import { quantizeHundredthMm } from "./input-policy.js";

export const AMERICAN_WIRE_GAUGE_DIAMETER_POLICY = {
  id: "american-wire-gauge-diameter",
  version: "1.0.0",
  minimumGaugeNumber: 0,
  maximumGaugeNumber: 40,
  source: "NIST Bureau of Standards Circular 31",
  sourceUrl: "https://nvlpubs.nist.gov/nistpubs/Legacy/circ/nbscircular31e4.pdf"
} as const;

/** Returns the nominal AWG reference diameter at SketchyCut's 0.01 mm input resolution. */
export function americanWireGaugeDiameterMm(gaugeNumber: number): number {
  if (
    !Number.isInteger(gaugeNumber) ||
    gaugeNumber < AMERICAN_WIRE_GAUGE_DIAMETER_POLICY.minimumGaugeNumber ||
    gaugeNumber > AMERICAN_WIRE_GAUGE_DIAMETER_POLICY.maximumGaugeNumber
  ) {
    throw new RangeError("American Wire Gauge number must be an integer from 0 through 40.");
  }
  const diameterInches = 0.005 * 92 ** ((36 - gaugeNumber) / 39);
  return quantizeHundredthMm(diameterInches * 25.4);
}

export function boundedAmericanWireGaugeDiameterMm(
  largerDiameterGaugeNumber: number,
  smallerDiameterGaugeNumber: number,
): {
  minimumDiameterMm: number;
  maximumDiameterMm: number;
  representativeDiameterMm: number;
} {
  const first = americanWireGaugeDiameterMm(largerDiameterGaugeNumber);
  const second = americanWireGaugeDiameterMm(smallerDiameterGaugeNumber);
  const minimumDiameterMm = Math.min(first, second);
  const maximumDiameterMm = Math.max(first, second);
  return {
    minimumDiameterMm,
    maximumDiameterMm,
    representativeDiameterMm: quantizeHundredthMm(
      (minimumDiameterMm + maximumDiameterMm) / 2,
    )
  };
}
