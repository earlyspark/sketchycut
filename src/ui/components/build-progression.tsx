import type {
  AvailableGuidedExample,
  GuidedExample,
  GuidedExampleId
} from "../content/guided-examples";

type Props = {
  entries: readonly GuidedExample[];
  active: AvailableGuidedExample;
  compileStatus: "loading" | "ready" | "error";
  onSelect: (entry: AvailableGuidedExample) => void;
};

export function BuildProgression({ entries, active, compileStatus, onSelect }: Props) {
  const available = entries.filter(
    (entry): entry is AvailableGuidedExample => entry.status === "available",
  );
  const activeIndex = available.findIndex((entry) => entry.id === active.id);
  const previous = activeIndex > 0 ? available[activeIndex - 1] : undefined;
  const next = activeIndex >= 0 && activeIndex < available.length - 1
    ? available[activeIndex + 1]
    : undefined;
  const activeId = active.id as GuidedExampleId;
  return (
    <section className="build-progression" aria-labelledby="build-progression-title">
      <div className="progression-heading">
        <div>
          <p className="section-kicker">Guided construction</p>
          <h2 id="build-progression-title">Build progression</h2>
        </div>
        <div className="progression-navigation" aria-label="Available example navigation">
          <button
            type="button"
            disabled={previous === undefined}
            aria-label={previous === undefined ? "Previous example unavailable" : `Previous: ${previous.label}`}
            onClick={() => { if (previous !== undefined) onSelect(previous); }}
          >Previous{previous === undefined ? "" : `: ${previous.label}`}</button>
          <button
            type="button"
            disabled={next === undefined}
            aria-label={next === undefined ? "Next available example unavailable" : `Next: ${next.label}`}
            onClick={() => { if (next !== undefined) onSelect(next); }}
          >Next{next === undefined ? "" : `: ${next.label}`}</button>
        </div>
      </div>
      <ol className="progression-rail" aria-label="Build progression">
        {entries.map((entry) => {
          const selected = entry.id === activeId;
          return (
            <li key={entry.id} className={selected ? "selected" : undefined}>
              <button
                type="button"
                disabled={entry.status === "planned"}
                aria-current={selected ? "step" : undefined}
                aria-pressed={entry.status === "available" ? selected : undefined}
                onClick={() => { if (entry.status === "available") onSelect(entry); }}
              >
                <span className="progression-step">Step {String(entry.order)}</span>
                <strong>{entry.label}</strong>
                <span>{entry.statusText}</span>
                <small>{entry.summary}</small>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="progression-explanation">
        <p><strong>What this step adds:</strong> {active.whatThisStepAdds}</p>
        <p>Fabrication candidate · physical verification required</p>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {active.label} selected. Product compile {compileStatus}.
      </p>
    </section>
  );
}
