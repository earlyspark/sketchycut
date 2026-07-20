import { z } from "zod";

import { Sha256Schema } from "../domain/digests.js";
import { StableIdSchema } from "../domain/primitives.js";

const ReferenceRoleSchema = z.enum(["structure", "motif"]);

export const SemanticModelConfigurationSchema = z.object({
  modelId: z.string().trim().min(1).max(120),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh"]),
  maxOutputTokens: z.number().int().positive().max(4_000),
  serviceTier: z.enum(["auto", "default", "priority"]),
  store: z.literal(false)
}).strict();

export const SemanticReferenceDescriptorSchema = z.object({
  referenceId: StableIdSchema,
  sha256: Sha256Schema,
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  width: z.number().int().positive().max(4_096),
  height: z.number().int().positive().max(4_096)
}).strict();

export const ReferenceRoleConstraintSchema = z.object({
  referenceId: StableIdSchema,
  roles: z.array(ReferenceRoleSchema).min(1).max(2)
}).strict().superRefine((constraint, context) => {
  if (new Set(constraint.roles).size !== constraint.roles.length) {
    context.addIssue({ code: "custom", message: "Role constraints must be unique." });
  }
});

export function normalizeBrief(value: string): string {
  return value.normalize("NFKC").trim().replaceAll(/\s+/g, " ");
}

export type SemanticModelConfiguration = z.infer<typeof SemanticModelConfigurationSchema>;
export type SemanticReferenceDescriptor = z.infer<typeof SemanticReferenceDescriptorSchema>;
export type ReferenceRoleConstraint = z.infer<typeof ReferenceRoleConstraintSchema>;
