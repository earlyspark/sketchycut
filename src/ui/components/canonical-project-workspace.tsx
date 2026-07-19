"use client";

import dynamic from "next/dynamic";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState
} from "react";

import type { DesignDocumentV1, ProjectionBundle } from "../../domain/contracts";
import type { FabricationEvidenceProjection } from "../../projections/evidence";
import type { XToolStudioHandoff } from "../../projections/handoff";
import type { ProductCompileWorkerRequest } from "../../workers/protocol";
import {
  resolveMotionPresentation,
  type MotionPresentationCopy
} from "../motion-presentation";

import { SheetView } from "./sheet-view";
import { XToolStudioHandoffPanel } from "./xtool-studio-handoff-panel";

const LazySceneViewer = dynamic(
  () => import("./scene-viewer").then((module) => module.SceneViewer),
  {
    ssr: false,
    loading: () => (
      <div className="scene-viewer-placeholder" role="status" aria-label="Loading interactive 3D assembly">
        Loading interactive 3D assembly…
      </div>
    )
  },
);

export type CanonicalProjectState =
  | { status: "loading"; requestId: string | null }
  | { status: "error"; requestId: string; message: string }
  | {
      status: "ready";
      requestId: string;
      document: DesignDocumentV1;
      geometryHash: string;
      bundle: ProjectionBundle;
      evidence: FabricationEvidenceProjection;
      svgs: { sheetId: string; svg: string; sha256: string }[];
    };

export type CanonicalHandoffState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; handoff: XToolStudioHandoff };

export type CanonicalWorkspacePresentation = {
  sourceId: string;
  structuralKind: ProductCompileWorkerRequest["structuralKind"];
  partLabels?: Readonly<Record<string, string>>;
  instructionLabels?: Readonly<Record<string, string>>;
  motion?: MotionPresentationCopy;
};

type Props = {
  project: CanonicalProjectState;
  handoff: CanonicalHandoffState;
  presentation: CanonicalWorkspacePresentation;
  designContent: ReactNode;
  sourceSummary?: ReactNode;
  stale: boolean;
  packageDownload?: {
    projectId: string;
    label: string;
  };
};

function downloadSvg(filename: string, svg: string): void {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CanonicalProjectWorkspace({
  project,
  handoff,
  presentation,
  designContent,
  sourceSummary,
  stale,
  packageDownload
}: Props) {
  const [sceneState, setSceneState] = useState<"assembled" | "exploded" | "removal">("assembled");
  const [motionValue, setMotionValue] = useState(0);
  const [activeSheetId, setActiveSheetId] = useState("sheet-1");
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [packageStatus, setPackageStatus] = useState<"idle" | "building" | "error">("idle");

  const readyProject = project.status === "ready" ? project : null;
  const sourceDocumentHash = readyProject?.bundle.sourceDocumentHash ?? "";

  useEffect(() => {
    if (readyProject === null) return;
    setActiveSheetId(readyProject.bundle.fabrication.sheets[0]?.id ?? "sheet-1");
    setSelectedPartId(readyProject.document.parts[0]?.id ?? null);
    setSceneState("assembled");
    setMotionValue(0);
  }, [sourceDocumentHash]);

  const activeSheet = readyProject?.bundle.fabrication.sheets.find(
    (sheet) => sheet.id === activeSheetId,
  ) ?? readyProject?.bundle.fabrication.sheets[0];
  const selectedPart = readyProject?.document.parts.find((part) => part.id === selectedPartId);
  const selectedStock = readyProject?.document.externalStock?.find(
    (item) => item.id === selectedPartId,
  );
  const markingCodeByPartId = new Map(
    readyProject?.bundle.legend?.entries.map((entry) => [entry.partId, entry.markingCode]) ?? [],
  );
  const stockFootprint = readyProject?.document.resolvedInputs.fabricationContext.stockFootprint ?? null;
  const downloadPackage = async (): Promise<void> => {
    if (packageDownload === undefined || stale || readyProject === null) return;
    setPackageStatus("building");
    try {
      const response = await fetch("/api/create/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "1.0",
          projectId: packageDownload.projectId
        }),
        cache: "no-store"
      });
      if (!response.ok) throw new Error("PACKAGE_UNAVAILABLE");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sketchycut-${packageDownload.projectId}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      setPackageStatus("idle");
    } catch {
      setPackageStatus("error");
    }
  };
  const motion = useMemo(
    () => readyProject === null
      ? null
      : resolveMotionPresentation(
          readyProject.document,
          readyProject.bundle.scene,
          presentation.motion,
        ),
    [presentation.motion, readyProject],
  );
  const motionMinimum = motion?.kind === "revolute"
    ? motion.minimumDegrees
    : motion?.kind === "prismatic"
    ? motion.minimumMm
    : 0;
  const motionMaximum = motion?.kind === "revolute"
    ? motion.maximumDegrees
    : motion?.kind === "prismatic"
    ? motion.maximumMm
    : 0;
  const openStop = motion?.kind === "revolute"
    ? motion.openStopDegrees
    : motion?.kind === "prismatic"
    ? motion.openStopMm
    : 0;
  const hasMotion = motion?.kind === "revolute" || motion?.kind === "prismatic";
  const atOpenStop = hasMotion && sceneState === "assembled" && motionValue === openStop;
  const inMidTravel = hasMotion &&
    sceneState === "assembled" &&
    motionValue > motionMinimum &&
    motionValue < openStop;
  const displayPartName = (partId: string, canonicalName: string): string =>
    presentation.partLabels?.[partId] ?? canonicalName;
  const displayInstructionKey = (key: string): string =>
    presentation.instructionLabels?.[key] ?? key.replaceAll("-", " ");
  const selectPart = (partId: string): void => setSelectedPartId(partId.length === 0 ? null : partId);

  const renderViewer = () => (
    <article className="panel viewer-panel">
      <div className="panel-heading">
        <div><p className="section-kicker">3D verification</p><h3>Assembly scene</h3></div>
        <div className="segmented compact">
          <button
            type="button"
            className={sceneState === "assembled" && motionValue === motionMinimum ? "active" : ""}
            onClick={() => { setSceneState("assembled"); setMotionValue(motionMinimum); }}
          >{motion?.restStateLabel ?? "Assembled"}</button>
          {hasMotion ? (
            <button
              type="button"
              className={atOpenStop ? "active" : ""}
              onClick={() => {
                setSceneState("assembled");
                setMotionValue(openStop);
                if (motion.endpointSelectionPartId !== null) {
                  setSelectedPartId(motion.endpointSelectionPartId);
                }
              }}
            >{motion.endpointStateLabel}</button>
          ) : null}
          {motion?.kind === "prismatic" ? (
            <button
              type="button"
              className={sceneState === "removal" ? "active" : ""}
              onClick={() => {
                setSceneState("removal");
                setMotionValue(motion.removalPositionMm);
                setSelectedPartId(motion.removableRetainerPartIds[0] ?? null);
              }}
            >{motion.removalStateLabel}</button>
          ) : null}
          <button
            type="button"
            className={sceneState === "exploded" ? "active" : ""}
            onClick={() => setSceneState("exploded")}
          >Exploded</button>
        </div>
      </div>
      <div
        className="viewer-canvas"
        data-testid="scene-viewer"
        role="group"
        aria-label={`${sceneState} interactive canonical assembly scene`}
      >
        <span className="sr-only">Interactive assembly scene. Use pointer or touch to orbit and zoom; select parts from the linked sheet, legend, or instructions.</span>
        {readyProject === null ? (
          <div className="loading-state">Building exact meshes…</div>
        ) : (
          <LazySceneViewer
            scene={readyProject.bundle.scene}
            stateKind={sceneState}
            motionValue={motionValue}
            selectedPartId={selectedPartId}
            onSelectPart={selectPart}
          />
        )}
      </div>
      {readyProject !== null && hasMotion ? (
        <label className="motion-control">
          {motion.controlLabel} · {motionValue.toFixed(motion.kind === "revolute" ? 0 : 1)}{motion.kind === "revolute" ? "°" : " mm"}
          <input
            aria-label={motion.rangeAriaLabel}
            aria-valuetext={`${motionValue.toFixed(motion.kind === "revolute" ? 0 : 1)} ${motion.kind === "revolute" ? "degrees" : "millimetres"}${
              atOpenStop && motion.endpointContactText !== null
                ? `, ${motion.endpointContactText}`
                : inMidTravel && motion.midTravelText !== null
                ? `, ${motion.midTravelText}`
                : ""
            }`}
            type="range"
            min={motionMinimum}
            max={motionMaximum}
            step={motion.kind === "revolute" ? "1" : "0.5"}
            value={motionValue}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              setSceneState("assembled");
              setMotionValue(next);
              if (next === openStop && motion.endpointSelectionPartId !== null) {
                setSelectedPartId(motion.endpointSelectionPartId);
              }
            }}
          />
          {motion.explanation === null ? null : <small>{motion.explanation}</small>}
          {motion.kind !== "prismatic" || motion.removalExplanation === null
            ? null
            : <small>{motion.removalExplanation}</small>}
        </label>
      ) : null}
      {motion === null ? null : (
        <p className="viewer-status">{motion.validationSummary}</p>
      )}
      <div className="selection-strip">
        <span>{selectedStock === undefined ? "Selected part" : "Selected external stock"}</span>
        <strong>{selectedPart === undefined
          ? selectedStock?.name ?? "None"
          : displayPartName(selectedPart.id, selectedPart.name)}</strong>
        <code>{selectedPartId ?? "—"}</code>
      </div>
    </article>
  );

  const renderSheet = () => (
    <article className="panel sheet-panel">
      <div className="panel-heading">
        <div><p className="section-kicker">2D fabrication</p><h3>Sheet projection</h3></div>
        {readyProject === null ? null : (
          <select
            aria-label="Active fabrication sheet"
            value={activeSheet?.id}
            onChange={(event) => setActiveSheetId(event.currentTarget.value)}
          >
            {readyProject.bundle.fabrication.sheets.map((sheet) => (
              <option key={sheet.id} value={sheet.id}>{sheet.id}</option>
            ))}
          </select>
        )}
      </div>
      <div className="sheet-downloads">
        <div><p className="section-kicker">Fabrication files</p><h3>Downloads</h3></div>
        {readyProject === null ? (
          <p className="field-help">Preparing current fabrication files…</p>
        ) : (
          <div className="download-row product-downloads">
            {readyProject.svgs.map((item) => (
              <button
                key={item.sheetId}
                type="button"
                disabled={stale}
                aria-describedby={stale ? "product-download-paused" : undefined}
                onClick={() => downloadSvg(`sketchycut-product-${item.sheetId}.svg`, item.svg)}
              >Download product {item.sheetId}</button>
            ))}
          </div>
        )}
        {!stale ? null : (
          <p id="product-download-paused" className="field-warning">
            Apply or discard setup changes before downloading product SVGs.
          </p>
        )}
      </div>
      <div className="sheet-stage" data-testid="sheet-view">
        {activeSheet === undefined ? (
          <div className="loading-state">Projecting compensated paths…</div>
        ) : (
          <SheetView
            sheet={activeSheet}
            markingCodeByPartId={markingCodeByPartId}
            stockFootprintMm={stockFootprint === null
              ? null
              : { width: stockFootprint.widthMm, height: stockFootprint.heightMm }}
            selectedPartId={selectedPartId}
            onSelectPart={selectPart}
          />
        )}
      </div>
      {activeSheet === undefined ? null : (
        <p className="sheet-stock-summary">
          {stockFootprint === null ? (
            <strong>Compact export footprint</strong>
          ) : (
            <strong>
              Stock sheet {(stockFootprint.widthMm / 25.4).toFixed(0)} × {(stockFootprint.heightMm / 25.4).toFixed(0)} in
            </strong>
          )}
          <span>
            {stockFootprint === null
              ? `${activeSheet.widthMm.toFixed(2)} × ${activeSheet.heightMm.toFixed(2)} mm`
              : `${stockFootprint.widthMm.toFixed(2)} × ${stockFootprint.heightMm.toFixed(2)} mm available · ${activeSheet.requiredMaterialFootprintMm.width.toFixed(2)} × ${activeSheet.requiredMaterialFootprintMm.height.toFixed(2)} mm required cut footprint`}
          </span>
        </p>
      )}
      <div className="operation-key">
        <span><i className="key-cut" /> Cut</span>
        <span><i className="key-score" /> Score</span>
        <span><i className="key-engrave" /> Engrave</span>
      </div>
    </article>
  );

  return (
    <section
      className="canonical-workspace"
      aria-busy={project.status === "loading"}
      data-testid="compiled-product"
      data-compile-status={project.status}
      data-active-example-id={presentation.sourceId}
      data-active-structural-kind={presentation.structuralKind}
      data-product-request-id={project.requestId ?? ""}
      data-geometry-hash={readyProject?.geometryHash ?? ""}
      data-source-document-hash={readyProject?.bundle.sourceDocumentHash ?? ""}
    >
      <section
        id="workspace-panel-design"
        aria-labelledby="workspace-heading-design"
        className="workspace-section design-tab-panel"
      >
        <h2 id="workspace-heading-design" className="workspace-section-title">Design</h2>
        <div className="workspace-section-body">
          {sourceSummary}
          {designContent}
        </div>
      </section>

      <section
        id="workspace-panel-preview"
        aria-labelledby="workspace-heading-preview"
        className="workspace-section"
      >
        <h2 id="workspace-heading-preview" className="workspace-section-title">Preview</h2>
        <div className="workspace-section-body workspace">{renderViewer()}{renderSheet()}</div>
      </section>

      <section
        id="workspace-panel-build"
        aria-labelledby="workspace-heading-build"
        className="workspace-section"
      >
        <h2 id="workspace-heading-build" className="workspace-section-title">Build</h2>
        <div className="workspace-section-body linked-data build-linked-data">
          <article className="panel data-panel">
            <div className="panel-heading">
              <div><p className="section-kicker">Linked identifiers</p><h3>Parts and sheets</h3></div>
              <span className="count-pill">{readyProject === null
                ? "—"
                : `${String(readyProject.document.parts.length)} cut parts + ${String(readyProject.document.externalStock?.length ?? 0)} stock`}</span>
            </div>
            <div className="table-wrap"><table><thead><tr><th>Mark</th><th>Part</th><th>Sheet</th></tr></thead><tbody>
              {readyProject?.bundle.legend?.entries.map((entry) => (
                <tr
                  key={entry.id}
                  className={selectedPartId === entry.partId ? "selected-row" : ""}
                  tabIndex={0}
                  aria-label={`Select part ${entry.markingCode}: ${displayPartName(entry.partId, entry.name)}`}
                  onClick={() => selectPart(entry.partId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectPart(entry.partId);
                    }
                  }}
                >
                  <td><code>{entry.markingCode}</code></td>
                  <td>{displayPartName(entry.partId, entry.name)}</td>
                  <td>{entry.sheetId}</td>
                </tr>
              ))}
              {readyProject?.bundle.bom.entries.filter((entry) => entry.entryKind === "external-stock").map((entry) => (
                <tr
                  key={entry.id}
                  className={selectedPartId === entry.partId ? "selected-row" : ""}
                  tabIndex={0}
                  aria-label={`Select external stock ${entry.name}`}
                  onClick={() => selectPart(entry.partId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectPart(entry.partId);
                    }
                  }}
                >
                  <td><code>stock</code></td>
                  <td>{entry.name} · {entry.measuredDiameterMm?.toFixed(2)} mm × {entry.cutLengthMm?.toFixed(2)} mm</td>
                  <td>Not in SVG</td>
                </tr>
              ))}
            </tbody></table></div>
          </article>

          <article className="panel data-panel">
            <div className="panel-heading">
              <div><p className="section-kicker">Deterministic sequence</p><h3>Assembly instructions</h3></div>
            </div>
            <ol className="instructions">{readyProject?.bundle.instructions?.steps.map((step) => {
              const marks = [...new Set(step.partIds.flatMap((partId) => {
                const markingCode = markingCodeByPartId.get(partId);
                return markingCode === undefined ? [] : [markingCode];
              }))];
              const markSummary = `${marks.length === 1 ? "Mark" : "Marks"} ${marks.join(", ")}`;
              const locations = [...step.sheetIds, ...(step.stockItemIds ?? [])].join(", ");
              return (
                <li key={step.id}>
                  <button type="button" onClick={() => selectPart(step.stockItemIds?.[0] ?? step.partIds[0]!)}>
                    <span>{String(step.order + 1).padStart(2, "0")}</span>
                    <strong>{displayInstructionKey(step.instructionKey)}</strong>
                    <small>{step.phase ?? "assembly"} · {markSummary} · {locations}</small>
                  </button>
                </li>
              );
            })}</ol>
          </article>
        </div>
      </section>

      <section
        id="workspace-panel-fabricate"
        aria-labelledby="workspace-heading-fabricate"
        className="workspace-section"
      >
        <h2 id="workspace-heading-fabricate" className="workspace-section-title">Fabricate</h2>
        <div className="workspace-section-body">
          {project.status === "error" ? (
            <section className="error-panel"><h3>Export withheld</h3><p>{project.message}</p></section>
          ) : null}
          <section className="handoff-section" aria-label="Applied export handoff">
          {packageDownload === undefined ? null : (
            <div className="package-download">
              <button
                type="button"
                disabled={stale || readyProject === null || packageStatus === "building"}
                onClick={() => void downloadPackage()}
              >
                {packageStatus === "building" ? "Building complete package…" : packageDownload.label}
              </button>
              <span role="status" aria-live="polite">
                {packageStatus === "error"
                  ? "The package could not be built. No partial export was downloaded."
                  : stale ? "Apply draft changes before downloading." : ""}
              </span>
            </div>
          )}
          {handoff.status === "ready" ? (
            <XToolStudioHandoffPanel handoff={handoff.handoff} current={!stale} />
          ) : handoff.status === "error" ? (
            <p className="field-error">Applied handoff unavailable: {handoff.message}</p>
          ) : (
            <p className="field-help">Preparing applied xTool Studio handoff…</p>
          )}
          </section>
        </div>
      </section>
    </section>
  );
}
