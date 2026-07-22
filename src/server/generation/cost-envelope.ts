import { z } from "zod";

import { INTENT_GRAPH_V2_JSON_SCHEMA } from "../../interpretation/intent-graph-v2.js";
import { CAPABILITY_CATALOG_V1 } from "../../interpretation/capability-catalog.js";
import { GENERATION_POLICY } from "./policy.js";

export const GENERATION_OPENAI_MODEL = "gpt-5.6-sol" as const;
export const GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT = 6_000 as const;
export const GENERATION_OPENAI_MAX_RETRIES = 0 as const;

export const GENERATION_OPENAI_PRICE = {
  id: "openai-public-pricing-2026-07-19-gpt-5-6-sol",
  sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
  uncachedInputUsdPerMillion: 5,
  cachedInputUsdPerMillion: 0.5,
  cacheWriteInputUsdPerMillion: 6.25,
  outputUsdPerMillion: 30,
  requestBudgetUpperBoundUsd: 0.65
} as const;

export const GENERATION_COST_ENVELOPE_POLICY = {
  version: "generation-cost-envelope-v2",
  maximumModelTextInputUtf8Bytes: 72_000,
  maximumImageInputTokensPerReference: {
    low: 1_000,
    high: 8_000,
    auto: 8_000
  },
  maximumReferences: 3,
  maximumOutputTokens: GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT,
  maximumInputTokenUpperBound: 75_000,
  requestBudgetUpperBoundMicrousd: GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd,
  maximumFiveCaseRoundExposureMicrousd:
    GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd * 5,
  assumptions: {
    textTokenUpperBound: "one-token-per-UTF-8-byte-conservative-bound",
    imageDetail: "request-identity-pinned-low-high-auto-or-mixed-first-high",
    imageTokenUpperBound: "1000 low / 8000 high-or-auto tokens per reference conservative policy caps",
    longContextMultiplierApplies: false
  }
} as const;

const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative()
}).strict().superRefine((usage, context) => {
  if (usage.cachedInputTokens > usage.inputTokens) {
    context.addIssue({ code: "custom", message: "Cached input cannot exceed total input." });
  }
  if (usage.cachedInputTokens + usage.cacheWriteInputTokens > usage.inputTokens) {
    context.addIssue({ code: "custom", message: "Cached and cache-write input cannot exceed total input." });
  }
});

export function estimateGenerationCostUsd(inputCandidate: {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
}): number {
  const input = UsageSchema.parse(inputCandidate);
  const uncachedInput = input.inputTokens - input.cachedInputTokens - input.cacheWriteInputTokens;
  return Number((
    uncachedInput * GENERATION_OPENAI_PRICE.uncachedInputUsdPerMillion / 1_000_000 +
    input.cachedInputTokens * GENERATION_OPENAI_PRICE.cachedInputUsdPerMillion / 1_000_000 +
    input.cacheWriteInputTokens * GENERATION_OPENAI_PRICE.cacheWriteInputUsdPerMillion / 1_000_000 +
    input.outputTokens * GENERATION_OPENAI_PRICE.outputUsdPerMillion / 1_000_000
  ).toFixed(8));
}

export const GenerationCostEnvelopeEvaluationV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  policyVersion: z.literal(GENERATION_COST_ENVELOPE_POLICY.version),
  imageDetailPolicy: z.enum(["low", "high", "auto", "mixed-first-high"]),
  referenceCount: z.number().int().min(0).max(3),
  modelTextInputUtf8Bytes: z.number().int().nonnegative(),
  modelTextInputTokenUpperBound: z.number().int().nonnegative(),
  imageInputTokenUpperBound: z.number().int().nonnegative(),
  totalInputTokenUpperBound: z.number().int().nonnegative(),
  outputTokenUpperBound: z.literal(GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT),
  estimatedUpperBoundUsd: z.number().nonnegative(),
  reservedUpperBoundUsd: z.literal(GENERATION_OPENAI_PRICE.requestBudgetUpperBoundUsd),
  reservedUpperBoundMicrousd: z.literal(GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd),
  withinDeclaredEnvelope: z.boolean()
}).strict();

export type GenerationCostEnvelopeEvaluationV1 = z.infer<
  typeof GenerationCostEnvelopeEvaluationV1Schema
>;

export function evaluateGenerationCostEnvelope(input: {
  modelTextInput: string;
  referenceCount: number;
  imageDetailPolicy: "low" | "high" | "auto" | "mixed-first-high";
}): GenerationCostEnvelopeEvaluationV1 {
  const referenceCount = z.number().int().min(0).max(3).parse(input.referenceCount);
  const modelTextInputUtf8Bytes = Buffer.byteLength(input.modelTextInput, "utf8");
  const modelTextInputTokenUpperBound = modelTextInputUtf8Bytes;
  const imageInputTokenUpperBound = input.imageDetailPolicy === "mixed-first-high"
    ? referenceCount === 0 ? 0
      : GENERATION_COST_ENVELOPE_POLICY.maximumImageInputTokensPerReference.high +
        (referenceCount - 1) * GENERATION_COST_ENVELOPE_POLICY.maximumImageInputTokensPerReference.low
    : referenceCount * GENERATION_COST_ENVELOPE_POLICY.maximumImageInputTokensPerReference[input.imageDetailPolicy];
  const totalInputTokenUpperBound = modelTextInputTokenUpperBound + imageInputTokenUpperBound;
  const estimatedUpperBoundUsd = estimateGenerationCostUsd({
    inputTokens: totalInputTokenUpperBound,
    cachedInputTokens: 0,
    cacheWriteInputTokens: totalInputTokenUpperBound,
    outputTokens: GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT
  });
  const withinDeclaredEnvelope =
    modelTextInputUtf8Bytes <= GENERATION_COST_ENVELOPE_POLICY.maximumModelTextInputUtf8Bytes &&
    totalInputTokenUpperBound <= GENERATION_COST_ENVELOPE_POLICY.maximumInputTokenUpperBound &&
    estimatedUpperBoundUsd <= GENERATION_OPENAI_PRICE.requestBudgetUpperBoundUsd;
  return GenerationCostEnvelopeEvaluationV1Schema.parse({
    schemaVersion: "1.0",
    policyVersion: GENERATION_COST_ENVELOPE_POLICY.version,
    imageDetailPolicy: input.imageDetailPolicy,
    referenceCount,
    modelTextInputUtf8Bytes,
    modelTextInputTokenUpperBound,
    imageInputTokenUpperBound,
    totalInputTokenUpperBound,
    outputTokenUpperBound: GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT,
    estimatedUpperBoundUsd,
    reservedUpperBoundUsd: GENERATION_OPENAI_PRICE.requestBudgetUpperBoundUsd,
    reservedUpperBoundMicrousd: GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd,
    withinDeclaredEnvelope
  });
}

export function generationSubmissionRequestBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function generationSubmissionFitsRequestCeiling(value: unknown): boolean {
  return generationSubmissionRequestBytes(value) <= GENERATION_POLICY.image.maximumGenerationRequestBytes;
}

export const GenerationInputAttributionV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  promptUtf8Bytes: z.number().int().nonnegative(),
  capabilityCatalogUtf8Bytes: z.number().int().nonnegative(),
  intentSchemaUtf8Bytes: z.number().int().nonnegative(),
  variableBriefUtf8Bytes: z.number().int().nonnegative(),
  variableReferenceDescriptorUtf8Bytes: z.number().int().nonnegative(),
  staticUtf8Bytes: z.number().int().nonnegative(),
  variableUtf8Bytes: z.number().int().nonnegative()
}).strict();

export function attributeGenerationInputBytes(input: {
  prompt: string;
  briefs: readonly string[];
  referenceDescriptors?: readonly unknown[];
}) {
  const bytes = (value: string): number => Buffer.byteLength(value, "utf8");
  const promptUtf8Bytes = bytes(input.prompt);
  const capabilityCatalogUtf8Bytes = bytes(JSON.stringify(CAPABILITY_CATALOG_V1));
  const intentSchemaUtf8Bytes = bytes(JSON.stringify(INTENT_GRAPH_V2_JSON_SCHEMA));
  const variableBriefUtf8Bytes = input.briefs.reduce((total, brief) => total + bytes(brief), 0);
  const variableReferenceDescriptorUtf8Bytes = bytes(JSON.stringify(input.referenceDescriptors ?? []));
  return GenerationInputAttributionV1Schema.parse({
    schemaVersion: "1.0",
    promptUtf8Bytes,
    capabilityCatalogUtf8Bytes,
    intentSchemaUtf8Bytes,
    variableBriefUtf8Bytes,
    variableReferenceDescriptorUtf8Bytes,
    staticUtf8Bytes: promptUtf8Bytes + capabilityCatalogUtf8Bytes + intentSchemaUtf8Bytes,
    variableUtf8Bytes: variableBriefUtf8Bytes + variableReferenceDescriptorUtf8Bytes
  });
}
