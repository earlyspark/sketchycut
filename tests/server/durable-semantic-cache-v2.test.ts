import { describe, expect, it } from "vitest";

import { hashCanonical, sha256 } from "../../src/domain/hash.js";
import { prepareSemanticGenerationRequestV2 } from "../../src/interpretation/semantic-request-v2.js";
import { DurableSemanticCacheV2 } from "../../src/server/generation/durable-semantic-cache-v2.js";
import { generationKeys } from "../../src/server/generation/keys.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import { frozenSemanticFixture } from "../fixtures/intent-conditioned-construction/semantic-fixtures.js";

async function fixture() {
  const prepared = await prepareSemanticGenerationRequestV2({
    brief: "Make a private open-top catchall.", references: [], roleConstraints: [],
    promptIdentity: "current-neutral-prompt", promptHash: await sha256("fixture-prompt"),
    modelConfiguration: { modelId: "fixture-model", reasoningEffort: "low", imageDetailPolicy: "low", promptLayoutVersion: "stable-prefix-v1", maxOutputTokens: 4_000, serviceTier: "default", store: false }
  });
  const intent = frozenSemanticFixture({ caseId: "text-only-zero-reference", sourceEvidenceIndex: prepared.sourceEvidenceIndex });
  const value = {
    schemaVersion: "2.0" as const, intent,
    provenance: {
      modelId: prepared.request.modelConfiguration.modelId,
      providerModelId: "fixture-model", providerRequestId: "provider-request-v2",
      modelConfigurationHash: await hashCanonical(prepared.request.modelConfiguration),
      responseId: "response-v2", finishState: "completed",
      usage: { inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningTokens: 10, outputTokens: 20, totalTokens: 120 },
      latencyMs: 10, estimatedCostUsd: 0.001, requestBudgetUpperBoundUsd: 0.5,
      priceSnapshotId: "pricing-snapshot",
      outputDigest: await hashCanonical(intent), promptIdentity: prepared.request.promptIdentity,
      promptHash: prepared.request.promptHash, intentSchemaId: prepared.request.intentSchemaId,
      capabilityCatalogVersion: prepared.request.capabilityCatalogVersion
    }
  };
  return { prepared, value };
}

describe("current durable exact semantic cache", () => {
  it("survives an instance restart and treats obsolete bytes as a strict miss", async () => {
    const { prepared, value } = await fixture();
    const store = new MemoryGenerationStore();
    const key = generationKeys.cache(prepared.requestDigest);
    await store.setValue(key, JSON.stringify({ schemaVersion: "1.0", rawUserContent: "obsolete" }), { ttlSeconds: 60 });
    let dispatches = 0;
    const first = new DurableSemanticCacheV2({ store });
    expect((await first.resolve(prepared.request, () => { dispatches += 1; return Promise.resolve(value); })).cacheResult).toBe("miss");
    const second = new DurableSemanticCacheV2({ store });
    expect((await second.resolve(prepared.request, () => { dispatches += 1; return Promise.resolve(value); })).cacheResult).toBe("hit");
    expect(dispatches).toBe(1);
    const stored = await store.getValue(key);
    expect(stored).not.toContain(prepared.request.semanticBrief);
    expect(stored).not.toContain("rawUserContent");
    expect(stored).not.toContain("geometry");
  });
});
