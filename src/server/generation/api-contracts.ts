import { z } from "zod";

import { Sha256Schema, StableIdSchema } from "../../domain/contracts.js";
import { GenerationOutcomeSchema, CanonicalGenerationSourceSchema } from "../../interpretation/generation-outcome.js";
import { GenerationDeterministicControlsSchema } from "../../interpretation/generation-submission.js";
import { GeneratedCompiledProjectSchema, GeneratedFabricationControlsSchema } from "../../interpretation/generated-project-contracts.js";

export const CurrentProjectSummarySchema = z.object({
  projectId: StableIdSchema,
  revision: z.number().int().positive(),
  updatedAtMs: z.number().int().nonnegative(),
  lastDocumentHash: Sha256Schema,
  lastGeometryHash: Sha256Schema
}).strict();

export const CurrentGenerationResponseSchema = z.object({
  schemaVersion: z.literal("3.0"),
  outcome: GenerationOutcomeSchema,
  project: CurrentProjectSummarySchema.nullable(),
  compiled: GeneratedCompiledProjectSchema.nullable(),
  retryContext: z.object({
    priorAttemptId: z.string().min(1).max(512),
    retryChainId: z.string().min(1).max(512),
    attemptOrdinal: z.number().int().min(2)
  }).strict().nullable()
}).strict().superRefine((value, context) => {
  const fabricable = value.outcome.kind === "supported" ||
    value.outcome.kind === "simplified" ||
    value.outcome.kind === "modified";
  if (fabricable !== (value.project !== null && value.compiled !== null)) {
    context.addIssue({
      code: "custom",
      message: "Only supported, simplified, or modified outcomes may carry a project and compiled result."
    });
  }
});

export const CurrentProjectUpdateRequestSchema = z.object({
  schemaVersion: z.literal("3.0"),
  projectId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  deterministicControls: GenerationDeterministicControlsSchema,
  fabricationControls: GeneratedFabricationControlsSchema
}).strict();

export const CurrentProjectResponseSchema = z.object({
  schemaVersion: z.literal("3.0"),
  project: CurrentProjectSummarySchema,
  source: CanonicalGenerationSourceSchema,
  deterministicControls: GenerationDeterministicControlsSchema,
  fabricationControls: GeneratedFabricationControlsSchema,
  compiled: GeneratedCompiledProjectSchema
}).strict();

export type CurrentGenerationResponse = z.infer<typeof CurrentGenerationResponseSchema>;
export type CurrentProjectResponse = z.infer<typeof CurrentProjectResponseSchema>;
