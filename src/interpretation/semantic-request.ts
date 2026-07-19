import { z } from "zod";

import { Sha256Schema, StableIdSchema } from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import { ReferenceRoleSchema } from "./intent-graph.js";

export const CURRENT_INTERPRETATION_PROMPT_VERSION =
  "sketchycut-semantic-intent@1.0.0" as const;
export const CURRENT_INTENT_SCHEMA_VERSION = "intent-graph-v1@1.0.0" as const;
export const CURRENT_CAPABILITY_CATALOG_ID = "sketchycut-semantic-capabilities@1.0.0" as const;

export const SemanticModelConfigurationSchema = z
  .object({
    modelId: z.string().trim().min(1).max(120),
    reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh"]),
    maxOutputTokens: z.number().int().positive().max(4_000),
    serviceTier: z.enum(["auto", "default", "priority"]),
    store: z.literal(false)
  })
  .strict();

export const SemanticReferenceDescriptorSchema = z
  .object({
    referenceId: StableIdSchema,
    sha256: Sha256Schema,
    mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    width: z.number().int().positive().max(4_096),
    height: z.number().int().positive().max(4_096)
  })
  .strict();

export const ReferenceRoleConstraintSchema = z
  .object({
    referenceId: StableIdSchema,
    roles: z.array(ReferenceRoleSchema).min(1).max(2)
  })
  .strict()
  .superRefine((constraint, context) => {
    if (new Set(constraint.roles).size !== constraint.roles.length) {
      context.addIssue({ code: "custom", message: "Role constraints must be unique." });
    }
  });

export const SemanticGenerationRequestV1Schema = z
  .object({
    schemaVersion: z.literal("1.0"),
    normalizedBrief: z.string().min(1).max(4_000),
    references: z.array(SemanticReferenceDescriptorSchema).min(1).max(3),
    roleConstraints: z.array(ReferenceRoleConstraintSchema).max(3),
    promptVersion: z.literal(CURRENT_INTERPRETATION_PROMPT_VERSION),
    promptHash: Sha256Schema.nullable(),
    intentSchemaVersion: z.literal(CURRENT_INTENT_SCHEMA_VERSION),
    capabilityCatalogVersion: z.literal(CURRENT_CAPABILITY_CATALOG_ID),
    modelConfiguration: SemanticModelConfigurationSchema
  })
  .strict()
  .superRefine((request, context) => {
    const referenceIds = request.references.map((item) => item.referenceId);
    if (new Set(referenceIds).size !== referenceIds.length) {
      context.addIssue({ code: "custom", message: "Reference IDs must be unique." });
    }
    const constraintIds = request.roleConstraints.map((item) => item.referenceId);
    if (new Set(constraintIds).size !== constraintIds.length) {
      context.addIssue({ code: "custom", message: "Role constraints must be unique by reference." });
    }
    for (const id of constraintIds) {
      if (!referenceIds.includes(id)) {
        context.addIssue({
          code: "custom",
          message: `Role constraint references unknown image ${id}.`
        });
      }
    }
    const expectedConstraintOrder = request.references
      .map((item) => item.referenceId)
      .filter((id) => constraintIds.includes(id));
    if (expectedConstraintOrder.some((id, index) => constraintIds[index] !== id)) {
      context.addIssue({
        code: "custom",
        message: "Role constraints must follow the normalized reference order."
      });
    }
  });

export function normalizeBrief(value: string): string {
  return value.normalize("NFKC").trim().replaceAll(/\s+/g, " ");
}

function normalizedRoles(roles: readonly ("structure" | "motif")[]) {
  return (["structure", "motif"] as const).filter((role) => roles.includes(role));
}

export function normalizeSemanticGenerationRequest(input: {
  brief: string;
  references: readonly z.input<typeof SemanticReferenceDescriptorSchema>[];
  roleConstraints: readonly z.input<typeof ReferenceRoleConstraintSchema>[];
  modelConfiguration: z.input<typeof SemanticModelConfigurationSchema>;
  promptVersion?: string;
  promptHash?: string | null;
}): SemanticGenerationRequestV1 {
  const references = input.references.map((item) => SemanticReferenceDescriptorSchema.parse(item));
  const byReferenceId = new Map(input.roleConstraints.map((item) => [item.referenceId, item]));
  return SemanticGenerationRequestV1Schema.parse({
    schemaVersion: "1.0",
    normalizedBrief: normalizeBrief(input.brief),
    references,
    roleConstraints: references.flatMap((reference) => {
      const constraint = byReferenceId.get(reference.referenceId);
      return constraint === undefined
        ? []
        : [{ referenceId: reference.referenceId, roles: normalizedRoles(constraint.roles) }];
    }),
    promptVersion: input.promptVersion ?? CURRENT_INTERPRETATION_PROMPT_VERSION,
    promptHash: input.promptHash ?? null,
    intentSchemaVersion: CURRENT_INTENT_SCHEMA_VERSION,
    capabilityCatalogVersion: CURRENT_CAPABILITY_CATALOG_ID,
    modelConfiguration: input.modelConfiguration
  });
}

export async function semanticRequestDigest(
  requestCandidate: unknown,
): Promise<string> {
  return hashCanonical(SemanticGenerationRequestV1Schema.parse(requestCandidate));
}

export type SemanticGenerationRequestV1 = z.infer<typeof SemanticGenerationRequestV1Schema>;
export type SemanticModelConfiguration = z.infer<typeof SemanticModelConfigurationSchema>;
export type SemanticReferenceDescriptor = z.infer<typeof SemanticReferenceDescriptorSchema>;
export type ReferenceRoleConstraint = z.infer<typeof ReferenceRoleConstraintSchema>;
