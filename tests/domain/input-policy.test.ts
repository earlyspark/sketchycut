import { describe, expect, it } from "vitest";

import {
  basswoodProfile,
  evaluateStockInputs,
  measuredBasswoodProfile,
  provisionalProcessRecipe,
  quantizeHundredthMm,
  summarizeThicknessSamples,
  xtoolM2Profile
} from "../../src/index.js";

describe("measured stock and full-kerf input policy", () => {
  it("represents a starter preset without fake readings and emits a typed advisory", () => {
    const evaluation = evaluateStockInputs({
      materialKind: "basswood-plywood",
      thicknessBasis: "nominal-preset",
      effectiveThicknessMm: 3,
      kerfXmm: 0.15,
      kerfYmm: 0.15,
      kerfSource: "provisional-preset"
    });
    expect(evaluation.thickness).toEqual({
      basis: "nominal-preset",
      effectiveThicknessMm: 3
    });
    expect(evaluation.findings).toContainEqual(expect.objectContaining({
      code: "STOCK_THICKNESS_UNMEASURED",
      severity: "warning"
    }));
    expect(evaluation.status).toBe("pass");
  });

  it("normalizes thickness and directional kerf once at the 10 µm boundary", () => {
    expect(quantizeHundredthMm(2.9699999999999998)).toBe(2.97);
    expect(quantizeHundredthMm(2.975)).toBe(2.98);
    expect(measuredBasswoodProfile([2.9699999999999998])).toEqual(
      measuredBasswoodProfile([2.97]),
    );
    expect(basswoodProfile(2.9699999999999998)).toEqual(
      measuredBasswoodProfile([2.97]),
    );
    expect(basswoodProfile(2.87).name).toBe("2.87 mm basswood plywood");
    const material = basswoodProfile(3);
    const machine = xtoolM2Profile();
    expect(provisionalProcessRecipe(material, machine, 0.149999999999, 0.160000000001)).toEqual(
      provisionalProcessRecipe(material, machine, 0.15, 0.16),
    );
  });

  it("sorts samples and derives an exact deterministic median and spread", () => {
    expect(summarizeThicknessSamples([3.08, 2.96, 3.01, 2.99, 3.04])).toEqual({
      samplesMm: [2.96, 2.99, 3.01, 3.04, 3.08],
      representativeThicknessMm: 3.01,
      minimumThicknessMm: 2.96,
      maximumThicknessMm: 3.08,
      spreadMm: 0.12,
      method: "median",
      resolutionUm: 10
    });
    expect(summarizeThicknessSamples([3.02, 2.98])).toMatchObject({
      representativeThicknessMm: 3,
      spreadMm: 0.04
    });
  });

  it("accepts exact hard boundaries and reports provisional advisories without blocking", () => {
    const low = evaluateStockInputs({
      materialKind: "basswood-plywood",
      thicknessSamplesMm: [2.5, 2.5, 2.5],
      kerfXmm: 0.05,
      kerfYmm: 0.05
    });
    const high = evaluateStockInputs({
      materialKind: "basswood-plywood",
      thicknessSamplesMm: [3.6, 3.6, 3.6],
      kerfXmm: 0.4,
      kerfYmm: 0.4
    });
    expect(low.status).toBe("pass");
    expect(high.status).toBe("pass");
    expect(low.findings.every((finding) => finding.severity === "warning")).toBe(true);
    expect(high.findings.every((finding) => finding.severity === "warning")).toBe(true);
  });

  it("rejects any out-of-envelope sample or kerf with typed findings and no clamping", () => {
    const evaluation = evaluateStockInputs({
      materialKind: "basswood-plywood",
      thicknessSamplesMm: [2.49, 3, 3.61],
      kerfXmm: 0.04,
      kerfYmm: 0.41
    });
    expect(evaluation.status).toBe("fail");
    expect(evaluation.thickness.measurement?.samplesMm).toEqual([2.49, 3, 3.61]);
    expect(evaluation.kerf).toMatchObject({ xMm: 0.04, yMm: 0.41 });
    expect(evaluation.findings.map((finding) => finding.code)).toContain(
      "STOCK_MEASUREMENT_OUT_OF_SUPPORTED_ENVELOPE",
    );
    expect(evaluation.findings.filter((finding) => finding.code === "KERF_OUT_OF_SUPPORTED_ENVELOPE")).toHaveLength(2);
  });

  it("warns only when thickness spread exceeds the provisional threshold", () => {
    const atThreshold = evaluateStockInputs({
      materialKind: "basswood-plywood",
      thicknessSamplesMm: [2.95, 3, 3.1],
      kerfXmm: 0.15
    });
    const aboveThreshold = evaluateStockInputs({
      materialKind: "basswood-plywood",
      thicknessSamplesMm: [2.94, 3, 3.1],
      kerfXmm: 0.15
    });
    expect(atThreshold.findings.map((finding) => finding.code)).not.toContain(
      "STOCK_THICKNESS_VARIATION_HIGH",
    );
    expect(aboveThreshold.findings.map((finding) => finding.code)).toContain(
      "STOCK_THICKNESS_VARIATION_HIGH",
    );
  });

  it("records provisional policy confidence and rejects a material outside the policy", () => {
    const evaluation = evaluateStockInputs({
      materialKind: "custom-plywood",
      thicknessSamplesMm: [3, 3, 3],
      kerfXmm: 0.15
    });
    expect(evaluation.policyConfidence).toBe("provisional-preset");
    expect(evaluation.status).toBe("fail");
    expect(evaluation.findings.map((finding) => finding.code)).toContain(
      "STOCK_MATERIAL_KIND_UNSUPPORTED",
    );
  });

  it("collapses equal-axis kerf advisories while retaining directional findings", () => {
    const scalarEquivalent = evaluateStockInputs({
      materialKind: "basswood-plywood",
      thicknessSamplesMm: [3, 3, 3],
      kerfXmm: 0.3,
      kerfYmm: 0.3
    });
    const directional = evaluateStockInputs({
      materialKind: "basswood-plywood",
      thicknessSamplesMm: [3, 3, 3],
      kerfXmm: 0.3,
      kerfYmm: 0.31
    });
    const scalarFindings = scalarEquivalent.findings.filter(
      (finding) => finding.code === "KERF_OUTSIDE_PROVISIONAL_BAND",
    );
    const directionalFindings = directional.findings.filter(
      (finding) => finding.code === "KERF_OUTSIDE_PROVISIONAL_BAND",
    );
    expect(scalarFindings).toHaveLength(1);
    expect(scalarFindings[0]?.message).toContain("X/Y full kerf");
    expect(directionalFindings).toHaveLength(2);
    expect(directionalFindings.map((finding) => finding.message)).toEqual([
      expect.stringContaining("X full kerf"),
      expect.stringContaining("Y full kerf")
    ]);
  });
});
