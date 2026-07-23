import { describe, expect, it, vi } from "vitest";

import { hashCanonical } from "../../src/domain/hash.js";
import { SheetPartSchema, type SheetPart } from "../../src/domain/contracts.js";
import {
  PROCEDURAL_MOTIF_SEARCH_POLICY,
  ProceduralMotifConstructionError,
  applyPlannedProceduralMotif
} from "../../src/interpretation/procedural-motif-planner.js";
import { MotifRecipeV1Schema } from "../../src/operators/procedural-surface-treatment.js";
import { rectangleContour } from "../../src/operators/orthogonal-model.js";
import { validateParts } from "../../src/validation/geometry.js";

function part(id: string, role: SheetPart["role"]): SheetPart {
  return SheetPartSchema.parse({
    schemaVersion: "2.0",
    id,
    name: id,
    role,
    markingCode: `${id}-mark`,
    materialProfileId: "planner-test-material",
    thicknessUm: 3_000,
    grainVector: { x: 1, y: 0 },
    nominalRegion: {
      outer: rectangleContour(`${id}-outer`, 0, 0, 100_000, 80_000),
      holes: []
    },
    features: [],
    assembledFrame: {
      origin: { xUm: 0, yUm: 0, zUm: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 }
    },
    explodedOffset: { xUm: 0, yUm: 0, zUm: 0 },
    assemblyDependencyPartIds: [],
    sourceOperator: { id: "planner-proof-panel", version: "1.0.0" }
  });
}

function collidingRecipe() {
  return MotifRecipeV1Schema.parse({
    schemaVersion: "1.0",
    recipeId: "planner-proof-recipe",
    deterministicSeed: "planner-proof-seed",
    vocabulary: ["framed", "floral", "accent"],
    composition: "focal",
    density: "dense",
    symmetry: "bilateral",
    primitiveFamilies: [
      "inset-score-frame",
      "filled-diamond-focal",
      "filled-dot-repeat",
      "corner-score-ticks"
    ],
    preferredOperations: ["engrave", "score"],
    preferredPartRoles: ["cover"],
    placement: {
      scalePermille: 1_000,
      rotationQuarterTurns: 0,
      offsetXPermille: 0,
      offsetYPermille: 0,
      targetFace: "front"
    }
  });
}

describe("procedural motif construction search", () => {
  it("targets a semantic cover to the canonical moving panel and resolves overlap deterministically", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const parts = [
      part("arbitrary-support-surface", "structural-panel"),
      part("arbitrary-moving-surface", "moving-panel")
    ];
    const [first, repeated] = await Promise.all([
      applyPlannedProceduralMotif({ parts, recipe: collidingRecipe() }),
      applyPlannedProceduralMotif({ parts, recipe: collidingRecipe() })
    ]);
    expect(first.report.targetPartIds).toEqual(["arbitrary-moving-surface"]);
    expect(first.recipe.primitiveFamilies).toEqual([
      "inset-score-frame",
      "filled-diamond-focal",
      "corner-score-ticks"
    ]);
    expect(first.selection).toMatchObject({
      searchPolicyId: PROCEDURAL_MOTIF_SEARCH_POLICY.id,
      searchPolicyVersion: PROCEDURAL_MOTIF_SEARCH_POLICY.version,
      preferredCandidateId: "requested-primitives",
      selectedCandidateId: "focal-primary",
      changedConstruction: true,
      attempts: [
        {
          candidateId: "requested-primitives",
          status: "rejected",
          findingCodes: ["ENGRAVE_REGION_OVERLAP"]
        },
        { candidateId: "focal-primary", status: "selected", findingCodes: [] }
      ]
    });
    expect(first.selection.disclosure).toContain("omitted filled-dot-repeat");
    expect(validateParts(first.parts).status).toBe("pass");
    expect(first.parts.find((item) => item.id === "arbitrary-support-surface")?.features).toEqual([]);
    expect(await hashCanonical(first)).toBe(await hashCanonical(repeated));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("withholds output with the fixed attempt record when no candidate validates", async () => {
    const work = applyPlannedProceduralMotif({
      parts: [part("unavailable-moving-surface", "moving-panel")],
      recipe: collidingRecipe(),
      validate: () => ({
        schemaVersion: "2.0",
        status: "fail",
        findings: [{
          code: "TREATMENT_SAFE_REGION_UNAVAILABLE",
          severity: "error",
          owner: "planner-proof",
          relatedIds: ["unavailable-moving-surface"],
          message: "The proof surface intentionally rejects every candidate.",
          blocksExport: true
        }]
      })
    });
    await expect(work).rejects.toMatchObject({
      code: "PROCEDURAL_MOTIF_CONSTRUCTION_UNAVAILABLE",
      attempts: [
        {
          candidateId: "requested-primitives",
          status: "rejected",
          findingCodes: ["TREATMENT_SAFE_REGION_UNAVAILABLE"]
        },
        {
          candidateId: "focal-primary",
          status: "rejected",
          findingCodes: ["TREATMENT_SAFE_REGION_UNAVAILABLE"]
        }
      ]
    } satisfies Partial<ProceduralMotifConstructionError>);
  });
});
