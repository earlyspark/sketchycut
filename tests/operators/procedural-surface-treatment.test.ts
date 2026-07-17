import { describe, expect, it, vi } from "vitest";

import { hashCanonical } from "../../src/domain/hash.js";
import {
  MotifRecipeV1Schema,
  applyProceduralSurfaceTreatment,
  type MotifRecipeV1
} from "../../src/operators/procedural-surface-treatment.js";
import { projectManufacturingPaths } from "../../src/projections/fabrication/manufacturing.js";
import { validateOrthogonalAssembly } from "../../src/validation/assembly.js";
import { validateParts } from "../../src/validation/geometry.js";
import { compileM2Fixture } from "../helpers/m2-fixtures.js";

function recipe(
  id: string,
  overrides: Partial<MotifRecipeV1> = {},
): MotifRecipeV1 {
  return MotifRecipeV1Schema.parse({
    schemaVersion: "1.0",
    recipeId: id,
    deterministicSeed: `${id}-seed`,
    vocabulary: ["geometric", "quiet"],
    composition: "field",
    density: "sparse",
    symmetry: "none",
    primitiveFamilies: ["parallel-line-field"],
    preferredOperations: ["score"],
    preferredPartRoles: ["enclosure"],
    placement: {
      scalePermille: 1_000,
      rotationQuarterTurns: 0,
      offsetXPermille: 0,
      offsetYPermille: 0,
      targetFace: "front"
    },
    ...overrides
  });
}

function motifFeatures(parts: Awaited<ReturnType<typeof applyProceduralSurfaceTreatment>>["parts"]) {
  return parts.flatMap((part) => part.features.filter((feature) =>
    feature.kind === "treatment" && feature.id.startsWith("m5-")
  ));
}

describe("registered procedural motif operator", () => {
  it("materially changes composition, density, and symmetry across three deterministic recipes", async () => {
    const { document } = await compileM2Fixture("basic-box");
    const recipes = [
      recipe("m5-line-field"),
      recipe("m5-dot-repeat", {
        composition: "repeated",
        density: "dense",
        symmetry: "radial",
        primitiveFamilies: ["filled-dot-repeat"],
        preferredOperations: ["engrave"]
      }),
      recipe("m5-diamond-focal", {
        composition: "focal",
        density: "balanced",
        symmetry: "bilateral",
        primitiveFamilies: ["filled-diamond-focal", "inset-score-frame"],
        preferredOperations: ["engrave", "score"],
        placement: {
          scalePermille: 900,
          rotationQuarterTurns: 1,
          offsetXPermille: -40,
          offsetYPermille: 60,
          targetFace: "back"
        }
      })
    ];
    const results = await Promise.all(recipes.map((item) =>
      applyProceduralSurfaceTreatment(document.parts, item)
    ));
    const geometryHashes = await Promise.all(results.map((result) =>
      hashCanonical(motifFeatures(result.parts))
    ));
    expect(new Set(geometryHashes).size).toBe(3);
    expect(results[0]!.report.scoreFeatureCount).toBeGreaterThan(0);
    expect(results[1]!.report.engraveFeatureCount).toBeGreaterThan(results[0]!.report.engraveFeatureCount);
    expect(results[2]!.report.targetPartIds.length).toBeGreaterThan(0);

    const repeated = await applyProceduralSurfaceTreatment(document.parts, recipes[1]);
    expect(await hashCanonical(motifFeatures(repeated.parts))).toBe(geometryHashes[1]);
    expect(repeated.report).toEqual(results[1]!.report);
  });

  it("keeps Score as centerlines and vector Engrave as simple closed filled regions", async () => {
    const { document, profiles } = await compileM2Fixture("basic-box");
    const applied = await applyProceduralSurfaceTreatment(document.parts, recipe("m5-operation-proof", {
      composition: "repeated",
      density: "balanced",
      symmetry: "translational",
      primitiveFamilies: ["parallel-line-field", "filled-dot-repeat"],
      preferredOperations: ["score", "engrave"]
    }));
    const features = motifFeatures(applied.parts);
    for (const feature of features) {
      if (feature.operation === "score") {
        expect(feature.path).not.toBeNull();
        expect(feature.region).toBeNull();
      } else {
        expect(feature.operation).toBe("engrave");
        expect(feature.path).toBeNull();
        expect(feature.region?.outer.closed).toBe(true);
        expect(feature.region?.holes).toEqual([]);
      }
    }
    const nextDocument = { ...document, parts: applied.parts };
    const geometry = validateParts(applied.parts);
    const assembly = validateOrthogonalAssembly(nextDocument);
    expect(geometry.findings.filter((finding) =>
      finding.code.startsWith("ENGRAVE_") || finding.code.startsWith("SCORE_")
    )).toEqual([]);
    expect(assembly.findings.filter((finding) => finding.code.startsWith("TREATMENT_"))).toEqual([]);
    const paths = (await Promise.all(applied.parts.map((part) =>
      projectManufacturingPaths(part, profiles.processRecipe)
    ))).flat();
    expect(paths.filter((path) => path.operation === "engrave").every((path) => path.closed)).toBe(true);
    expect(paths.filter((path) => path.operation === "score").length).toBeGreaterThan(0);
  });

  it("recompiles placement locally with zero network calls and distinct byte identity", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const { document } = await compileM2Fixture("basic-box");
    const firstRecipe = recipe("m5-placement-edit", {
      primitiveFamilies: ["filled-diamond-focal"],
      preferredOperations: ["engrave"]
    });
    const secondRecipe = MotifRecipeV1Schema.parse({
      ...firstRecipe,
      placement: { ...firstRecipe.placement, offsetXPermille: 120 }
    });
    const [first, second] = await Promise.all([
      applyProceduralSurfaceTreatment(document.parts, firstRecipe),
      applyProceduralSurfaceTreatment(document.parts, secondRecipe)
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await hashCanonical(motifFeatures(first.parts))).not.toBe(
      await hashCanonical(motifFeatures(second.parts)),
    );
    fetchSpy.mockRestore();
  });
});
