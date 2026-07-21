import { describe, expect, it } from "vitest";

import {
  americanWireGaugeDiameterMm,
  boundedAmericanWireGaugeDiameterMm,
  resolvePinSetup
} from "../../src/index.js";

describe("reference diameter gauge policy", () => {
  it("keeps the AWG 9 plywood comparison separate from AWG 11/12 toothpick bounds", () => {
    expect(americanWireGaugeDiameterMm(9)).toBe(2.91);
    expect(boundedAmericanWireGaugeDiameterMm(11, 12)).toEqual({
      minimumDiameterMm: 2.05,
      maximumDiameterMm: 2.3,
      representativeDiameterMm: 2.18
    });
  });

  it("retains reference-gauge evidence and rejects a substituted scalar", () => {
    const input = {
      basis: "user-reported-reference-gauge" as const,
      effectiveDiameterMm: 2.18,
      minimumDiameterMm: 2.05,
      maximumDiameterMm: 2.3,
      stockKind: "wooden-toothpick" as const,
      referenceGauge: {
        system: "american-wire-gauge" as const,
        largerDiameterGaugeNumber: 11,
        smallerDiameterGaugeNumber: 12,
        policyId: "american-wire-gauge-diameter" as const,
        policyVersion: "1.0.0" as const
      },
      straightnessEvidence: "unverified" as const
    };
    expect(resolvePinSetup(input)).toEqual(input);
    expect(() => resolvePinSetup({ ...input, effectiveDiameterMm: 2.2 })).toThrow(
      "Reference-gauge pin bounds must match",
    );
  });
});
