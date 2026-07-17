import { z } from "zod";

import { StableIdSchema } from "../domain/primitives.js";

const CompactTextSchema = z.string().trim().min(1).max(500);

export const ReferenceRoleSchema = z.enum(["structure", "motif"]);
export const RequirementKindSchema = z.enum([
  "rigid-assembly",
  "containment",
  "revolute-motion",
  "prismatic-motion",
  "permitted-stock",
  "visual-treatment",
  "specific-profile",
  "compound-motion"
]);
export const BodyRoleSchema = z.enum([
  "support",
  "enclosure",
  "cover",
  "moving-panel",
  "connector"
]);
export const ShapeClassSchema = z.enum(["planar", "shell", "rod"]);
export const AttachmentRoleSchema = z.enum([
  "base",
  "side",
  "top",
  "internal",
  "free",
  "unspecified"
]);
export const OrientationRoleSchema = z.enum([
  "horizontal",
  "vertical",
  "axial",
  "unspecified"
]);
export const InterfaceBehaviorSchema = z.enum(["rigid", "revolute", "prismatic"]);
export const InterfaceOrientationSchema = z.enum([
  "parallel",
  "orthogonal",
  "coaxial",
  "unspecified"
]);
export const AxisRoleSchema = z.enum([
  "width",
  "depth",
  "height",
  "surface-normal",
  "unspecified"
]);

export const IntentEvidenceV1Schema = z
  .object({
    evidenceId: StableIdSchema,
    source: z.enum(["text", "reference"]),
    referenceId: StableIdSchema.nullable(),
    statement: CompactTextSchema
  })
  .strict()
  .superRefine((evidence, context) => {
    if ((evidence.source === "reference") !== (evidence.referenceId !== null)) {
      context.addIssue({
        code: "custom",
        message: "Reference evidence must name its reference and text evidence must not."
      });
    }
  });

export const IntentGraphV1Schema = z
  .object({
    schemaVersion: z.literal("1.0"),
    title: z.string().trim().min(1).max(120),
    coreIntent: CompactTextSchema,
    requirements: z.array(
      z
        .object({
          id: StableIdSchema,
          priority: z.enum(["must", "prefer"]),
          kind: RequirementKindSchema,
          statement: CompactTextSchema,
          evidence: z.array(IntentEvidenceV1Schema).min(1).max(8)
        })
        .strict(),
    ).min(1).max(24),
    references: z.array(
      z
        .object({
          referenceId: StableIdSchema,
          inferredRoles: z.array(ReferenceRoleSchema).min(1).max(2),
          structuralObservations: z.array(IntentEvidenceV1Schema).max(12),
          motifObservations: z.array(IntentEvidenceV1Schema).max(12),
          confidence: z.enum(["low", "medium", "high"])
        })
        .strict()
        .superRefine((reference, context) => {
          if (new Set(reference.inferredRoles).size !== reference.inferredRoles.length) {
            context.addIssue({ code: "custom", message: "Reference roles must be unique." });
          }
          for (const evidence of [
            ...reference.structuralObservations,
            ...reference.motifObservations
          ]) {
            if (evidence.referenceId !== reference.referenceId) {
              context.addIssue({
                code: "custom",
                message: "Reference observations must point to their containing reference."
              });
            }
          }
        }),
    ).max(3),
    topology: z
      .object({
        bodies: z.array(
          z
            .object({
              id: StableIdSchema,
              role: BodyRoleSchema,
              quantity: z.number().int().positive().max(24),
              shapeClass: ShapeClassSchema,
              attachmentRole: AttachmentRoleSchema,
              orientationRole: OrientationRoleSchema
            })
            .strict(),
        ).min(1).max(24),
        interfaces: z.array(
          z
            .object({
              id: StableIdSchema,
              between: z.tuple([StableIdSchema, StableIdSchema]),
              behavior: InterfaceBehaviorSchema,
              relativeOrientation: InterfaceOrientationSchema,
              axisRole: AxisRoleSchema,
              function: CompactTextSchema
            })
            .strict(),
        ).max(48)
      })
      .strict(),
    motif: z
      .object({
        vocabulary: z.array(z.string().trim().min(1).max(80)).max(12),
        composition: z.enum(["border", "field", "focal", "repeated"]),
        density: z.enum(["sparse", "balanced", "dense"]),
        symmetry: z.enum(["none", "bilateral", "radial", "translational"]),
        primitiveFamilies: z.array(StableIdSchema).min(1).max(6),
        preferredOperations: z.array(z.enum(["engrave", "score"])).min(1).max(2),
        preferredPartRoles: z.array(BodyRoleSchema).min(1).max(5)
      })
      .strict()
      .nullable(),
    conflicts: z.array(
      z
        .object({
          textEvidenceId: StableIdSchema,
          imageEvidenceId: StableIdSchema,
          resolution: z.literal("text-wins")
        })
        .strict(),
    ).max(12),
    assumptions: z.array(
      z
        .object({
          id: StableIdSchema,
          statement: CompactTextSchema,
          source: z.enum(["preset", "inference"])
        })
        .strict(),
    ).max(16),
    capabilityAssessment: z
      .object({
        coreIntentRepresentable: z.boolean(),
        unresolvedNeeds: z.array(CompactTextSchema).max(12)
      })
      .strict()
  })
  .strict()
  .superRefine((intent, context) => {
    const bodyIds = new Set(intent.topology.bodies.map((body) => body.id));
    const referenceIds = new Set(intent.references.map((reference) => reference.referenceId));
    const evidenceIds = new Set<string>();
    const stableIds = [
      ...intent.requirements.map((item) => item.id),
      ...intent.topology.bodies.map((item) => item.id),
      ...intent.topology.interfaces.map((item) => item.id),
      ...intent.assumptions.map((item) => item.id)
    ];
    if (new Set(stableIds).size !== stableIds.length) {
      context.addIssue({ code: "custom", message: "Intent semantic IDs must be globally unique." });
    }
    for (const [index, item] of intent.topology.interfaces.entries()) {
      if (item.between[0] === item.between[1]) {
        context.addIssue({
          code: "custom",
          message: "An interface cannot connect a body to itself.",
          path: ["topology", "interfaces", index, "between"]
        });
      }
      for (const bodyId of item.between) {
        if (!bodyIds.has(bodyId)) {
          context.addIssue({
            code: "custom",
            message: `Interface references unknown body ${bodyId}.`,
            path: ["topology", "interfaces", index, "between"]
          });
        }
      }
    }
    const evidence = [
      ...intent.requirements.flatMap((item) => item.evidence),
      ...intent.references.flatMap((reference) => [
        ...reference.structuralObservations,
        ...reference.motifObservations
      ])
    ];
    for (const item of evidence) {
      if (evidenceIds.has(item.evidenceId)) {
        context.addIssue({ code: "custom", message: `Duplicate evidence ID ${item.evidenceId}.` });
      }
      evidenceIds.add(item.evidenceId);
      if (item.referenceId !== null && !referenceIds.has(item.referenceId)) {
        context.addIssue({
          code: "custom",
          message: `Evidence references unknown reference ${item.referenceId}.`
        });
      }
    }
    for (const conflict of intent.conflicts) {
      if (!evidenceIds.has(conflict.textEvidenceId) || !evidenceIds.has(conflict.imageEvidenceId)) {
        context.addIssue({ code: "custom", message: "Conflict references unknown evidence." });
      }
    }
  });

function normalizeStrictOutputSchema(candidate: unknown): unknown {
  if (Array.isArray(candidate)) {
    return candidate.map((item) => normalizeStrictOutputSchema(item));
  }
  if (typeof candidate !== "object" || candidate === null) return candidate;

  const source = candidate as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    // The API accepts the strict schema itself, not a dialect declaration.
    if (key === "$schema") continue;
    if (key === "items" && Array.isArray(value)) {
      if (value.length === 0) throw new Error("INTENT_SCHEMA_EMPTY_TUPLE");
      const tupleItems = value.map((item) => normalizeStrictOutputSchema(item));
      const first = JSON.stringify(tupleItems[0]);
      if (!tupleItems.every((item) => JSON.stringify(item) === first)) {
        throw new Error("INTENT_SCHEMA_HETEROGENEOUS_TUPLE_UNSUPPORTED");
      }
      if ((source.minItems !== undefined && source.minItems !== value.length) ||
          (source.maxItems !== undefined && source.maxItems !== value.length)) {
        throw new Error("INTENT_SCHEMA_TUPLE_LENGTH_CONFLICT");
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

/**
 * Provider-facing schema for strict structured output. Zod emits Draft-7 tuple
 * arrays for `z.tuple`; the supported strict-output subset accepts homogeneous
 * `items` plus exact array bounds instead. The runtime Zod schema remains the
 * final authority and still validates the two-element tuple after parsing.
 */
export const INTENT_GRAPH_V1_JSON_SCHEMA = normalizeStrictOutputSchema(
  z.toJSONSchema(IntentGraphV1Schema, { target: "draft-7" }),
) as ReturnType<typeof z.toJSONSchema>;

export type IntentGraphV1 = z.infer<typeof IntentGraphV1Schema>;
export type ReferenceRole = z.infer<typeof ReferenceRoleSchema>;
