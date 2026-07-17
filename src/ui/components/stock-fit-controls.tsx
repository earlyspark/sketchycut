import type { ReactNode } from "react";

import type { InputPolicyFinding } from "../../domain/contracts";
import {
  NOMINAL_STOCK_PRESETS,
  resolveNominalStockPreset,
  type NominalStockPresetId
} from "../../domain/stock-catalog";

export type SetupMode = "starter" | "measure" | "calibrate";

type Props = {
  stockPresetId: NominalStockPresetId;
  mode: SetupMode;
  showModeChooser: boolean;
  stale: boolean;
  canApply: boolean;
  appliedSummary: ReactNode;
  invalidMessage: string | null;
  findings: readonly InputPolicyFinding[];
  measurementControls: ReactNode;
  capabilityInputs: ReactNode;
  optionalTools: ReactNode;
  onStockChange: (id: NominalStockPresetId) => void;
  onModeChange: (mode: SetupMode) => void;
  onApply: () => void;
  onDiscard: () => void;
};

export function StockFitControls({
  stockPresetId,
  mode,
  showModeChooser,
  stale,
  canApply,
  appliedSummary,
  invalidMessage,
  findings,
  measurementControls,
  capabilityInputs,
  optionalTools,
  onStockChange,
  onModeChange,
  onApply,
  onDiscard
}: Props) {
  const stock = resolveNominalStockPreset(stockPresetId);
  return (
    <section className="fabrication-setup" aria-labelledby="fabrication-setup-title">
      <div className="setup-heading">
        <p className="section-kicker">Fabrication setup</p>
        <h2 id="fabrication-setup-title">Start with the material label</h2>
        <p>Select the label that best matches the sheet you plan to use. Actual thickness may vary slightly.</p>
      </div>
      <fieldset className="stock-choice-group">
        <legend>Material on hand</legend>
        <div className="stock-choice-grid">
          {NOMINAL_STOCK_PRESETS.map((item) => (
            <label key={item.id} className={stockPresetId === item.id ? "stock-choice selected" : "stock-choice"}>
              <input
                type="radio"
                name="nominal-stock"
                value={item.id}
                checked={stockPresetId === item.id}
                onChange={() => onStockChange(item.id)}
              />
              <span>
                <strong>{item.selectionLabel}</strong>
                <small>Sold as 3 mm · {item.confidence.replaceAll("-", " ")}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {showModeChooser ? (
        <fieldset className="setup-mode-group">
          <legend>How do you want to set up fit?</legend>
          <div className="setup-mode-grid">
            {([
              ["starter", "Use starter profile", "Begin with visible provisional estimates."],
              ["measure", "Measure this sheet", "Enter one caliper reading; two more are optional."],
              ["calibrate", "Measure full cut width", "Use the optional packed-span fit test."]
            ] as const).map(([id, label, description]) => (
              <label key={id} className={mode === id ? "setup-mode selected" : "setup-mode"}>
                <input
                  type="radio"
                  name="setup-mode"
                  checked={mode === id}
                  onChange={() => onModeChange(id)}
                />
                <span><strong>{label}</strong><small>{description}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {mode === "starter" ? (
        <section className="setup-mode-panel starter-summary" aria-labelledby="starter-summary-title">
          <p className="section-kicker">Selected registered preset</p>
          <h3 id="starter-summary-title">Ready with beginner estimates</h3>
          <p className="measurement-result">
            {stock.defaultEffectiveThicknessMm.toFixed(2)} mm sheet thickness ·{" "}
            {stock.defaultFullCutWidthMm.toFixed(2)} mm laser cut width
          </p>
          <p>Starter estimate · physical fit not verified</p>
        </section>
      ) : measurementControls}

      <div className="capability-input-slot" aria-label="Required construction inputs">
        {capabilityInputs}
      </div>

      {stale ? (
        <div className="stale-banner" role="status" aria-live="polite">
          <strong>Changes are not applied.</strong>
          <p>The preview still uses the settings shown below; product downloads are paused.</p>
        </div>
      ) : (
        <p className="applied-live" role="status" aria-live="polite">Preview matches the applied setup.</p>
      )}
      <div className="applied-summary" aria-label="Applied fabrication setup">
        <strong>Preview currently uses</strong>
        {appliedSummary}
      </div>
      {invalidMessage !== null && stale ? (
        <p className="field-error" role="alert">{invalidMessage}</p>
      ) : null}
      {findings.filter((finding) => finding.severity === "warning").map((finding) => (
        <p key={finding.code + finding.message} className="field-warning">
          <strong>{finding.code.replaceAll("_", " ")}</strong> {finding.message}
        </p>
      ))}
      <div className="setup-actions">
        <button
          type="button"
          onClick={onApply}
          disabled={!stale || !canApply}
          aria-describedby={stale && canApply ? "apply-settings-ready" : undefined}
        >
          {stale && canApply ? "Apply pending settings" : "Apply settings"}
        </button>
        <button type="button" className="secondary-action" onClick={onDiscard} disabled={!stale}>
          Discard changes
        </button>
      </div>
      {stale && canApply ? (
        <p id="apply-settings-ready" className="apply-ready" role="status">
          Pending settings are valid and ready to apply.
        </p>
      ) : null}

      <div className="optional-tools-slot" aria-label="Optional fabrication tools">
        {optionalTools}
      </div>
    </section>
  );
}
