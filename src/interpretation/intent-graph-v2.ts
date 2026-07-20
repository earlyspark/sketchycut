import { z } from "zod";

import { StableIdSchema } from "../domain/primitives.js";
import { RegisteredMotifPrimitiveSchema } from "./capability-catalog.js";
import { authorizedEvidenceIds, SourceEvidenceIndexV1Schema, type SourceEvidenceIndexV1 } from "./source-evidence.js";

const CompactTextSchema = z.string().trim().min(1).max(240);
const EvidenceIdsSchema = z.array(StableIdSchema).min(1).max(8).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Evidence IDs must be unique." });
  }
});

export const IntentPriorityV2Schema = z.enum(["must", "prefer"]);
export const SemanticAxisV2Schema = z.enum(["width", "depth", "height"]);
export const CURRENT_INTENT_GRAPH_SCHEMA_VERSION = "2.1" as const;
export const SemanticBodyRoleV2Schema = z.enum(["primary-enclosure", "support", "cover"]);
export const SemanticShapeClassV2Schema = z.enum([
  "orthogonal-shell",
  "planar",
  "rod",
  "angled",
  "curved",
  "freeform"
]);
export const AccessKindV2Schema = z.enum(["open-top", "open-front", "covered"]);
export const InterfaceBehaviorV2Schema = z.enum(["rigid", "revolute", "prismatic"]);

export const IntentRequirementV2Schema = z.object({
  id: StableIdSchema,
  priority: IntentPriorityV2Schema,
  kind: z.enum([
    "containment",
    "support",
    "access",
    "organization",
    "closure",
    "rigid-interface",
    "revolute-interface",
    "prismatic-interface",
    "permitted-stock",
    "visual-treatment",
    "specific-profile",
    "compound-motion"
  ]),
  semanticSummary: CompactTextSchema,
  evidenceIds: EvidenceIdsSchema
}).strict();

export const SemanticConstructionBodyV2Schema = z.object({
  id: StableIdSchema,
  role: SemanticBodyRoleV2Schema,
  shapeClass: SemanticShapeClassV2Schema,
  requirementIds: z.array(StableIdSchema).min(1).max(8),
  evidenceIds: EvidenceIdsSchema
}).strict();

export const SemanticObjectV2Schema = z.object({
  id: StableIdSchema,
  role: z.enum(["contained", "supported"]),
  engagement: z.enum(["full-envelope", "partial-support"]),
  semanticLabel: z.string().trim().min(1).max(80),
  quantity: z.number().int().positive().max(64).nullable(),
  fitCritical: z.boolean(),
  evidenceIds: EvidenceIdsSchema
}).strict().superRefine((value, context) => {
  if (value.role === "contained" && value.engagement !== "full-envelope") {
    context.addIssue({
      code: "custom",
      path: ["engagement"],
      message: "Contained objects require full-envelope engagement."
    });
  }
  if (value.role === "supported" && value.engagement !== "partial-support") {
    context.addIssue({
      code: "custom",
      path: ["engagement"],
      message: "Supported objects require partial-support engagement."
    });
  }
});

export const SemanticInterfaceV2Schema = z.object({
  id: StableIdSchema,
  betweenBodyIds: z.tuple([StableIdSchema, StableIdSchema]),
  behavior: InterfaceBehaviorV2Schema,
  axis: SemanticAxisV2Schema.nullable(),
  requirementIds: z.array(StableIdSchema).min(1).max(8),
  evidenceIds: EvidenceIdsSchema
}).strict();

export const AccessIntentV2Schema = z.object({
  bodyId: StableIdSchema,
  kind: AccessKindV2Schema,
  direction: z.enum(["top", "front"]),
  priority: IntentPriorityV2Schema,
  requirementId: StableIdSchema,
  evidenceIds: EvidenceIdsSchema
}).strict();

export const OrganizationIntentV2Schema = z.object({
  bodyId: StableIdSchema,
  desiredSpaceCount: z.number().int().positive().max(12).nullable(),
  rows: z.number().int().positive().max(6).nullable(),
  columns: z.number().int().positive().max(6).nullable(),
  priority: IntentPriorityV2Schema,
  requirementId: StableIdSchema,
  evidenceIds: EvidenceIdsSchema
}).strict().superRefine((value, context) => {
  if (value.desiredSpaceCount === null && value.rows === null && value.columns === null) {
    context.addIssue({ code: "custom", message: "Organization intent requires one permitted semantic count." });
  }
});

const QuantizedUmSchema = z.number().int().positive().max(1_000_000).refine(
  (value) => value % 10 === 0,
  "Scale evidence must use the registered 0.01 mm increment.",
);

const ScaleRangeV2Schema = z.object({
  minimumUm: QuantizedUmSchema,
  maximumUm: QuantizedUmSchema
}).strict().superRefine((value, context) => {
  if (value.maximumUm < value.minimumUm) {
    context.addIssue({ code: "custom", message: "Scale range maximum must not precede minimum." });
  }
});

export const ScaleEvidenceV1Schema = z.object({
  id: StableIdSchema,
  objectId: StableIdSchema,
  long: ScaleRangeV2Schema,
  short: ScaleRangeV2Schema,
  height: ScaleRangeV2Schema,
  confidence: z.enum(["low", "medium", "high"]),
  basis: z.literal("model-prior"),
  evidenceIds: EvidenceIdsSchema
}).strict();

export const ProportionRelationV2Schema = z.object({
  id: StableIdSchema,
  targetBodyId: StableIdSchema,
  numeratorAxis: SemanticAxisV2Schema,
  denominatorAxis: SemanticAxisV2Schema,
  strength: z.enum(["moderate", "strong", "extreme"]),
  priority: IntentPriorityV2Schema,
  confidence: z.enum(["low", "medium", "high"]),
  evidenceIds: EvidenceIdsSchema
}).strict().superRefine((value, context) => {
  if (value.numeratorAxis === value.denominatorAxis) {
    context.addIssue({ code: "custom", message: "A proportion must relate distinct axes." });
  }
});

export const ClearanceIntentV2Schema = z.object({
  objectId: StableIdSchema,
  kind: z.enum(["close", "ordinary-access", "easy-access"]),
  priority: IntentPriorityV2Schema,
  evidenceIds: EvidenceIdsSchema
}).strict();

export const RankedSemanticGoalV2Schema = z.object({
  id: StableIdSchema,
  kind: z.enum(["compactness", "capacity", "accessibility", "low-part-count", "visual-similarity"]),
  rank: z.number().int().positive().max(8),
  evidenceIds: EvidenceIdsSchema
}).strict();

export const IntentMotifV2Schema = z.object({
  vocabulary: z.array(z.string().trim().min(1).max(80)).max(12),
  composition: z.enum(["border", "field", "focal", "repeated"]),
  density: z.enum(["sparse", "balanced", "dense"]),
  symmetry: z.enum(["none", "bilateral", "radial", "translational"]),
  primitiveFamilies: z.array(RegisteredMotifPrimitiveSchema).min(1).max(6),
  preferredOperations: z.array(z.enum(["engrave", "score"])).min(1).max(2),
  preferredBodyRoles: z.array(SemanticBodyRoleV2Schema).min(1).max(3),
  evidenceIds: EvidenceIdsSchema
}).strict();

export const IntentGraphV2Schema = z.object({
  schemaVersion: z.literal(CURRENT_INTENT_GRAPH_SCHEMA_VERSION),
  title: z.string().trim().min(1).max(120),
  purpose: CompactTextSchema,
  requirements: z.array(IntentRequirementV2Schema).min(1).max(32),
  constructionBodies: z.array(SemanticConstructionBodyV2Schema).min(1).max(8),
  objects: z.array(SemanticObjectV2Schema).max(12),
  interfaces: z.array(SemanticInterfaceV2Schema).max(12),
  access: z.array(AccessIntentV2Schema).max(8),
  organization: z.array(OrganizationIntentV2Schema).max(8),
  scaleEvidence: z.array(ScaleEvidenceV1Schema).max(12),
  proportions: z.array(ProportionRelationV2Schema).max(12),
  clearance: z.array(ClearanceIntentV2Schema).max(12),
  rankedGoals: z.array(RankedSemanticGoalV2Schema).max(8),
  motif: IntentMotifV2Schema.nullable(),
  assumptions: z.array(z.object({
    id: StableIdSchema,
    semanticSummary: CompactTextSchema,
    evidenceIds: z.array(StableIdSchema).max(8)
  }).strict()).max(16),
  conflicts: z.array(z.object({
    id: StableIdSchema,
    evidenceIds: z.array(StableIdSchema).min(2).max(8),
    resolution: z.enum(["text-wins", "unresolved"])
  }).strict()).max(12),
  unresolvedNeeds: z.array(z.object({
    id: StableIdSchema,
    semanticSummary: CompactTextSchema,
    requirementIds: z.array(StableIdSchema).max(8),
    evidenceIds: z.array(StableIdSchema).max(8)
  }).strict()).max(12)
}).strict().superRefine((intent, context) => {
  const requirementIds = new Set(intent.requirements.map((item) => item.id));
  const bodyIds = new Set(intent.constructionBodies.map((item) => item.id));
  const objectIds = new Set(intent.objects.map((item) => item.id));
  const stableIds = [
    ...intent.requirements.map((item) => item.id),
    ...intent.constructionBodies.map((item) => item.id),
    ...intent.objects.map((item) => item.id),
    ...intent.interfaces.map((item) => item.id),
    ...intent.rankedGoals.map((item) => item.id),
    ...intent.assumptions.map((item) => item.id),
    ...intent.conflicts.map((item) => item.id),
    ...intent.unresolvedNeeds.map((item) => item.id),
    ...intent.scaleEvidence.map((item) => item.id),
    ...intent.proportions.map((item) => item.id)
  ];
  if (new Set(stableIds).size !== stableIds.length) {
    context.addIssue({ code: "custom", message: "IntentGraphV2 semantic IDs must be globally unique." });
  }
  for (const body of intent.constructionBodies) {
    for (const id of body.requirementIds) {
      if (!requirementIds.has(id)) context.addIssue({ code: "custom", message: `Body ${body.id} cites unknown requirement ${id}.` });
    }
  }
  for (const item of intent.interfaces) {
    if (item.betweenBodyIds[0] === item.betweenBodyIds[1]) {
      context.addIssue({ code: "custom", message: `Interface ${item.id} cannot connect a body to itself.` });
    }
    for (const id of item.betweenBodyIds) {
      if (!bodyIds.has(id)) context.addIssue({ code: "custom", message: `Interface ${item.id} cites unknown body ${id}.` });
    }
  }
  for (const item of [...intent.access, ...intent.organization]) {
    if (!bodyIds.has(item.bodyId)) context.addIssue({ code: "custom", message: `Semantic relation cites unknown body ${item.bodyId}.` });
    if (!requirementIds.has(item.requirementId)) context.addIssue({ code: "custom", message: `Semantic relation cites unknown requirement ${item.requirementId}.` });
  }
  for (const item of intent.scaleEvidence) {
    if (!objectIds.has(item.objectId)) context.addIssue({ code: "custom", message: `Scale evidence ${item.id} cites unknown object ${item.objectId}.` });
  }
  for (const item of intent.clearance) {
    if (!objectIds.has(item.objectId)) context.addIssue({ code: "custom", message: `Clearance intent cites unknown object ${item.objectId}.` });
  }
  for (const item of intent.proportions) {
    if (!bodyIds.has(item.targetBodyId)) context.addIssue({ code: "custom", message: `Proportion ${item.id} cites unknown body ${item.targetBodyId}.` });
  }
});

function normalizeStrictOutputSchema(candidate: unknown): unknown {
  if (Array.isArray(candidate)) return candidate.map((item) => normalizeStrictOutputSchema(item));
  if (typeof candidate !== "object" || candidate === null) return candidate;
  const source = candidate as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "$schema") continue;
    if (key === "items" && Array.isArray(value)) {
      if (value.length === 0) throw new Error("INTENT_V2_SCHEMA_EMPTY_TUPLE");
      const tupleItems = value.map((item) => normalizeStrictOutputSchema(item));
      const first = JSON.stringify(tupleItems[0]);
      if (!tupleItems.every((item) => JSON.stringify(item) === first)) {
        throw new Error("INTENT_V2_SCHEMA_HETEROGENEOUS_TUPLE_UNSUPPORTED");
      }
      normalized.items = tupleItems[0];
      normalized.minItems = value.length;
      normalized.maxItems = value.length;
      continue;
    }
    normalized[key] = normalizeStrictOutputSchema(value);
  }
  return normalized;
}

export const INTENT_GRAPH_V2_JSON_SCHEMA = normalizeStrictOutputSchema(
  z.toJSONSchema(IntentGraphV2Schema, { target: "draft-7" }),
) as ReturnType<typeof z.toJSONSchema>;

export type IntentGraphV2 = z.infer<typeof IntentGraphV2Schema>;
export type ScaleEvidenceV1 = z.infer<typeof ScaleEvidenceV1Schema>;

function evidenceIdsFrom(intent: IntentGraphV2): string[] {
  return [
    ...intent.requirements.flatMap((item) => item.evidenceIds),
    ...intent.constructionBodies.flatMap((item) => item.evidenceIds),
    ...intent.objects.flatMap((item) => item.evidenceIds),
    ...intent.interfaces.flatMap((item) => item.evidenceIds),
    ...intent.access.flatMap((item) => item.evidenceIds),
    ...intent.organization.flatMap((item) => item.evidenceIds),
    ...intent.scaleEvidence.flatMap((item) => item.evidenceIds),
    ...intent.proportions.flatMap((item) => item.evidenceIds),
    ...intent.clearance.flatMap((item) => item.evidenceIds),
    ...intent.rankedGoals.flatMap((item) => item.evidenceIds),
    ...(intent.motif?.evidenceIds ?? []),
    ...intent.assumptions.flatMap((item) => item.evidenceIds),
    ...intent.conflicts.flatMap((item) => item.evidenceIds),
    ...intent.unresolvedNeeds.flatMap((item) => item.evidenceIds)
  ];
}

export function authorizeIntentGraphV2Evidence(input: {
  intent: unknown;
  sourceEvidenceIndex: SourceEvidenceIndexV1;
}): { success: true; intent: IntentGraphV2 } | { success: false; unknownEvidenceIds: string[]; schemaIssues: string[] } {
  const index = SourceEvidenceIndexV1Schema.parse(input.sourceEvidenceIndex);
  const parsed = IntentGraphV2Schema.safeParse(input.intent);
  if (!parsed.success) {
    return {
      success: false,
      unknownEvidenceIds: [],
      schemaIssues: parsed.error.issues.map((issue) => `${issue.path.join(".")}:${issue.message}`)
    };
  }
  const authorized = authorizedEvidenceIds(index);
  const unknownEvidenceIds = [...new Set(evidenceIdsFrom(parsed.data).filter((id) => !authorized.has(id)))].sort();
  return unknownEvidenceIds.length === 0
    ? { success: true, intent: parsed.data }
    : { success: false, unknownEvidenceIds, schemaIssues: [] };
}
