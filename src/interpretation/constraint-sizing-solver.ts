import { z } from "zod";

import { Sha256Schema, StableIdSchema } from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import {
  ExplicitSizingConstraintsV1Schema,
  SIZING_FIXED_POINT_UM,
  targetKey,
  type ExplicitSizingConstraintV1,
  type ExplicitSizingConstraintsV1
} from "./explicit-sizing.js";
import { IntentGraphV2Schema, type IntentGraphV2, type ScaleEvidenceV1 } from "./intent-graph-v2.js";
import {
  SymbolicTopologyCandidateV1Schema,
  type SymbolicTopologyCandidateV1
} from "./construction-contracts.js";

export const CONSTRAINT_SIZING_SOLVER_VERSION = "constraint-sizing-solver-v5" as const;
export const SIZING_POLICY_VERSION = "constraint-sizing-policy-v5" as const;
export const PROPORTION_STRENGTH_POLICY_VERSION = "proportion-strength-policy-v1" as const;
export const PROPORTION_RELATION_POLICY_VERSION = "proportion-relation-policy-v1" as const;
export const SUPPORTED_OBJECT_ENGAGEMENT_POLICY_VERSION = "supported-object-engagement-policy-v1" as const;
export const SCALE_AXIS_MAPPING_POLICY_VERSION = "scale-axis-mapping-policy-v2" as const;

const AXES = ["width", "depth", "height"] as const;
type Axis = typeof AXES[number];

const SIZING_POLICY = {
  version: SIZING_POLICY_VERSION,
  fixedPointUm: SIZING_FIXED_POINT_UM,
  unanchoredCharacteristicScaleUm: 120_000,
  unanchoredSanityIntervalUm: { minimum: 80_000, maximum: 180_000 },
  canonicalDefaultProportionsPermille: { width: 1_000, depth: 750, height: 500 },
  minimumExternalUm: { width: 80_000, depth: 60_000, height: 38_000 },
  minimumUsableSpaceUm: 18_000,
  clearanceTotalUm: { close: 1_000, "ordinary-access": 4_000, "easy-access": 8_000 },
  proportionStrengthRatioPermille: {
    moderate: 1_800,
    strong: 2_500,
    extreme: 3_500
  },
  proportionRelationResolution: {
    version: PROPORTION_RELATION_POLICY_VERSION,
    transitiveReduction: true,
    rejectDirectedCycles: true,
    preserveHierarchyAfterMinima: true
  },
  scaleAxisMapping: {
    version: SCALE_AXIS_MAPPING_POLICY_VERSION,
    rule: "proportion-dag-topological-order",
    tieBreak: "relation-precedence-then-axis-order"
  },
  supportedObjectEngagement: {
    longExtentFractionPermille: 250,
    minimumLongEngagementUm: 20_000,
    maximumLongEngagementUm: 100_000
  },
  scaleSanityUm: {
    long: { minimum: 1_000, maximum: 500_000 },
    short: { minimum: 1_000, maximum: 250_000 },
    height: { minimum: 1_000, maximum: 300_000 }
  }
} as const;

const SourceCategorySchema = z.enum([
  "exact-external",
  "exact-internal",
  "exact-contained-object",
  "exact-supported-object",
  "model-prior-scale",
  "semantic-proportion",
  "unanchored-fallback",
  "canonical-default-proportions",
  "construction-minimum"
]);

const AxisDecisionSchema = z.object({
  externalUm: z.number().int().positive(),
  internalUm: z.number().int().positive(),
  usablePerSpaceUm: z.number().int().positive(),
  sourceCategories: z.array(SourceCategorySchema).min(1)
}).strict();

const ConstraintLedgerEntrySchema = z.object({
  constraintId: StableIdSchema,
  targetKey: z.string().min(1).max(160),
  valueUm: z.number().int().positive(),
  state: z.enum(["satisfied", "overridden", "unused", "conflicting"]),
  candidateId: StableIdSchema
}).strict();

const ScaleNormalizationSchema = z.object({
  scaleEvidenceId: StableIdSchema,
  original: z.object({
    long: z.object({ minimumUm: z.number().int(), maximumUm: z.number().int() }).strict(),
    short: z.object({ minimumUm: z.number().int(), maximumUm: z.number().int() }).strict(),
    height: z.object({ minimumUm: z.number().int(), maximumUm: z.number().int() }).strict()
  }).strict(),
  normalized: z.object({
    long: z.object({ minimumUm: z.number().int(), maximumUm: z.number().int() }).strict(),
    short: z.object({ minimumUm: z.number().int(), maximumUm: z.number().int() }).strict(),
    height: z.object({ minimumUm: z.number().int(), maximumUm: z.number().int() }).strict()
  }).strict(),
  clamped: z.boolean(),
  findingCode: z.literal("SCALE_ESTIMATE_CLAMPED").nullable()
}).strict();

const ScaleAxisMappingDecisionSchema = z.object({
  scaleEvidenceId: StableIdSchema,
  objectId: StableIdSchema,
  longAxis: z.enum(AXES),
  shortAxis: z.enum(AXES),
  heightAxis: z.enum(AXES),
  policyVersion: z.literal(SCALE_AXIS_MAPPING_POLICY_VERSION)
}).strict().superRefine((value, context) => {
  if (new Set([value.longAxis, value.shortAxis, value.heightAxis]).size !== AXES.length) {
    context.addIssue({ code: "custom", message: "Scale evidence must map to three distinct project axes." });
  }
});

const SupportEngagementDecisionSchema = z.object({
  objectId: StableIdSchema,
  sourceKind: z.enum(["model-prior", "exact-maker"]),
  sourceId: StableIdSchema,
  longAxis: z.enum(AXES),
  originalLongExtentUm: z.number().int().positive(),
  appliedLongEngagementUm: z.number().int().positive(),
  policyVersion: z.literal(SUPPORTED_OBJECT_ENGAGEMENT_POLICY_VERSION),
  disclosure: z.literal(
    "Supported-object sizing uses partial engagement; the object may protrude and physical support remains unverified."
  )
}).strict();

export const SizingDecisionV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  kind: z.literal("solved"),
  candidateId: StableIdSchema,
  external: z.object({ widthUm: z.number().int(), depthUm: z.number().int(), heightUm: z.number().int() }).strict(),
  internal: z.object({ widthUm: z.number().int(), depthUm: z.number().int(), heightUm: z.number().int() }).strict(),
  usablePerSpace: z.object({ widthUm: z.number().int(), depthUm: z.number().int(), heightUm: z.number().int() }).strict(),
  axes: z.object({ width: AxisDecisionSchema, depth: AxisDecisionSchema, height: AxisDecisionSchema }).strict(),
  constraintLedger: z.array(ConstraintLedgerEntrySchema),
  scaleNormalizations: z.array(ScaleNormalizationSchema),
  scaleAxisMappings: z.array(ScaleAxisMappingDecisionSchema),
  sourceCategories: z.array(SourceCategorySchema).min(1),
  fallback: z.object({
    used: z.boolean(),
    policyVersion: z.literal(SIZING_POLICY_VERSION),
    characteristicScaleUm: z.number().int().positive().nullable(),
    disclosure: z.string().min(1).max(500).nullable()
  }).strict(),
  canonicalDefaultProportions: z.object({
    used: z.boolean(),
    policyVersion: z.literal("canonical-default-proportions-v1"),
    affectedAxes: z.array(z.enum(AXES)),
    disclosure: z.literal("canonical default proportions").nullable()
  }).strict(),
  proportionStrengthPolicy: z.object({
    policyVersion: z.literal(PROPORTION_STRENGTH_POLICY_VERSION),
    moderateRatioPermille: z.literal(1_800),
    strongRatioPermille: z.literal(2_500),
    extremeRatioPermille: z.literal(3_500)
  }).strict(),
  supportEngagement: z.object({
    used: z.boolean(),
    policyVersion: z.literal(SUPPORTED_OBJECT_ENGAGEMENT_POLICY_VERSION),
    decisions: z.array(SupportEngagementDecisionSchema),
    disclosure: z.literal(
      "Supported-object sizing uses partial engagement; the object may protrude and physical support remains unverified."
    ).nullable()
  }).strict(),
  objectiveVector: z.array(z.number().int()).length(7),
  assumptions: z.array(z.string().min(1).max(500)),
  solverVersion: z.literal(CONSTRAINT_SIZING_SOLVER_VERSION),
  policyVersion: z.literal(SIZING_POLICY_VERSION),
  policyHash: Sha256Schema,
  decisionHash: Sha256Schema
}).strict();

export const SizingInfeasibleV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  kind: z.literal("infeasible"),
  candidateId: StableIdSchema,
  findingCode: z.enum([
    "SIZING_HARD_CONSTRAINT_INFEASIBLE",
    "FIT_CRITICAL_MEASUREMENT_REQUIRED",
    "SIZING_OBJECT_TARGET_AMBIGUOUS",
    "SIZING_PROPORTION_RELATION_CONFLICT"
  ]),
  conflictingConstraintIds: z.array(StableIdSchema),
  relatedSemanticIds: z.array(StableIdSchema),
  message: z.string().min(1).max(500),
  solverVersion: z.literal(CONSTRAINT_SIZING_SOLVER_VERSION),
  policyVersion: z.literal(SIZING_POLICY_VERSION),
  policyHash: Sha256Schema
}).strict();

export const ConstraintSizingResultV1Schema = z.discriminatedUnion("kind", [
  SizingDecisionV1Schema,
  SizingInfeasibleV1Schema
]);

export type SizingDecisionV1 = z.infer<typeof SizingDecisionV1Schema>;
export type SizingInfeasibleV1 = z.infer<typeof SizingInfeasibleV1Schema>;
export type ConstraintSizingResultV1 = z.infer<typeof ConstraintSizingResultV1Schema>;

const quantize = (value: number): number => Math.round(value / SIZING_FIXED_POINT_UM) * SIZING_FIXED_POINT_UM;

export type ProportionStrength = keyof typeof SIZING_POLICY.proportionStrengthRatioPermille;

export function proportionStrengthRatioPermille(strength: ProportionStrength): number {
  return SIZING_POLICY.proportionStrengthRatioPermille[strength];
}

type ProportionRelation = IntentGraphV2["proportions"][number];

type ProportionResolution = {
  active: ProportionRelation[];
  redundantIds: string[];
  conflictingIds: string[];
};

const priorityRank = { must: 2, prefer: 1 } as const;
const confidenceRank = { high: 3, medium: 2, low: 1 } as const;

function relationPrecedence(left: ProportionRelation, right: ProportionRelation): number {
  const priority = priorityRank[right.priority] - priorityRank[left.priority];
  if (priority !== 0) return priority;
  const strength = proportionStrengthRatioPermille(right.strength) -
    proportionStrengthRatioPermille(left.strength);
  if (strength !== 0) return strength;
  const confidence = confidenceRank[right.confidence] - confidenceRank[left.confidence];
  if (confidence !== 0) return confidence;
  const numerator = AXES.indexOf(left.numeratorAxis) - AXES.indexOf(right.numeratorAxis);
  if (numerator !== 0) return numerator;
  const denominator = AXES.indexOf(left.denominatorAxis) - AXES.indexOf(right.denominatorAxis);
  return denominator !== 0 ? denominator : left.id.localeCompare(right.id);
}

function pathExists(
  relations: readonly ProportionRelation[],
  start: Axis,
  target: Axis,
  excludedId?: string,
): boolean {
  const pending: Axis[] = [start];
  const visited = new Set<Axis>();
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const relation of relations) {
      if (relation.id !== excludedId && relation.numeratorAxis === current) {
        pending.push(relation.denominatorAxis);
      }
    }
  }
  return false;
}

/**
 * Qualitative pairwise relations describe an axis order, while exact ratios
 * are code-owned. Resolve duplicates, reject cycles, and remove transitive
 * edges before applying exact ratios so equivalent semantic graphs cannot be
 * changed by model-authored relation IDs or redundant pairwise statements.
 */
function resolveProportionRelations(intent: IntentGraphV2, bodyId: string): ProportionResolution {
  const ordered = intent.proportions
    .filter((item) => item.targetBodyId === bodyId)
    .sort(relationPrecedence);
  const unique: ProportionRelation[] = [];
  const redundantIds: string[] = [];
  const pairKeys = new Set<string>();
  for (const relation of ordered) {
    const key = `${relation.numeratorAxis}:${relation.denominatorAxis}`;
    if (pairKeys.has(key)) {
      redundantIds.push(relation.id);
      continue;
    }
    pairKeys.add(key);
    unique.push(relation);
  }
  const conflictingIds = unique.filter((relation) =>
    pathExists(unique, relation.denominatorAxis, relation.numeratorAxis, relation.id)
  ).map((item) => item.id).sort();
  if (conflictingIds.length > 0) return { active: [], redundantIds, conflictingIds };
  const active = unique.filter((relation) => {
    const transitive = pathExists(unique, relation.numeratorAxis, relation.denominatorAxis, relation.id);
    if (transitive) redundantIds.push(relation.id);
    return !transitive;
  });
  return {
    active: active.sort(relationPrecedence),
    redundantIds: redundantIds.sort(),
    conflictingIds: []
  };
}

function partialSupportLongEngagementUm(longExtentUm: number): number {
  const policy = SIZING_POLICY.supportedObjectEngagement;
  const fractional = quantize(longExtentUm * policy.longExtentFractionPermille / 1_000);
  return Math.min(
    longExtentUm,
    Math.max(policy.minimumLongEngagementUm, Math.min(policy.maximumLongEngagementUm, fractional)),
  );
}

function boundaryThickness(topology: SymbolicTopologyCandidateV1, thicknessUm: number, axis: Axis): number {
  if (axis === "width" || axis === "depth") return thicknessUm * 2;
  return thicknessUm + (topology.access === "covered" ? thicknessUm : 0);
}

function normalizeScale(item: ScaleEvidenceV1): z.infer<typeof ScaleNormalizationSchema> {
  const original = { long: item.long, short: item.short, height: item.height };
  const normalized = Object.fromEntries((["long", "short", "height"] as const).map((kind) => {
    const policy = SIZING_POLICY.scaleSanityUm[kind];
    const minimumUm = quantize(Math.max(policy.minimum, Math.min(policy.maximum, item[kind].minimumUm)));
    const maximumUm = quantize(Math.max(minimumUm, Math.max(policy.minimum, Math.min(policy.maximum, item[kind].maximumUm))));
    return [kind, { minimumUm, maximumUm }];
  })) as { long: { minimumUm: number; maximumUm: number }; short: { minimumUm: number; maximumUm: number }; height: { minimumUm: number; maximumUm: number } };
  const clamped = JSON.stringify(original) !== JSON.stringify(normalized);
  return ScaleNormalizationSchema.parse({
    scaleEvidenceId: item.id,
    original,
    normalized,
    clamped,
    findingCode: clamped ? "SCALE_ESTIMATE_CLAMPED" : null
  });
}

function infeasible(input: {
  candidateId: string;
  findingCode: SizingInfeasibleV1["findingCode"];
  conflictingConstraintIds?: readonly string[];
  relatedSemanticIds?: readonly string[];
  message: string;
  policyHash: string;
}): SizingInfeasibleV1 {
  return SizingInfeasibleV1Schema.parse({
    schemaVersion: "1.0",
    kind: "infeasible",
    candidateId: input.candidateId,
    findingCode: input.findingCode,
    conflictingConstraintIds: [...(input.conflictingConstraintIds ?? [])].sort(),
    relatedSemanticIds: [...(input.relatedSemanticIds ?? [])].sort(),
    message: input.message,
    solverVersion: CONSTRAINT_SIZING_SOLVER_VERSION,
    policyVersion: SIZING_POLICY_VERSION,
    policyHash: input.policyHash
  });
}

function active(constraints: ExplicitSizingConstraintsV1): ExplicitSizingConstraintV1[] {
  return constraints.constraints.filter((item) => item.status === "active");
}

function exactProjectExternalValues(input: {
  constraints: readonly ExplicitSizingConstraintV1[];
  topology: SymbolicTopologyCandidateV1;
  thicknessUm: number;
}): { values: Partial<Record<Axis, number>>; sources: Partial<Record<Axis, string[]>>; conflictIds: string[] } {
  const values: Partial<Record<Axis, number>> = {};
  const sources: Partial<Record<Axis, string[]>> = {};
  const idsByAxis: Partial<Record<Axis, string[]>> = {};
  for (const constraint of input.constraints) {
    if (constraint.target.subject !== "project") continue;
    const axis = constraint.target.axis;
    const external = constraint.target.envelope === "external"
      ? constraint.valueUm
      : constraint.valueUm + boundaryThickness(input.topology, input.thicknessUm, axis);
    idsByAxis[axis] = [...(idsByAxis[axis] ?? []), constraint.constraintId];
    sources[axis] = [...(sources[axis] ?? []), constraint.target.envelope === "external" ? "exact-external" : "exact-internal"];
    if (values[axis] === undefined) values[axis] = external;
    else if (values[axis] !== external) return { values, sources, conflictIds: idsByAxis[axis] };
  }
  return { values, sources, conflictIds: [] };
}

function mappingAxes(intent: IntentGraphV2, bodyId: string): { long: Axis; short: Axis; height: Axis } {
  const relations = intent.proportions
    .filter((item) => item.targetBodyId === bodyId)
    .sort(relationPrecedence);
  if (relations.length === 0) return { long: "width", short: "depth", height: "height" };

  const preference = [...new Set([
    ...relations.flatMap((relation) => [relation.numeratorAxis, relation.denominatorAxis]),
    ...AXES
  ])] as Axis[];
  const rank = new Map(preference.map((axis, index) => [axis, index]));
  const remaining = new Set<Axis>(AXES);
  const ordered: Axis[] = [];
  while (remaining.size > 0) {
    const eligible = [...remaining].filter((axis) => !relations.some((relation) =>
      relation.denominatorAxis === axis && remaining.has(relation.numeratorAxis)
    )).sort((left, right) =>
      (rank.get(left) ?? AXES.indexOf(left)) - (rank.get(right) ?? AXES.indexOf(right)) ||
      AXES.indexOf(left) - AXES.indexOf(right)
    );
    if (eligible.length === 0) return { long: "width", short: "depth", height: "height" };
    const next = eligible[0]!;
    ordered.push(next);
    remaining.delete(next);
  }
  return { long: ordered[0]!, short: ordered[1]!, height: ordered[2]! };
}

function clearanceFor(intent: IntentGraphV2, objectId: string): number {
  const clearance = intent.clearance.find((item) => item.objectId === objectId)?.kind ?? "ordinary-access";
  return SIZING_POLICY.clearanceTotalUm[clearance];
}

function objectConstraintAxes(
  constraints: readonly ExplicitSizingConstraintV1[],
  intent: IntentGraphV2,
  bodyId: string,
): {
  requirements: Partial<Record<Axis, number>>;
  ids: Partial<Record<Axis, string[]>>;
  sources: Partial<Record<Axis, z.infer<typeof SourceCategorySchema>[]>>;
  unknownObjects: ExplicitSizingConstraintV1[];
  supportDecisions: z.infer<typeof SupportEngagementDecisionSchema>[];
} {
  const requirements: Partial<Record<Axis, number>> = {};
  const ids: Partial<Record<Axis, string[]>> = {};
  const sources: Partial<Record<Axis, z.infer<typeof SourceCategorySchema>[]>> = {};
  const unknownObjects: ExplicitSizingConstraintV1[] = [];
  const supportDecisions: z.infer<typeof SupportEngagementDecisionSchema>[] = [];
  const objects = new Map(intent.objects.map((item) => [item.id, item]));
  const map = mappingAxes(intent, bodyId);
  for (const constraint of constraints) {
    if (constraint.target.subject !== "contained-object") continue;
    const object = objects.get(constraint.target.objectId);
    if (object === undefined) {
      unknownObjects.push(constraint);
      continue;
    }
    const axis = constraint.target.axis;
    const isPartialLong = object.engagement === "partial-support" && axis === map.long;
    const appliedExtent = isPartialLong
      ? partialSupportLongEngagementUm(constraint.valueUm)
      : constraint.valueUm;
    if (isPartialLong) {
      supportDecisions.push(SupportEngagementDecisionSchema.parse({
        objectId: object.id,
        sourceKind: "exact-maker",
        sourceId: constraint.constraintId,
        longAxis: map.long,
        originalLongExtentUm: constraint.valueUm,
        appliedLongEngagementUm: appliedExtent,
        policyVersion: SUPPORTED_OBJECT_ENGAGEMENT_POLICY_VERSION,
        disclosure: "Supported-object sizing uses partial engagement; the object may protrude and physical support remains unverified."
      }));
    }
    const required = appliedExtent + clearanceFor(intent, constraint.target.objectId);
    requirements[axis] = Math.max(requirements[axis] ?? 0, required);
    ids[axis] = [...(ids[axis] ?? []), constraint.constraintId];
    sources[axis] = [...new Set([
      ...(sources[axis] ?? []),
      object.role === "supported" ? "exact-supported-object" : "exact-contained-object"
    ])] as z.infer<typeof SourceCategorySchema>[];
  }
  return { requirements, ids, sources, unknownObjects, supportDecisions };
}

function setIfUnset(
  values: Partial<Record<Axis, number>>,
  sources: Partial<Record<Axis, string[]>>,
  axis: Axis,
  value: number,
  source: z.infer<typeof SourceCategorySchema>,
): void {
  if (values[axis] !== undefined) return;
  values[axis] = quantize(value);
  sources[axis] = [...(sources[axis] ?? []), source];
}

function hardAxis(
  sources: Partial<Record<Axis, string[]>>,
  axis: Axis,
): boolean {
  return (sources[axis] ?? []).some((source) =>
    source === "exact-external" || source === "exact-internal" ||
      source === "exact-contained-object" || source === "exact-supported-object"
  );
}

function applyProportions(input: {
  values: Partial<Record<Axis, number>>;
  sources: Partial<Record<Axis, string[]>>;
  intent: IntentGraphV2;
  bodyId: string;
  characteristicUm: number;
}): Set<Axis> {
  const assignSoft = (axis: Axis, value: number): void => {
    input.values[axis] = quantize(value);
    input.sources[axis] = [...new Set([...(input.sources[axis] ?? []), "semantic-proportion"])] as z.infer<typeof SourceCategorySchema>[];
    affected.add(axis);
  };
  const affected = new Set<Axis>();
  for (const relation of input.intent.proportions
    .filter((item) => item.targetBodyId === input.bodyId)
    .sort(relationPrecedence)) {
    const numerator = relation.numeratorAxis;
    const denominator = relation.denominatorAxis;
    const ratioPermille = proportionStrengthRatioPermille(relation.strength);
    if (input.values[numerator] === undefined && input.values[denominator] === undefined) {
      if (ratioPermille >= 1_000) {
        setIfUnset(input.values, input.sources, numerator, input.characteristicUm, "semantic-proportion");
        setIfUnset(input.values, input.sources, denominator, input.characteristicUm * 1_000 / ratioPermille, "semantic-proportion");
      } else {
        setIfUnset(input.values, input.sources, denominator, input.characteristicUm, "semantic-proportion");
        setIfUnset(input.values, input.sources, numerator, input.characteristicUm * ratioPermille / 1_000, "semantic-proportion");
      }
      affected.add(numerator).add(denominator);
    } else if (input.values[numerator] === undefined) {
      setIfUnset(input.values, input.sources, numerator, input.values[denominator]! * ratioPermille / 1_000, "semantic-proportion");
      affected.add(numerator);
    } else if (input.values[denominator] === undefined) {
      setIfUnset(input.values, input.sources, denominator, input.values[numerator] * 1_000 / ratioPermille, "semantic-proportion");
      affected.add(denominator);
    } else if (!hardAxis(input.sources, numerator) || !hardAxis(input.sources, denominator)) {
      if (hardAxis(input.sources, numerator)) {
        assignSoft(denominator, input.values[numerator] * 1_000 / ratioPermille);
      } else if (hardAxis(input.sources, denominator)) {
        assignSoft(numerator, input.values[denominator] * ratioPermille / 1_000);
      } else if (ratioPermille >= 1_000) {
        assignSoft(denominator, input.values[numerator] * 1_000 / ratioPermille);
      } else {
        assignSoft(numerator, input.values[denominator] * ratioPermille / 1_000);
      }
    }
  }
  return affected;
}

function preserveProportionHierarchy(input: {
  values: Record<Axis, number>;
  sources: Partial<Record<Axis, string[]>>;
  intent: IntentGraphV2;
  bodyId: string;
}): Set<Axis> {
  const expanded = new Set<Axis>();
  const relations = input.intent.proportions
    .filter((item) => item.targetBodyId === input.bodyId)
    .sort(relationPrecedence);
  let remainingPasses: number = AXES.length;
  while (remainingPasses > 0) {
    remainingPasses -= 1;
    let changed = false;
    for (const relation of relations) {
      const numerator = relation.numeratorAxis;
      if (hardAxis(input.sources, numerator)) continue;
      const minimumNumerator = Math.ceil(
        input.values[relation.denominatorAxis] * proportionStrengthRatioPermille(relation.strength) /
          1_000 / SIZING_FIXED_POINT_UM,
      ) * SIZING_FIXED_POINT_UM;
      if (input.values[numerator] >= minimumNumerator) continue;
      input.values[numerator] = minimumNumerator;
      input.sources[numerator] = [...new Set([
        ...(input.sources[numerator] ?? []),
        "semantic-proportion"
      ])] as z.infer<typeof SourceCategorySchema>[];
      expanded.add(numerator);
      changed = true;
    }
    if (!changed) break;
  }
  return expanded;
}

function perSpaceInternal(input: {
  internal: Record<Axis, number>;
  topology: SymbolicTopologyCandidateV1;
  thicknessUm: number;
}): Record<Axis, number> {
  const spaces = input.topology.canonicalSpaces.length;
  const output = { ...input.internal };
  if (spaces > 1 && input.topology.partitionAxis !== null) {
    const axis = input.topology.partitionAxis;
    output[axis] = Math.floor((output[axis] - input.thicknessUm * (spaces - 1)) / spaces);
  }
  return output;
}

/** A pure fixed-order solver; it does not search nearby maker measurements. */
export async function solveSizingConstraints(input: {
  intent: unknown;
  explicitConstraints: unknown;
  topology: unknown;
  materialThicknessUm: number;
}): Promise<ConstraintSizingResultV1> {
  const intent = IntentGraphV2Schema.parse(input.intent);
  const constraints = ExplicitSizingConstraintsV1Schema.parse(input.explicitConstraints);
  const topology = SymbolicTopologyCandidateV1Schema.parse(input.topology);
  if (!Number.isSafeInteger(input.materialThicknessUm) || input.materialThicknessUm <= 0 ||
      input.materialThicknessUm % SIZING_FIXED_POINT_UM !== 0) {
    throw new Error("SIZING_MATERIAL_THICKNESS_INVALID");
  }
  const policyHash = await hashCanonical(SIZING_POLICY);
  const proportionResolution = resolveProportionRelations(intent, topology.primaryBodyId);
  if (proportionResolution.conflictingIds.length > 0) {
    return infeasible({
      candidateId: topology.candidateId,
      findingCode: "SIZING_PROPORTION_RELATION_CONFLICT",
      relatedSemanticIds: proportionResolution.conflictingIds,
      message: "Qualitative proportion relations contain a directed axis cycle and cannot be realized deterministically.",
      policyHash
    });
  }
  const resolvedIntent: IntentGraphV2 = {
    ...intent,
    proportions: proportionResolution.active
  };
  const activeConstraints = active(constraints);
  const project = exactProjectExternalValues({ constraints: activeConstraints, topology, thicknessUm: input.materialThicknessUm });
  if (project.conflictIds.length > 0) {
    return infeasible({
      candidateId: topology.candidateId,
      findingCode: "SIZING_HARD_CONSTRAINT_INFEASIBLE",
      conflictingConstraintIds: project.conflictIds,
      message: "Exact project constraints disagree after candidate-specific internal/external reconciliation.",
      policyHash
    });
  }
  const objectConstraints = objectConstraintAxes(activeConstraints, resolvedIntent, topology.primaryBodyId);
  if (objectConstraints.unknownObjects.length > 0) {
    return infeasible({
      candidateId: topology.candidateId,
      findingCode: "SIZING_OBJECT_TARGET_AMBIGUOUS",
      conflictingConstraintIds: objectConstraints.unknownObjects.map((item) => item.constraintId),
      message: "An exact contained-object measurement did not reconcile to exactly one semantic object.",
      policyHash
    });
  }
  const exactObjectIds = new Set(activeConstraints.flatMap((item) =>
    item.target.subject === "contained-object" ? [item.target.objectId] : []
  ));
  const unmeasuredFitCritical = intent.objects.filter((item) => item.fitCritical && !exactObjectIds.has(item.id));
  if (unmeasuredFitCritical.length > 0) {
    return infeasible({
      candidateId: topology.candidateId,
      findingCode: "FIT_CRITICAL_MEASUREMENT_REQUIRED",
      relatedSemanticIds: unmeasuredFitCritical.map((item) => item.id),
      message: "Fit-critical content requires an exact maker measurement; model-prior scale cannot authorize fit.",
      policyHash
    });
  }

  const scaleNormalizations = intent.scaleEvidence.map(normalizeScale);
  const hasAbsoluteAnchor = activeConstraints.length > 0 || scaleNormalizations.length > 0;
  const fallbackUsed = !hasAbsoluteAnchor;
  const values: Partial<Record<Axis, number>> = { ...project.values };
  const sources: Partial<Record<Axis, string[]>> = Object.fromEntries(
    Object.entries(project.sources).map(([axis, items]) => [axis, [...new Set(items)]])
  );
  for (const axis of AXES) {
    const requirement = objectConstraints.requirements[axis];
    if (requirement === undefined || values[axis] !== undefined) continue;
    const partitions = topology.partitionAxis === axis ? topology.canonicalSpaces.length : 1;
    const dividers = topology.partitionAxis === axis ? input.materialThicknessUm * (partitions - 1) : 0;
    const internalRequired = requirement * partitions + dividers;
    values[axis] = internalRequired + boundaryThickness(topology, input.materialThicknessUm, axis);
    sources[axis] = [...(objectConstraints.sources[axis] ?? ["exact-contained-object"])] as z.infer<typeof SourceCategorySchema>[];
  }

  let characteristicUm: number = SIZING_POLICY.unanchoredCharacteristicScaleUm;
  const scaleMinimums: Partial<Record<Axis, number>> = {};
  const supportEngagementDecisions = [...objectConstraints.supportDecisions];
  const scaleAxisMappings: z.infer<typeof ScaleAxisMappingDecisionSchema>[] = [];
  for (const normalized of scaleNormalizations) {
    const source = intent.scaleEvidence.find((item) => item.id === normalized.scaleEvidenceId)!;
    const object = intent.objects.find((item) => item.id === source.objectId)!;
    const map = mappingAxes(resolvedIntent, topology.primaryBodyId);
    scaleAxisMappings.push(ScaleAxisMappingDecisionSchema.parse({
      scaleEvidenceId: source.id,
      objectId: object.id,
      longAxis: map.long,
      shortAxis: map.short,
      heightAxis: map.height,
      policyVersion: SCALE_AXIS_MAPPING_POLICY_VERSION
    }));
    const clearance = clearanceFor(intent, source.objectId);
    const midpoint = (range: { minimumUm: number; maximumUm: number }) => quantize((range.minimumUm + range.maximumUm) / 2);
    const originalLongExtentUm = midpoint(normalized.normalized.long);
    const appliedLongEngagementUm = object.engagement === "partial-support"
      ? partialSupportLongEngagementUm(originalLongExtentUm)
      : originalLongExtentUm;
    if (object.engagement === "partial-support") {
      supportEngagementDecisions.push(SupportEngagementDecisionSchema.parse({
        objectId: object.id,
        sourceKind: "model-prior",
        sourceId: source.id,
        longAxis: map.long,
        originalLongExtentUm,
        appliedLongEngagementUm,
        policyVersion: SUPPORTED_OBJECT_ENGAGEMENT_POLICY_VERSION,
        disclosure: "Supported-object sizing uses partial engagement; the object may protrude and physical support remains unverified."
      }));
    }
    const desired = {
      [map.long]: appliedLongEngagementUm + clearance,
      [map.short]: midpoint(normalized.normalized.short) + clearance,
      [map.height]: midpoint(normalized.normalized.height) + clearance
    } as Partial<Record<Axis, number>>;
    characteristicUm = Math.max(characteristicUm, ...Object.values(desired));
    for (const axis of AXES) {
      if (desired[axis] === undefined) continue;
      const minimum = desired[axis] + boundaryThickness(topology, input.materialThicknessUm, axis);
      scaleMinimums[axis] = Math.max(scaleMinimums[axis] ?? 0, minimum);
      if (values[axis] === undefined && resolvedIntent.proportions.length > 0) {
        values[axis] = minimum;
        sources[axis] = ["model-prior-scale"];
      }
    }
  }

  const semanticAxes = applyProportions({
    values,
    sources,
    intent: resolvedIntent,
    bodyId: topology.primaryBodyId,
    characteristicUm
  });
  const canonicalAffected: Axis[] = [];
  for (const axis of AXES) {
    if (values[axis] !== undefined) continue;
    const defaultPermille = SIZING_POLICY.canonicalDefaultProportionsPermille[axis];
    setIfUnset(values, sources, axis, characteristicUm * defaultPermille / 1_000, fallbackUsed ? "canonical-default-proportions" : "canonical-default-proportions");
    canonicalAffected.push(axis);
  }
  if (fallbackUsed) {
    for (const axis of AXES) {
      if (!semanticAxes.has(axis) && !canonicalAffected.includes(axis)) continue;
      sources[axis] = [...new Set([...(sources[axis] ?? []), "unanchored-fallback"])] as z.infer<typeof SourceCategorySchema>[];
    }
  }

  for (const axis of AXES) {
    const minimum = scaleMinimums[axis];
    if (minimum === undefined) continue;
    const makerExact = (sources[axis] ?? []).some((source) =>
      source === "exact-external" || source === "exact-internal" ||
        source === "exact-contained-object" || source === "exact-supported-object"
    );
    if (!makerExact && values[axis]! < minimum) values[axis] = minimum;
    if (!makerExact) {
      sources[axis] = [...new Set([...(sources[axis] ?? []), "model-prior-scale"])] as z.infer<typeof SourceCategorySchema>[];
    }
  }

  if (topology.partitionAxis !== null && topology.canonicalSpaces.length > 1) {
    const axis = topology.partitionAxis;
    const spaces = topology.canonicalSpaces.length;
    const requiredInternal = SIZING_POLICY.minimumUsableSpaceUm * spaces +
      input.materialThicknessUm * (spaces - 1);
    const requiredExternal = requiredInternal + boundaryThickness(topology, input.materialThicknessUm, axis);
    if (project.values[axis] !== undefined && project.values[axis] < requiredExternal) {
      const related = activeConstraints.filter((item) => item.target.subject === "project" && item.target.axis === axis);
      return infeasible({
        candidateId: topology.candidateId,
        findingCode: "SIZING_HARD_CONSTRAINT_INFEASIBLE",
        conflictingConstraintIds: related.map((item) => item.constraintId),
        message: `Exact ${axis} cannot preserve the registered minimum usable web across ${String(spaces)} spaces.`,
        policyHash
      });
    }
    if (values[axis]! < requiredExternal) {
      values[axis] = requiredExternal;
      sources[axis] = [...new Set([...(sources[axis] ?? []), "construction-minimum"])] as z.infer<typeof SourceCategorySchema>[];
    }
  }

  for (const axis of AXES) {
    const minimum = SIZING_POLICY.minimumExternalUm[axis];
    if (project.values[axis] !== undefined && project.values[axis] < minimum) {
      const related = activeConstraints.filter((item) => item.target.subject === "project" && item.target.axis === axis);
      return infeasible({
        candidateId: topology.candidateId,
        findingCode: "SIZING_HARD_CONSTRAINT_INFEASIBLE",
        conflictingConstraintIds: related.map((item) => item.constraintId),
        message: `Exact ${axis} is below the registered construction minimum.`,
        policyHash
      });
    }
    if (values[axis]! < minimum) {
      values[axis] = minimum;
      sources[axis] = [...new Set([...(sources[axis] ?? []), "construction-minimum"])] as z.infer<typeof SourceCategorySchema>[];
    }
    values[axis] = quantize(values[axis]!);
  }

  const hierarchyExpanded = preserveProportionHierarchy({
    values: values as Record<Axis, number>,
    sources,
    intent: resolvedIntent,
    bodyId: topology.primaryBodyId
  });

  const external = Object.fromEntries(AXES.map((axis) => [axis, values[axis]!])) as Record<Axis, number>;
  const internal = Object.fromEntries(AXES.map((axis) => [
    axis,
    external[axis] - boundaryThickness(topology, input.materialThicknessUm, axis)
  ])) as Record<Axis, number>;
  if (AXES.some((axis) => internal[axis] <= 0)) {
    return infeasible({
      candidateId: topology.candidateId,
      findingCode: "SIZING_HARD_CONSTRAINT_INFEASIBLE",
      conflictingConstraintIds: activeConstraints.map((item) => item.constraintId),
      message: "Resolved external dimensions leave no positive structural internal envelope.",
      policyHash
    });
  }
  const usable = perSpaceInternal({ internal, topology, thicknessUm: input.materialThicknessUm });
  for (const axis of AXES) {
    if (usable[axis] < SIZING_POLICY.minimumUsableSpaceUm) {
      return infeasible({
        candidateId: topology.candidateId,
        findingCode: "SIZING_HARD_CONSTRAINT_INFEASIBLE",
        conflictingConstraintIds: objectConstraints.ids[axis] ?? [],
        message: `Candidate leaves a ${axis} usable space below the registered minimum.`,
        policyHash
      });
    }
    if (objectConstraints.requirements[axis] !== undefined && usable[axis] < objectConstraints.requirements[axis]) {
      return infeasible({
        candidateId: topology.candidateId,
        findingCode: "SIZING_HARD_CONSTRAINT_INFEASIBLE",
        conflictingConstraintIds: objectConstraints.ids[axis] ?? [],
        message: `Candidate does not preserve the exact object ${axis} engagement requirement.`,
        policyHash
      });
    }
  }

  const ledger = constraints.constraints.map((constraint) => ConstraintLedgerEntrySchema.parse({
    constraintId: constraint.constraintId,
    targetKey: targetKey(constraint.target),
    valueUm: constraint.valueUm,
    state: constraint.status === "active" ? "satisfied" : constraint.status,
    candidateId: topology.candidateId
  }));
  const axes = Object.fromEntries(AXES.map((axis) => [axis, AxisDecisionSchema.parse({
    externalUm: external[axis],
    internalUm: internal[axis],
    usablePerSpaceUm: usable[axis],
    sourceCategories: [...new Set(sources[axis] ?? ["construction-minimum"])]
  })])) as z.infer<typeof SizingDecisionV1Schema>["axes"];
  const sourceCategories = [...new Set(AXES.flatMap((axis) => axes[axis].sourceCategories))].sort();
  const scaleSlack = scaleNormalizations.reduce((total, item) => total + Number(item.clamped), 0);
  const proportionSlack = resolvedIntent.proportions.reduce((total, relation) => {
    const actual = external[relation.numeratorAxis] * 1_000 / external[relation.denominatorAxis];
    return total + Math.abs(Math.round(actual) - proportionStrengthRatioPermille(relation.strength));
  }, 0);
  const provisional = {
    schemaVersion: "1.0" as const,
    kind: "solved" as const,
    candidateId: topology.candidateId,
    external: { widthUm: external.width, depthUm: external.depth, heightUm: external.height },
    internal: { widthUm: internal.width, depthUm: internal.depth, heightUm: internal.height },
    usablePerSpace: { widthUm: usable.width, depthUm: usable.depth, heightUm: usable.height },
    axes,
    constraintLedger: ledger,
    scaleNormalizations,
    scaleAxisMappings,
    sourceCategories,
    fallback: {
      used: fallbackUsed,
      policyVersion: SIZING_POLICY_VERSION,
      characteristicScaleUm: fallbackUsed ? SIZING_POLICY.unanchoredCharacteristicScaleUm : null,
      disclosure: fallbackUsed ? "No absolute scale evidence was available; a versioned unanchored characteristic scale was applied." : null
    },
    canonicalDefaultProportions: {
      used: canonicalAffected.length > 0,
      policyVersion: "canonical-default-proportions-v1" as const,
      affectedAxes: canonicalAffected,
      disclosure: canonicalAffected.length > 0 ? "canonical default proportions" as const : null
    },
    proportionStrengthPolicy: {
      policyVersion: PROPORTION_STRENGTH_POLICY_VERSION,
      moderateRatioPermille: SIZING_POLICY.proportionStrengthRatioPermille.moderate,
      strongRatioPermille: SIZING_POLICY.proportionStrengthRatioPermille.strong,
      extremeRatioPermille: SIZING_POLICY.proportionStrengthRatioPermille.extreme
    },
    supportEngagement: {
      used: supportEngagementDecisions.length > 0,
      policyVersion: SUPPORTED_OBJECT_ENGAGEMENT_POLICY_VERSION,
      decisions: supportEngagementDecisions,
      disclosure: supportEngagementDecisions.length > 0
        ? "Supported-object sizing uses partial engagement; the object may protrude and physical support remains unverified." as const
        : null
    },
    objectiveVector: [
      scaleSlack,
      proportionSlack,
      fallbackUsed ? 1 : 0,
      canonicalAffected.length,
      external.width,
      external.depth,
      external.height
    ],
    assumptions: [
      ...(fallbackUsed ? ["Unanchored scale is a deterministic fallback, not evidence from the brief."] : []),
      ...(scaleNormalizations.length > 0 ? ["Model-prior object scale is an estimate and does not verify fit or capacity."] : []),
      ...(supportEngagementDecisions.length > 0
        ? ["Supported-object partial engagement allows protrusion and does not verify stability, retention, or support function."]
        : []),
      ...(proportionResolution.redundantIds.length > 0
        ? ["Redundant qualitative proportion relations were realized through a deterministic transitive reduction."]
        : []),
      ...(hierarchyExpanded.size > 0
        ? ["Qualitative proportion hierarchy was preserved by increasing only non-exact axes after construction and object minima."]
        : [])
    ],
    solverVersion: CONSTRAINT_SIZING_SOLVER_VERSION,
    policyVersion: SIZING_POLICY_VERSION,
    policyHash
  };
  return SizingDecisionV1Schema.parse({
    ...provisional,
    decisionHash: await hashCanonical(provisional)
  });
}

export async function sizingPolicyHash(): Promise<string> {
  return hashCanonical(SIZING_POLICY);
}
