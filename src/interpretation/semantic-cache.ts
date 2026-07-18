import { z } from "zod";

import { Sha256Schema } from "../domain/contracts.js";
import { IntentGraphV1Schema, type IntentGraphV1 } from "./intent-graph.js";
import {
  SemanticGenerationRequestV1Schema,
  semanticRequestDigest,
  type SemanticGenerationRequestV1
} from "./semantic-request.js";

export const CachedSemanticValueV1Schema = z
  .object({
    schemaVersion: z.literal("1.0"),
    intent: IntentGraphV1Schema,
    provenance: z
      .object({
        modelId: z.string().min(1).max(120),
        responseId: z.string().min(1).max(512).nullable(),
        outputDigest: Sha256Schema,
        promptVersion: z.string().min(1).max(120),
        intentSchemaVersion: z.string().min(1).max(120),
        capabilityCatalogVersion: z.string().min(1).max(120)
      })
      .strict()
  })
  .strict();

export type CachedSemanticValueV1 = z.infer<typeof CachedSemanticValueV1Schema>;
export type CacheResolution = {
  requestDigest: string;
  cacheResult: "miss" | "hit" | "singleflight-hit";
  value: CachedSemanticValueV1;
};

export type SemanticCache = {
  resolve(
    requestCandidate: unknown,
    dispatch: (request: SemanticGenerationRequestV1) => Promise<unknown>,
  ): Promise<CacheResolution>;
};

function cloneValue(value: CachedSemanticValueV1): CachedSemanticValueV1 {
  return CachedSemanticValueV1Schema.parse(structuredClone(value));
}

export class ExactSemanticCache implements SemanticCache {
  readonly #values = new Map<string, CachedSemanticValueV1>();
  readonly #inflight = new Map<string, Promise<CachedSemanticValueV1>>();

  get size(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
    this.#inflight.clear();
  }

  async resolve(
    requestCandidate: unknown,
    dispatch: (request: SemanticGenerationRequestV1) => Promise<unknown>,
  ): Promise<CacheResolution> {
    const request = SemanticGenerationRequestV1Schema.parse(requestCandidate);
    const requestDigest = await semanticRequestDigest(request);
    const existing = this.#values.get(requestDigest);
    if (existing !== undefined) {
      return { requestDigest, cacheResult: "hit", value: cloneValue(existing) };
    }
    const active = this.#inflight.get(requestDigest);
    if (active !== undefined) {
      return {
        requestDigest,
        cacheResult: "singleflight-hit",
        value: cloneValue(await active)
      };
    }
    const work = Promise.resolve(dispatch(request)).then((candidate) => {
      const value = CachedSemanticValueV1Schema.parse(candidate);
      if (value.provenance.modelId !== request.modelConfiguration.modelId) {
        throw new Error("CACHE_MODEL_PROVENANCE_MISMATCH");
      }
      if (
        value.provenance.promptVersion !== request.promptVersion ||
        value.provenance.intentSchemaVersion !== request.intentSchemaVersion ||
        value.provenance.capabilityCatalogVersion !== request.capabilityCatalogVersion
      ) {
        throw new Error("CACHE_VERSION_PROVENANCE_MISMATCH");
      }
      this.#values.set(requestDigest, cloneValue(value));
      return value;
    });
    this.#inflight.set(requestDigest, work);
    try {
      return { requestDigest, cacheResult: "miss", value: cloneValue(await work) };
    } finally {
      this.#inflight.delete(requestDigest);
    }
  }

  inspectPrivacySafeValues(): readonly CachedSemanticValueV1[] {
    return [...this.#values.values()].map(cloneValue);
  }
}

export function strictIntentFromCacheValue(value: CachedSemanticValueV1): IntentGraphV1 {
  return IntentGraphV1Schema.parse(value.intent);
}
