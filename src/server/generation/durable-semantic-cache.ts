import { randomUUID } from "node:crypto";

import {
  CachedSemanticValueSchema,
  type CachedSemanticValue,
  type SemanticCacheResolution,
  type SemanticCache,
  validateCachedSemanticValue
} from "../../interpretation/semantic-cache.js";
import {
  SemanticGenerationRequestSchema,
  semanticRequestDigest,
  type SemanticGenerationRequest
} from "../../interpretation/semantic-request.js";
import type { GenerationStore } from "./contracts.js";
import { generationKeys } from "./keys.js";
import { GENERATION_POLICY } from "./policy.js";

function clone(value: CachedSemanticValue): CachedSemanticValue {
  return CachedSemanticValueSchema.parse(structuredClone(value));
}

async function parseCurrentStored(
  source: string,
  request: SemanticGenerationRequest,
): Promise<CachedSemanticValue | null> {
  try {
    return await validateCachedSemanticValue({ candidate: JSON.parse(source) as unknown, request });
  } catch {
    return null;
  }
}

export class DurableSemanticCache implements SemanticCache {
  readonly #store: GenerationStore;
  readonly #inflight = new Map<string, Promise<{ value: CachedSemanticValue; dispatched: boolean }>>();
  readonly #wait: (milliseconds: number) => Promise<void>;

  constructor(input: { store: GenerationStore; wait?: (milliseconds: number) => Promise<void> }) {
    this.#store = input.store;
    this.#wait = input.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async resolve(
    requestCandidate: unknown,
    dispatch: (request: SemanticGenerationRequest) => Promise<unknown>,
  ): Promise<SemanticCacheResolution> {
    const request = SemanticGenerationRequestSchema.parse(requestCandidate);
    const requestDigest = await semanticRequestDigest(request);
    const cacheKey = generationKeys.cache(requestDigest);
    const existing = await this.#store.getValue(cacheKey);
    if (existing !== null) {
      const value = await parseCurrentStored(existing, request);
      if (value !== null) return { requestDigest, cacheResult: "hit", value: clone(value) };
    }
    const local = this.#inflight.get(requestDigest);
    if (local !== undefined) {
      return { requestDigest, cacheResult: "singleflight-hit", value: clone((await local).value) };
    }
    const work = this.#resolveDistributedMiss(requestDigest, request, dispatch);
    this.#inflight.set(requestDigest, work);
    try {
      const resolution = await work;
      return {
        requestDigest,
        cacheResult: resolution.dispatched ? "miss" : "singleflight-hit",
        value: clone(resolution.value)
      };
    } finally {
      this.#inflight.delete(requestDigest);
    }
  }

  async #resolveDistributedMiss(
    requestDigest: string,
    request: SemanticGenerationRequest,
    dispatch: (request: SemanticGenerationRequest) => Promise<unknown>,
  ): Promise<{ value: CachedSemanticValue; dispatched: boolean }> {
    const cacheKey = generationKeys.cache(requestDigest);
    const lockKey = generationKeys.cacheLock(requestDigest);
    const lockOwner = `lock-${randomUUID()}`;
    const deadline = Date.now() + GENERATION_POLICY.singleflightLockTtlMs + 5_000;
    while (Date.now() < deadline) {
      const acquired = await this.#store.setValue(lockKey, lockOwner, {
        ttlSeconds: Math.ceil(GENERATION_POLICY.singleflightLockTtlMs / 1_000),
        onlyIfAbsent: true
      });
      if (acquired) {
        try {
          const raced = await this.#store.getValue(cacheKey);
          if (raced !== null) {
            const value = await parseCurrentStored(raced, request);
            if (value !== null) return { value, dispatched: false };
          }
          const value = await validateCachedSemanticValue({ candidate: await dispatch(request), request });
          await this.#store.setValue(cacheKey, JSON.stringify(value), { ttlSeconds: GENERATION_POLICY.cacheTtlSeconds });
          return { value, dispatched: true };
        } finally {
          await this.#store.deleteIfValue(lockKey, lockOwner);
        }
      }
      await this.#wait(250);
      const shared = await this.#store.getValue(cacheKey);
      if (shared !== null) {
        const value = await parseCurrentStored(shared, request);
        if (value !== null) return { value, dispatched: false };
      }
    }
    throw new Error("GENERATION_SEMANTIC_SINGLEFLIGHT_TIMEOUT");
  }
}
