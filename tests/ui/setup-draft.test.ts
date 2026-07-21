import { describe, expect, it } from "vitest";

import {
  createPublicFabricationSetup,
  createCompactFabricationSetup,
  resolveFabricationSetup
} from "../../src/index.js";
import { draftFromApplied } from "../../src/ui/hooks/use-applied-fabrication-setup.js";
import { evaluateFabricationSetupDraft } from "../../src/ui/setup-draft.js";

const fixtureArtifactHash = "b".repeat(64);

describe("public fabrication setup draft resolver", () => {
  it("uses a canonical 12 × 12 inch public stock sheet and relinks it to measured material", () => {
    const applied = createPublicFabricationSetup();
    expect(applied.stockFootprint).toMatchObject({
      widthMm: 304.8,
      heightMm: 304.8,
      orientation: "machine-x-y",
      source: "user-reported",
      confidence: "user-reported-unreviewed"
    });
    const resolved = resolveFabricationSetup({
      ...applied,
      thickness: { basis: "user-reported-caliper", readingsMm: [2.97] }
    });
    expect(resolved.fabricationContext.stockFootprint).toMatchObject({
      widthMm: 304.8,
      heightMm: 304.8,
      materialProfileId: resolved.material.id
    });
    expect(resolved.fit.snug).toEqual({
      totalDeltaMm: 0.15,
      confidence: "provisional"
    });
  });

  it("accepts one reading without range/variation evidence", () => {
    const draft = draftFromApplied(createCompactFabricationSetup());
    draft.thickness = { basis: "user-reported-caliper", readings: ["2.99", "", ""] };
    const result = evaluateFabricationSetupDraft(draft, {
      requireAdditionalThicknessReadings: false,
      fixtureArtifactHash
    });
    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.applied.thickness).toEqual({
        basis: "user-reported-caliper",
        readingsMm: [2.99]
      });
      expect(result.policyEvaluation.thickness.measurement?.samplesMm).toEqual([2.99]);
      expect(result.policyEvaluation.findings.map((finding) => finding.code)).not.toContain(
        "STOCK_THICKNESS_VARIATION_HIGH",
      );
    }
  });

  it("never emits a public two-reading profile", () => {
    const draft = draftFromApplied(createCompactFabricationSetup());
    draft.thickness = { basis: "user-reported-caliper", readings: ["2.99", "3.01", ""] };
    const result = evaluateFabricationSetupDraft(draft, {
      requireAdditionalThicknessReadings: true,
      fixtureArtifactHash
    });
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.message).toBe("Complete both additional readings, or use one reading only.");
    }
  });

  it("retains three readings, deterministic typical value, range, and wide-spread warning", () => {
    const draft = draftFromApplied(createCompactFabricationSetup());
    draft.thickness = { basis: "user-reported-caliper", readings: ["2.98", "3.01", "2.99"] };
    const tight = evaluateFabricationSetupDraft(draft, {
      requireAdditionalThicknessReadings: true,
      fixtureArtifactHash
    });
    expect(tight.status).toBe("valid");
    if (tight.status === "valid") {
      expect(tight.policyEvaluation.thickness.measurement).toMatchObject({
        samplesMm: [2.98, 2.99, 3.01],
        representativeThicknessMm: 2.99,
        minimumThicknessMm: 2.98,
        maximumThicknessMm: 3.01
      });
      expect(tight.policyEvaluation.findings.map((finding) => finding.code)).not.toContain(
        "STOCK_THICKNESS_VARIATION_HIGH",
      );
    }
    draft.thickness.readings = ["2.88", "3.00", "3.10"];
    const wide = evaluateFabricationSetupDraft(draft, {
      requireAdditionalThicknessReadings: true,
      fixtureArtifactHash
    });
    expect(wide.status).toBe("valid");
    if (wide.status === "valid") {
      expect(wide.policyEvaluation.findings.map((finding) => finding.code)).toContain(
        "STOCK_THICKNESS_VARIATION_HIGH",
      );
    }
  });

  it("preserves exact out-of-envelope text without clamping or substitution", () => {
    const draft = draftFromApplied(createCompactFabricationSetup());
    draft.thickness = { basis: "user-reported-caliper", readings: ["2.49", "", ""] };
    const result = evaluateFabricationSetupDraft(draft, {
      requireAdditionalThicknessReadings: false,
      fixtureArtifactHash
    });
    expect(draft.thickness.readings[0]).toBe("2.49");
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.findings.map((finding) => finding.code)).toContain(
        "STOCK_MEASUREMENT_OUT_OF_SUPPORTED_ENVELOPE",
      );
      expect(result.message).not.toMatch(/nearby|try 2\./i);
    }
  });
});
