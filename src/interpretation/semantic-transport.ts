import { z } from "zod";

import type { SemanticGenerationRequest } from "./semantic-request.js";

const ReportedUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative()
}).strict();

const ConfirmedResponseFieldsSchema = z.object({
  providerRequestId: z.string().min(1).max(512),
  providerModelId: z.string().min(1).max(120).nullable(),
  responseId: z.string().min(1).max(512).nullable(),
  finishState: z.enum(["completed", "incomplete", "failed", "cancelled", "unknown"]),
  latencyMs: z.number().int().nonnegative(),
  usage: ReportedUsageSchema,
  estimatedCostUsd: z.number().nonnegative(),
  requestBudgetUpperBoundUsd: z.number().nonnegative(),
  priceSnapshotId: z.string().min(1).max(120)
});

export const SemanticTransportOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pre-dispatch-failure"),
    errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/)
  }).strict(),
  ConfirmedResponseFieldsSchema.extend({
    kind: z.literal("completed"),
    interpretationCandidate: z.unknown()
  }).strict(),
  ConfirmedResponseFieldsSchema.extend({
    kind: z.literal("model-failure"),
    errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/)
  }).strict(),
  z.object({
    kind: z.literal("provider-not-accepted"),
    providerRequestId: z.string().min(1).max(512).nullable(),
    latencyMs: z.number().int().nonnegative(),
    errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/)
  }).strict(),
  z.object({
    kind: z.literal("ambiguous-transport"),
    providerRequestId: z.string().min(1).max(512).nullable(),
    latencyMs: z.number().int().nonnegative().nullable(),
    requestBudgetUpperBoundUsd: z.number().nonnegative(),
    priceSnapshotId: z.string().min(1).max(120),
    errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/)
  }).strict()
]);

export type SemanticTransportOutcome = z.infer<typeof SemanticTransportOutcomeSchema>;

export type SemanticInterpretationTransport = {
  dispatch(input: {
    request: SemanticGenerationRequest;
    clientRequestId: string;
  }): Promise<SemanticTransportOutcome>;
};
