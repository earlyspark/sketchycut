import { describe, expect, it } from "vitest";

import { reconcileExplicitSizingConstraints, targetKey } from "../../src/interpretation/explicit-sizing.js";
import { buildSourceEvidenceIndex } from "../../src/interpretation/source-evidence.js";

const reference = {
  referenceId: "reference-one",
  sha256: "a".repeat(64),
  mediaType: "image/png" as const,
  width: 640,
  height: 480
};

describe("SourceEvidenceIndexV1 and ExactMeasurementGrammarV1", () => {
  it("extracts only explicit project subject/axis measurements and removes values from semantics", async () => {
    const first = await buildSourceEvidenceIndex({
      brief: "Make a box with project external width 150 mm, project external depth 100 mm, and project external height 60 mm.",
      references: [],
      roleConstraints: []
    });
    expect(first.parsedConstraints.map((item) => [targetKey(item.target), item.valueUm])).toEqual([
      ["project.external.width", 150_000],
      ["project.external.depth", 100_000],
      ["project.external.height", 60_000]
    ]);
    expect(first.semanticBrief).not.toMatch(/150|100|60/);
    expect(first.semanticBrief).toContain("<EXACT:project.external.width>");
    const changedValue = await buildSourceEvidenceIndex({
      brief: "Make a box with project external width 155 mm, project external depth 100 mm, and project external height 60 mm.",
      references: [],
      roleConstraints: []
    });
    expect(changedValue.semanticBrief).toBe(first.semanticBrief);
    expect(changedValue.sourceEvidenceIndex.digest).toBe(first.sourceEvidenceIndex.digest);
    expect(changedValue.parsedConstraints[0]?.valueUm).toBe(155_000);
    const retargeted = await buildSourceEvidenceIndex({
      brief: "Make a box with project internal width 155 mm, project external depth 100 mm, and project external height 60 mm.",
      references: [],
      roleConstraints: []
    });
    expect(retargeted.sourceEvidenceIndex.digest).not.toBe(first.sourceEvidenceIndex.digest);
  });

  it("targets adjective measurements to a contained object without converting them to project width", async () => {
    const result = await buildSourceEvidenceIndex({
      brief: "Make an organizer that holds 90 mm-wide cards.",
      references: [],
      roleConstraints: []
    });
    expect(result.parsedConstraints).toHaveLength(1);
    expect(result.parsedConstraints[0]).toMatchObject({
      target: { subject: "contained-object", objectId: "cards", axis: "width" },
      valueUm: 90_000
    });
    expect(targetKey(result.parsedConstraints[0]!.target)).toBe("contained.cards.width");
  });

  it("accepts only a fully labeled, individually unit-attached project axis tuple", async () => {
    const result = await buildSourceEvidenceIndex({
      brief: "Use project internal width × depth × height = 150 mm × 100 mm × 60 mm.",
      references: [],
      roleConstraints: []
    });
    expect(result.parsedConstraints.map((item) => [targetKey(item.target), item.valueUm])).toEqual([
      ["project.internal.width", 150_000],
      ["project.internal.depth", 100_000],
      ["project.internal.height", 60_000]
    ]);
    expect(result.semanticBrief).toContain("<EXACT:project.internal.width>");
    expect(result.semanticBrief).toContain("<EXACT:project.internal.depth>");
    expect(result.semanticBrief).toContain("<EXACT:project.internal.height>");
    expect(result.semanticBrief).not.toMatch(/150|100|60/);
  });

  it("leaves approximate, ranged, unitless, count, model-number, and ambiguous text in the semantic lane", async () => {
    const result = await buildSourceEvidenceIndex({
      brief: "Make about 10 cm wide storage for model X100 with 4 spaces, between 90–110 mm wide and height 60.",
      references: [],
      roleConstraints: []
    });
    expect(result.parsedConstraints).toEqual([]);
    expect(result.parserFindings.map((item) => item.reason)).toEqual(["approximate", "range"]);
    expect(result.semanticBrief).toContain("about 10 cm wide");
    expect(result.semanticBrief).toContain("X100");
    expect(result.semanticBrief).toContain("4 spaces");
    expect(result.semanticBrief).toContain("height 60");
  });

  it("retains a unit-attached axis without an explicit subject as a blocking ambiguity", async () => {
    const result = await buildSourceEvidenceIndex({
      brief: "Make a storage object with width 90 mm.",
      references: [],
      roleConstraints: []
    });
    expect(result.parsedConstraints).toEqual([]);
    expect(result.semanticBrief).toContain("width 90 mm");
    expect(result.parserFindings).toContainEqual(expect.objectContaining({
      code: "SIZING_MEASUREMENT_AMBIGUOUS",
      blocking: true,
      reason: "ambiguous-target"
    }));
  });

  it("keeps server evidence IDs privacy-safe and rejects unknown model IDs at authorization time", async () => {
    const result = await buildSourceEvidenceIndex({
      brief: "Make an open-front cubby from this reference.",
      references: [reference],
      roleConstraints: [{ referenceId: reference.referenceId, roles: ["structure"] }]
    });
    const serialized = JSON.stringify(result.sourceEvidenceIndex);
    expect(serialized).not.toContain("open-front cubby");
    expect(serialized).not.toContain("filename");
    expect(result.sourceEvidenceIndex.references[0]).toMatchObject({
      referenceId: "reference-one",
      contentDigest: "a".repeat(64),
      declaredRoles: ["structure"]
    });
  });

  it("preserves advanced precedence while retaining overridden brief provenance", async () => {
    const parsed = await buildSourceEvidenceIndex({
      brief: "Make a box with project external width 120 mm.",
      references: [],
      roleConstraints: []
    });
    const constraints = await reconcileExplicitSizingConstraints({
      advancedSizing: { basis: "exact-external", dimensions: { widthMm: 150 } },
      parsedConstraints: parsed.parsedConstraints,
      parserFindings: parsed.parserFindings
    });
    expect(constraints.constraints).toHaveLength(2);
    expect(constraints.constraints[0]).toMatchObject({ source: "advanced", valueUm: 150_000, status: "active" });
    expect(constraints.constraints[1]).toMatchObject({ source: "brief", valueUm: 120_000, status: "overridden", findingCode: "PARSED_MEASUREMENT_OVERRIDDEN" });
    expect(constraints.findings).toContainEqual(expect.objectContaining({ code: "PARSED_MEASUREMENT_OVERRIDDEN" }));
  });
});
