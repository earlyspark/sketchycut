import { z } from "zod";

import { Sha256Schema, StableIdSchema } from "../domain/contracts.js";

export const ConstructionAccessV1Schema = z.enum(["open-top", "open-front", "covered"]);
export const ConstructionMechanismV1Schema = z.enum(["rigid", "retained-pin", "captured-slide"]);
export const ConstructionFaceRoleV1Schema = z.enum([
  "foundation",
  "rear",
  "left",
  "right",
  "front",
  "cover",
  "divider"
]);

export const SymbolicTopologyCandidateV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  candidateId: StableIdSchema,
  primaryBodyId: StableIdSchema,
  access: ConstructionAccessV1Schema,
  mechanism: ConstructionMechanismV1Schema,
  mechanismAxis: z.enum(["width", "depth"]).nullable(),
  faces: z.array(z.object({
    id: StableIdSchema,
    role: ConstructionFaceRoleV1Schema,
    sourceRequirementIds: z.array(StableIdSchema).max(8)
  }).strict()).min(4).max(20),
  canonicalSpaces: z.array(z.object({
    id: StableIdSchema,
    order: z.number().int().nonnegative(),
    sourceRequirementIds: z.array(StableIdSchema).max(8)
  }).strict()).min(1).max(12),
  partitionAxis: z.enum(["width", "depth"]).nullable(),
  sourceRequirementIds: z.array(StableIdSchema).min(1).max(24),
  assumptionIds: z.array(StableIdSchema).max(12)
}).strict().superRefine((value, context) => {
  const faceIds = value.faces.map((item) => item.id);
  const spaceIds = value.canonicalSpaces.map((item) => item.id);
  if (new Set(faceIds).size !== faceIds.length) {
    context.addIssue({ code: "custom", message: "Symbolic face IDs must be unique." });
  }
  if (new Set(spaceIds).size !== spaceIds.length) {
    context.addIssue({ code: "custom", message: "Canonical space IDs must be unique." });
  }
  const roles = value.faces.map((item) => item.role);
  for (const required of ["foundation", "rear", "left", "right"] as const) {
    if (!roles.includes(required)) context.addIssue({ code: "custom", message: `Topology requires ${required}.` });
  }
  if ((value.access === "open-front") === roles.includes("front")) {
    context.addIssue({ code: "custom", message: "Open-front topology must omit front; other access kinds require it." });
  }
  const coverRequired = value.access === "covered";
  if (coverRequired !== roles.includes("cover")) {
    context.addIssue({ code: "custom", message: "Covered topology requires exactly one cover role." });
  }
  const expectedDividers = value.canonicalSpaces.length - 1;
  if (roles.filter((role) => role === "divider").length !== expectedDividers) {
    context.addIssue({ code: "custom", message: "Divider faces must derive from canonical spaces." });
  }
  if ((expectedDividers > 0) !== (value.partitionAxis !== null)) {
    context.addIssue({ code: "custom", message: "Partition axis must exist exactly when dividers exist." });
  }
  if ((value.mechanism === "rigid") !== (value.mechanismAxis === null)) {
    context.addIssue({ code: "custom", message: "Only a moving construction declares a mechanism axis." });
  }
});

export const ConstructionFindingV1Schema = z.object({
  code: z.enum([
    "EMPTY_OR_DISCONNECTED_TOPOLOGY",
    "CONTRADICTORY_INTERFACES",
    "COMPOUND_MOTION_UNSUPPORTED",
    "ESSENTIAL_ROD_REALIZATION_UNSUPPORTED",
    "INTERFACE_ORIENTATION_UNSUPPORTED",
    "MANDATORY_REQUIREMENT_UNSUPPORTED",
    "MANDATORY_REQUIREMENT_REALIZATION_MISSING",
    "MANDATORY_REFERENCE_OBSERVATION_UNSUPPORTED",
    "MOTIF_PRIMITIVE_UNREGISTERED",
    "PREFERRED_REQUIREMENT_OMITTED",
    "SIZING_HARD_CONSTRAINT_INFEASIBLE",
    "FIT_CRITICAL_MEASUREMENT_REQUIRED",
    "SIZING_OBJECT_TARGET_AMBIGUOUS",
    "SIZING_PROPORTION_RELATION_CONFLICT",
    "SEARCH_BUDGET_EXHAUSTED",
    "STUDIO_IMPORT_COMPLEXITY_EXCEEDED",
    "CANDIDATE_COMPILATION_FAILED",
    "CANDIDATE_VALIDATION_FAILED"
  ]),
  phase: z.enum(["schema", "semantic", "topology", "sizing", "composition", "compile", "validate", "rank"]),
  blocking: z.boolean(),
  relatedSemanticIds: z.array(StableIdSchema),
  relatedConstraintIds: z.array(StableIdSchema),
  candidateId: StableIdSchema.nullable(),
  message: z.string().trim().min(1).max(500)
}).strict();

export const ConstructionPlanV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  planId: StableIdSchema,
  topology: SymbolicTopologyCandidateV1Schema,
  panels: z.array(z.object({
    id: StableIdSchema,
    role: ConstructionFaceRoleV1Schema,
    markingCode: StableIdSchema,
    sourceSemanticIds: z.array(StableIdSchema).max(16)
  }).strict()).min(4).max(20),
  mates: z.array(z.object({
    id: StableIdSchema,
    kind: z.enum(["tab-slot", "edge-finger", "retained-pin", "captured-slide"]),
    betweenPanelIds: z.tuple([StableIdSchema, StableIdSchema]),
    sourceSemanticIds: z.array(StableIdSchema).max(16)
  }).strict()).min(1).max(48),
  operatorProgram: z.array(z.object({
    operatorId: StableIdSchema,
    operatorVersion: z.string().regex(/^\d+\.\d+\.\d+$/)
  }).strict()).min(3).max(8),
  rankingVector: z.array(z.number().int()).min(1).max(12),
  assumptions: z.array(z.object({ id: StableIdSchema, disclosure: z.string().min(1).max(500) }).strict()).max(12),
  simplifications: z.array(z.object({ requirementId: StableIdSchema, disclosure: z.string().min(1).max(500) }).strict()).max(12),
  policyVersion: z.literal("construction-planner-v1"),
  policyHash: Sha256Schema
}).strict().superRefine((value, context) => {
  const panelIds = new Set(value.panels.map((item) => item.id));
  if (panelIds.size !== value.panels.length) context.addIssue({ code: "custom", message: "Panel IDs must be unique." });
  for (const mate of value.mates) {
    if (mate.betweenPanelIds[0] === mate.betweenPanelIds[1] || mate.betweenPanelIds.some((id) => !panelIds.has(id))) {
      context.addIssue({ code: "custom", message: `Mate ${mate.id} must connect two known distinct panels.` });
    }
  }
});

export type SymbolicTopologyCandidateV1 = z.infer<typeof SymbolicTopologyCandidateV1Schema>;
export type ConstructionFindingV1 = z.infer<typeof ConstructionFindingV1Schema>;
export type ConstructionPlanV1 = z.infer<typeof ConstructionPlanV1Schema>;
