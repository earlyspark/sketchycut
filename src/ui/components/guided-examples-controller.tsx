"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { DesignDocumentV1, MachineProfile, ProjectionBundle } from "../../domain/contracts";
import { MachineProfileSchema, ProcessRecipeSchema } from "../../domain/contracts";
import {
  resolveFabricationSetup,
  type AppliedFabricationSetup
} from "../../domain/fabrication-setup";
import { resolveNominalStockPreset, type NominalStockPresetId } from "../../domain/stock-catalog";
import { buildXToolStudioHandoff } from "../../projections/handoff";
import { isLatestCompileResponse } from "../../workers/latest-response";
import type {
  CompileWorkerRequest,
  CompileWorkerResponse,
  FixtureCompileWorkerRequest,
  ProductCompileWorkerRequest
} from "../../workers/protocol";
import {
  DEFAULT_GUIDED_EXAMPLE,
  GUIDED_EXAMPLE_CATALOG,
  buildGuidedProductCompileRequest,
  type AvailableGuidedExample
} from "../content/guided-examples";
import {
  ORTHOGONAL_PRESETS,
  type OrthogonalPresetId
} from "../content/presets";
import { PUBLIC_GUIDED_FIT_MODES_ENABLED } from "../feature-flags";
import { draftFromApplied, useAppliedFabricationSetup } from "../hooks/use-applied-fabrication-setup";
import {
  evaluateFabricationSetupDraft,
  evaluateRetainedPinDraft
} from "../setup-draft";

import {
  CanonicalProjectWorkspace,
  type CanonicalHandoffState,
  type CanonicalProjectState
} from "./canonical-project-workspace";
import { LaserCalibrationPanel } from "./laser-calibration-panel";
import { PinStockPanel } from "./pin-stock-panel";
import { SheetMeasurementPanel } from "./sheet-measurement-panel";
import { StockFitControls, type SetupMode } from "./stock-fit-controls";

type FixtureState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      document: DesignDocumentV1;
      geometryHash: string;
      bundle: ProjectionBundle;
      svgs: { sheetId: string; svg: string; sha256: string }[];
    };

function forcedMachine(machine: MachineProfile, enabled: boolean): MachineProfile {
  if (!enabled) return machine;
  return MachineProfileSchema.parse({
    ...machine,
    id: `${machine.id}-compact`,
    name: "Compact proof bed",
    processingEnvelopeMm: { width: 132, height: 102 }
  });
}

function downloadSvg(filename: string, svg: string): void {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function setupModeForApplied(applied: AppliedFabricationSetup): SetupMode {
  if (applied.cutWidth.source !== "provisional-preset") return "calibrate";
  return applied.thickness.basis === "user-reported-caliper" ? "measure" : "starter";
}

function sourceLabel(applied: AppliedFabricationSetup): string {
  const thickness = applied.thickness.basis === "nominal-preset"
    ? "registered starter thickness"
    : `${String(applied.thickness.readingsMm.length)} user-reported caliper reading${applied.thickness.readingsMm.length === 1 ? "" : "s"}`;
  const cut = applied.cutWidth.source === "fixture-derived"
    ? "packed-span fit-test-derived cut width"
    : applied.cutWidth.source === "user-reported-manual"
    ? "manually reported directional cut width"
    : "starter cut-width estimate";
  return `${thickness} · ${cut}`;
}

export function GuidedExamplesController() {
  const workerRef = useRef<Worker | null>(null);
  const productRequestCounter = useRef(0);
  const fixtureRequestCounter = useRef(0);
  const setup = useAppliedFabricationSetup(
    DEFAULT_GUIDED_EXAMPLE.programAdapter.structuralKind,
  );
  const [activeEntry, setActiveEntry] = useState<AvailableGuidedExample>(
    DEFAULT_GUIDED_EXAMPLE,
  );
  const [setupMode, setSetupMode] = useState<SetupMode>("starter");
  const [additionalReadingsVisible, setAdditionalReadingsVisible] = useState(false);
  const [advancedCutWidthOpen, setAdvancedCutWidthOpen] = useState(false);
  const [presetId, setPresetId] = useState<OrthogonalPresetId>("medium");
  const [compactBed, setCompactBed] = useState(false);
  const [project, setProject] = useState<CanonicalProjectState>({
    status: "loading",
    requestId: null
  });
  const [fixture, setFixture] = useState<FixtureState>({ status: "loading" });
  const [handoff, setHandoff] = useState<CanonicalHandoffState>({ status: "loading" });

  const resolvedApplied = useMemo(() => resolveFabricationSetup(setup.applied), [setup.applied]);
  const productProfiles = useMemo(() => {
    const machine = forcedMachine(resolvedApplied.machine, compactBed);
    return {
      material: resolvedApplied.material,
      machine,
      processRecipe: ProcessRecipeSchema.parse({
        ...resolvedApplied.processRecipe,
        id: compactBed
          ? `${resolvedApplied.processRecipe.id}-compact`
          : resolvedApplied.processRecipe.id,
        machineProfileId: machine.id
      }),
      fabricationContext: resolvedApplied.fabricationContext,
      fit: resolvedApplied.fit
    };
  }, [compactBed, resolvedApplied]);

  if (activeEntry.programAdapter.structuralKind !== setup.capabilityInputs.activeStructuralKind) {
    throw new Error("Selected presentation entry and active capability state diverged.");
  }

  const fixtureArtifactHash = fixture.status === "ready"
    ? fixture.svgs[0]?.sha256 ?? null
    : null;
  const draftEvaluation = useMemo(() => evaluateFabricationSetupDraft(setup.draft, {
    requireAdditionalThicknessReadings: setupMode === "measure" && additionalReadingsVisible,
    fixtureArtifactHash
  }), [additionalReadingsVisible, fixtureArtifactHash, setup.draft, setupMode]);
  const pinDraftEvaluation = useMemo(
    () => evaluateRetainedPinDraft(setup.capabilityInputs.retainedPin.draft),
    [setup.capabilityInputs.retainedPin.draft],
  );

  useEffect(() => {
    const worker = new Worker(
      new URL("../../workers/compile.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    const failWorker = (code: "WORKER_RUNTIME_ERROR" | "WORKER_MESSAGE_ERROR"): void => {
      const message = `${code}: The geometry worker stopped before it could return a validated result.`;
      setProject({
        status: "error",
        requestId: `product-${String(productRequestCounter.current)}`,
        message
      });
      setFixture({ status: "error", message });
      setHandoff({ status: "error", message });
    };
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      failWorker("WORKER_RUNTIME_ERROR");
    });
    worker.addEventListener("messageerror", () => {
      failWorker("WORKER_MESSAGE_ERROR");
    });
    worker.addEventListener("message", (event: MessageEvent<CompileWorkerResponse>) => {
      const response = event.data;
      if (!isLatestCompileResponse(response, {
        product: `product-${String(productRequestCounter.current)}`,
        fixture: `fixture-${String(fixtureRequestCounter.current)}`
      })) return;
      if (response.kind === "product-success" || response.kind === "product-error") {
        if (response.status === "error") {
          setProject({
            status: "error",
            requestId: response.requestId,
            message: response.message
          });
          return;
        }
        setProject({
          status: "ready",
          requestId: response.requestId,
          document: response.document,
          geometryHash: response.geometryHash,
          bundle: response.bundle,
          evidence: response.evidence,
          svgs: response.svgs
        });
        return;
      }
      if (response.status === "error") {
        setFixture({ status: "error", message: response.message });
        return;
      }
      setFixture({
        status: "ready",
        document: response.document,
        geometryHash: response.geometryHash,
        bundle: response.bundle,
        svgs: response.svgs
      });
    });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (worker === null) return;
    productRequestCounter.current += 1;
    const requestId = `product-${String(productRequestCounter.current)}`;
    const request: ProductCompileWorkerRequest = buildGuidedProductCompileRequest(
      activeEntry,
      {
        requestId,
        presetId,
        profiles: productProfiles,
        inputPolicyEvaluation: resolvedApplied.inputPolicyEvaluation,
        retainedPin: setup.capabilityInputs.retainedPin.applied
      },
    );
    setProject({ status: "loading", requestId });
    worker.postMessage(request satisfies CompileWorkerRequest);
  }, [
    activeEntry,
    presetId,
    productProfiles,
    resolvedApplied.inputPolicyEvaluation,
    setup.capabilityInputs.retainedPin.applied
  ]);

  useEffect(() => {
    const worker = workerRef.current;
    if (worker === null) return;
    fixtureRequestCounter.current += 1;
    const request: FixtureCompileWorkerRequest = {
      kind: "fixture-compile",
      requestId: `fixture-${String(fixtureRequestCounter.current)}`,
      stockPresetId: setup.draft.stockPresetId
    };
    setFixture({ status: "loading" });
    worker.postMessage(request satisfies CompileWorkerRequest);
  }, [setup.draft.stockPresetId]);

  useEffect(() => {
    if (project.status !== "ready" || fixture.status !== "ready") {
      setHandoff({ status: "loading" });
      return;
    }
    let cancelled = false;
    void buildXToolStudioHandoff(
      project.document.resolvedInputs.machine,
      { fabrication: project.bundle.fabrication, svgs: project.svgs },
      { fabrication: fixture.bundle.fabrication, svgs: fixture.svgs },
    ).then((nextHandoff) => {
      if (!cancelled) setHandoff({ status: "ready", handoff: nextHandoff });
    }).catch((error: unknown) => {
      if (!cancelled) {
        setHandoff({
          status: "error",
          message: error instanceof Error ? error.message : "Handoff projection failed."
        });
      }
    });
    return () => { cancelled = true; };
  }, [fixture, project]);

  const draftPolicy = draftEvaluation.status === "valid"
    ? draftEvaluation.policyEvaluation
    : draftEvaluation.policyEvaluation ?? null;
  const draftError = draftEvaluation.status === "invalid"
    ? draftEvaluation.message
    : setup.capabilityInputs.activeStructuralKind === "retained-pin" &&
        pinDraftEvaluation.status === "invalid"
      ? pinDraftEvaluation.message
      : null;
  const draftFindings = draftEvaluation.status === "invalid"
    ? draftEvaluation.findings
    : draftEvaluation.policyEvaluation.findings;
  const appliedStock = resolveNominalStockPreset(setup.applied.stockPresetId);
  const appliedThickness = resolvedApplied.material.measuredThicknessMm;
  const appliedSummary = (
    <p>
      <strong>{appliedStock.supplierLabel}</strong><br />
      {appliedThickness.toFixed(2)} mm effective thickness · {setup.applied.cutWidth.xMm.toFixed(2)} mm across /{" "}
      {setup.applied.cutWidth.yMm.toFixed(2)} mm down<br />
      <small>{sourceLabel(setup.applied)}</small>
    </p>
  );

  const setDraftReading = (index: 0 | 1 | 2, value: string): void => {
    setup.setDraft((current) => {
      const readings = [...current.thickness.readings] as [string, string, string];
      readings[index] = value;
      return { ...current, thickness: { ...current.thickness, readings } };
    });
  };
  const changeMode = (mode: SetupMode): void => {
    setSetupMode(mode);
    setAdvancedCutWidthOpen(false);
    const restored = draftFromApplied(setup.applied);
    restored.stockPresetId = setup.draft.stockPresetId;
    if (mode === "starter") {
      setup.chooseStarter(setup.draft.stockPresetId);
      setAdditionalReadingsVisible(false);
    } else if (mode === "measure") {
      restored.thickness = {
        basis: "user-reported-caliper",
        readings: setup.applied.thickness.basis === "user-reported-caliper"
          ? draftFromApplied(setup.applied).thickness.readings
          : ["", "", ""]
      };
      setup.setDraft(restored);
      setAdditionalReadingsVisible(restored.thickness.readings[1].length > 0);
    } else {
      restored.cutWidth = {
        ...restored.cutWidth,
        source: "fixture-derived",
        packedRow: setup.applied.cutWidth.fixtureEvidence?.enteredPackedSpanMm.row.toFixed(2) ?? "",
        packedColumn: setup.applied.cutWidth.fixtureEvidence?.enteredPackedSpanMm.column.toFixed(2) ?? ""
      };
      setup.setDraft(restored);
    }
  };
  const discardDraft = (): void => {
    setup.discard();
    setSetupMode(setupModeForApplied(setup.applied));
    setAdditionalReadingsVisible(
      setup.applied.thickness.basis === "user-reported-caliper" &&
      setup.applied.thickness.readingsMm.length === 3,
    );
  };
  const applyDraft = (): void => {
    if (draftEvaluation.status !== "valid") return;
    if (setup.capabilityInputs.activeStructuralKind === "retained-pin") {
      if (pinDraftEvaluation.status !== "valid") return;
      setup.apply(draftEvaluation.applied, pinDraftEvaluation.applied);
      return;
    }
    setup.apply(draftEvaluation.applied);
  };
  const selectEntry = (entry: AvailableGuidedExample): void => {
    if (entry.id === activeEntry.id) return;
    productRequestCounter.current += 1;
    setup.activateStructuralKind(entry.programAdapter.structuralKind);
    setActiveEntry(entry);
    setProject({ status: "loading", requestId: null });
    setHandoff({ status: "loading" });
  };
  const fixtureDownloads = fixture.status === "ready" ? fixture.svgs : [];
  const calibrationResult = setupMode === "calibrate" && draftEvaluation.status === "valid"
    ? draftEvaluation.policyEvaluation
    : null;

  const designContent = (
    <>
      <StockFitControls
        stockPresetId={setup.draft.stockPresetId}
        mode={setupMode}
        showModeChooser={PUBLIC_GUIDED_FIT_MODES_ENABLED}
        stale={setup.stale}
        canApply={draftEvaluation.status === "valid" && (
          setup.capabilityInputs.activeStructuralKind !== "retained-pin" ||
          pinDraftEvaluation.status === "valid"
        )}
        appliedSummary={appliedSummary}
        invalidMessage={draftError}
        findings={setup.stale ? draftFindings : []}
        onStockChange={(id: NominalStockPresetId) => setup.setDraft((current) => ({ ...current, stockPresetId: id }))}
        onModeChange={changeMode}
        onApply={applyDraft}
        onDiscard={discardDraft}
        measurementControls={setupMode === "measure" ? (
          <SheetMeasurementPanel
            readings={setup.draft.thickness.readings}
            additionalVisible={additionalReadingsVisible}
            evaluation={draftPolicy}
            invalidMessage={draftError}
            onChange={setDraftReading}
            onShowAdditional={() => setAdditionalReadingsVisible(true)}
            onUseOneReading={() => {
              setAdditionalReadingsVisible(false);
              setup.setDraft((current) => ({
                ...current,
                thickness: {
                  ...current.thickness,
                  readings: [current.thickness.readings[0], "", ""]
                }
              }));
            }}
          />
        ) : (
          <LaserCalibrationPanel
            packedRow={setup.draft.cutWidth.packedRow}
            packedColumn={setup.draft.cutWidth.packedColumn}
            manualX={setup.draft.cutWidth.manualX}
            manualY={setup.draft.cutWidth.manualY}
            manualActive={setup.draft.cutWidth.source === "user-reported-manual"}
            advancedOpen={advancedCutWidthOpen}
            fixtureDownloads={fixtureDownloads}
            fixtureLoading={fixture.status === "loading"}
            result={calibrationResult}
            findings={draftFindings}
            invalidMessage={draftError}
            onPackedRowChange={(value) => setup.setDraft((current) => ({
              ...current,
              cutWidth: { ...current.cutWidth, source: "fixture-derived", packedRow: value }
            }))}
            onPackedColumnChange={(value) => setup.setDraft((current) => ({
              ...current,
              cutWidth: { ...current.cutWidth, source: "fixture-derived", packedColumn: value }
            }))}
            onManualXChange={(value) => setup.setDraft((current) => ({
              ...current,
              cutWidth: { ...current.cutWidth, source: "user-reported-manual", manualX: value }
            }))}
            onManualYChange={(value) => setup.setDraft((current) => ({
              ...current,
              cutWidth: { ...current.cutWidth, source: "user-reported-manual", manualY: value }
            }))}
            onManualActiveChange={(manual) => setup.setDraft((current) => ({
              ...current,
              cutWidth: {
                ...current.cutWidth,
                source: manual ? "user-reported-manual" : "fixture-derived"
              }
            }))}
            onToggleAdvanced={() => setAdvancedCutWidthOpen((value) => !value)}
            onDownloadFixture={(item) => downloadSvg(`sketchycut-cut-width-fit-test-${item.sheetId}.svg`, item.svg)}
          />
        )}
        capabilityInputs={setup.capabilityInputs.activeStructuralKind === "retained-pin" ? (
          <PinStockPanel
            measured={setup.capabilityInputs.retainedPin.draft.basis === "user-reported-caliper"}
            diameter={setup.capabilityInputs.retainedPin.draft.diameter}
            invalid={pinDraftEvaluation.status === "invalid"}
            onMeasuredChange={(measured) => setup.setRetainedPinDraft({
              basis: measured ? "user-reported-caliper" : "nominal-preset",
              diameter: measured ? "" : "3.00"
            })}
            onDiameterChange={(value) => setup.setRetainedPinDraft({
              ...setup.capabilityInputs.retainedPin.draft,
              diameter: value
            })}
          />
        ) : null}
        optionalTools={(
          <div className="fixture-utility">
            <strong>Optional cut-width fit test</strong>
            <p>
              Estimates directional full cut width using the selected material and a recipe
              you have already tested. It does not calibrate the M2, find a working recipe,
              prove joint fit, or update the starter preview.
            </p>
            <p>
              Cut it with the same material, grain orientation, process settings, and support
              arrangement as the product. Keep xTool Studio Kerf Offset off/0.
            </p>
            {fixtureDownloads.map((item) => (
              <button
                key={item.sheetId}
                type="button"
                onClick={() => downloadSvg(`sketchycut-cut-width-fit-test-${item.sheetId}.svg`, item.svg)}
              >Download optional cut-width fit test</button>
            ))}
            {fixture.status === "loading"
              ? <button type="button" disabled>Preparing optional fit test…</button>
              : null}
            {fixture.status === "error" ? <p className="field-error">{fixture.message}</p> : null}
          </div>
        )}
      />

      <section className="controls secondary-controls" aria-label="Deterministic design controls">
        <fieldset>
          <legend>Size preset</legend>
          <div className="segmented">
            {ORTHOGONAL_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={presetId === preset.id ? "active" : ""}
                onClick={() => setPresetId(preset.id)}
              >{preset.label}</button>
            ))}
          </div>
        </fieldset>
        <label className="check-control">
          <input
            type="checkbox"
            checked={compactBed}
            onChange={(event) => setCompactBed(event.currentTarget.checked)}
          />
          Force multi-sheet proof
        </label>
      </section>
    </>
  );

  return (
    <main className="examples-page">
      <header className="hero">
        <div className="hero-copy">
          <p className="section-kicker">Sample demo</p>
          <h1>&quot;Make me a box&quot;</h1>
          <p className="lede">Enter a brief, optionally add up to 3 reference images, and hit &quot;Generate project&quot;</p>
        </div>
      </header>

      <section className="example-selector" aria-labelledby="example-selector-heading">
        <h2 id="example-selector-heading">Examples</h2>
        <div className="example-selector-controls" role="group" aria-label="Choose an example">
          {GUIDED_EXAMPLE_CATALOG.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={activeEntry.id === entry.id}
              className={activeEntry.id === entry.id ? "active" : ""}
              onClick={() => selectEntry(entry)}
            >{entry.label}</button>
          ))}
        </div>
      </section>

      <CanonicalProjectWorkspace
        project={project}
        handoff={handoff}
        presentation={{
          sourceId: activeEntry.id,
          structuralKind: setup.capabilityInputs.activeStructuralKind,
          partLabels: activeEntry.partAliases,
          instructionLabels: activeEntry.instructionAliases,
          ...(activeEntry.motionPresentation === undefined
            ? {}
            : { motion: activeEntry.motionPresentation })
        }}
        designContent={designContent}
        sourceSummary={(
          <section className="source-summary" aria-label="Example source">
            <p className="section-kicker">Pre-interpreted source</p>
            <h3>{activeEntry.label}</h3>
          </section>
        )}
        stale={setup.stale}
      />
    </main>
  );
}
