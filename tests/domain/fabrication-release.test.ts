import { describe, expect, it } from "vitest";

import {
  CURRENT_FABRICATION_RELEASE_POLICY_VERSION,
  fabricationReleaseForMechanism,
  fabricationReleaseForStructuralKind
} from "../../src/domain/fabrication-release.js";

describe("current fabrication release policy", () => {
  it("keeps rigid panel construction exportable", () => {
    expect(fabricationReleaseForStructuralKind("orthogonal-panel")).toEqual({
      policyVersion: CURRENT_FABRICATION_RELEASE_POLICY_VERSION,
      exportAllowed: true,
      findingCode: null,
      reason: null
    });
    expect(fabricationReleaseForMechanism("rigid").exportAllowed).toBe(true);
  });

  it("withholds both physically deferred moving-interface constructions", () => {
    for (const kind of ["retained-pin", "captured-slide"] as const) {
      expect(fabricationReleaseForStructuralKind(kind)).toMatchObject({
        policyVersion: CURRENT_FABRICATION_RELEASE_POLICY_VERSION,
        exportAllowed: false,
        findingCode: "FABRICATION_EXPORT_WITHHELD_PENDING_STRUCTURAL_REDESIGN"
      });
    }
    expect(fabricationReleaseForMechanism("retained-pin").exportAllowed).toBe(false);
    expect(fabricationReleaseForMechanism("captured-slide").exportAllowed).toBe(false);
  });
});
