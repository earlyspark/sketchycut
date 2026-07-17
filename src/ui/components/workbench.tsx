"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  DesignDocumentV1,
  MachineProfile,
  ProjectionBundle
} from "../../domain/contracts";
import { MachineProfileSchema } from "../../domain/contracts";
import {
  resolveFabricationSetup,
  type AppliedFabricationSetup
} from "../../domain/fabrication-setup";
import { resolveNominalStockPreset, type NominalStockPresetId } from "../../domain/stock-catalog";
import type { FabricationEvidenceProjection } from "../../projections/evidence";
import type {
  CompileWorkerRequest,
  CompileWorkerResponse,
  FixtureCompileWorkerRequest,
  ProductCompileWorkerRequest
} from "../../workers/protocol";
import { isLatestCompileResponse } from "../../workers/latest-response";
import {
  ORTHOGONAL_PRESETS,
  PRODUCT_COPY,
  createRetainedPreset,
  type OrthogonalPresetId
} from "../content/presets";
import { PUBLIC_GUIDED_FIT_MODES_ENABLED } from "../feature-flags";
import { useAppliedFabricationSetup, draftFromApplied } from "../hooks/use-applied-fabrication-setup";
import { evaluateFabricationSetupDraft } from "../setup-draft";

import { LaserCalibrationPanel } from "./laser-calibration-panel";
import { PinStockPanel } from "./pin-stock-panel";
import { SceneViewer } from "./scene-viewer";
import { SheetMeasurementPanel } from "./sheet-measurement-panel";
import { SheetView } from "./sheet-view";
import { StockFitControls, type SetupMode } from "./stock-fit-controls";

type ProductCompileState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      document: DesignDocumentV1;
      geometryHash: string;
      bundle: ProjectionBundle;
      evidence: FabricationEvidenceProjection;
      svgs: { sheetId: string; svg: string; sha256: string }[];
    };

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
    bedMm: { width: 132, height: 102, margin: 5 }
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
    ? "packed-span fixture-derived cut width"
    : applied.cutWidth.source === "user-reported-manual"
    ? "manually reported directional cut width"
    : "starter cut-width estimate";
  return `${thickness} · ${cut}`;
}

function displayPartName(partId: string, canonicalName: string): string {
  return partId === "open-stop-brace" ? "Lid-open stop" : canonicalName;
}

function displayInstructionKey(key: string): string {
  return key === "install-open-stop-brace"
    ? "install lid-open stop"
    : key.replaceAll("-", " ");
}

export function Workbench() {
  const workerRef = useRef<Worker | null>(null);
  const productRequestCounter = useRef(0);
  const fixtureRequestCounter = useRef(0);
  const setup = useAppliedFabricationSetup();
  const [setupMode, setSetupMode] = useState<SetupMode>("starter");
  const [additionalReadingsVisible, setAdditionalReadingsVisible] = useState(false);
  const [advancedCutWidthOpen, setAdvancedCutWidthOpen] = useState(false);
  const [presetId, setPresetId] = useState<OrthogonalPresetId>("medium");
  const [compactBed, setCompactBed] = useState(false);
  const [sceneState, setSceneState] = useState<"assembled" | "exploded">("assembled");
  const [motionDegrees, setMotionDegrees] = useState(0);
  const [activeSheetId, setActiveSheetId] = useState("sheet-1");
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [compileState, setCompileState] = useState<ProductCompileState>({ status: "loading" });
  const [fixtureState, setFixtureState] = useState<FixtureState>({ status: "loading" });

  const resolvedApplied = useMemo(() => resolveFabricationSetup(setup.applied), [setup.applied]);
  const productProfiles = useMemo(() => ({
    material: resolvedApplied.material,
    machine: forcedMachine(resolvedApplied.machine, compactBed),
    fit: resolvedApplied.fit
  }), [compactBed, resolvedApplied]);
  const program = useMemo(() => createRetainedPreset(
    presetId,
    productProfiles,
    {
      effectiveDiameterMm: setup.applied.pin.effectiveDiameterMm,
      basis: setup.applied.pin.basis
    },
  ), [presetId, productProfiles, setup.applied.pin]);
  const fixtureArtifactHash = fixtureState.status === "ready"
    ? fixtureState.svgs[0]?.sha256 ?? null
    : null;
  const draftEvaluation = useMemo(() => evaluateFabricationSetupDraft(setup.draft, {
    requireAdditionalThicknessReadings:
      setupMode === "measure" && additionalReadingsVisible,
    fixtureArtifactHash
  }), [additionalReadingsVisible, fixtureArtifactHash, setup.draft, setupMode]);

  useEffect(() => {
    const worker = new Worker(
      new URL("../../workers/compile.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.addEventListener("message", (event: MessageEvent<CompileWorkerResponse>) => {
      const response = event.data;
      if (!isLatestCompileResponse(response, {
        product: `product-${String(productRequestCounter.current)}`,
        fixture: `fixture-${String(fixtureRequestCounter.current)}`
      })) return;
      if (response.kind === "product-success" || response.kind === "product-error") {
        if (response.status === "error") {
          setCompileState({ status: "error", message: response.message });
          return;
        }
        setCompileState({
          status: "ready",
          document: response.document,
          geometryHash: response.geometryHash,
          bundle: response.bundle,
          evidence: response.evidence,
          svgs: response.svgs
        });
        setActiveSheetId(response.bundle.fabrication.sheets[0]?.id ?? "sheet-1");
        setSelectedPartId(response.document.parts[0]?.id ?? null);
        setSceneState("assembled");
        setMotionDegrees(0);
        return;
      }
      if (response.status === "error") {
        setFixtureState({ status: "error", message: response.message });
        return;
      }
      setFixtureState({
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
    const request: ProductCompileWorkerRequest = {
      kind: "product-compile",
      requestId: `product-${String(productRequestCounter.current)}`,
      program,
      profiles: productProfiles,
      inputPolicyEvaluation: resolvedApplied.inputPolicyEvaluation
    };
    setCompileState({ status: "loading" });
    worker.postMessage(request satisfies CompileWorkerRequest);
  }, [productProfiles, program, resolvedApplied.inputPolicyEvaluation]);

  useEffect(() => {
    const worker = workerRef.current;
    if (worker === null) return;
    fixtureRequestCounter.current += 1;
    const request: FixtureCompileWorkerRequest = {
      kind: "fixture-compile",
      requestId: `fixture-${String(fixtureRequestCounter.current)}`,
      stockPresetId: setup.draft.stockPresetId
    };
    setFixtureState({ status: "loading" });
    worker.postMessage(request satisfies CompileWorkerRequest);
  }, [setup.draft.stockPresetId]);

  const activeSheet = compileState.status === "ready"
    ? compileState.bundle.fabrication.sheets.find((sheet) => sheet.id === activeSheetId) ??
      compileState.bundle.fabrication.sheets[0]
    : undefined;
  const selectedPart = compileState.status === "ready"
    ? compileState.document.parts.find((part) => part.id === selectedPartId)
    : undefined;
  const selectedStock = compileState.status === "ready"
    ? compileState.document.externalStock?.find((item) => item.id === selectedPartId)
    : undefined;
  const motionMaximum = compileState.status === "ready"
    ? compileState.bundle.scene.motions?.[0]?.rangeDegrees.maximum ?? 0
    : 0;
  const atOpenStop = sceneState === "assembled" && motionMaximum > 0 && motionDegrees === motionMaximum;
  const inMidTravel = sceneState === "assembled" && motionDegrees > 0 && motionDegrees < motionMaximum;
  const draftPolicy = draftEvaluation.status === "valid"
    ? draftEvaluation.policyEvaluation
    : draftEvaluation.policyEvaluation ?? null;
  const draftError = draftEvaluation.status === "invalid" ? draftEvaluation.message : null;
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

  const selectPart = (partId: string): void => setSelectedPartId(partId.length === 0 ? null : partId);
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
    setup.apply(draftEvaluation.applied);
  };
  const fixtureDownloads = fixtureState.status === "ready" ? fixtureState.svgs : [];
  const calibrationResult = setupMode === "calibrate" && draftEvaluation.status === "valid"
    ? draftEvaluation.policyEvaluation
    : null;

  return (
    <main>
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{PRODUCT_COPY.eyebrow}</p>
          <h1>{PRODUCT_COPY.title}</h1>
          <p className="lede">{PRODUCT_COPY.description}</p>
        </div>
        <div className="hero-proof">
          <span>Nominal geometry</span>
          <strong>{compileState.status === "ready" ? compileState.geometryHash.slice(0, 12) : "compiling…"}</strong>
          <small>
            Evaluation {compileState.status === "ready"
              ? compileState.bundle.sourceDocumentHash.slice(0, 12)
              : "pending"} · 0 model calls
          </small>
        </div>
      </header>

      <StockFitControls
        stockPresetId={setup.draft.stockPresetId}
        mode={setupMode}
        showModeChooser={PUBLIC_GUIDED_FIT_MODES_ENABLED}
        stale={setup.stale}
        canApply={draftEvaluation.status === "valid"}
        appliedSummary={appliedSummary}
        invalidMessage={draftError}
        findings={setup.stale ? draftFindings : []}
        onStockChange={(id: NominalStockPresetId) => setup.setDraft((current) => ({ ...current, stockPresetId: id }))}
        onModeChange={changeMode}
        onApply={applyDraft}
        onDiscard={discardDraft}
      >
        {setupMode === "measure" ? (
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
            fixtureLoading={fixtureState.status === "loading"}
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
            onDownloadFixture={(item) => downloadSvg(`sketchycut-cut-width-${item.sheetId}.svg`, item.svg)}
          />
        )}
      </StockFitControls>

      <section className="pin-and-fixture-utility" aria-label="Hinge pin and independent fixture">
        <PinStockPanel
          measured={setup.draft.pin.basis === "user-reported-caliper"}
          diameter={setup.draft.pin.diameter}
          invalid={draftError?.toLowerCase().includes("pin") ?? false}
          onMeasuredChange={(measured) => setup.setDraft((current) => ({
            ...current,
            pin: {
              basis: measured ? "user-reported-caliper" : "nominal-preset",
              diameter: measured ? "" : "3.00"
            }
          }))}
          onDiameterChange={(value) => setup.setDraft((current) => ({
            ...current,
            pin: { ...current.pin, diameter: value }
          }))}
        />
        <div className="fixture-utility">
          <strong>Independent calibration fixture</strong>
          <p>Available even while product settings are incomplete, invalid, or not applied.</p>
          {fixtureDownloads.map((item) => (
            <button
              key={item.sheetId}
              type="button"
              onClick={() => downloadSvg(`sketchycut-cut-width-${item.sheetId}.svg`, item.svg)}
            >
              Download cut-width fixture
            </button>
          ))}
          {fixtureState.status === "loading" ? <button type="button" disabled>Preparing fixture…</button> : null}
          {fixtureState.status === "error" ? <p className="field-error">{fixtureState.message}</p> : null}
        </div>
      </section>

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
              >
                {preset.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="check-control">
          <input type="checkbox" checked={compactBed} onChange={(event) => setCompactBed(event.currentTarget.checked)} />
          Force multi-sheet proof
        </label>
      </section>

      {compileState.status === "error" ? (
        <section className="error-panel"><h2>Export withheld</h2><p>{compileState.message}</p></section>
      ) : null}

      <section className="workspace" aria-busy={compileState.status === "loading"}>
        <article className="panel viewer-panel">
          <div className="panel-heading">
            <div><p className="section-kicker">3D verification</p><h2>Assembly scene</h2></div>
            <div className="segmented compact">
              <button
                type="button"
                className={sceneState === "assembled" && motionDegrees === 0 ? "active" : ""}
                onClick={() => { setSceneState("assembled"); setMotionDegrees(0); }}
              >Closed</button>
              <button
                type="button"
                className={atOpenStop ? "active" : ""}
                onClick={() => {
                  setSceneState("assembled");
                  setMotionDegrees(motionMaximum);
                  setSelectedPartId("open-stop-brace");
                }}
              >Open</button>
              <button
                type="button"
                className={sceneState === "exploded" ? "active" : ""}
                onClick={() => setSceneState("exploded")}
              >Exploded</button>
            </div>
          </div>
          <div className="viewer-canvas" data-testid="scene-viewer">
            {compileState.status === "ready" ? (
              <SceneViewer
                scene={compileState.bundle.scene}
                stateKind={sceneState}
                motionDegrees={motionDegrees}
                selectedPartId={selectedPartId}
                onSelectPart={selectPart}
              />
            ) : <div className="loading-state">Building exact meshes…</div>}
          </div>
          {compileState.status === "ready" && motionMaximum > 0 ? (
            <label className="motion-control">
              Open / close · {motionDegrees.toFixed(0)}°
              <input
                aria-label="Retained pin motion angle"
                aria-valuetext={`${motionDegrees.toFixed(0)} degrees${atOpenStop ? ", lid-open stop contact" : inMidTravel ? ", expected gap before stop" : ""}`}
                type="range"
                min="0"
                max={motionMaximum}
                step="1"
                value={motionDegrees}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  setSceneState("assembled");
                  setMotionDegrees(next);
                  if (next === motionMaximum) setSelectedPartId("open-stop-brace");
                }}
              />
              <small>
                Deterministic endpoint proof certifies canonical contact; this animation
                only explains the pose. Physical contact and motion remain unverified.
              </small>
            </label>
          ) : null}
          <div className="selection-strip">
            <span>{selectedStock === undefined ? "Selected part" : "Selected external stock"}</span>
            <strong>{selectedPart === undefined
              ? selectedStock?.name ?? "None"
              : displayPartName(selectedPart.id, selectedPart.name)}</strong>
            <code>{selectedPartId ?? "—"}</code>
          </div>
        </article>

        <article className="panel sheet-panel">
          <div className="panel-heading">
            <div><p className="section-kicker">2D fabrication</p><h2>Sheet projection</h2></div>
            {compileState.status === "ready" ? (
              <select aria-label="Active fabrication sheet" value={activeSheet?.id} onChange={(event) => setActiveSheetId(event.currentTarget.value)}>
                {compileState.bundle.fabrication.sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.id}</option>)}
              </select>
            ) : null}
          </div>
          <div className="sheet-stage" data-testid="sheet-view">
            {activeSheet === undefined
              ? <div className="loading-state">Projecting compensated paths…</div>
              : <SheetView sheet={activeSheet} selectedPartId={selectedPartId} onSelectPart={selectPart} />}
          </div>
          <div className="operation-key"><span><i className="key-cut" /> Cut</span><span><i className="key-score" /> Score</span><span><i className="key-engrave" /> Engrave</span></div>
          <div className="download-row product-downloads">
            {compileState.status === "ready" ? compileState.svgs.map((item) => (
              <button
                key={item.sheetId}
                type="button"
                disabled={setup.stale}
                aria-describedby={setup.stale ? "product-download-paused" : undefined}
                onClick={() => downloadSvg(`sketchycut-product-${item.sheetId}.svg`, item.svg)}
              >Download product {item.sheetId}</button>
            )) : null}
          </div>
          {setup.stale ? <p id="product-download-paused" className="field-warning">Apply or discard setup changes before downloading product SVGs.</p> : null}
        </article>
      </section>

      <section className="linked-data">
        <article className="panel data-panel">
          <div className="panel-heading"><div><p className="section-kicker">Linked identifiers</p><h2>Parts and sheets</h2></div><span className="count-pill">{compileState.status === "ready" ? `${String(compileState.document.parts.length)} cut parts + ${String(compileState.document.externalStock?.length ?? 0)} stock` : "—"}</span></div>
          <div className="table-wrap"><table><thead><tr><th>Mark</th><th>Part</th><th>Sheet</th></tr></thead><tbody>
            {compileState.status === "ready" ? compileState.bundle.legend?.entries.map((entry) => (
              <tr key={entry.id} className={selectedPartId === entry.partId ? "selected-row" : ""} onClick={() => selectPart(entry.partId)}>
                <td><code>{entry.markingCode}</code></td><td>{displayPartName(entry.partId, entry.name)}</td><td>{entry.sheetId}</td>
              </tr>
            )) : null}
            {compileState.status === "ready" ? compileState.bundle.bom.entries.filter((entry) => entry.entryKind === "external-stock").map((entry) => (
              <tr key={entry.id} className={selectedPartId === entry.partId ? "selected-row" : ""} onClick={() => selectPart(entry.partId)}>
                <td><code>stock</code></td><td>{entry.name} · {entry.measuredDiameterMm?.toFixed(2)} mm × {entry.cutLengthMm?.toFixed(2)} mm</td><td>Not in SVG</td>
              </tr>
            )) : null}
          </tbody></table></div>
        </article>

        <article className="panel data-panel">
          <div className="panel-heading"><div><p className="section-kicker">Deterministic sequence</p><h2>Assembly instructions</h2></div></div>
          <ol className="instructions">{compileState.status === "ready" ? compileState.bundle.instructions?.steps.map((step) => (
            <li key={step.id}><button type="button" onClick={() => selectPart(step.stockItemIds?.[0] ?? step.partIds[0]!)}><span>{String(step.order + 1).padStart(2, "0")}</span><strong>{displayInstructionKey(step.instructionKey)}</strong><small>{step.phase ?? "assembly"} · {step.stockItemIds?.join(", ") ?? step.sheetIds.join(", ")}</small></button></li>
          )) : null}</ol>
        </article>

        <article className="panel data-panel evidence-panel">
          <div className="panel-heading"><div><p className="section-kicker">Evidence boundary</p><h2>Validation state</h2></div></div>
          {compileState.status === "ready" ? <>
            <p className="status-pass">Deterministic checks passed</p>
            <p className="evidence-claim">{compileState.evidence.claim}</p>
            <dl><div><dt>Sheets</dt><dd>{compileState.bundle.fabrication.sheets.length}</dd></div><div><dt>Joints</dt><dd>{compileState.document.joints.length}</dd></div><div><dt>Motion</dt><dd>1 revolute · 0–{motionMaximum}°</dd></div><div><dt>API calls</dt><dd>{compileState.document.provenance.runtimeApplicationApiCalls}</dd></div></dl>
            <ul className="warnings">
              {compileState.document.provenance.inputPolicyEvaluation?.findings.map((item) => <li key={item.code + item.message}>{item.message}</li>)}
              {compileState.document.validation.findings.map((item) => <li key={item.code}>{item.message}</li>)}
            </ul>
            <p className="calibration-caveat">{compileState.document.constructionSelections?.[0]?.disclosure}</p>
          </> : <div className="loading-state">Running deterministic validators…</div>}
        </article>
      </section>

      <footer><p>{PRODUCT_COPY.verification}</p><span>Judge workspace</span></footer>
    </main>
  );
}
