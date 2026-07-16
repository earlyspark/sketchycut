"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  measuredBasswoodProfile,
  provisionalFitProfile,
  xtoolM2Profile
} from "../../domain/profiles";
import {
  NOMINAL_3MM_LASER_PLYWOOD_POLICY,
  evaluateStockInputs
} from "../../domain/input-policy";
import type {
  DesignDocumentV1,
  InputPolicyEvaluation,
  MachineProfile,
  ProjectionBundle
} from "../../domain/contracts";
import { MachineProfileSchema } from "../../domain/contracts";
import type {
  CompileWorkerRequest,
  CompileWorkerResponse
} from "../../workers/protocol";
import {
  ORTHOGONAL_PRESETS,
  PRODUCT_COPY,
  createPrimaryPreset,
  type OrthogonalPresetId
} from "../content/presets";

import { SceneViewer } from "./scene-viewer";
import { SheetView } from "./sheet-view";

type CompileState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      document: DesignDocumentV1;
      geometryHash: string;
      bundle: ProjectionBundle;
      svgs: { sheetId: string; svg: string; sha256: string }[];
      calibration: {
        document: DesignDocumentV1;
        geometryHash: string;
        bundle: ProjectionBundle;
        svgs: { sheetId: string; svg: string; sha256: string }[];
      };
    };

type InputPolicyState =
  | { status: "invalid"; message: string }
  | { status: "evaluated"; evaluation: InputPolicyEvaluation };

function forcedMachine(machine: MachineProfile, enabled: boolean): MachineProfile {
  if (!enabled) {
    return machine;
  }
  return MachineProfileSchema.parse({
    ...machine,
    id: `${machine.id}-compact`,
    name: "Compact proof bed",
    bedMm: { width: 132, height: 102, margin: 5 }
  });
}

export function Workbench() {
  const workerRef = useRef<Worker | null>(null);
  const requestCounter = useRef(0);
  const [presetId, setPresetId] = useState<OrthogonalPresetId>("medium");
  const [thicknessSamplesMm, setThicknessSamplesMm] = useState(["3.00", "3.00", "3.00"]);
  const [kerfXmm, setKerfXmm] = useState("0.15");
  const [kerfYmm, setKerfYmm] = useState("0.15");
  const [compactBed, setCompactBed] = useState(false);
  const [sceneState, setSceneState] = useState<"assembled" | "exploded">("assembled");
  const [activeSheetId, setActiveSheetId] = useState("sheet-1");
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [compileState, setCompileState] = useState<CompileState>({ status: "loading" });

  const inputPolicyState = useMemo<InputPolicyState>(() => {
    try {
      if (
        thicknessSamplesMm.some((value) => value.trim().length === 0) ||
        kerfXmm.trim().length === 0 ||
        kerfYmm.trim().length === 0
      ) {
        throw new RangeError("Enter all measured thickness and full-kerf values.");
      }
      return {
        status: "evaluated",
        evaluation: evaluateStockInputs({
          materialKind: "basswood-plywood",
          thicknessSamplesMm: thicknessSamplesMm.map(Number),
          kerfXmm: Number(kerfXmm),
          kerfYmm: Number(kerfYmm)
        })
      };
    } catch (error) {
      return {
        status: "invalid",
        message: error instanceof Error ? error.message : "Measured inputs are invalid."
      };
    }
  }, [kerfXmm, kerfYmm, thicknessSamplesMm]);
  const profiles = useMemo(() => {
    if (
      inputPolicyState.status !== "evaluated" ||
      inputPolicyState.evaluation.status !== "pass"
    ) {
      return null;
    }
    const evaluation = inputPolicyState.evaluation;
    const material = measuredBasswoodProfile(evaluation.thickness.samplesMm);
    const machine = forcedMachine(
      xtoolM2Profile(evaluation.kerf.xMm, evaluation.kerf.yMm),
      compactBed,
    );
    return { material, machine, fit: provisionalFitProfile() };
  }, [compactBed, inputPolicyState]);
  const program = useMemo(
    () => profiles === null ? null : createPrimaryPreset(presetId, profiles),
    [presetId, profiles],
  );

  useEffect(() => {
    const worker = new Worker(
      new URL("../../workers/compile.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.addEventListener("message", (event: MessageEvent<CompileWorkerResponse>) => {
      const response = event.data;
      const expectedRequestId = `compile-${String(requestCounter.current)}`;
      if (response.requestId !== expectedRequestId) {
        return;
      }
      if (response.status === "error") {
        setCompileState({ status: "error", message: response.message });
        return;
      }
      setCompileState({
        status: "ready",
        document: response.document,
        geometryHash: response.geometryHash,
        bundle: response.bundle,
        svgs: response.svgs,
        calibration: response.calibration
      });
      setActiveSheetId(response.bundle.fabrication.sheets[0]?.id ?? "sheet-1");
      setSelectedPartId(response.document.parts[0]?.id ?? null);
    });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (
      worker === null ||
      profiles === null ||
      program === null ||
      inputPolicyState.status !== "evaluated" ||
      inputPolicyState.evaluation.status !== "pass"
    ) {
      requestCounter.current += 1;
      const message = inputPolicyState.status === "invalid"
        ? inputPolicyState.message
        : inputPolicyState.evaluation.findings
            .filter((finding) => finding.severity === "error")
            .map((finding) => finding.message)
            .join(" ");
      if (message.length > 0) {
        setCompileState({ status: "error", message });
      }
      return;
    }
    requestCounter.current += 1;
    const requestId = `compile-${String(requestCounter.current)}`;
    setCompileState({ status: "loading" });
    const request: CompileWorkerRequest = {
      requestId,
      program,
      profiles,
      inputPolicyEvaluation: inputPolicyState.evaluation
    };
    worker.postMessage(request);
  }, [inputPolicyState, profiles, program]);

  const activeSheet = compileState.status === "ready"
    ? compileState.bundle.fabrication.sheets.find((sheet) => sheet.id === activeSheetId) ??
      compileState.bundle.fabrication.sheets[0]
    : undefined;
  const selectedPart = compileState.status === "ready"
    ? compileState.document.parts.find((part) => part.id === selectedPartId)
    : undefined;
  const selectPart = (partId: string): void => {
    setSelectedPartId(partId.length === 0 ? null : partId);
  };
  const updateThicknessSample = (index: number, value: string): void => {
    setThicknessSamplesMm((current) =>
      current.map((sample, sampleIndex) => sampleIndex === index ? value : sample),
    );
  };
  const downloadCalibrationSvg = (sheetId: string, svg: string): void => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sketchycut-accumulated-kerf-${sheetId}.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const policyEvaluation =
    inputPolicyState.status === "evaluated" ? inputPolicyState.evaluation : null;

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

      <section className="controls" aria-label="Deterministic design controls">
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
        <fieldset className="measurement-control">
          <legend>Actual measured thickness · nominal 3 mm</legend>
          <div className="measurement-inputs">
            {thicknessSamplesMm.map((value, index) => (
              <label key={String(index)}>
                Sample {String(index + 1)}
                <input
                  aria-label={`Measured stock thickness sample ${String(index + 1)}`}
                  type="number"
                  inputMode="decimal"
                  min={NOMINAL_3MM_LASER_PLYWOOD_POLICY.thickness.hardMinimumMm}
                  max={NOMINAL_3MM_LASER_PLYWOOD_POLICY.thickness.hardMaximumMm}
                  step="0.01"
                  value={value}
                  onChange={(event) => updateThicknessSample(index, event.currentTarget.value)}
                />
              </label>
            ))}
          </div>
          <small>
            {policyEvaluation === null
              ? "Enter three caliper readings."
              : `Median ${policyEvaluation.thickness.representativeThicknessMm.toFixed(2)} mm · spread ${policyEvaluation.thickness.spreadMm.toFixed(2)} mm`}
          </small>
        </fieldset>
        <fieldset className="measurement-control">
          <legend>Measured full kerf</legend>
          <div className="measurement-inputs kerf-inputs">
            <label>
              X
              <input
                aria-label="Measured full kerf X"
                type="number"
                inputMode="decimal"
                min={NOMINAL_3MM_LASER_PLYWOOD_POLICY.kerf.hardMinimumMm}
                max={NOMINAL_3MM_LASER_PLYWOOD_POLICY.kerf.hardMaximumMm}
                step="0.01"
                value={kerfXmm}
                onChange={(event) => setKerfXmm(event.currentTarget.value)}
              />
            </label>
            <label>
              Y
              <input
                aria-label="Measured full kerf Y"
                type="number"
                inputMode="decimal"
                min={NOMINAL_3MM_LASER_PLYWOOD_POLICY.kerf.hardMinimumMm}
                max={NOMINAL_3MM_LASER_PLYWOOD_POLICY.kerf.hardMaximumMm}
                step="0.01"
                value={kerfYmm}
                onChange={(event) => setKerfYmm(event.currentTarget.value)}
              />
            </label>
          </div>
          <small>Full cut width; half is applied per contour side.</small>
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

      {inputPolicyState.status === "invalid" ? (
        <section className="policy-findings error-panel">
          <p>{inputPolicyState.message}</p>
        </section>
      ) : inputPolicyState.evaluation.findings.length > 0 ? (
        <section className="policy-findings" aria-label="Measured input findings">
          {inputPolicyState.evaluation.findings.map((finding, index) => (
            <p
              key={`${finding.code}-${String(index)}`}
              className={finding.severity === "error" ? "policy-error" : "policy-warning"}
            >
              <strong>{finding.code.replaceAll("_", " ")}</strong> {finding.message}
            </p>
          ))}
        </section>
      ) : null}

      {compileState.status === "error" ? (
        <section className="error-panel">
          <h2>Export withheld</h2>
          <p>{compileState.message}</p>
        </section>
      ) : null}

      <section className="workspace" aria-busy={compileState.status === "loading"}>
        <article className="panel viewer-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">3D verification</p>
              <h2>Assembly scene</h2>
            </div>
            <div className="segmented compact">
              <button
                type="button"
                className={sceneState === "assembled" ? "active" : ""}
                onClick={() => setSceneState("assembled")}
              >
                Assembled
              </button>
              <button
                type="button"
                className={sceneState === "exploded" ? "active" : ""}
                onClick={() => setSceneState("exploded")}
              >
                Exploded
              </button>
            </div>
          </div>
          <div className="viewer-canvas" data-testid="scene-viewer">
            {compileState.status === "ready" ? (
              <SceneViewer
                scene={compileState.bundle.scene}
                stateKind={sceneState}
                selectedPartId={selectedPartId}
                onSelectPart={selectPart}
              />
            ) : (
              <div className="loading-state">Building exact meshes…</div>
            )}
          </div>
          <div className="selection-strip">
            <span>Selected part</span>
            <strong>{selectedPart?.name ?? "None"}</strong>
            <code>{selectedPartId ?? "—"}</code>
          </div>
        </article>

        <article className="panel sheet-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">2D fabrication</p>
              <h2>Sheet projection</h2>
            </div>
            {compileState.status === "ready" ? (
              <select
                aria-label="Active fabrication sheet"
                value={activeSheet?.id}
                onChange={(event) => setActiveSheetId(event.currentTarget.value)}
              >
                {compileState.bundle.fabrication.sheets.map((sheet) => (
                  <option key={sheet.id} value={sheet.id}>{sheet.id}</option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="sheet-stage" data-testid="sheet-view">
            {activeSheet === undefined ? (
              <div className="loading-state">Projecting compensated paths…</div>
            ) : (
              <SheetView
                sheet={activeSheet}
                selectedPartId={selectedPartId}
                onSelectPart={selectPart}
              />
            )}
          </div>
          <div className="operation-key">
            <span><i className="key-cut" /> Cut</span>
            <span><i className="key-score" /> Score</span>
            <span><i className="key-engrave" /> Engrave</span>
          </div>
        </article>
      </section>

      <section className="linked-data">
        <article className="panel data-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Linked identifiers</p>
              <h2>Parts and sheets</h2>
            </div>
            <span className="count-pill">
              {compileState.status === "ready" ? `${String(compileState.document.parts.length)} parts` : "—"}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Mark</th><th>Part</th><th>Sheet</th></tr>
              </thead>
              <tbody>
                {compileState.status === "ready"
                  ? compileState.bundle.legend?.entries.map((entry) => (
                      <tr
                        key={entry.id}
                        className={selectedPartId === entry.partId ? "selected-row" : ""}
                        onClick={() => selectPart(entry.partId)}
                      >
                        <td><code>{entry.markingCode}</code></td>
                        <td>{entry.name}</td>
                        <td>{entry.sheetId}</td>
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel data-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Deterministic sequence</p>
              <h2>Assembly instructions</h2>
            </div>
          </div>
          <ol className="instructions">
            {compileState.status === "ready"
              ? compileState.bundle.instructions?.steps.map((step) => (
                  <li key={step.id}>
                    <button type="button" onClick={() => selectPart(step.partIds[0]!)}>
                      <span>{String(step.order + 1).padStart(2, "0")}</span>
                      <strong>{step.instructionKey.replaceAll("-", " ")}</strong>
                      <small>{step.sheetIds.join(", ")}</small>
                    </button>
                  </li>
                ))
              : null}
          </ol>
        </article>

        <article className="panel data-panel evidence-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Evidence boundary</p>
              <h2>Validation state</h2>
            </div>
          </div>
          {compileState.status === "ready" ? (
            <>
              <p className="status-pass">Deterministic checks passed</p>
              <dl>
                <div><dt>Sheets</dt><dd>{compileState.bundle.fabrication.sheets.length}</dd></div>
                <div><dt>Joints</dt><dd>{compileState.document.joints.length}</dd></div>
                <div><dt>API calls</dt><dd>{compileState.document.provenance.runtimeApplicationApiCalls}</dd></div>
              </dl>
              <ul className="warnings">
                {compileState.document.validation.findings.map((item) => (
                  <li key={item.code}>{item.message}</li>
                ))}
              </ul>
            </>
          ) : (
            <div className="loading-state">Running deterministic validators…</div>
          )}
        </article>

        <article className="panel data-panel calibration-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Measurement fixture</p>
              <h2>Accumulated full kerf</h2>
            </div>
          </div>
          <div className="calibration-copy">
            <p>
              Cut all ten uncompensated pieces from the same sheet with the same
              process settings. Keep every scored corner marker aligned; do not
              resize, rotate, or mirror the fixture independently.
            </p>
            <p>
              Pack the pieces across X and measure the span: <code>(120.00 mm − measured span) ÷ 10</code>.
              Pack them across Y: <code>(100.00 mm − measured span) ÷ 10</code>.
            </p>
            <p>
              X and Y mean width loss normal to vertical and horizontal edges,
              not cut-travel direction. Enter full cut width. If another tool
              reports a per-side offset, enter twice that value.
            </p>
            <p className="calibration-caveat">
              The older 0°/45°/90° coupon lines are process demonstrations, not
              precision instruments. This fixture is software-validated only;
              physical verification is still required.
            </p>
            {compileState.status === "ready" ? (
              <div className="download-row">
                {compileState.calibration.svgs.map((item) => (
                  <button
                    key={item.sheetId}
                    type="button"
                    onClick={() => downloadCalibrationSvg(item.sheetId, item.svg)}
                  >
                    Download fixture {item.sheetId}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      </section>

      <footer>
        <p>{PRODUCT_COPY.verification}</p>
        <span>Judge workspace</span>
      </footer>
    </main>
  );
}
