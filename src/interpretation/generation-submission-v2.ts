import { z } from "zod";

import { MotifRecipeV1Schema } from "../operators/procedural-surface-treatment.js";
import { AdvancedSizingInputV1Schema } from "./explicit-sizing.js";
import { GeneratedFabricationControlsSchema } from "./generated-project-contracts.js";
import {
  ReferenceRoleConstraintSchema,
  SemanticReferenceDescriptorSchema
} from "./semantic-input-contracts.js";

const NormalizedReferencePayloadV2Schema = z.object({
  descriptor: SemanticReferenceDescriptorSchema,
  dataUrl: z.string().regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/)
}).strict();

export const GenerationRetryContextV2Schema = z.object({
  priorAttemptId: z.string().min(1).max(512),
  retryChainId: z.string().min(1).max(512),
  attemptOrdinal: z.number().int().min(2)
}).strict();

export const GenerationDeterministicControlsV2Schema = z.object({
  advancedSizing: AdvancedSizingInputV1Schema,
  motifPlacement: MotifRecipeV1Schema.shape.placement
}).strict();

export const DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2 =
  GenerationDeterministicControlsV2Schema.parse({
    advancedSizing: { basis: "auto" },
    motifPlacement: {
      scalePermille: 1_000,
      rotationQuarterTurns: 0,
      offsetXPermille: 0,
      offsetYPermille: 0,
      targetFace: "front"
    }
  });

export const GenerationSubmissionV2Schema = z.object({
  schemaVersion: z.literal("2.0"),
  brief: z.string().min(1).max(4_000),
  references: z.array(NormalizedReferencePayloadV2Schema).max(3),
  roleConstraints: z.array(ReferenceRoleConstraintSchema).max(3),
  deterministicControls: GenerationDeterministicControlsV2Schema,
  fabricationControls: GeneratedFabricationControlsSchema,
  retry: GenerationRetryContextV2Schema.nullable()
}).strict().superRefine((submission, context) => {
  const referenceIds = submission.references.map((item) => item.descriptor.referenceId);
  if (new Set(referenceIds).size !== referenceIds.length) {
    context.addIssue({ code: "custom", message: "Reference IDs must be unique." });
  }
  const constraintIds = submission.roleConstraints.map((item) => item.referenceId);
  if (new Set(constraintIds).size !== constraintIds.length) {
    context.addIssue({ code: "custom", message: "Role constraints must be unique by reference." });
  }
  if (referenceIds.length === 0 && constraintIds.length !== 0) {
    context.addIssue({ code: "custom", message: "A text-only submission requires empty role constraints." });
  }
  for (const id of constraintIds) {
    if (!referenceIds.includes(id)) {
      context.addIssue({ code: "custom", message: `Role constraint references unknown image ${id}.` });
    }
  }
  const expectedConstraintOrder = referenceIds.filter((id) => constraintIds.includes(id));
  if (expectedConstraintOrder.some((id, index) => constraintIds[index] !== id)) {
    context.addIssue({ code: "custom", message: "Role constraints must follow normalized reference order." });
  }
});

export type GenerationSubmissionV2 = z.infer<typeof GenerationSubmissionV2Schema>;
export type GenerationDeterministicControlsV2 = z.infer<
  typeof GenerationDeterministicControlsV2Schema
>;
