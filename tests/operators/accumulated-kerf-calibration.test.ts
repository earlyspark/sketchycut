import { describe, expect, it } from "vitest";

import {
  evaluatePackedSpanCalibration,
  evaluateStockInputs
} from "../../src/index.js";

const artifactHash = "a".repeat(64);
const base = {
  materialKind: "basswood-plywood" as const,
  thicknessBasis: "nominal-preset" as const,
  effectiveThicknessMm: 3,
  fixtureArtifactHash: artifactHash
};

describe("packed-span cut-width calibration", () => {
  it("accepts exact raw boundaries before normalizing once", () => {
    const minimum = evaluatePackedSpanCalibration({
      ...base,
      packedRowWidthMm: 119.5,
      packedColumnHeightMm: 99.5
    });
    const maximum = evaluatePackedSpanCalibration({
      ...base,
      packedRowWidthMm: 116,
      packedColumnHeightMm: 96
    });
    expect(minimum.status).toBe("valid");
    expect(maximum.status).toBe("valid");
    if (minimum.status === "valid" && maximum.status === "valid") {
      expect(minimum.rawDerivedFullCutWidthMm).toEqual({ x: 0.05, y: 0.05 });
      expect(minimum.evaluation.kerf).toMatchObject({ xMm: 0.05, yMm: 0.05 });
      expect(maximum.rawDerivedFullCutWidthMm).toEqual({ x: 0.4, y: 0.4 });
      expect(maximum.evaluation.kerf).toMatchObject({ xMm: 0.4, yMm: 0.4 });
    }
  });

  it.each([
    [119.51, 98.5, "X raw derived"],
    [115.96, 98.5, "X raw derived"],
    [118.5, 99.51, "Y raw derived"],
    [118.5, 95.96, "Y raw derived"]
  ])("rejects %.2f / %.2f before boundary-rounding could admit it", (row, column, message) => {
    const result = evaluatePackedSpanCalibration({
      ...base,
      packedRowWidthMm: row,
      packedColumnHeightMm: column
    });
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") throw new Error("Expected raw boundary rejection.");
    expect(result.findings.map((finding) => finding.code)).toContain(
      "KERF_OUT_OF_SUPPORTED_ENVELOPE",
    );
    expect(result.findings.map((finding) => finding.message).join(" ")).toContain(message);
  });

  it.each([
    [null, 98.5, "FIXTURE_PACKED_SPAN_INCOMPLETE"],
    [118.5, null, "FIXTURE_PACKED_SPAN_INCOMPLETE"],
    [120, 98.5, "FIXTURE_PACKED_SPAN_INVALID"],
    [121, 98.5, "FIXTURE_PACKED_SPAN_INVALID"],
    [-1, 98.5, "FIXTURE_PACKED_SPAN_INVALID"],
    [Number.NaN, 98.5, "FIXTURE_PACKED_SPAN_INVALID"],
    [98.5, 118.5, "FIXTURE_PACKED_SPAN_INVALID"]
  ])("returns a typed finding for invalid spans", (row, column, code) => {
    const result = evaluatePackedSpanCalibration({
      ...base,
      packedRowWidthMm: row,
      packedColumnHeightMm: column
    });
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") throw new Error("Expected typed span rejection.");
    expect(result.findings[0]?.code).toBe(code);
  });

  it("retains raw evidence and routes normalized results through the manual policy", () => {
    const fixture = evaluatePackedSpanCalibration({
      ...base,
      packedRowWidthMm: 117,
      packedColumnHeightMm: 97
    });
    const manual = evaluateStockInputs({
      materialKind: "basswood-plywood",
      thicknessBasis: "nominal-preset",
      effectiveThicknessMm: 3,
      kerfXmm: 0.3,
      kerfYmm: 0.3,
      kerfSource: "user-reported-manual"
    });
    expect(fixture.status).toBe("valid");
    if (fixture.status === "valid") {
      expect(fixture.evaluation.kerf).toMatchObject({
        xMm: 0.3,
        yMm: 0.3,
        source: "fixture-derived",
        fixtureEvidence: {
          fixtureArtifactHash: artifactHash,
          enteredPackedSpanMm: { row: 117, column: 97 },
          rawDerivedFullCutWidthMm: { x: 0.3, y: 0.3 },
          normalizedFullCutWidthMm: { x: 0.3, y: 0.3 }
        }
      });
      expect(fixture.evaluation.findings.map((finding) => finding.code)).toEqual(
        manual.findings.map((finding) => finding.code),
      );
      expect(fixture.evaluation.findings.filter(
        (finding) => finding.code === "KERF_OUTSIDE_PROVISIONAL_BAND",
      )).toHaveLength(1);
    }
  });
});
