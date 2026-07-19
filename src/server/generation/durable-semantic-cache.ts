import { randomUUID } from "node:crypto";

import {
  CachedSemanticValueV1Schema,
  type CachedSemanticValueV1,
  type CacheResolution,
  type SemanticCache
} from "../../interpretation/semantic-cache.js";
import {
  SemanticGenerationRequestV1Schema,
  semanticRequestDigest,
  type SemanticGenerationRequestV1
} from "../../interpretation/semantic-request.js";
import type { GenerationStore } from "./contracts.js";
import { generationKeys } from "./keys.js";
import { GENERATION_POLICY } from "./policy.js";

function cloneValue(value: CachedSemanticValueV1): CachedSemanticValueV1 {
  return CachedSemanticValueV1Schema.parse(structuredClone(value));
}

function hasCurrentProvenance(
  value: CachedSemanticValueV1,
  request: SemanticGenerationRequestV1,
): boolean {
  if (value.provenance.modelId !== request.modelConfiguration.modelId) {
    return false;
  }
  if (value.provenance.promptVersion !== request.promptVersion ||
      value.provenance.promptHash !== request.promptHash ||
      value.provenance.intentSchemaVersion !== request.intentSchemaVersion ||
      value.provenance.capabilityCatalogVersion !== request.capabilityCatalogVersion) {
    return false;
  }
  return true;
}

function parseCurrentStored(
  source: string,
  request: SemanticGenerationRequestV1,
): CachedSemanticValueV1 | null {
  try {
    const value = CachedSemanticValueV1Schema.parse(JSON.parse(source) as unknown);
    return hasCurrentProvenance(value, request) ? value : null;
  } catch {
    return null;
  }
}

export class DurableSemanticCache implements SemanticCache {
  readonly #store: GenerationStore;
  readonly #inflight = new Map<string, Promise<{ value: CachedSemanticValueV1; dispatched: boolean }>>();
  readonly #wait: (milliseconds: number) => Promise<void>;

  constructor(input: {
    store: GenerationStore;
    wait?: (milliseconds: number) => Promise<void>;
  }) {
    this.#store = input.store;
    this.#wait = input.wait ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
  }

  async resolve(
    requestCandidate: unknown,
    dispatch: (request: SemanticGenerationRequestV1) => Promise<unknown>,
  ): Promise<CacheResolution> {
    const request = SemanticGenerationRequestV1Schema.parse(requestCandidate);
    const requestDigest = await semanticRequestDigest(request);
    const cacheKey = generationKeys.cache(requestDigest);
    const existing = await this.#store.getValue(cacheKey);
    if (existing !== null) {
      const value = parseCurrentStored(existing, request);
      if (value !== null) {
        return { requestDigest, cacheResult: "hit", value: cloneValue(value) };
      }
    }
    const local = this.#inflight.get(requestDigest);
    if (local !== undefined) {
      const resolution = await local;
      return {
        requestDigest,
        cacheResult: "singleflight-hit",
        value: cloneValue(resolution.value)
      };
    }
    const work = this.#resolveDistributedMiss(requestDigest, request, dispatch);
    this.#inflight.set(requestDigest, work);
    try {
      const resolution = await work;
      return {
        requestDigest,
        cacheResult: resolution.dispatched ? "miss" : "singleflight-hit",
        value: cloneValue(resolution.value)
      };
    } finally {
      this.#inflight.delete(requestDigest);
    }
  }

  async #resolveDistributedMiss(
    requestDigest: string,
    request: SemanticGenerationRequestV1,
    dispatch: (request: SemanticGenerationRequestV1) => Promise<unknown>,
  ): Promise<{ value: CachedSemanticValueV1; dispatched: boolean }> {
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
            const value = parseCurrentStored(raced, request);
            if (value !== null) return { value, dispatched: false };
          }
          const value = CachedSemanticValueV1Schema.parse(await dispatch(request));
          if (!hasCurrentProvenance(value, request)) {
            throw new Error("CACHE_PROVENANCE_MISMATCH");
          }
          await this.#store.setValue(cacheKey, JSON.stringify(value), {
            ttlSeconds: GENERATION_POLICY.cacheTtlSeconds
          });
          return { value, dispatched: true };
        } finally {
          await this.#store.deleteIfValue(lockKey, lockOwner);
        }
      }
      await this.#wait(250);
      const shared = await this.#store.getValue(cacheKey);
      if (shared !== null) {
        const value = parseCurrentStored(shared, request);
        if (value !== null) return { value, dispatched: false };
      }
    }
    throw new Error("GENERATION_SEMANTIC_SINGLEFLIGHT_TIMEOUT");
  }
}
