import { z } from "zod";

import { LiveCallAttemptSchema } from "./live-ledger.js";
import { IntentGraphV1Schema } from "./intent-graph.js";
import {
  ConceptOnlyCapabilityMappingSchema,
  SimplifiedCapabilityMappingSchema,
  SupportedCapabilityMappingSchema
} from "./mapper.js";
import {
  ReferenceRoleConstraintSchema,
  SemanticGenerationRequestV1Schema,
  SemanticReferenceDescriptorSchema
} from "./semantic-request.js";
import {
  GeneratedCompiledProjectSchema,
  GeneratedDeterministicControlsSchema,
  GeneratedFabricationControlsSchema
} from "./generated-project-contracts.js";

const NormalizedReferencePayloadSchema = z
  .object({
    descriptor: SemanticReferenceDescriptorSchema,
    dataUrl: z.string().regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/)
  })
  .strict();

export const GenerationRetryContextSchema = z
  .object({
    priorAttemptId: z.string().min(1).max(512),
    retryChainId: z.string().min(1).max(512),
    attemptOrdinal: z.number().int().min(2)
  })
  .strict();

export const GenerationSubmissionV1Schema = z
  .object({
    schemaVersion: z.literal("1.0"),
    brief: z.string().min(1).max(4_000),
    references: z.array(NormalizedReferencePayloadSchema).min(1).max(3),
    roleConstraints: z.array(ReferenceRoleConstraintSchema).max(3),
    deterministicControls: GeneratedDeterministicControlsSchema,
    fabricationControls: GeneratedFabricationControlsSchema,
    retry: GenerationRetryContextSchema.nullable()
  })
  .strict();

const ResultBaseSchema = z.object({
  schemaVersion: z.literal("1.0"),
  transportMode: z.enum(["replay", "live"]),
  semanticRequest: SemanticGenerationRequestV1Schema,
  intent: IntentGraphV1Schema,
  cacheResult: z.enum(["miss", "hit", "singleflight-hit"]),
  attempt: LiveCallAttemptSchema.nullable()
});

const FabricationResultBaseSchema = ResultBaseSchema.extend({
  compiled: GeneratedCompiledProjectSchema
});

export const GenerationOutcomeV1Schema = z.discriminatedUnion("kind", [
  FabricationResultBaseSchema.extend({
    kind: z.literal("supported"),
    mapping: SupportedCapabilityMappingSchema
  }).strict(),
  FabricationResultBaseSchema.extend({
    kind: z.literal("simplified"),
    mapping: SimplifiedCapabilityMappingSchema
  }).strict(),
  ResultBaseSchema.extend({
    kind: z.literal("concept-only"),
    mapping: ConceptOnlyCapabilityMappingSchema,
    exportAllowed: z.literal(false)
  }).strict(),
  z
    .object({
      schemaVersion: z.literal("1.0"),
      kind: z.literal("failure"),
      transportMode: z.enum(["replay", "live"]),
      stage: z.enum(["input", "transport", "schema", "model", "mapping", "compilation"]),
      code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
      retryable: z.boolean(),
      attempt: LiveCallAttemptSchema.nullable()
    })
    .strict()
]);

export type GenerationSubmissionV1 = z.infer<typeof GenerationSubmissionV1Schema>;
export type GenerationOutcomeV1 = z.infer<typeof GenerationOutcomeV1Schema>;
