import type { XToolStudioHandoff } from "../../projections/handoff";

type Props = {
  handoff: XToolStudioHandoff;
  current: boolean;
};

export function XToolStudioHandoffPanel({ handoff, current }: Props) {
  return (
    <section className="handoff-panel" aria-labelledby="studio-handoff-title">
      <div className="handoff-heading">
        <div>
          <p className="section-kicker">Applied export handoff</p>
          <h3 id="studio-handoff-title">xTool Studio import checklist</h3>
        </div>
        <span className={current ? "handoff-state current" : "handoff-state stale"}>
          {current ? "Matches applied output" : "Last-applied output · draft not included"}
        </span>
      </div>
      <p>{handoff.outputClaim}</p>
      <div className="handoff-groups">
        {handoff.artifactGroups.map((group) => (
          <article
            key={group.id}
            data-artifact-group={group.id}
            data-source-document-hash={group.sourceDocumentHash}
            data-artifact-set-hash={group.artifactSetHash}
          >
            <strong>{group.id === "product" ? "Product SVG group" : "Optional cut-width fit-test group"}</strong>
            <code title={group.artifactSetHash}>{group.artifactSetHash}</code>
            {group.sheets.map((sheet) => (
              <p key={sheet.sheetId}>
                {sheet.sheetId}: {sheet.rootDimensionsMm.width.toFixed(2)} × {sheet.rootDimensionsMm.height.toFixed(2)} mm root · required stock footprint at least {sheet.requiredMaterialFootprintMm.width.toFixed(2)} × {sheet.requiredMaterialFootprintMm.height.toFixed(2)} mm · {String(sheet.complexity.pathCount)} paths
              </p>
            ))}
          </article>
        ))}
      </div>
      <ol className="operation-assignment-list" aria-label="Manual Studio operation assignments">
        {handoff.operationMap.map((operation) => (
          <li key={operation.operation}>
            <i style={{ background: operation.color }} aria-hidden="true" />
            <span>
              <strong>{operation.order}. {operation.nonColorLabel}</strong><br />
              Assign manually · Output on · Kerf Offset {operation.studioKerfOffsetMm.toFixed(2)} mm
            </span>
          </li>
        ))}
      </ol>
      {handoff.applicationLimitations.length === 0 ? null : (
        <section
          className="application-limitations"
          aria-labelledby="studio-application-limitations-title"
        >
          <h4 id="studio-application-limitations-title">Applied assumptions and limitations</h4>
          <ul>
            {handoff.applicationLimitations.map((limitation) => (
              <li key={limitation.code}>
                <strong>{limitation.code}</strong> — {limitation.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="handoff-checks">
        <li>Use xTool Studio Desktop {handoff.target.minimumStudioDesktopVersion} or later; record exact Studio version, SVG DPI, and vector quality.</li>
        <li>Oversized import preference: Ask every time. Never permit silent auto-scaling.</li>
        <li>SketchyCut owns compensation. Confirm Kerf Offset off / 0.00 mm in the parameter panel for every product and fit-test object/layer.</li>
        <li>Assign each present operation manually and enable Output. Studio Auto owns scheduling and runs Cut last; do not try to drag operation cards. Confirm the Cut-last sequence and interior-before-outer contour handling in processing preview.</li>
      </ul>
    </section>
  );
}
