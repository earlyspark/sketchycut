import { z } from "zod";

import { Sha256Schema } from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import { IntentGraphV2Schema, type IntentGraphV2 } from "./intent-graph-v2.js";
import {
  SemanticGenerationRequestV2Schema,
  semanticRequestDigestV2,
  type SemanticGenerationRequestV2
} from "./semantic-request-v2.js";

export const CachedSemanticValueV2Schema = z.object({
  schemaVersion: z.literal("2.0"),
  intent: IntentGraphV2Schema,
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
    intentSchemaId: z.string().min(1).max(120),
    capabilityCatalogVersion: z.string().min(1).max(120)
  }).strict()
}).strict();

export type CachedSemanticValueV2 = z.infer<typeof CachedSemanticValueV2Schema>;
export type SemanticCacheResolutionV2 = {
  requestDigest: string;
  cacheResult: "miss" | "hit" | "singleflight-hit";
  value: CachedSemanticValueV2;
};

export type SemanticCacheV2 = {
  resolve(
    requestCandidate: unknown,
    dispatch: (request: SemanticGenerationRequestV2) => Promise<unknown>,
  ): Promise<SemanticCacheResolutionV2>;
};

function clone(value: CachedSemanticValueV2): CachedSemanticValueV2 {
  return CachedSemanticValueV2Schema.parse(structuredClone(value));
}

function provenanceMatches(value: CachedSemanticValueV2, request: SemanticGenerationRequestV2): boolean {
  return value.provenance.modelId === request.modelConfiguration.modelId &&
    value.provenance.promptIdentity === request.promptIdentity &&
    value.provenance.promptHash === request.promptHash &&
    value.provenance.intentSchemaId === request.intentSchemaId &&
    value.provenance.capabilityCatalogVersion === request.capabilityCatalogVersion;
}

export async function validateCachedSemanticValueV2(input: {
  candidate: unknown;
  request: SemanticGenerationRequestV2;
}): Promise<CachedSemanticValueV2> {
  const value = CachedSemanticValueV2Schema.parse(input.candidate);
  if (!provenanceMatches(value, input.request)) throw new Error("CACHE_PROVENANCE_MISMATCH");
  if (await hashCanonical(input.request.modelConfiguration) !== value.provenance.modelConfigurationHash) {
    throw new Error("CACHE_MODEL_CONFIGURATION_MISMATCH");
  }
  if (await hashCanonical(value.intent) !== value.provenance.outputDigest) {
    throw new Error("CACHE_OUTPUT_DIGEST_MISMATCH");
  }
  return value;
}

export class ExactSemanticCacheV2 implements SemanticCacheV2 {
  readonly #values = new Map<string, CachedSemanticValueV2>();
  readonly #inflight = new Map<string, Promise<CachedSemanticValueV2>>();

  get size(): number {
    return this.#values.size;
  }

  async resolve(
    requestCandidate: unknown,
    dispatch: (request: SemanticGenerationRequestV2) => Promise<unknown>,
  ): Promise<SemanticCacheResolutionV2> {
    const request = SemanticGenerationRequestV2Schema.parse(requestCandidate);
    const requestDigest = await semanticRequestDigestV2(request);
    const existing = this.#values.get(requestDigest);
    if (existing !== undefined) return { requestDigest, cacheResult: "hit", value: clone(existing) };
    const inflight = this.#inflight.get(requestDigest);
    if (inflight !== undefined) {
      return { requestDigest, cacheResult: "singleflight-hit", value: clone(await inflight) };
    }
    const work = Promise.resolve(dispatch(request)).then(async (candidate) => {
      const value = await validateCachedSemanticValueV2({ candidate, request });
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

  inspectPrivacySafeValues(): readonly CachedSemanticValueV2[] {
    return [...this.#values.values()].map(clone);
  }
}

export function strictIntentFromCacheValueV2(value: CachedSemanticValueV2): IntentGraphV2 {
  return IntentGraphV2Schema.parse(value.intent);
}
