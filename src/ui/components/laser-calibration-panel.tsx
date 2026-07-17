import type { InputPolicyEvaluation, InputPolicyFinding } from "../../domain/contracts";

type FixtureDownload = {
  sheetId: string;
  svg: string;
  sha256: string;
};

type Props = {
  packedRow: string;
  packedColumn: string;
  manualX: string;
  manualY: string;
  manualActive: boolean;
  advancedOpen: boolean;
  fixtureDownloads: readonly FixtureDownload[];
  fixtureLoading: boolean;
  result: InputPolicyEvaluation | null;
  findings: readonly InputPolicyFinding[];
  invalidMessage: string | null;
  onPackedRowChange: (value: string) => void;
  onPackedColumnChange: (value: string) => void;
  onManualXChange: (value: string) => void;
  onManualYChange: (value: string) => void;
  onManualActiveChange: (manual: boolean) => void;
  onToggleAdvanced: () => void;
  onDownloadFixture: (item: FixtureDownload) => void;
};

export function LaserCalibrationPanel({
  packedRow,
  packedColumn,
  manualX,
  manualY,
  manualActive,
  advancedOpen,
  fixtureDownloads,
  fixtureLoading,
  result,
  findings,
  invalidMessage,
  onPackedRowChange,
  onPackedColumnChange,
  onManualXChange,
  onManualYChange,
  onManualActiveChange,
  onToggleAdvanced,
  onDownloadFixture
}: Props) {
  const errorId = invalidMessage === null ? undefined : "cut-width-calibration-error";
  return (
    <section className="setup-mode-panel" aria-labelledby="laser-calibration-title">
      <div>
        <p className="section-kicker">Optional process measurement</p>
        <h3 id="laser-calibration-title">Calibrate my laser</h3>
        <p>Use one uncompensated fixture with the intended sheet and process settings.</p>
      </div>
      <div className="fixture-download-row">
        {fixtureDownloads.map((item) => (
          <button
            key={item.sheetId}
            type="button"
            onClick={() => onDownloadFixture(item)}
          >
            Download cut-width fixture
          </button>
        ))}
        {fixtureDownloads.length === 0 ? (
          <button type="button" disabled>
            {fixtureLoading ? "Preparing cut-width fixture…" : "Fixture unavailable"}
          </button>
        ) : null}
      </div>
      <figure className="fixture-arrangement" aria-labelledby="fixture-arrangement-caption">
        <div className="fixture-row" aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => <i key={String(index)} />)}
        </div>
        <div className="fixture-column" aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => <i key={String(index)} />)}
        </div>
        <figcaption id="fixture-arrangement-caption">
          Keep every scored corner marker aligned. Pack all ten pieces first as a
          row, then as a column; do not rotate or mirror pieces independently.
        </figcaption>
      </figure>

      {!manualActive ? (
        <div className="packed-span-fields">
          <label className="numeric-field" htmlFor="packed-row-width">
            <span>Packed row width</span>
            <span className="input-with-unit">
              <input
                id="packed-row-width"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={packedRow}
                aria-invalid={invalidMessage !== null}
                aria-describedby={["packed-row-help", errorId].filter(Boolean).join(" ")}
                onChange={(event) => onPackedRowChange(event.currentTarget.value)}
              />
              <span>mm</span>
            </span>
          </label>
          <p id="packed-row-help" className="field-help">Designed accumulated span: 120.00 mm.</p>
          <label className="numeric-field" htmlFor="packed-column-height">
            <span>Packed column height</span>
            <span className="input-with-unit">
              <input
                id="packed-column-height"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={packedColumn}
                aria-invalid={invalidMessage !== null}
                aria-describedby={["packed-column-help", errorId].filter(Boolean).join(" ")}
                onChange={(event) => onPackedColumnChange(event.currentTarget.value)}
              />
              <span>mm</span>
            </span>
          </label>
          <p id="packed-column-help" className="field-help">Designed accumulated span: 100.00 mm.</p>
        </div>
      ) : null}

      <button
        type="button"
        className="text-action"
        aria-expanded={advancedOpen}
        aria-controls="manual-cut-width-controls"
        onClick={onToggleAdvanced}
      >
        Advanced: enter full cut width manually
      </button>
      {advancedOpen ? (
        <div id="manual-cut-width-controls" className="advanced-cut-width">
          <label className="radio-line">
            <input
              type="radio"
              name="cut-width-method"
              checked={!manualActive}
              onChange={() => onManualActiveChange(false)}
            />
            Use packed fixture measurements
          </label>
          <label className="radio-line">
            <input
              type="radio"
              name="cut-width-method"
              checked={manualActive}
              onChange={() => onManualActiveChange(true)}
            />
            Enter directional values manually
          </label>
          {manualActive ? (
            <div className="manual-cut-width-fields">
              <label className="numeric-field" htmlFor="manual-cut-width-x">
                <span>Full cut width X</span>
                <span className="input-with-unit">
                  <input
                    id="manual-cut-width-x"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={manualX}
                    aria-invalid={invalidMessage !== null}
                    aria-describedby={["manual-cut-width-help", errorId].filter(Boolean).join(" ")}
                    onChange={(event) => onManualXChange(event.currentTarget.value)}
                  />
                  <span>mm</span>
                </span>
              </label>
              <label className="numeric-field" htmlFor="manual-cut-width-y">
                <span>Full cut width Y</span>
                <span className="input-with-unit">
                  <input
                    id="manual-cut-width-y"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    value={manualY}
                    aria-invalid={invalidMessage !== null}
                    aria-describedby={["manual-cut-width-help", errorId].filter(Boolean).join(" ")}
                    onChange={(event) => onManualYChange(event.currentTarget.value)}
                  />
                  <span>mm</span>
                </span>
              </label>
              <p id="manual-cut-width-help" className="field-help">
                Full cut width (kerf) is the whole removed width; compensation applies
                half per contour side. Unequal X and Y values remain independent.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {result !== null ? (
        <p className="measurement-result">
          Laser cut width {result.kerf.xMm.toFixed(2)} mm across · {result.kerf.yMm.toFixed(2)} mm down
        </p>
      ) : null}
      {invalidMessage !== null ? (
        <p id="cut-width-calibration-error" className="field-error" role="alert">
          {invalidMessage}
        </p>
      ) : null}
      {findings.filter((finding) => finding.severity === "warning").map((finding) => (
        <p key={finding.code + finding.message} className="field-warning">
          {finding.message}
        </p>
      ))}
      <p className="calibration-caveat">
        A reported span is provisional process evidence. Power, speed, passes, focus,
        air assist, material batch, and physical fit are not yet reviewed.
      </p>
    </section>
  );
}
