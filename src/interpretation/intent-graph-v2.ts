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
export const CURRENT_INTENT_GRAPH_SCHEMA_VERSION = "2.2" as const;
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
  kind: z.enum(["compactness", "capacity", "accessibility", "low-part-count"]),
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

export const ReferenceRelationshipV1Schema = z.enum(["reproduce", "inspire", "context"]);
export const ReferenceObservationKindV1Schema = z.enum([
  "primary-subject",
  "silhouette",
  "proportion",
  "opening",
  "ornament",
  "operation-character",
  "target-role",
  "visible-joint"
]);

export const ReferenceObservationValueV1Schema = z.enum([
  "enclosure",
  "container",
  "lantern",
  "stand",
  "support",
  "cover",
  "orthogonal",
  "tapered",
  "arched",
  "cylindrical",
  "curved",
  "freeform",
  "wide",
  "deep",
  "tall",
  "balanced",
  "slender",
  "none",
  "open-top",
  "open-front",
  "covered",
  "arched-aperture",
  "geometric-aperture",
  "repeated-apertures",
  "geometric",
  "botanical",
  "lattice",
  "border",
  "field",
  "focal",
  "repeated",
  "score",
  "engrave",
  "cut-through-visible",
  "mixed",
  "primary-enclosure",
  "finger",
  "tab-slot",
  "pin-hinge",
  "slide-guide",
  "none-visible",
  "unknown",
  "uncertain"
]);

const OBSERVATION_VALUES: Readonly<Record<z.infer<typeof ReferenceObservationKindV1Schema>, readonly z.infer<typeof ReferenceObservationValueV1Schema>[]>> = {
  "primary-subject": ["enclosure", "container", "lantern", "stand", "support", "cover", "unknown"],
  silhouette: ["orthogonal", "tapered", "arched", "cylindrical", "curved", "freeform", "unknown"],
  proportion: ["wide", "deep", "tall", "balanced", "slender", "unknown"],
  opening: ["none", "open-top", "open-front", "covered", "arched-aperture", "geometric-aperture", "repeated-apertures", "unknown"],
  ornament: ["none", "geometric", "botanical", "lattice", "border", "field", "focal", "repeated", "unknown"],
  "operation-character": ["score", "engrave", "cut-through-visible", "mixed", "uncertain"],
  "target-role": ["primary-enclosure", "support", "cover", "unknown"],
  "visible-joint": ["finger", "tab-slot", "pin-hinge", "slide-guide", "none-visible", "unknown"]
};

export const ReferenceObservationV1Schema = z.object({
  id: StableIdSchema,
  kind: ReferenceObservationKindV1Schema,
  value: ReferenceObservationValueV1Schema,
  targetBodyRole: z.enum(["primary-enclosure", "support", "cover"]).nullable(),
  targetFaceRole: z.enum(["foundation", "rear", "left", "right", "front", "cover", "all", "unspecified"]),
  salience: z.enum(["secondary", "defining", "dominant"]),
  confidence: z.enum(["low", "medium", "high"]),
  visibility: z.enum(["visible", "partial", "occluded", "uncertain"]),
  evidenceIds: EvidenceIdsSchema
}).strict().superRefine((value, context) => {
  if (!OBSERVATION_VALUES[value.kind].includes(value.value)) {
    context.addIssue({ code: "custom", path: ["value"], message: `Observation value ${value.value} is not registered for ${value.kind}.` });
  }
});

export const ReferenceBriefEntryV1Schema = z.object({
  referenceEvidenceId: StableIdSchema,
  relationship: ReferenceRelationshipV1Schema,
  observations: z.array(ReferenceObservationV1Schema).min(1).max(16)
}).strict();

export const IntentConflictV2Schema = z.object({
  id: StableIdSchema,
  attribute: z.enum([
    "dimensions",
    "material",
    "count",
    "mechanism",
    "visual-treatment",
    "body-role",
    "interface",
    "access",
    "silhouette",
    "proportion",
    "opening",
    "ornament",
    "visible-joint"
  ]),
  textEvidenceIds: z.array(StableIdSchema).min(1).max(8),
  observationIds: z.array(StableIdSchema).min(1).max(8),
  resolution: z.enum(["explicit-text-wins", "reference-wins", "unresolved"])
}).strict();

function briefDirectlyStatesAttribute(brief: string, attribute: z.infer<typeof IntentConflictV2Schema>["attribute"]): boolean {
  const patterns: Record<z.infer<typeof IntentConflictV2Schema>["attribute"], RegExp> = {
    dimensions: /\b(?:width|depth|height|dimensions?|mm|cm|inch|inches)\b/iu,
    material: /\b(?:material|basswood|birch|plywood|acrylic)\b/iu,
    count: /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/iu,
    mechanism: /\b(?:hinge|hinged|sliding|slide|fixed|rigid|revolute|prismatic)\b/iu,
    "visual-treatment": /\b(?:plain|unornamented|score|engrave|motif|pattern|ornament)\b/iu,
    "body-role": /\b(?:body|support|cover|lid|base|enclosure|stand)\b/iu,
    interface: /\b(?:joint|interface|attach|connect|hinge|slide)\b/iu,
    access: /\b(?:open-top|open top|open-front|open front|covered|lid|cover)\b/iu,
    silhouette: /\b(?:orthogonal|rectangular|square|tapered|arched|cylindrical|curved|freeform)\b/iu,
    proportion: /\b(?:wide|deep|tall|balanced|slender|long|narrow|flat)\b/iu,
    opening: /\b(?:opening|aperture|open-top|open top|open-front|open front|covered)\b/iu,
    ornament: /\b(?:ornament|pattern|lattice|border|botanical|geometric|plain)\b/iu,
    "visible-joint": /\b(?:finger joint|tab|slot|pin hinge|slide guide|joint)\b/iu
  };
  return patterns[attribute].test(brief);
}

const EXCLUSIVE_ACCESS_OBSERVATION_VALUES = new Set(["open-top", "open-front", "covered"]);

export function reconcileDeterministicReferenceConflicts(input: {
  intent: unknown;
  semanticBrief?: string;
  briefEvidenceId: string;
}): IntentGraphV2 {
  const intent = IntentGraphV2Schema.parse(input.intent);
  const candidates = intent.referenceBrief.flatMap((entry) =>
    entry.relationship === "context" ? [] : entry.observations.filter((observation) =>
      observation.kind === "opening" &&
      observation.targetBodyRole !== null &&
      EXCLUSIVE_ACCESS_OBSERVATION_VALUES.has(observation.value)
    ).map((observation) => ({
      observation,
      target: observation.targetBodyRole!
    }))
  );
  const byTarget = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    byTarget.set(candidate.target, [...(byTarget.get(candidate.target) ?? []), candidate]);
  }
  const existingIds = new Set([
    ...intent.requirements.map((item) => item.id),
    ...intent.constructionBodies.map((item) => item.id),
    ...intent.objects.map((item) => item.id),
    ...intent.interfaces.map((item) => item.id),
    ...intent.rankedGoals.map((item) => item.id),
    ...intent.referenceBrief.flatMap((entry) => entry.observations.map((item) => item.id)),
    ...intent.assumptions.map((item) => item.id),
    ...intent.conflicts.map((item) => item.id),
    ...intent.unresolvedNeeds.map((item) => item.id),
    ...intent.scaleEvidence.map((item) => item.id),
    ...intent.proportions.map((item) => item.id)
  ]);
  const inferred: z.infer<typeof IntentConflictV2Schema>[] = [];
  for (const [, targetCandidates] of [...byTarget.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const values = new Set(targetCandidates.map((item) => item.observation.value));
    if (values.size < 2) continue;
    const observationIds = [...new Set(targetCandidates.map((item) => item.observation.id))].sort();
    const alreadyRecorded = intent.conflicts.some((conflict) =>
      conflict.attribute === "access" && observationIds.every((id) => conflict.observationIds.includes(id))
    );
    if (alreadyRecorded) continue;
    let ordinal = inferred.length + 1;
    let id = `reference-access-conflict-${String(ordinal)}`;
    while (existingIds.has(id)) {
      ordinal += 1;
      id = `reference-access-conflict-${String(ordinal)}`;
    }
    existingIds.add(id);
    inferred.push(IntentConflictV2Schema.parse({
      id,
      attribute: "access",
      textEvidenceIds: [input.briefEvidenceId],
      observationIds,
      resolution: input.semanticBrief !== undefined && briefDirectlyStatesAttribute(input.semanticBrief, "access")
        ? "explicit-text-wins"
        : "unresolved"
    }));
  }
  return inferred.length === 0 ? intent : IntentGraphV2Schema.parse({
    ...intent,
    conflicts: [...intent.conflicts, ...inferred]
  });
}

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
  referenceBrief: z.array(ReferenceBriefEntryV1Schema).max(3),
  assumptions: z.array(z.object({
    id: StableIdSchema,
    semanticSummary: CompactTextSchema,
    evidenceIds: z.array(StableIdSchema).max(8)
  }).strict()).max(16),
  conflicts: z.array(IntentConflictV2Schema).max(12),
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
    ...intent.referenceBrief.flatMap((item) => item.observations.map((observation) => observation.id)),
    ...intent.assumptions.map((item) => item.id),
    ...intent.conflicts.map((item) => item.id),
    ...intent.unresolvedNeeds.map((item) => item.id),
    ...intent.scaleEvidence.map((item) => item.id),
    ...intent.proportions.map((item) => item.id)
  ];
  if (new Set(stableIds).size !== stableIds.length) {
    context.addIssue({ code: "custom", message: "IntentGraphV2 semantic IDs must be globally unique." });
  }
  const observationIds = new Set(intent.referenceBrief.flatMap((item) =>
    item.observations.map((observation) => observation.id)
  ));
  for (const conflict of intent.conflicts) {
    for (const observationId of conflict.observationIds) {
      if (!observationIds.has(observationId)) {
        context.addIssue({ code: "custom", message: `Conflict ${conflict.id} cites unknown observation ${observationId}.` });
      }
    }
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

type ProviderSchemaNode = Record<string, unknown>;

function providerSchemaNode(candidate: unknown, code: string): ProviderSchemaNode {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new Error(code);
  }
  return candidate as ProviderSchemaNode;
}

function bindEvidenceArrayItems(candidate: unknown, reference: string): void {
  if (Array.isArray(candidate)) {
    for (const item of candidate) bindEvidenceArrayItems(item, reference);
    return;
  }
  if (typeof candidate !== "object" || candidate === null) return;
  const node = candidate as ProviderSchemaNode;
  const properties = node.properties;
  if (typeof properties === "object" && properties !== null && !Array.isArray(properties)) {
    for (const [name, propertyCandidate] of Object.entries(properties)) {
      if (name === "evidenceIds" || name === "textEvidenceIds") {
        const property = providerSchemaNode(propertyCandidate, "INTENT_PROVIDER_SCHEMA_EVIDENCE_ARRAY_INVALID");
        property.items = { $ref: reference };
      } else {
        bindEvidenceArrayItems(propertyCandidate, reference);
      }
    }
  }
  for (const [name, value] of Object.entries(node)) {
    if (name !== "properties") bindEvidenceArrayItems(value, reference);
  }
}

function schemaProperty(node: ProviderSchemaNode, name: string): ProviderSchemaNode {
  const properties = providerSchemaNode(node.properties, "INTENT_PROVIDER_SCHEMA_PROPERTIES_INVALID");
  return providerSchemaNode(properties[name], `INTENT_PROVIDER_SCHEMA_PROPERTY_MISSING:${name}`);
}

function schemaItems(node: ProviderSchemaNode): ProviderSchemaNode {
  return providerSchemaNode(node.items, "INTENT_PROVIDER_SCHEMA_ITEMS_INVALID");
}

export function intentGraphV2ProviderSchema(
  sourceEvidenceIndex: SourceEvidenceIndexV1,
): ProviderSchemaNode {
  const index = SourceEvidenceIndexV1Schema.parse(sourceEvidenceIndex);
  const authorizedIds = [...authorizedEvidenceIds(index)];
  const referenceIds = index.references.map((item) => item.evidenceId);
  const schema = structuredClone(INTENT_GRAPH_V2_JSON_SCHEMA) as ProviderSchemaNode;
  schema.$defs = {
    authorizedEvidenceId: { type: "string", enum: authorizedIds },
    ...(referenceIds.length === 0
      ? {}
      : { referenceEvidenceId: { type: "string", enum: referenceIds } })
  };
  bindEvidenceArrayItems(schema, "#/$defs/authorizedEvidenceId");

  const referenceBrief = schemaProperty(schema, "referenceBrief");
  referenceBrief.minItems = referenceIds.length;
  referenceBrief.maxItems = referenceIds.length;
  if (referenceIds.length > 0) {
    const referenceEntry = schemaItems(referenceBrief);
    const referenceEntryProperties = providerSchemaNode(
      referenceEntry.properties,
      "INTENT_PROVIDER_SCHEMA_REFERENCE_PROPERTIES_INVALID",
    );
    referenceEntryProperties.referenceEvidenceId = { $ref: "#/$defs/referenceEvidenceId" };
    const observations = schemaProperty(referenceEntry, "observations");
    const observationEvidenceIds = schemaProperty(schemaItems(observations), "evidenceIds");
    observationEvidenceIds.items = { $ref: "#/$defs/referenceEvidenceId" };
  }
  return schema;
}

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
    ...intent.referenceBrief.flatMap((item) => [
      item.referenceEvidenceId,
      ...item.observations.flatMap((observation) => observation.evidenceIds)
    ]),
    ...intent.assumptions.flatMap((item) => item.evidenceIds),
    ...intent.conflicts.flatMap((item) => item.textEvidenceIds),
    ...intent.unresolvedNeeds.flatMap((item) => item.evidenceIds)
  ];
}

export function authorizeIntentGraphV2Evidence(input: {
  intent: unknown;
  sourceEvidenceIndex: SourceEvidenceIndexV1;
  semanticBrief?: string;
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
  if (unknownEvidenceIds.length > 0) return { success: false, unknownEvidenceIds, schemaIssues: [] };
  const expectedReferenceEvidenceIds = index.references.map((item) => item.evidenceId);
  const actualReferenceEvidenceIds = parsed.data.referenceBrief.map((item) => item.referenceEvidenceId);
  if (JSON.stringify(expectedReferenceEvidenceIds) !== JSON.stringify(actualReferenceEvidenceIds)) {
    return {
      success: false,
      unknownEvidenceIds: [],
      schemaIssues: ["referenceBrief:must contain one ordered entry for every supplied reference"]
    };
  }
  const referenceEvidenceIds = new Set(expectedReferenceEvidenceIds);
  if (parsed.data.referenceBrief.some((entry) =>
    entry.observations.some((observation) =>
      observation.evidenceIds.some((id) => !referenceEvidenceIds.has(id))
    )
  )) {
    return {
      success: false,
      unknownEvidenceIds: [],
      schemaIssues: ["referenceBrief:observations may cite reference evidence only"]
    };
  }
  const closeReproduction = input.semanticBrief !== undefined && /\bas close as possible\b/iu.test(input.semanticBrief);
  if (input.semanticBrief !== undefined && parsed.data.conflicts.some((conflict) =>
    conflict.resolution === "explicit-text-wins" &&
    !briefDirectlyStatesAttribute(input.semanticBrief!, conflict.attribute)
  )) {
    return {
      success: false,
      unknownEvidenceIds: [],
      schemaIssues: ["conflicts:explicit-text-wins requires a directly stated maker attribute"]
    };
  }
  const relationshipNormalized = closeReproduction ? IntentGraphV2Schema.parse({
    ...parsed.data,
    referenceBrief: parsed.data.referenceBrief.map((entry) => ({ ...entry, relationship: "reproduce" }))
  }) : parsed.data;
  const intent = reconcileDeterministicReferenceConflicts({
    intent: relationshipNormalized,
    ...(input.semanticBrief === undefined ? {} : { semanticBrief: input.semanticBrief }),
    briefEvidenceId: index.spans[0]!.evidenceId
  });
  return { success: true, intent };
}
