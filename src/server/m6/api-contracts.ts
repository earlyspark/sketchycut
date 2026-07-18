import { z } from "zod";

import { Sha256Schema, StableIdSchema } from "../../domain/contracts.js";
import { GenerationOutcomeV1Schema } from "../../interpretation/generation-protocol.js";
import {
  GeneratedCompiledProjectSchema,
  GeneratedDeterministicControlsSchema,
  GeneratedFabricationControlsSchema
} from "../../interpretation/generated-project-contracts.js";
import { IntentGraphV1Schema } from "../../interpretation/intent-graph.js";
import {
  SimplifiedCapabilityMappingSchema,
  SupportedCapabilityMappingSchema
} from "../../interpretation/mapper.js";
const ProjectSummarySchema = z.object({
  projectId: StableIdSchema,
  revision: z.number().int().positive(),
  updatedAtMs: z.number().int().nonnegative(),
  lastDocumentHash: Sha256Schema,
  lastGeometryHash: Sha256Schema
}).strict();

export const M6GenerationResponseSchema = z.object({
  schemaVersion: z.literal("1.0"),
  outcome: GenerationOutcomeV1Schema,
  project: ProjectSummarySchema.nullable()
}).strict();

export const M6ProjectUpdateRequestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  projectId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
  deterministicControls: GeneratedDeterministicControlsSchema,
  fabricationControls: GeneratedFabricationControlsSchema
}).strict();

export const M6ProjectResponseSchema = z.object({
  schemaVersion: z.literal("1.0"),
  project: ProjectSummarySchema,
  source: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("supported"),
      intent: IntentGraphV1Schema,
      mapping: SupportedCapabilityMappingSchema,
      deterministicControls: GeneratedDeterministicControlsSchema,
      fabricationControls: GeneratedFabricationControlsSchema
    }).strict(),
    z.object({
      kind: z.literal("simplified"),
      intent: IntentGraphV1Schema,
      mapping: SimplifiedCapabilityMappingSchema,
      deterministicControls: GeneratedDeterministicControlsSchema,
      fabricationControls: GeneratedFabricationControlsSchema
    }).strict()
  ]),
  compiled: GeneratedCompiledProjectSchema
}).strict();

export type M6GenerationResponse = z.infer<typeof M6GenerationResponseSchema>;
export type M6ProjectResponse = z.infer<typeof M6ProjectResponseSchema>;
