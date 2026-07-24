import { z } from "zod";

import { StableIdSchema } from "../domain/primitives.js";
import {
  CAPABILITY_CATALOG,
  RegisteredMotifPrimitiveSchema
} from "./capability-catalog.js";
import {
  UnsupportedSemanticSignatureIdSchema
} from "./unsupported-semantic-signatures.js";

const CompactTextSchema = z.string().trim().min(1).max(320);
const EvidenceIdsSchema = z.array(StableIdSchema).min(1).max(8).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Evidence IDs must be unique." });
  }
});
const InventoryItemIdsSchema = z.array(StableIdSchema).min(1).max(12).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Inventory item IDs must be unique." });
  }
});

export const CURRENT_SEMANTIC_INTERPRETATION_SCHEMA_VERSION = "3.0" as const;
export const MINIMUM_SEPARATED_ORGANIZATION_ASSUMPTION_ID =
  "organization-layout-defaulted-to-minimum" as const;
export const MINIMUM_SEPARATED_ORGANIZATION_FINDING_CODE =
  "ORGANIZATION_LAYOUT_DEFAULTED_TO_MINIMUM" as const;
export const MINIMUM_SEPARATED_ORGANIZATION_DISCLOSURE =
  "The request required multiple spaces but did not specify a layout; SketchyCut used the registered minimum of two one-axis spaces." as const;
export const SemanticImportanceSchema = z.enum(["essential", "preference", "context"]);
export const SemanticAspectSchema = z.enum(["structure", "surface", "operation", "context"]);
export const SemanticAxisSchema = z.enum(["width", "depth", "height"]);
export const SemanticBodyRoleSchema = z.enum(["primary-enclosure", "support", "cover"]);
export const SemanticShapeClassSchema = z.enum([
  "orthogonal-shell",
  "planar",
  "rod",
  "angled",
  "curved",
  "freeform"
]);
export const AccessKindSchema = z.enum(["open-top", "open-front", "covered"]);
export const InterfaceBehaviorSchema = z.enum(["rigid", "revolute", "prismatic"]);

export const SemanticEvidenceBindingSchema = z.object({
  evidenceId: StableIdSchema,
  aspect: SemanticAspectSchema,
  support: z.enum(["direct", "inferred"])
}).strict();

export const SemanticInventoryItemSchema = z.object({
  id: StableIdSchema,
  claim: CompactTextSchema,
  importance: SemanticImportanceSchema,
  aspects: z.array(SemanticAspectSchema).min(1).max(4),
  evidenceBindings: z.array(SemanticEvidenceBindingSchema).min(1).max(8),
  omissionConsequence: CompactTextSchema.nullable(),
  uncertainty: z.object({
    state: z.enum(["certain", "uncertain"]),
    rationale: CompactTextSchema.nullable()
  }).strict()
}).strict().superRefine((item, context) => {
  if (new Set(item.aspects).size !== item.aspects.length) {
    context.addIssue({ code: "custom", path: ["aspects"], message: "Inventory aspects must be unique." });
  }
  if (item.evidenceBindings.some((binding) => !item.aspects.includes(binding.aspect))) {
    context.addIssue({ code: "custom", path: ["evidenceBindings"], message: "Evidence binding aspects must be declared by the item." });
  }
  if (item.importance !== "context" && item.omissionConsequence === null) {
    context.addIssue({ code: "custom", path: ["omissionConsequence"], message: "Commitments and preferences require an omission consequence." });
  }
  if (item.uncertainty.state === "uncertain" && item.uncertainty.rationale === null) {
    context.addIssue({ code: "custom", path: ["uncertainty", "rationale"], message: "Uncertain items require a rationale." });
  }
});

export const SemanticInventoryRelationshipSchema = z.object({
  id: StableIdSchema,
  kind: z.enum(["supports", "contradicts", "depends-on", "refines"]),
  fromItemId: StableIdSchema,
  toItemId: StableIdSchema,
  resolution: z.enum(["from-item", "to-item", "unresolved", "not-applicable"]),
  precedenceBasis: z.enum(["explicit-brief", "maker-reference-role", "none"]),
  evidenceIds: EvidenceIdsSchema
}).strict();

export const MeasurementTargetSchema = z.discriminatedUnion("subject", [
  z.object({
    subject: z.literal("project"),
    envelope: z.enum(["external", "internal"]),
    axis: SemanticAxisSchema
  }).strict(),
  z.object({
    subject: z.literal("contained-object"),
    objectId: StableIdSchema,
    axis: SemanticAxisSchema
  }).strict()
]);

export const SemanticMeasurementTargetSchema = z.object({
  id: StableIdSchema,
  inventoryItemId: StableIdSchema,
  target: MeasurementTargetSchema,
  interpretation: z.enum(["exact", "approximate", "range", "ambiguous"]),
  literal: z.object({
    evidenceId: StableIdSchema,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive()
  }).strict()
}).strict().superRefine((measurement, context) => {
  if (measurement.literal.end <= measurement.literal.start) {
    context.addIssue({ code: "custom", path: ["literal", "end"], message: "Measurement literal span must be non-empty." });
  }
});

export const SemanticAssumptionSchema = z.object({
  id: StableIdSchema,
  claim: CompactTextSchema,
  evidenceIds: z.array(StableIdSchema).max(8)
}).strict();

export const OpenSemanticInventorySchema = z.object({
  title: z.string().trim().min(1).max(120),
  purpose: CompactTextSchema,
  items: z.array(SemanticInventoryItemSchema).min(1).max(48),
  relationships: z.array(SemanticInventoryRelationshipSchema).max(24),
  assumptions: z.array(SemanticAssumptionSchema).max(16),
  measurementTargets: z.array(SemanticMeasurementTargetSchema).max(16)
}).strict().superRefine((inventory, context) => {
  const itemIds = new Set(inventory.items.map((item) => item.id));
  const stableIds = [
    ...inventory.items.map((item) => item.id),
    ...inventory.relationships.map((item) => item.id),
    ...inventory.assumptions.map((item) => item.id),
    ...inventory.measurementTargets.map((item) => item.id)
  ];
  if (new Set(stableIds).size !== stableIds.length) {
    context.addIssue({ code: "custom", message: "Open inventory IDs must be globally unique." });
  }
  for (const relationship of inventory.relationships) {
    if (relationship.fromItemId === relationship.toItemId) {
      context.addIssue({ code: "custom", message: `Relationship ${relationship.id} cannot connect an item to itself.` });
    }
    for (const id of [relationship.fromItemId, relationship.toItemId]) {
      if (!itemIds.has(id)) context.addIssue({ code: "custom", message: `Relationship ${relationship.id} cites unknown inventory item ${id}.` });
    }
  }
  for (const measurement of inventory.measurementTargets) {
    if (!itemIds.has(measurement.inventoryItemId)) {
      context.addIssue({ code: "custom", message: `Measurement ${measurement.id} cites unknown inventory item ${measurement.inventoryItemId}.` });
    }
  }
});

export const IntentPrioritySchema = z.enum(["must", "prefer"]);

export const SemanticRequirementSchema = z.object({
  id: StableIdSchema,
  priority: IntentPrioritySchema,
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
    "cut-through-treatment",
    "functional-aperture",
    "specific-profile",
    "compound-motion"
  ]),
  inventoryItemIds: InventoryItemIdsSchema,
  evidenceIds: EvidenceIdsSchema
}).strict();

export const SemanticConstructionBodySchema = z.object({
  id: StableIdSchema,
  role: SemanticBodyRoleSchema,
  shapeClass: SemanticShapeClassSchema,
  requirementIds: z.array(StableIdSchema).min(1).max(8),
  inventoryItemIds: InventoryItemIdsSchema,
  evidenceIds: EvidenceIdsSchema
}).strict();

export const SemanticObjectSchema = z.object({
  id: StableIdSchema,
  role: z.enum(["contained", "supported"]),
  engagement: z.enum(["full-envelope", "partial-support"]),
  quantity: z.number().int().positive().max(64).nullable(),
  inventoryItemIds: InventoryItemIdsSchema,
  evidenceIds: EvidenceIdsSchema
}).strict().superRefine((value, context) => {
  if (value.role === "contained" && value.engagement !== "full-envelope") {
    context.addIssue({ code: "custom", path: ["engagement"], message: "Contained objects require full-envelope engagement." });
  }
  if (value.role === "supported" && value.engagement !== "partial-support") {
    context.addIssue({ code: "custom", path: ["engagement"], message: "Supported objects require partial-support engagement." });
  }
});

export const SemanticInterfaceSchema = z.object({
  id: StableIdSchema,
  betweenBodyIds: z.tuple([StableIdSchema, StableIdSchema]),
  behavior: InterfaceBehaviorSchema,
  axis: SemanticAxisSchema.nullable(),
  requirementIds: z.array(StableIdSchema).min(1).max(8),
  inventoryItemIds: InventoryItemIdsSchema,
  evidenceIds: EvidenceIdsSchema
}).strict();

export const AccessIntentSchema = z.object({
  bodyId: StableIdSchema,
  kind: AccessKindSchema,
  direction: z.enum(["top", "front"]),
  basis: z.enum([
    "default-open-top-policy",
    "explicit-open-top",
    "explicit-open-front",
    "explicit-covered-top",
    "explicit-covered-front"
  ]),
  priority: IntentPrioritySchema,
  requirementId: StableIdSchema,
  inventoryItemIds: InventoryItemIdsSchema,
  evidenceIds: EvidenceIdsSchema
}).strict().superRefine((value, context) => {
  const expected = value.basis === "default-open-top-policy" ||
      value.basis === "explicit-open-top"
    ? { kind: "open-top", direction: "top" } as const
    : value.basis === "explicit-open-front"
      ? { kind: "open-front", direction: "front" } as const
      : value.basis === "explicit-covered-top"
        ? { kind: "covered", direction: "top" } as const
        : { kind: "covered", direction: "front" } as const;
  if (value.kind !== expected.kind || value.direction !== expected.direction) {
    context.addIssue({
      code: "custom",
      message: "Access kind and direction must agree with their normalized provenance basis."
    });
  }
});

export const OrganizationIntentSchema = z.object({
  bodyId: StableIdSchema,
  desiredSpaceCount: z.number().int().min(1).max(36),
  rows: z.number().int().positive().max(6).nullable(),
  columns: z.number().int().positive().max(6).nullable(),
  basis: z.enum([
    "default-single-space-policy",
    "explicit-single-space",
    "explicit-count",
    "explicit-grid",
    "minimum-separated-policy"
  ]),
  priority: IntentPrioritySchema,
  requirementId: StableIdSchema,
  inventoryItemIds: InventoryItemIdsSchema,
  evidenceIds: EvidenceIdsSchema
}).strict().superRefine((value, context) => {
  if ((value.basis === "default-single-space-policy" ||
       value.basis === "explicit-single-space") &&
      (value.desiredSpaceCount !== 1 ||
       value.rows !== null ||
       value.columns !== null)) {
    context.addIssue({
      code: "custom",
      message: "Single-space organization provenance requires exactly one space and no grid."
    });
  }
  if (value.basis === "explicit-count" &&
      (value.desiredSpaceCount < 2 ||
       value.rows !== null ||
       value.columns !== null)) {
    context.addIssue({
      code: "custom",
      message: "Explicit-count organization requires at least two spaces and cannot carry grid dimensions."
    });
  }
  if (value.basis === "explicit-grid" &&
      (value.rows === null ||
       value.columns === null ||
       value.rows * value.columns < 2 ||
       value.desiredSpaceCount !== value.rows * value.columns)) {
    context.addIssue({
      code: "custom",
      message: "Explicit-grid organization requires matching row, column, and total-space values."
    });
  }
  if (value.basis === "minimum-separated-policy" &&
      (value.desiredSpaceCount !== 2 || value.rows !== null || value.columns !== null)) {
    context.addIssue({
      code: "custom",
      message: "Minimum-separated organization normalizes to exactly two spaces without an explicit grid."
    });
  }
});

const QuantizedUmSchema = z.number().int().positive().max(1_000_000).refine(
  (value) => value % 10 === 0,
  "Scale evidence must use the registered 0.01 mm increment.",
);

const ScaleRangeSchema = z.object({
  minimumUm: QuantizedUmSchema,
  maximumUm: QuantizedUmSchema
}).strict().superRefine((value, context) => {
  if (value.maximumUm < value.minimumUm) {
    context.addIssue({ code: "custom", message: "Scale range maximum must not precede minimum." });
  }
});

export const ScaleEvidenceSchema = z.object({
  id: StableIdSchema,
  objectId: StableIdSchema,
  long: ScaleRangeSchema,
  short: ScaleRangeSchema,
  height: ScaleRangeSchema,
  confidence: z.enum(["low", "medium", "high"]),
  basis: z.literal("model-prior"),
  inventoryItemIds: InventoryItemIdsSchema,
  evidenceIds: EvidenceIdsSchema
}).strict();

export const ProportionRelationSchema = z.object({
  id: StableIdSchema,
  targetBodyId: StableIdSchema,
  numeratorAxis: SemanticAxisSchema,
  denominatorAxis: SemanticAxisSchema,
  strength: z.enum(["moderate", "strong", "extreme"]),
  priority: IntentPrioritySchema,
  confidence: z.enum(["low", "medium", "high"]),
  inventoryItemIds: InventoryItemIdsSchema,
  evidenceIds: EvidenceIdsSchema
}).strict().superRefine((value, context) => {
  if (value.numeratorAxis === value.denominatorAxis) {
    context.addIssue({ code: "custom", message: "A proportion must relate distinct axes." });
  }
});

export const ClearanceIntentSchema = z.object({
  objectId: StableIdSchema,
  kind: z.enum(["close", "ordinary-access", "easy-access"]),
  priority: IntentPrioritySchema,
  inventoryItemIds: InventoryItemIdsSchema,
  evidenceIds: EvidenceIdsSchema
}).strict();

export const RankedSemanticGoalSchema = z.object({
  id: StableIdSchema,
  kind: z.enum(["compactness", "capacity", "accessibility", "low-part-count"]),
  rank: z.number().int().positive().max(8),
  inventoryItemIds: InventoryItemIdsSchema,
  evidenceIds: EvidenceIdsSchema
}).strict();

export const IntentMotifSchema = z.object({
  composition: z.enum(["border", "field", "focal", "repeated"]),
  density: z.enum(["sparse", "balanced", "dense"]),
  symmetry: z.enum(["none", "bilateral", "radial", "translational"]),
  primitiveFamilies: z.array(RegisteredMotifPrimitiveSchema).min(1).max(6),
  preferredOperations: z.array(z.enum(["engrave", "score"])).min(1).max(2),
  preferredBodyRoles: z.array(SemanticBodyRoleSchema).min(1).max(3),
  inventoryItemIds: InventoryItemIdsSchema,
  evidenceIds: EvidenceIdsSchema
}).strict();

export const IntentCutThroughSchema = z.object({
  id: StableIdSchema,
  bodyId: StableIdSchema,
  targetFaceRoles: z.array(z.enum(["rear", "left", "right", "front", "cover", "all"])).min(1).max(6),
  patternFamily: z.enum(["lattice-grid", "radial-rosette", "circle-field", "ring-aperture"]),
  purpose: z.enum([
    "access",
    "illumination",
    "ventilation",
    "ornament",
    "illumination-ventilation",
    "illumination-ornament",
    "ventilation-ornament"
  ]),
  density: z.enum(["sparse", "balanced", "dense"]),
  symmetry: z.enum(["none", "bilateral", "radial", "translational"]),
  repetition: z.enum(["single-face", "matched-faces", "all-eligible-faces"]),
  fixedTopAccess: z.boolean(),
  priority: IntentPrioritySchema,
  requirementId: StableIdSchema,
  inventoryItemIds: InventoryItemIdsSchema,
  evidenceIds: EvidenceIdsSchema
}).strict().superRefine((value, context) => {
  if (new Set(value.targetFaceRoles).size !== value.targetFaceRoles.length) {
    context.addIssue({ code: "custom", message: "Cut-through face roles must be unique." });
  }
  if (value.fixedTopAccess && (
    value.patternFamily !== "ring-aperture" ||
    value.purpose !== "access" ||
    !value.targetFaceRoles.includes("cover")
  )) {
    context.addIssue({ code: "custom", message: "Fixed-top access requires a cover-targeted ring aperture with access purpose." });
  }
});

export const InventoryAccountingStateSchema = z.enum(["bound", "deferred", "unbound", "uncertain"]);
export const InventoryAccountingReasonSchema = z.enum([
  "REFERENCE_ROLE_DEFERRED",
  "CAPABILITY_NOT_REGISTERED",
  "EVIDENCE_INSUFFICIENT",
  "EVIDENCE_CONFLICT",
  "PROJECTION_COVERAGE_MISMATCH"
]);

const InventoryAccountingBindingFields = {
  requirementIds: z.array(StableIdSchema).max(16),
  bodyIds: z.array(StableIdSchema).max(8),
  interfaceIds: z.array(StableIdSchema).max(12),
  relationIds: z.array(StableIdSchema).max(24),
  capabilityIds: z.array(StableIdSchema).max(8)
};

const EmptyInventoryAccountingBindingFields = {
  requirementIds: z.array(StableIdSchema).max(0),
  bodyIds: z.array(StableIdSchema).max(0),
  interfaceIds: z.array(StableIdSchema).max(0),
  relationIds: z.array(StableIdSchema).max(0),
  capabilityIds: z.array(StableIdSchema).max(0)
};

const BoundInventoryAccountingRecordSchema = z.object({
  itemId: StableIdSchema,
  state: z.literal("bound"),
  ...InventoryAccountingBindingFields,
  deferredByEvidenceIds: z.array(StableIdSchema).max(0),
  unsupportedSignatureIds: z.array(UnsupportedSemanticSignatureIdSchema).max(0),
  reason: z.null()
}).strict();

const DeferredInventoryAccountingRecordSchema = z.object({
  itemId: StableIdSchema,
  state: z.literal("deferred"),
  ...EmptyInventoryAccountingBindingFields,
  deferredByEvidenceIds: z.array(StableIdSchema).min(1).max(3),
  unsupportedSignatureIds: z.array(UnsupportedSemanticSignatureIdSchema).max(0),
  reason: z.literal("REFERENCE_ROLE_DEFERRED")
}).strict();

const UnresolvedInventoryAccountingReasonSchema = z.enum([
  "CAPABILITY_NOT_REGISTERED",
  "EVIDENCE_INSUFFICIENT",
  "EVIDENCE_CONFLICT",
  "PROJECTION_COVERAGE_MISMATCH"
]);

const UnboundInventoryAccountingRecordSchema = z.object({
  itemId: StableIdSchema,
  state: z.literal("unbound"),
  ...EmptyInventoryAccountingBindingFields,
  deferredByEvidenceIds: z.array(StableIdSchema).max(0),
  unsupportedSignatureIds: z.array(UnsupportedSemanticSignatureIdSchema).max(1),
  reason: UnresolvedInventoryAccountingReasonSchema
}).strict();

const UncertainInventoryAccountingRecordSchema = z.object({
  itemId: StableIdSchema,
  state: z.literal("uncertain"),
  ...EmptyInventoryAccountingBindingFields,
  deferredByEvidenceIds: z.array(StableIdSchema).max(0),
  unsupportedSignatureIds: z.array(UnsupportedSemanticSignatureIdSchema).max(1),
  reason: UnresolvedInventoryAccountingReasonSchema
}).strict();

export const InventoryAccountingRecordSchema = z.discriminatedUnion("state", [
  BoundInventoryAccountingRecordSchema,
  DeferredInventoryAccountingRecordSchema,
  UnboundInventoryAccountingRecordSchema,
  UncertainInventoryAccountingRecordSchema
]).superRefine((record, context) => {
  const bindings = [
    ...record.requirementIds,
    ...record.bodyIds,
    ...record.interfaceIds,
    ...record.relationIds,
    ...record.capabilityIds
  ];
  if (record.state === "bound" && bindings.length === 0) {
    context.addIssue({ code: "custom", message: "Bound accounting requires at least one typed binding." });
  }
  if (
    record.reason !== "CAPABILITY_NOT_REGISTERED" &&
    record.unsupportedSignatureIds.length > 0
  ) {
    context.addIssue({
      code: "custom",
      message: "Unsupported semantic signatures require CAPABILITY_NOT_REGISTERED accounting."
    });
  }
});

export const ClosedSemanticProjectionSchema = z.object({
  requirements: z.array(SemanticRequirementSchema).max(32),
  constructionBodies: z.array(SemanticConstructionBodySchema).max(8),
  objects: z.array(SemanticObjectSchema).max(12),
  interfaces: z.array(SemanticInterfaceSchema).max(12),
  access: z.array(AccessIntentSchema).max(8),
  organization: z.array(OrganizationIntentSchema).max(8),
  scaleEvidence: z.array(ScaleEvidenceSchema).max(12),
  proportions: z.array(ProportionRelationSchema).max(12),
  clearance: z.array(ClearanceIntentSchema).max(12),
  rankedGoals: z.array(RankedSemanticGoalSchema).max(8),
  motif: IntentMotifSchema.nullable(),
  cutThrough: z.array(IntentCutThroughSchema).max(8),
  accounting: z.array(InventoryAccountingRecordSchema).max(48)
}).strict();

export const SemanticInterpretationSchema = z.object({
  schemaVersion: z.literal(CURRENT_SEMANTIC_INTERPRETATION_SCHEMA_VERSION),
  inventory: OpenSemanticInventorySchema,
  projection: ClosedSemanticProjectionSchema
}).strict().superRefine((interpretation, context) => {
  const inventoryIds = new Set(interpretation.inventory.items.map((item) => item.id));
  const commitmentIds = interpretation.inventory.items
    .filter((item) => item.importance !== "context")
    .map((item) => item.id);
  const accountingIds = interpretation.projection.accounting.map((item) => item.itemId);
  if (new Set(accountingIds).size !== accountingIds.length ||
      JSON.stringify([...accountingIds].sort()) !== JSON.stringify([...commitmentIds].sort())) {
    context.addIssue({ code: "custom", path: ["projection", "accounting"], message: "Accounting must cover every non-context inventory item exactly once." });
  }

  const requirementIds = new Set(interpretation.projection.requirements.map((item) => item.id));
  const bodyIds = new Set(interpretation.projection.constructionBodies.map((item) => item.id));
  const objectIds = new Set(interpretation.projection.objects.map((item) => item.id));
  const interfaceIds = new Set(interpretation.projection.interfaces.map((item) => item.id));
  const relationIds = new Set(interpretation.inventory.relationships.map((item) => item.id));
  const capabilityIds = new Set(CAPABILITY_CATALOG.capabilities.map((item) => item.capabilityId));
  const semanticIds = [
    ...requirementIds,
    ...bodyIds,
    ...objectIds,
    ...interfaceIds,
    ...interpretation.projection.rankedGoals.map((item) => item.id),
    ...interpretation.projection.cutThrough.map((item) => item.id),
    ...interpretation.projection.scaleEvidence.map((item) => item.id),
    ...interpretation.projection.proportions.map((item) => item.id)
  ];
  if (new Set(semanticIds).size !== semanticIds.length) {
    context.addIssue({ code: "custom", message: "Closed projection semantic IDs must be globally unique." });
  }

  const checkInventoryIds = (location: string, ids: readonly string[]): void => {
    for (const id of ids) {
      if (!inventoryIds.has(id)) context.addIssue({ code: "custom", message: `${location} cites unknown inventory item ${id}.` });
    }
  };
  for (const requirement of interpretation.projection.requirements) {
    checkInventoryIds(`Requirement ${requirement.id}`, requirement.inventoryItemIds);
    if (requirement.inventoryItemIds.some((id) =>
      interpretation.inventory.items.find((item) => item.id === id)?.importance === "context"
    )) {
      context.addIssue({ code: "custom", message: `Requirement ${requirement.id} cannot promote a context item.` });
    }
  }
  for (const body of interpretation.projection.constructionBodies) {
    checkInventoryIds(`Body ${body.id}`, body.inventoryItemIds);
    for (const id of body.requirementIds) {
      if (!requirementIds.has(id)) context.addIssue({ code: "custom", message: `Body ${body.id} cites unknown requirement ${id}.` });
    }
  }
  for (const object of interpretation.projection.objects) checkInventoryIds(`Object ${object.id}`, object.inventoryItemIds);
  for (const item of interpretation.projection.interfaces) {
    checkInventoryIds(`Interface ${item.id}`, item.inventoryItemIds);
    if (item.betweenBodyIds[0] === item.betweenBodyIds[1]) {
      context.addIssue({ code: "custom", message: `Interface ${item.id} cannot connect a body to itself.` });
    }
    for (const id of item.betweenBodyIds) {
      if (!bodyIds.has(id)) context.addIssue({ code: "custom", message: `Interface ${item.id} cites unknown body ${id}.` });
    }
    for (const id of item.requirementIds) {
      if (!requirementIds.has(id)) context.addIssue({ code: "custom", message: `Interface ${item.id} cites unknown requirement ${id}.` });
    }
  }
  for (const item of [...interpretation.projection.access, ...interpretation.projection.organization]) {
    checkInventoryIds("Semantic relation", item.inventoryItemIds);
    if (!bodyIds.has(item.bodyId)) context.addIssue({ code: "custom", message: `Semantic relation cites unknown body ${item.bodyId}.` });
    if (!requirementIds.has(item.requirementId)) context.addIssue({ code: "custom", message: `Semantic relation cites unknown requirement ${item.requirementId}.` });
  }
  for (const item of interpretation.projection.cutThrough) {
    checkInventoryIds(`Cut-through ${item.id}`, item.inventoryItemIds);
    if (!bodyIds.has(item.bodyId)) context.addIssue({ code: "custom", message: `Cut-through ${item.id} cites unknown body ${item.bodyId}.` });
    if (!requirementIds.has(item.requirementId)) context.addIssue({ code: "custom", message: `Cut-through ${item.id} cites unknown requirement ${item.requirementId}.` });
  }
  for (const item of interpretation.projection.scaleEvidence) {
    checkInventoryIds(`Scale evidence ${item.id}`, item.inventoryItemIds);
    if (!objectIds.has(item.objectId)) context.addIssue({ code: "custom", message: `Scale evidence ${item.id} cites unknown object ${item.objectId}.` });
  }
  for (const item of interpretation.projection.clearance) {
    checkInventoryIds("Clearance intent", item.inventoryItemIds);
    if (!objectIds.has(item.objectId)) context.addIssue({ code: "custom", message: `Clearance intent cites unknown object ${item.objectId}.` });
  }
  for (const item of interpretation.projection.proportions) {
    checkInventoryIds(`Proportion ${item.id}`, item.inventoryItemIds);
    if (!bodyIds.has(item.targetBodyId)) context.addIssue({ code: "custom", message: `Proportion ${item.id} cites unknown body ${item.targetBodyId}.` });
  }
  for (const item of interpretation.projection.rankedGoals) checkInventoryIds(`Goal ${item.id}`, item.inventoryItemIds);
  if (interpretation.projection.motif !== null) checkInventoryIds("Motif", interpretation.projection.motif.inventoryItemIds);

  for (const record of interpretation.projection.accounting) {
    for (const id of record.requirementIds) if (!requirementIds.has(id)) context.addIssue({ code: "custom", message: `Accounting ${record.itemId} cites unknown requirement ${id}.` });
    for (const id of record.bodyIds) if (!bodyIds.has(id)) context.addIssue({ code: "custom", message: `Accounting ${record.itemId} cites unknown body ${id}.` });
    for (const id of record.interfaceIds) if (!interfaceIds.has(id)) context.addIssue({ code: "custom", message: `Accounting ${record.itemId} cites unknown interface ${id}.` });
    for (const id of record.relationIds) if (!relationIds.has(id)) context.addIssue({ code: "custom", message: `Accounting ${record.itemId} cites unknown relationship ${id}.` });
    for (const id of record.capabilityIds) if (!capabilityIds.has(id)) context.addIssue({ code: "custom", message: `Accounting ${record.itemId} cites unregistered capability ${id}.` });
  }
});

const UNSUPPORTED_STRICT_OUTPUT_COMPOSITION = new Set([
  "allOf",
  "not",
  "dependentRequired",
  "dependentSchemas",
  "if",
  "then",
  "else"
]);

function normalizeSemanticStrictOutputSchemaNode(candidate: unknown): unknown {
  if (Array.isArray(candidate)) return candidate.map((item) => normalizeSemanticStrictOutputSchemaNode(item));
  if (typeof candidate !== "object" || candidate === null) return candidate;
  const source = candidate as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "$schema") continue;
    if (UNSUPPORTED_STRICT_OUTPUT_COMPOSITION.has(key)) {
      throw new Error(`SEMANTIC_SCHEMA_UNSUPPORTED_COMPOSITION_${key.toUpperCase()}`);
    }
    if (key === "oneOf") {
      if (source.anyOf !== undefined) throw new Error("SEMANTIC_SCHEMA_AMBIGUOUS_UNION");
      normalized.anyOf = normalizeSemanticStrictOutputSchemaNode(value);
      continue;
    }
    if (key === "items" && Array.isArray(value)) {
      if (value.length === 0) throw new Error("SEMANTIC_SCHEMA_EMPTY_TUPLE");
      const tupleItems = value.map((item) => normalizeSemanticStrictOutputSchemaNode(item));
      const first = JSON.stringify(tupleItems[0]);
      if (!tupleItems.every((item) => JSON.stringify(item) === first)) {
        throw new Error("SEMANTIC_SCHEMA_HETEROGENEOUS_TUPLE_UNSUPPORTED");
      }
      normalized.items = tupleItems[0];
      normalized.minItems = value.length;
      normalized.maxItems = value.length;
      continue;
    }
    normalized[key] = normalizeSemanticStrictOutputSchemaNode(value);
  }
  return normalized;
}

export function assertSemanticStrictOutputSchema(candidate: unknown): asserts candidate is Record<string, unknown> {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new Error("SEMANTIC_SCHEMA_ROOT_NOT_OBJECT");
  }
  const root = candidate as Record<string, unknown>;
  if (root.type !== "object" || root.anyOf !== undefined || root.oneOf !== undefined) {
    throw new Error("SEMANTIC_SCHEMA_ROOT_NOT_STRICT_OBJECT");
  }

  let propertyCount = 0;
  let enumValueCount = 0;
  let schemaStringLength = 0;
  const visit = (value: unknown, depth: number): void => {
    if (depth > 10) throw new Error("SEMANTIC_SCHEMA_NESTING_LIMIT_EXCEEDED");
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const node = value as Record<string, unknown>;
    for (const schemaToken of ["oneOf", ...UNSUPPORTED_STRICT_OUTPUT_COMPOSITION]) {
      if (schemaToken in node) throw new Error(`SEMANTIC_SCHEMA_UNSUPPORTED_CONSTRUCT_${schemaToken.toUpperCase()}`);
    }
    if ("$ref" in node) {
      const siblings = Object.keys(node).filter((key) => key !== "$ref" && key !== "description");
      if (siblings.length > 0) throw new Error("SEMANTIC_SCHEMA_REF_SIBLINGS_UNSUPPORTED");
    }
    if (node.type === "object" || node.properties !== undefined) {
      if (typeof node.properties !== "object" || node.properties === null || Array.isArray(node.properties)) {
        throw new Error("SEMANTIC_SCHEMA_OBJECT_PROPERTIES_INVALID");
      }
      const propertyNames = Object.keys(node.properties);
      const required = node.required;
      if (!Array.isArray(required) || required.some((item) => typeof item !== "string")) {
        throw new Error("SEMANTIC_SCHEMA_OBJECT_REQUIRED_INVALID");
      }
      const requiredNames = required as string[];
      if (
        requiredNames.length !== propertyNames.length
        || propertyNames.some((name) => !requiredNames.includes(name))
        || requiredNames.some((name) => !propertyNames.includes(name))
      ) {
        throw new Error("SEMANTIC_SCHEMA_ALL_FIELDS_MUST_BE_REQUIRED");
      }
      if (node.additionalProperties !== false) {
        throw new Error("SEMANTIC_SCHEMA_ADDITIONAL_PROPERTIES_MUST_BE_FALSE");
      }
      propertyCount += propertyNames.length;
      schemaStringLength += propertyNames.reduce((total, name) => total + name.length, 0);
    }
    if (Array.isArray(node.enum)) {
      const enumValues: unknown[] = node.enum;
      enumValueCount += enumValues.length;
      const enumStringLength = enumValues.reduce<number>(
        (total, item) => total + (typeof item === "string" ? item.length : 0),
        0
      );
      schemaStringLength += enumStringLength;
      if (enumValues.length > 250 && enumStringLength > 15_000) {
        throw new Error("SEMANTIC_SCHEMA_SINGLE_ENUM_STRING_LIMIT_EXCEEDED");
      }
    }
    if (typeof node.const === "string") schemaStringLength += node.const.length;
    if (typeof node.$defs === "object" && node.$defs !== null && !Array.isArray(node.$defs)) {
      schemaStringLength += Object.keys(node.$defs as Record<string, unknown>)
        .reduce((total, name) => total + name.length, 0);
    }
    for (const [key, child] of Object.entries(node)) {
      const nextDepth = ["properties", "items", "anyOf", "$defs"].includes(key) ? depth + 1 : depth;
      visit(child, nextDepth);
    }
  };
  visit(root, 0);
  if (propertyCount > 5_000) throw new Error("SEMANTIC_SCHEMA_PROPERTY_LIMIT_EXCEEDED");
  if (enumValueCount > 1_000) throw new Error("SEMANTIC_SCHEMA_ENUM_LIMIT_EXCEEDED");
  if (schemaStringLength > 120_000) throw new Error("SEMANTIC_SCHEMA_STRING_LIMIT_EXCEEDED");
}

export function normalizeSemanticStrictOutputSchema(candidate: unknown): Record<string, unknown> {
  const normalized = normalizeSemanticStrictOutputSchemaNode(candidate);
  assertSemanticStrictOutputSchema(normalized);
  return normalized;
}

export type SemanticInterpretation = z.infer<typeof SemanticInterpretationSchema>;
export type OpenSemanticInventory = z.infer<typeof OpenSemanticInventorySchema>;
export type ClosedSemanticProjection = z.infer<typeof ClosedSemanticProjectionSchema>;
export type SemanticInventoryItem = z.infer<typeof SemanticInventoryItemSchema>;
export type ScaleEvidence = z.infer<typeof ScaleEvidenceSchema>;
