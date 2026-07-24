import { z } from "zod";

import { Sha256Schema } from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import {
  authorizeSemanticInterpretation,
  SemanticInterpretationCandidateSchema,
  expandSemanticInterpretationCandidate
} from "./semantic-model-contract.js";
import type { SemanticInterpretation } from "./semantic-interpretation.js";
import {
  SemanticGenerationRequestSchema,
  semanticRequestDigest,
  type SemanticGenerationRequest
} from "./semantic-request.js";

export const CURRENT_SEMANTIC_CACHE_VALUE_VERSION = "7.0" as const;

export const CachedSemanticValueSchema = z.object({
  schemaVersion: z.literal(CURRENT_SEMANTIC_CACHE_VALUE_VERSION),
  candidate: SemanticInterpretationCandidateSchema,
  provenance: z.object({
    modelId: z.string().min(1).max(120),
    providerModelId: z.string().min(1).max(120).nullable(),
    providerRequestId: z.string().min(1).max(512).nullable(),
    modelConfigurationHash: Sha256Schema,
    responseId: z.string().min(1).max(512).nullable(),
    finishState: z.enum(["completed", "incomplete", "failed", "cancelled", "unknown", "not-observed"]),
    usage: z.object({
      inputTokens: z.number().int().nonnegative(),
      cachedInputTokens: z.number().int().nonnegative(),
      cacheWriteInputTokens: z.number().int().nonnegative(),
      reasoningTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative()
    }).strict().nullable(),
    latencyMs: z.number().int().nonnegative().nullable(),
    estimatedCostUsd: z.number().nonnegative().nullable(),
    requestBudgetUpperBoundUsd: z.number().nonnegative().nullable(),
    priceSnapshotId: z.string().min(1).max(120).nullable(),
    outputDigest: Sha256Schema,
    promptIdentity: z.string().min(1).max(160),
    promptHash: Sha256Schema,
    semanticSchemaId: z.string().min(1).max(120),
    atomTemplateVersion: z.string().min(1).max(120),
    capabilityCatalogVersion: z.string().min(1).max(120),
    unsupportedSemanticSignatureRegistryVersion: z.string().min(1).max(120)
  }).strict()
}).strict();

export type CachedSemanticValue = z.infer<typeof CachedSemanticValueSchema>;
export type SemanticCacheResolution = {
  requestDigest: string;
  cacheResult: "miss" | "hit" | "singleflight-hit";
  value: CachedSemanticValue;
};

export type SemanticCache = {
  resolve(
    requestCandidate: unknown,
    dispatch: (request: SemanticGenerationRequest) => Promise<unknown>,
  ): Promise<SemanticCacheResolution>;
};

function clone(value: CachedSemanticValue): CachedSemanticValue {
  return CachedSemanticValueSchema.parse(structuredClone(value));
}

function provenanceMatches(value: CachedSemanticValue, request: SemanticGenerationRequest): boolean {
  return value.provenance.modelId === request.modelConfiguration.modelId &&
    value.provenance.promptIdentity === request.promptIdentity &&
    value.provenance.promptHash === request.promptHash &&
    value.provenance.semanticSchemaId === request.semanticSchemaId &&
    value.provenance.atomTemplateVersion === request.atomTemplateVersion &&
    value.provenance.capabilityCatalogVersion === request.capabilityCatalogVersion &&
    value.provenance.unsupportedSemanticSignatureRegistryVersion ===
      request.unsupportedSemanticSignatureRegistryVersion;
}

export async function validateCachedSemanticValue(input: {
  candidate: unknown;
  request: SemanticGenerationRequest;
}): Promise<CachedSemanticValue> {
  const value = CachedSemanticValueSchema.parse(input.candidate);
  if (!provenanceMatches(value, input.request)) throw new Error("CACHE_PROVENANCE_MISMATCH");
  if (await hashCanonical(input.request.modelConfiguration) !== value.provenance.modelConfigurationHash) {
    throw new Error("CACHE_MODEL_CONFIGURATION_MISMATCH");
  }
  if (await hashCanonical(value.candidate) !== value.provenance.outputDigest) {
    throw new Error("CACHE_OUTPUT_DIGEST_MISMATCH");
  }
  if (!authorizeSemanticInterpretation({
    interpretation: value.candidate,
    sourceEvidenceIndex: input.request.sourceEvidenceIndex
  }).success) {
    throw new Error("CACHE_SEMANTIC_AUTHORIZATION_FAILED");
  }
  return value;
}

export class ExactSemanticCache implements SemanticCache {
  readonly #values = new Map<string, CachedSemanticValue>();
  readonly #inflight = new Map<string, Promise<CachedSemanticValue>>();

  get size(): number {
    return this.#values.size;
  }

  async resolve(
    requestCandidate: unknown,
    dispatch: (request: SemanticGenerationRequest) => Promise<unknown>,
  ): Promise<SemanticCacheResolution> {
    const request = SemanticGenerationRequestSchema.parse(requestCandidate);
    const requestDigest = await semanticRequestDigest(request);
    const existing = this.#values.get(requestDigest);
    if (existing !== undefined) return { requestDigest, cacheResult: "hit", value: clone(existing) };
    const inflight = this.#inflight.get(requestDigest);
    if (inflight !== undefined) {
      return { requestDigest, cacheResult: "singleflight-hit", value: clone(await inflight) };
    }
    const work = Promise.resolve(dispatch(request)).then(async (candidate) => {
      const value = await validateCachedSemanticValue({ candidate, request });
      this.#values.set(requestDigest, clone(value));
      return value;
    });
    this.#inflight.set(requestDigest, work);
    try {
      return { requestDigest, cacheResult: "miss", value: clone(await work) };
    } finally {
      this.#inflight.delete(requestDigest);
    }
  }

  inspectPrivacySafeValues(): readonly CachedSemanticValue[] {
    return [...this.#values.values()].map(clone);
  }
}

export function strictInterpretationFromCacheValue(value: CachedSemanticValue): SemanticInterpretation {
  return expandSemanticInterpretationCandidate(CachedSemanticValueSchema.parse(value).candidate);
}
