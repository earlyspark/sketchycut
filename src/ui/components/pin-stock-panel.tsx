type Props = {
  measured: boolean;
  diameter: string;
  invalid: boolean;
  onMeasuredChange: (measured: boolean) => void;
  onDiameterChange: (value: string) => void;
};

export function PinStockPanel({
  measured,
  diameter,
  invalid,
  onMeasuredChange,
  onDiameterChange
}: Props) {
  return (
    <fieldset className="pin-stock-panel">
      <legend>Hinge pin on hand</legend>
      <p><strong>Sold as a 3 mm straight wooden dowel or bamboo skewer</strong></p>
      <p className="field-help">
        The sold size is nominal. A decimal value describes the particular straight pin,
        not a separate product size.
      </p>
      <label className="check-control">
        <input
          type="checkbox"
          checked={measured}
          onChange={(event) => onMeasuredChange(event.currentTarget.checked)}
        />
        I measured this pin
      </label>
      {measured ? (
        <label className="numeric-field" htmlFor="actual-pin-diameter">
          <span>Actual pin diameter</span>
          <span className="input-with-unit">
            <input
              id="actual-pin-diameter"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={diameter}
              aria-invalid={invalid}
              aria-describedby={invalid
                ? "actual-pin-diameter-help actual-pin-diameter-error"
                : "actual-pin-diameter-help"}
              onChange={(event) => onDiameterChange(event.currentTarget.value)}
            />
            <span>mm</span>
          </span>
        </label>
      ) : null}
      {measured && invalid ? (
        <p id="actual-pin-diameter-error" className="field-error" role="alert">
          Enter the actual diameter reported by your caliper.
        </p>
      ) : null}
      <p id="actual-pin-diameter-help" className="field-help">
        {measured
          ? "Enter exactly what the caliper reports. SketchyCut never substitutes a nearby reading."
          : "Without a caliper reading, the preview uses a 3.00 mm starter estimate and remains physically unverified. SketchyCut never substitutes a nearby reading."}
      </p>
    </fieldset>
  );
}
