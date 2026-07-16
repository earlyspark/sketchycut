"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  basswoodProfile,
  provisionalFitProfile,
  xtoolM2Profile
} from "../../domain/profiles";
import type {
  DesignDocumentV1,
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
      bundle: ProjectionBundle;
      svgs: { sheetId: string; svg: string; sha256: string }[];
    };

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
  const [thicknessMm, setThicknessMm] = useState(3);
  const [kerfMm, setKerfMm] = useState(0.15);
  const [compactBed, setCompactBed] = useState(false);
  const [sceneState, setSceneState] = useState<"assembled" | "exploded">("assembled");
  const [activeSheetId, setActiveSheetId] = useState("sheet-1");
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [compileState, setCompileState] = useState<CompileState>({ status: "loading" });

  const profiles = useMemo(() => {
    const material = basswoodProfile(thicknessMm);
    const machine = forcedMachine(xtoolM2Profile(kerfMm), compactBed);
    return { material, machine, fit: provisionalFitProfile() };
  }, [compactBed, kerfMm, thicknessMm]);
  const program = useMemo(
    () => createPrimaryPreset(presetId, profiles),
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
        bundle: response.bundle,
        svgs: response.svgs
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
    if (worker === null) {
      return;
    }
    requestCounter.current += 1;
    const requestId = `compile-${String(requestCounter.current)}`;
    setCompileState({ status: "loading" });
    const request: CompileWorkerRequest = { requestId, program, profiles };
    worker.postMessage(request);
  }, [profiles, program]);

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

  return (
    <main>
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{PRODUCT_COPY.eyebrow}</p>
          <h1>{PRODUCT_COPY.title}</h1>
          <p className="lede">{PRODUCT_COPY.description}</p>
        </div>
        <div className="hero-proof">
          <span>Canonical source</span>
          <strong>{compileState.status === "ready" ? compileState.bundle.sourceDocumentHash.slice(0, 12) : "compiling…"}</strong>
          <small>0 runtime model calls</small>
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
        <label>
          Measured stock
          <span>{thicknessMm.toFixed(1)} mm</span>
          <input
            aria-label="Measured stock thickness"
            type="range"
            min="2.7"
            max="3.3"
            step="0.1"
            value={thicknessMm}
            onChange={(event) => setThicknessMm(Number(event.currentTarget.value))}
          />
        </label>
        <label>
          Kerf
          <span>{kerfMm.toFixed(2)} mm</span>
          <input
            aria-label="Kerf"
            type="range"
            min="0.10"
            max="0.20"
            step="0.01"
            value={kerfMm}
            onChange={(event) => setKerfMm(Number(event.currentTarget.value))}
          />
        </label>
        <label className="check-control">
          <input
            type="checkbox"
            checked={compactBed}
            onChange={(event) => setCompactBed(event.currentTarget.checked)}
          />
          Force multi-sheet proof
        </label>
      </section>

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
      </section>

      <footer>
        <p>{PRODUCT_COPY.verification}</p>
        <span>Judge workspace</span>
      </footer>
    </main>
  );
}
