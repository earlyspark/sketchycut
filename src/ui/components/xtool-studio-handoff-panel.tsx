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
          <h3 id="studio-handoff-title">xTool Studio setup checklist</h3>
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
      <ul className="handoff-checks">
        <li>Use xTool Studio Desktop {handoff.target.minimumStudioDesktopVersion} or later; record exact Studio version, SVG DPI, and vector quality.</li>
        <li>Oversized import preference: Ask every time. Never permit silent auto-scaling.</li>
        <li>SketchyCut owns compensation. Confirm Kerf Offset off / 0.00 mm in the parameter panel for every product and fit-test object/layer.</li>
        <li>Assign each present operation manually and enable Output. Studio Auto owns scheduling and runs Cut last; do not try to drag operation cards. Confirm the Cut-last sequence and interior-before-outer contour handling in processing preview.</li>
        <li>Confirm power, speed, passes, focus, air pump, exhaust, support, and material recipe manually; SketchyCut has not generated them.</li>
        <li>Use a clean, level baseplate and four magnetic fixtures; keep toolpaths at least 5 mm from fixtures and all four camera viewfinder points unobstructed.</li>
        <li>For 0–6 mm M2 cutting stock, raise the upper surface of all four fixtures so the sheet is elevated with an exhaust gap underneath; never invert the fixtures or leave the sheet directly on the baseplate.</li>
        <li>After the sheet and raised fixtures are in their final positions, use Studio Auto Mode/Auto-measure for surface height and focus. Nominal 3 mm describes the stock; do not reuse 3 mm as a manual total-height datum for an elevated sheet.</li>
        <li>M2 does not support a honeycomb panel. Optional baseplate protection must be a suitable flat thick silicone mat or black-coated aluminum-oxide plate; never improvise flammable or highly reflective backing, and recheck focus and framing after changing the support stack.</li>
        <li>Frame before processing; framing checks placement and fixture avoidance, not joint fit or mechanical clearance.</li>
        <li>Confirm enclosure/interlock, exhaust, continuous supervision, fire readiness, and residue cleanup.</li>
      </ul>
    </section>
  );
}
