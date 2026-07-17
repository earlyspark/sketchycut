"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
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

import { SceneViewer } from "./scene-viewer";
import { SheetView } from "./sheet-view";
import { XToolStudioHandoffPanel } from "./xtool-studio-handoff-panel";

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
};

const WORKSPACE_TABS = [
  { id: "preview", label: "Preview" },
  { id: "design", label: "Design" },
  { id: "build", label: "Build" },
  { id: "fabricate", label: "Fabricate" }
] as const;

type WorkspaceTabId = (typeof WORKSPACE_TABS)[number]["id"];

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
  stale
}: Props) {
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>("preview");
  const [sceneState, setSceneState] = useState<"assembled" | "exploded" | "removal">("assembled");
  const [motionValue, setMotionValue] = useState(0);
  const [activeSheetId, setActiveSheetId] = useState("sheet-1");
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const tabRefs = useRef(new Map<WorkspaceTabId, HTMLButtonElement>());

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

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tabId: WorkspaceTabId): void => {
    const currentIndex = WORKSPACE_TABS.findIndex((tab) => tab.id === tabId);
    const lastIndex = WORKSPACE_TABS.length - 1;
    const targetIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % WORKSPACE_TABS.length
      : event.key === "ArrowLeft"
      ? (currentIndex - 1 + WORKSPACE_TABS.length) % WORKSPACE_TABS.length
      : event.key === "Home"
      ? 0
      : event.key === "End"
      ? lastIndex
      : null;
    if (targetIndex === null) return;
    event.preventDefault();
    const target = WORKSPACE_TABS[targetIndex]!;
    setActiveTab(target.id);
    tabRefs.current.get(target.id)?.focus();
  };

  const renderViewer = () => (
    <article className="panel viewer-panel">
      <div className="panel-heading">
        <div><p className="section-kicker">3D verification</p><h2>Assembly scene</h2></div>
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
      <div className="viewer-canvas" data-testid="scene-viewer">
        {readyProject === null ? (
          <div className="loading-state">Building exact meshes…</div>
        ) : (
          <SceneViewer
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

  const renderSheet = (downloads: boolean) => (
    <article className="panel sheet-panel">
      <div className="panel-heading">
        <div><p className="section-kicker">2D fabrication</p><h2>Sheet projection</h2></div>
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
      {!downloads || readyProject === null ? null : (
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
      {!downloads || !stale ? null : (
        <p id="product-download-paused" className="field-warning">
          Apply or discard setup changes before downloading product SVGs.
        </p>
      )}
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
      <div className="workspace-tabs" role="tablist" aria-label="Project workspace">
        {WORKSPACE_TABS.map((tab) => (
          <button
            key={tab.id}
            ref={(node) => {
              if (node === null) tabRefs.current.delete(tab.id);
              else tabRefs.current.set(tab.id, node);
            }}
            id={`workspace-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`workspace-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, tab.id)}
          >{tab.label}</button>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {WORKSPACE_TABS.find((tab) => tab.id === activeTab)!.label} workspace tab selected.
      </p>

      <section
        id="workspace-panel-preview"
        role="tabpanel"
        aria-labelledby="workspace-tab-preview"
        hidden={activeTab !== "preview"}
        className="workspace-tab-panel"
      >
        <div className="workspace">{renderViewer()}{renderSheet(false)}</div>
      </section>

      <section
        id="workspace-panel-design"
        role="tabpanel"
        aria-labelledby="workspace-tab-design"
        hidden={activeTab !== "design"}
        className="workspace-tab-panel design-tab-panel"
      >
        {sourceSummary}
        {designContent}
      </section>

      <section
        id="workspace-panel-build"
        role="tabpanel"
        aria-labelledby="workspace-tab-build"
        hidden={activeTab !== "build"}
        className="workspace-tab-panel"
      >
        <div className="linked-data build-linked-data">
          <article className="panel data-panel">
            <div className="panel-heading">
              <div><p className="section-kicker">Linked identifiers</p><h2>Parts and sheets</h2></div>
              <span className="count-pill">{readyProject === null
                ? "—"
                : `${String(readyProject.document.parts.length)} cut parts + ${String(readyProject.document.externalStock?.length ?? 0)} stock`}</span>
            </div>
            <div className="table-wrap"><table><thead><tr><th>Mark</th><th>Part</th><th>Sheet</th></tr></thead><tbody>
              {readyProject?.bundle.legend?.entries.map((entry) => (
                <tr
                  key={entry.id}
                  className={selectedPartId === entry.partId ? "selected-row" : ""}
                  onClick={() => selectPart(entry.partId)}
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
                  onClick={() => selectPart(entry.partId)}
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
              <div><p className="section-kicker">Deterministic sequence</p><h2>Assembly instructions</h2></div>
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
        role="tabpanel"
        aria-labelledby="workspace-tab-fabricate"
        hidden={activeTab !== "fabricate"}
        className="workspace-tab-panel"
      >
        {project.status === "error" ? (
          <section className="error-panel"><h2>Export withheld</h2><p>{project.message}</p></section>
        ) : null}
        <div className="fabricate-layout">
          {renderSheet(true)}
          <article className="panel data-panel evidence-panel">
            <div className="panel-heading">
              <div><p className="section-kicker">Evidence boundary</p><h2>Validation state</h2></div>
            </div>
            {readyProject === null ? (
              <div className="loading-state">Running deterministic validators…</div>
            ) : (
              <>
                <p className="status-pass">Deterministic checks passed</p>
                <p className="evidence-claim">{readyProject.evidence.claim}</p>
                <dl>
                  <div><dt>Sheets</dt><dd>{readyProject.bundle.fabrication.sheets.length}</dd></div>
                  <div><dt>Joints</dt><dd>{readyProject.document.joints.length}</dd></div>
                  <div><dt>Motion</dt><dd>{motion?.validationSummary ?? "Unavailable"}</dd></div>
                  <div><dt>API calls</dt><dd>{readyProject.document.provenance.runtimeApplicationApiCalls}</dd></div>
                </dl>
                <ul className="warnings">
                  {readyProject.document.provenance.inputPolicyEvaluation?.findings.map((item) => (
                    <li key={item.code + item.message}>{item.message}</li>
                  ))}
                  {readyProject.document.validation.findings.map((item) => (
                    <li key={item.code}>{item.message}</li>
                  ))}
                </ul>
                {readyProject.document.constructionSelections?.[0]?.disclosure === undefined
                  ? null
                  : <p className="calibration-caveat">{readyProject.document.constructionSelections[0].disclosure}</p>}
              </>
            )}
          </article>
        </div>
        <section className="handoff-section" aria-label="Applied export handoff">
          {handoff.status === "ready" ? (
            <XToolStudioHandoffPanel handoff={handoff.handoff} current={!stale} />
          ) : handoff.status === "error" ? (
            <p className="field-error">Applied handoff unavailable: {handoff.message}</p>
          ) : (
            <p className="field-help">Preparing applied xTool Studio handoff…</p>
          )}
        </section>
      </section>
    </section>
  );
}
