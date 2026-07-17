import type { InputPolicyEvaluation } from "../../domain/contracts";

type Props = {
  readings: [string, string, string];
  additionalVisible: boolean;
  evaluation: InputPolicyEvaluation | null;
  invalidMessage: string | null;
  onChange: (index: 0 | 1 | 2, value: string) => void;
  onShowAdditional: () => void;
  onUseOneReading: () => void;
};

export function SheetMeasurementPanel({
  readings,
  additionalVisible,
  evaluation,
  invalidMessage,
  onChange,
  onShowAdditional,
  onUseOneReading
}: Props) {
  const measurement = evaluation?.thickness.measurement;
  const readingCount = measurement?.samplesMm.length ?? 0;
  const errorId = invalidMessage === null ? undefined : "sheet-thickness-error";
  return (
    <section className="setup-mode-panel" aria-labelledby="sheet-measurement-title">
      <div>
        <p className="section-kicker">Optional sheet measurement</p>
        <h3 id="sheet-measurement-title">Measure this sheet</h3>
        <p>
          A reading such as 2.99 mm describes this particular 3 mm sheet. It is a
          measurement, not a separate stock size.
        </p>
      </div>
      <label className="numeric-field" htmlFor="sheet-thickness-primary">
        <span>Sheet thickness</span>
        <span className="input-with-unit">
          <input
            id="sheet-thickness-primary"
            type="number"
            inputMode="decimal"
            step="0.01"
            value={readings[0]}
            aria-invalid={invalidMessage !== null}
            aria-describedby={["sheet-thickness-help", errorId].filter(Boolean).join(" ")}
            onChange={(event) => onChange(0, event.currentTarget.value)}
          />
          <span>mm</span>
        </span>
      </label>
      <p id="sheet-thickness-help" className="field-help">
        Enter the number shown on your calipers. Measure near the middle of one
        undamaged edge; one reading is enough to continue.
      </p>
      <button
        type="button"
        className="secondary-action"
        aria-expanded={additionalVisible}
        aria-controls="additional-thickness-readings"
        onClick={additionalVisible ? onUseOneReading : onShowAdditional}
      >
        {additionalVisible
          ? "Use one reading only"
          : "Add 2 more readings for better confidence"}
      </button>
      {additionalVisible ? (
        <div id="additional-thickness-readings" className="additional-readings">
          <label className="numeric-field" htmlFor="sheet-thickness-opposite-edge">
            <span>Middle of opposite edge</span>
            <span className="input-with-unit">
              <input
                id="sheet-thickness-opposite-edge"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={readings[1]}
                aria-invalid={invalidMessage !== null}
                aria-describedby={errorId}
                onChange={(event) => onChange(1, event.currentTarget.value)}
              />
              <span>mm</span>
            </span>
          </label>
          <label className="numeric-field" htmlFor="sheet-thickness-another-edge">
            <span>Middle of another edge</span>
            <span className="input-with-unit">
              <input
                id="sheet-thickness-another-edge"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={readings[2]}
                aria-invalid={invalidMessage !== null}
                aria-describedby={errorId}
                onChange={(event) => onChange(2, event.currentTarget.value)}
              />
              <span>mm</span>
            </span>
          </label>
          <p className="field-help">
            Use separated reachable locations along different edges. Avoid damaged
            corners, compressed spots, and visibly distorted areas.
          </p>
        </div>
      ) : null}
      {invalidMessage !== null ? (
        <p id="sheet-thickness-error" className="field-error" role="alert">
          {invalidMessage}
        </p>
      ) : null}
      {measurement !== undefined && readingCount === 3 ? (
        <p className="measurement-result">
          Typical thickness {measurement.representativeThicknessMm.toFixed(2)} mm · range{" "}
          {measurement.minimumThicknessMm.toFixed(2)}–{measurement.maximumThicknessMm.toFixed(2)} mm
        </p>
      ) : measurement !== undefined && readingCount === 1 ? (
        <p className="measurement-result">
          Sheet thickness {measurement.representativeThicknessMm.toFixed(2)} mm
        </p>
      ) : null}
    </section>
  );
}
