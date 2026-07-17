import { z } from "zod";

import {
  PartFeatureSchema,
  SheetPartSchema,
  StableIdSchema,
  type PartFeature,
  type PointUm,
  type SheetPart
} from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import { RegisteredMotifPrimitiveSchema } from "../interpretation/capability-catalog.js";
import { boundsUm } from "../kernel/geometry/metrics.js";
import { rectangleContour } from "./orthogonal-model.js";

export const PROCEDURAL_SURFACE_TREATMENT_OPERATOR = {
  id: "procedural-surface-treatment",
  version: "1.0.0"
} as const;

export const MotifRecipeV1Schema = z
  .object({
    schemaVersion: z.literal("1.0"),
    recipeId: StableIdSchema,
    deterministicSeed: z.string().min(1).max(120),
    vocabulary: z.array(z.string().trim().min(1).max(80)).max(12),
    composition: z.enum(["border", "field", "focal", "repeated"]),
    density: z.enum(["sparse", "balanced", "dense"]),
    symmetry: z.enum(["none", "bilateral", "radial", "translational"]),
    primitiveFamilies: z.array(RegisteredMotifPrimitiveSchema).min(1).max(6),
    preferredOperations: z.array(z.enum(["engrave", "score"])).min(1).max(2),
    preferredPartRoles: z.array(z.enum([
      "support",
      "enclosure",
      "cover",
      "moving-panel",
      "connector"
    ])).min(1).max(5),
    placement: z
      .object({
        scalePermille: z.number().int().min(500).max(1_500),
        rotationQuarterTurns: z.number().int().min(0).max(3),
        offsetXPermille: z.number().int().min(-200).max(200),
        offsetYPermille: z.number().int().min(-200).max(200),
        targetFace: z.enum(["front", "back"])
      })
      .strict()
  })
  .strict()
  .superRefine((recipe, context) => {
    if (new Set(recipe.primitiveFamilies).size !== recipe.primitiveFamilies.length) {
      context.addIssue({ code: "custom", message: "Motif primitive families must be unique." });
    }
    if (new Set(recipe.preferredOperations).size !== recipe.preferredOperations.length) {
      context.addIssue({ code: "custom", message: "Motif operations must be unique." });
    }
  });

export const MotifApplicationReportSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    operatorId: z.literal(PROCEDURAL_SURFACE_TREATMENT_OPERATOR.id),
    operatorVersion: z.literal(PROCEDURAL_SURFACE_TREATMENT_OPERATOR.version),
    recipeHash: z.string().regex(/^[0-9a-f]{64}$/),
    status: z.enum(["applied", "omitted"]),
    targetPartIds: z.array(StableIdSchema),
    featureIds: z.array(StableIdSchema),
    scoreFeatureCount: z.number().int().nonnegative(),
    engraveFeatureCount: z.number().int().nonnegative(),
    segmentCount: z.number().int().nonnegative(),
    coveragePermille: z.number().int().min(0).max(1_000),
    disclosures: z.array(z.string().min(1).max(500))
  })
  .strict();

type MotifRecipe = z.infer<typeof MotifRecipeV1Schema>;
type Bounds = ReturnType<typeof boundsUm>;

function primitiveOperation(
  primitive: MotifRecipe["primitiveFamilies"][number],
): "score" | "engrave" {
  return primitive.startsWith("filled-") ? "engrave" : "score";
}

function densityCount(density: MotifRecipe["density"]): number {
  return density === "sparse" ? 2 : density === "balanced" ? 4 : 6;
}

function eligiblePart(part: SheetPart): boolean {
  if (["guide-rail", "retainer", "motion-stop", "coupon-base", "coupon-insert", "coupon-pin"].includes(part.role)) {
    return false;
  }
  const bounds = boundsUm(part.nominalRegion.outer.points);
  return bounds.maxXUm - bounds.minXUm >= 32_000 && bounds.maxYUm - bounds.minYUm >= 28_000;
}

function preferredScore(part: SheetPart, recipe: MotifRecipe): number {
  if (part.role === "moving-panel" && recipe.preferredPartRoles.includes("moving-panel")) return 0;
  if (part.role === "structural-panel" && recipe.preferredPartRoles.some((role) =>
    role === "support" || role === "enclosure" || role === "cover"
  )) return 1;
  return 2;
}

function safeBounds(part: SheetPart, recipe: MotifRecipe): Bounds | null {
  const outer = boundsUm(part.nominalRegion.outer.points);
  const edgeInset = Math.max(6_000, part.thicknessUm * 3);
  const labelReserve = 18_000;
  const available = {
    minXUm: outer.minXUm + edgeInset,
    minYUm: outer.minYUm + edgeInset,
    maxXUm: outer.maxXUm - edgeInset - labelReserve,
    maxYUm: outer.maxYUm - edgeInset
  };
  const width = available.maxXUm - available.minXUm;
  const height = available.maxYUm - available.minYUm;
  if (width < 12_000 || height < 12_000) return null;
  const baseScale = recipe.placement.scalePermille / 1_500;
  const targetWidth = Math.max(10_000, Math.round(width * baseScale));
  const targetHeight = Math.max(10_000, Math.round(height * baseScale));
  const centerX = Math.round((available.minXUm + available.maxXUm) / 2) +
    Math.round((width * recipe.placement.offsetXPermille) / 2_000);
  const centerY = Math.round((available.minYUm + available.maxYUm) / 2) +
    Math.round((height * recipe.placement.offsetYPermille) / 2_000);
  const halfWidth = Math.floor(Math.min(targetWidth, width) / 2);
  const halfHeight = Math.floor(Math.min(targetHeight, height) / 2);
  return {
    minXUm: Math.max(available.minXUm, centerX - halfWidth),
    minYUm: Math.max(available.minYUm, centerY - halfHeight),
    maxXUm: Math.min(available.maxXUm, centerX + halfWidth),
    maxYUm: Math.min(available.maxYUm, centerY + halfHeight)
  };
}

function rotatePoint(point: PointUm, bounds: Bounds, turns: number): PointUm {
  if (turns === 0) return point;
  const centerX = Math.round((bounds.minXUm + bounds.maxXUm) / 2);
  const centerY = Math.round((bounds.minYUm + bounds.maxYUm) / 2);
  const limitX = Math.floor((bounds.maxXUm - bounds.minXUm) / 2);
  const limitY = Math.floor((bounds.maxYUm - bounds.minYUm) / 2);
  const x = point.xUm - centerX;
  const y = point.yUm - centerY;
  const rotated = turns === 1
    ? { x: Math.round((-y * limitX) / limitY), y: Math.round((x * limitY) / limitX) }
    : turns === 2
    ? { x: -x, y: -y }
    : { x: Math.round((y * limitX) / limitY), y: Math.round((-x * limitY) / limitX) };
  return {
    xUm: centerX + Math.max(-limitX, Math.min(limitX, rotated.x)),
    yUm: centerY + Math.max(-limitY, Math.min(limitY, rotated.y))
  };
}

function scoreFeature(
  id: string,
  points: PointUm[],
  closed: boolean,
  recipe: MotifRecipe,
): PartFeature {
  return PartFeatureSchema.parse({
    id,
    kind: "treatment",
    operation: "score",
    surfaceSide: recipe.placement.targetFace,
    fitClass: null,
    jointId: null,
    region: null,
    path: { id: `${id}-path`, closed, points },
    parametersUm: { motifPrimitiveIndex: 1 }
  });
}

function engraveFeature(
  id: string,
  points: PointUm[],
  recipe: MotifRecipe,
): PartFeature {
  return PartFeatureSchema.parse({
    id,
    kind: "treatment",
    operation: "engrave",
    surfaceSide: recipe.placement.targetFace,
    fitClass: null,
    jointId: null,
    region: {
      outer: { id: `${id}-region`, closed: true, points },
      holes: []
    },
    path: null,
    parametersUm: { motifPrimitiveIndex: 1 }
  });
}

function lineFeatures(
  part: SheetPart,
  bounds: Bounds,
  recipe: MotifRecipe,
): PartFeature[] {
  const count = densityCount(recipe.density);
  return Array.from({ length: count }, (_, index) => {
    const yUm = bounds.minYUm + Math.round(((index + 1) * (bounds.maxYUm - bounds.minYUm)) / (count + 1));
    const points = [
      { xUm: bounds.minXUm, yUm },
      { xUm: bounds.maxXUm, yUm }
    ].map((point) => rotatePoint(point, bounds, recipe.placement.rotationQuarterTurns));
    return scoreFeature(
      `${recipe.recipeId}-${part.id}-line-${String(index + 1)}`,
      points,
      false,
      recipe,
    );
  });
}

function frameFeature(part: SheetPart, bounds: Bounds, recipe: MotifRecipe): PartFeature {
  const points = rectangleContour(
    `${recipe.recipeId}-${part.id}-frame-source`,
    bounds.minXUm,
    bounds.minYUm,
    bounds.maxXUm - bounds.minXUm,
    bounds.maxYUm - bounds.minYUm,
  ).points.map((point) => rotatePoint(point, bounds, recipe.placement.rotationQuarterTurns));
  return scoreFeature(`${recipe.recipeId}-${part.id}-frame`, points, true, recipe);
}

function tickFeatures(part: SheetPart, bounds: Bounds, recipe: MotifRecipe): PartFeature[] {
  const length = Math.max(3_000, Math.min(8_000, Math.floor(Math.min(
    bounds.maxXUm - bounds.minXUm,
    bounds.maxYUm - bounds.minYUm,
  ) / 4)));
  const corners = [
    [bounds.minXUm, bounds.minYUm, 1, 1],
    [bounds.maxXUm, bounds.minYUm, -1, 1],
    [bounds.minXUm, bounds.maxYUm, 1, -1],
    [bounds.maxXUm, bounds.maxYUm, -1, -1]
  ] as const;
  return corners.map(([xUm, yUm, xDirection, yDirection], index) => scoreFeature(
    `${recipe.recipeId}-${part.id}-tick-${String(index + 1)}`,
    [
      { xUm: xUm + xDirection * length, yUm },
      { xUm, yUm },
      { xUm, yUm: yUm + yDirection * length }
    ].map((point) => rotatePoint(point, bounds, recipe.placement.rotationQuarterTurns)),
    false,
    recipe,
  ));
}

function motifCenters(bounds: Bounds, recipe: MotifRecipe): PointUm[] {
  const count = densityCount(recipe.density);
  const center = {
    xUm: Math.round((bounds.minXUm + bounds.maxXUm) / 2),
    yUm: Math.round((bounds.minYUm + bounds.maxYUm) / 2)
  };
  const radiusX = Math.floor((bounds.maxXUm - bounds.minXUm) * 0.35);
  const radiusY = Math.floor((bounds.maxYUm - bounds.minYUm) * 0.35);
  if (recipe.composition === "focal") return [center];
  if (recipe.symmetry === "radial") {
    return Array.from({ length: Math.max(4, count) }, (_, index) => {
      const radians = (index * Math.PI * 2) / Math.max(4, count);
      return {
        xUm: center.xUm + Math.round(Math.cos(radians) * radiusX),
        yUm: center.yUm + Math.round(Math.sin(radians) * radiusY)
      };
    });
  }
  if (recipe.symmetry === "bilateral") {
    const pairs = Math.max(1, Math.ceil(count / 2));
    return Array.from({ length: pairs }, (_, index) => {
      const yUm = bounds.minYUm + Math.round(((index + 1) * (bounds.maxYUm - bounds.minYUm)) / (pairs + 1));
      return [
        { xUm: center.xUm - Math.round(radiusX * 0.65), yUm },
        { xUm: center.xUm + Math.round(radiusX * 0.65), yUm }
      ];
    }).flat().slice(0, count);
  }
  const seedValue = Array.from(recipe.deterministicSeed).reduce(
    (value, character) => ((value * 33) ^ character.charCodeAt(0)) >>> 0,
    5_381,
  );
  return Array.from({ length: count }, (_, index) => ({
    xUm: bounds.minXUm + Math.round(((index + 1) * (bounds.maxXUm - bounds.minXUm)) / (count + 1)),
    yUm: recipe.composition === "border"
      ? index % 2 === 0 ? bounds.minYUm + 3_000 : bounds.maxYUm - 3_000
      : center.yUm + (recipe.symmetry === "none"
        ? ((((seedValue >>> (index % 16)) & 3) - 1) * 2_000)
        : 0)
  }));
}

function dotFeatures(part: SheetPart, bounds: Bounds, recipe: MotifRecipe): PartFeature[] {
  const radius = Math.max(1_200, Math.min(3_000, Math.floor(Math.min(
    bounds.maxXUm - bounds.minXUm,
    bounds.maxYUm - bounds.minYUm,
  ) / 16)));
  return motifCenters(bounds, recipe).map((rawCenter, index) => {
    const center = rotatePoint(rawCenter, bounds, recipe.placement.rotationQuarterTurns);
    const points = Array.from({ length: 8 }, (_, pointIndex) => {
      const radians = (pointIndex * Math.PI * 2) / 8;
      return {
        xUm: center.xUm + Math.round(Math.cos(radians) * radius),
        yUm: center.yUm + Math.round(Math.sin(radians) * radius)
      };
    });
    return engraveFeature(
      `${recipe.recipeId}-${part.id}-dot-${String(index + 1)}`,
      points,
      recipe,
    );
  });
}

function diamondFeature(part: SheetPart, bounds: Bounds, recipe: MotifRecipe): PartFeature {
  const center = rotatePoint({
    xUm: Math.round((bounds.minXUm + bounds.maxXUm) / 2),
    yUm: Math.round((bounds.minYUm + bounds.maxYUm) / 2)
  }, bounds, recipe.placement.rotationQuarterTurns);
  const radiusX = Math.max(2_000, Math.floor((bounds.maxXUm - bounds.minXUm) / 5));
  const radiusY = Math.max(2_000, Math.floor((bounds.maxYUm - bounds.minYUm) / 5));
  return engraveFeature(`${recipe.recipeId}-${part.id}-diamond`, [
    { xUm: center.xUm, yUm: center.yUm - radiusY },
    { xUm: center.xUm + radiusX, yUm: center.yUm },
    { xUm: center.xUm, yUm: center.yUm + radiusY },
    { xUm: center.xUm - radiusX, yUm: center.yUm }
  ], recipe);
}

function primitiveFeatures(
  primitive: MotifRecipe["primitiveFamilies"][number],
  part: SheetPart,
  bounds: Bounds,
  recipe: MotifRecipe,
): PartFeature[] {
  if (primitive === "parallel-line-field") return lineFeatures(part, bounds, recipe);
  if (primitive === "inset-score-frame") return [frameFeature(part, bounds, recipe)];
  if (primitive === "corner-score-ticks") return tickFeatures(part, bounds, recipe);
  if (primitive === "filled-dot-repeat") return dotFeatures(part, bounds, recipe);
  return [diamondFeature(part, bounds, recipe)];
}

export async function applyProceduralSurfaceTreatment(
  partsCandidate: readonly SheetPart[],
  recipeCandidate: unknown,
): Promise<{
  parts: SheetPart[];
  report: z.infer<typeof MotifApplicationReportSchema>;
}> {
  const parts = partsCandidate.map((part) => SheetPartSchema.parse(part));
  const recipe = MotifRecipeV1Schema.parse(recipeCandidate);
  const recipeHash = await hashCanonical(recipe);
  const disclosures: string[] = [];
  const allowedPrimitives = recipe.primitiveFamilies.filter((primitive) => {
    const operation = primitiveOperation(primitive);
    const allowed = recipe.preferredOperations.includes(operation);
    if (!allowed) disclosures.push(`${primitive} was omitted because ${operation} was not selected.`);
    return allowed;
  });
  const candidates = parts
    .filter(eligiblePart)
    .sort((left, right) =>
      preferredScore(left, recipe) - preferredScore(right, recipe) || left.id.localeCompare(right.id)
    )
    .slice(0, recipe.density === "dense" ? 2 : 1);
  const additions = new Map<string, PartFeature[]>();
  for (const part of candidates) {
    const bounds = safeBounds(part, recipe);
    if (bounds === null) {
      disclosures.push(`No meaningful safe treatment surface remained on ${part.id}.`);
      continue;
    }
    const safeId = `${recipe.recipeId}-${part.id}-safe-region`;
    const features: PartFeature[] = [PartFeatureSchema.parse({
      id: safeId,
      kind: "safe-treatment-region",
      operation: "none",
      fitClass: null,
      jointId: null,
      region: {
        outer: rectangleContour(
          `${safeId}-outer`,
          bounds.minXUm,
          bounds.minYUm,
          bounds.maxXUm - bounds.minXUm,
          bounds.maxYUm - bounds.minYUm,
        ),
        holes: []
      },
      path: null,
      parametersUm: { edgeInset: Math.max(6_000, part.thicknessUm * 3) }
    })];
    features.push(...allowedPrimitives.flatMap((primitive) =>
      primitiveFeatures(primitive, part, bounds, recipe)
    ));
    additions.set(part.id, features);
  }
  const output = parts.map((part) => ({
    ...part,
    features: [...part.features, ...(additions.get(part.id) ?? [])]
  })).map((part) => SheetPartSchema.parse(part));
  const treatments = [...additions.values()].flat().filter((feature) => feature.kind === "treatment");
  if (treatments.length === 0) {
    disclosures.push("No registered treatment could be placed safely; fabrication geometry is unchanged.");
  }
  const candidateArea = candidates.reduce((total, part) => {
    const bounds = safeBounds(part, recipe);
    return bounds === null ? total : total +
      (bounds.maxXUm - bounds.minXUm) * (bounds.maxYUm - bounds.minYUm);
  }, 0);
  const partArea = candidates.reduce((total, part) => {
    const bounds = boundsUm(part.nominalRegion.outer.points);
    return total + (bounds.maxXUm - bounds.minXUm) * (bounds.maxYUm - bounds.minYUm);
  }, 0);
  return {
    parts: output,
    report: MotifApplicationReportSchema.parse({
      schemaVersion: "1.0",
      operatorId: PROCEDURAL_SURFACE_TREATMENT_OPERATOR.id,
      operatorVersion: PROCEDURAL_SURFACE_TREATMENT_OPERATOR.version,
      recipeHash,
      status: treatments.length > 0 ? "applied" : "omitted",
      targetPartIds: [...additions.entries()]
        .filter(([, features]) => features.some((feature) => feature.kind === "treatment"))
        .map(([partId]) => partId)
        .sort(),
      featureIds: treatments.map((feature) => feature.id).sort(),
      scoreFeatureCount: treatments.filter((feature) => feature.operation === "score").length,
      engraveFeatureCount: treatments.filter((feature) => feature.operation === "engrave").length,
      segmentCount: treatments.reduce((total, feature) => {
        const points = feature.path?.points ?? feature.region?.outer.points ?? [];
        return total + Math.max(0, points.length - (feature.path?.closed === false ? 1 : 0));
      }, 0),
      coveragePermille: partArea === 0 ? 0 : Math.min(1_000, Math.round((candidateArea * 1_000) / partArea)),
      disclosures
    })
  };
}

export type MotifRecipeV1 = z.infer<typeof MotifRecipeV1Schema>;
export type MotifApplicationReport = z.infer<typeof MotifApplicationReportSchema>;
