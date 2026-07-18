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
import type { M6Store } from "./contracts.js";
import { m6Keys } from "./keys.js";
import { M6_POLICY } from "./policy.js";

function cloneValue(value: CachedSemanticValueV1): CachedSemanticValueV1 {
  return CachedSemanticValueV1Schema.parse(structuredClone(value));
}

function parseStored(source: string): CachedSemanticValueV1 {
  return CachedSemanticValueV1Schema.parse(JSON.parse(source) as unknown);
}

function verifyProvenance(
  value: CachedSemanticValueV1,
  request: SemanticGenerationRequestV1,
): void {
  if (value.provenance.modelId !== request.modelConfiguration.modelId) {
    throw new Error("CACHE_MODEL_PROVENANCE_MISMATCH");
  }
  if (value.provenance.promptVersion !== request.promptVersion ||
      value.provenance.intentSchemaVersion !== request.intentSchemaVersion ||
      value.provenance.capabilityCatalogVersion !== request.capabilityCatalogVersion) {
    throw new Error("CACHE_VERSION_PROVENANCE_MISMATCH");
  }
}

export class DurableSemanticCache implements SemanticCache {
  readonly #store: M6Store;
  readonly #inflight = new Map<string, Promise<{ value: CachedSemanticValueV1; dispatched: boolean }>>();
  readonly #wait: (milliseconds: number) => Promise<void>;

  constructor(input: {
    store: M6Store;
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
    const cacheKey = m6Keys.cache(requestDigest);
    const existing = await this.#store.getValue(cacheKey);
    if (existing !== null) {
      const value = parseStored(existing);
      verifyProvenance(value, request);
      return { requestDigest, cacheResult: "hit", value: cloneValue(value) };
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
    const cacheKey = m6Keys.cache(requestDigest);
    const lockKey = m6Keys.cacheLock(requestDigest);
    const lockOwner = `lock-${randomUUID()}`;
    const deadline = Date.now() + M6_POLICY.singleflightLockTtlMs + 5_000;
    while (Date.now() < deadline) {
      const acquired = await this.#store.setValue(lockKey, lockOwner, {
        ttlSeconds: Math.ceil(M6_POLICY.singleflightLockTtlMs / 1_000),
        onlyIfAbsent: true
      });
      if (acquired) {
        try {
          const raced = await this.#store.getValue(cacheKey);
          if (raced !== null) {
            const value = parseStored(raced);
            verifyProvenance(value, request);
            return { value, dispatched: false };
          }
          const value = CachedSemanticValueV1Schema.parse(await dispatch(request));
          verifyProvenance(value, request);
          await this.#store.setValue(cacheKey, JSON.stringify(value), {
            ttlSeconds: M6_POLICY.cacheTtlSeconds
          });
          return { value, dispatched: true };
        } finally {
          await this.#store.deleteIfValue(lockKey, lockOwner);
        }
      }
      await this.#wait(250);
      const shared = await this.#store.getValue(cacheKey);
      if (shared !== null) {
        const value = parseStored(shared);
        verifyProvenance(value, request);
        return { value, dispatched: false };
      }
    }
    throw new Error("M6_SEMANTIC_SINGLEFLIGHT_TIMEOUT");
  }
}
