import { describe, expect, it } from "vitest";

import { hashCanonical, sha256 } from "../../src/domain/hash.js";
import { ExactSemanticCacheV2 } from "../../src/interpretation/semantic-cache-v2.js";
import { prepareSemanticGenerationRequestV2 } from "../../src/interpretation/semantic-request-v2.js";
import { frozenSemanticFixture } from "../fixtures/intent-conditioned-construction/semantic-fixtures.js";

const modelConfiguration = {
  modelId: "fixture-model",
  reasoningEffort: "low" as const,
  imageDetailPolicy: "low" as const,
  promptLayoutVersion: "stable-prefix-v1" as const,
  maxOutputTokens: 4_000,
  serviceTier: "default" as const,
  store: false as const
};

async function prepared(brief = "Make an open-top catchall.") {
  return prepareSemanticGenerationRequestV2({
    brief,
    references: [],
    roleConstraints: [],
    promptIdentity: "current-neutral-prompt",
    promptHash: await sha256("fixture-prompt"),
    modelConfiguration
  });
}

async function valueFor(input: Awaited<ReturnType<typeof prepared>>) {
  const intent = frozenSemanticFixture({
    caseId: "text-only-zero-reference",
    sourceEvidenceIndex: input.sourceEvidenceIndex
  });
  return {
    schemaVersion: "2.0" as const,
    intent,
    provenance: {
      modelId: input.request.modelConfiguration.modelId,
      providerModelId: "fixture-model",
      providerRequestId: "provider-request-v2",
      modelConfigurationHash: await hashCanonical(input.request.modelConfiguration),
      responseId: "response-v2",
      finishState: "completed",
      usage: { inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningTokens: 10, outputTokens: 20, totalTokens: 120 },
      latencyMs: 10,
      estimatedCostUsd: 0.001,
      requestBudgetUpperBoundUsd: 0.5,
      priceSnapshotId: "pricing-snapshot",
      outputDigest: await hashCanonical(intent),
      promptIdentity: input.request.promptIdentity,
      promptHash: input.request.promptHash,
      intentSchemaId: input.request.intentSchemaId,
      capabilityCatalogVersion: input.request.capabilityCatalogVersion
    }
  };
}

describe("current exact semantic cache", () => {
  it("supports a strict text-only miss, hit, and singleflight without fabrication authority", async () => {
    const input = await prepared();
    const cache = new ExactSemanticCacheV2();
    let dispatches = 0;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const dispatch = async () => {
      dispatches += 1;
      await held;
      return valueFor(input);
    };
    const first = cache.resolve(input.request, dispatch);
    const follower = cache.resolve(input.request, dispatch);
    release?.();
    const resolutions = await Promise.all([first, follower]);
    expect(resolutions.map((item) => item.cacheResult).sort()).toEqual(["miss", "singleflight-hit"]);
    expect((await cache.resolve(input.request, dispatch)).cacheResult).toBe("hit");
    expect(dispatches).toBe(1);
    const serialized = JSON.stringify(cache.inspectPrivacySafeValues());
    expect(serialized).not.toContain(input.request.semanticBrief);
    expect(serialized).not.toContain("geometry");
    expect(serialized).not.toContain("validation");
  });

  it("rejects provenance drift, digest drift, and obsolete cache contracts", async () => {
    const input = await prepared();
    const valid = await valueFor(input);
    for (const candidate of [
      { ...valid, schemaVersion: "1.0" },
      { ...valid, provenance: { ...valid.provenance, promptHash: "f".repeat(64) } },
      { ...valid, provenance: { ...valid.provenance, outputDigest: "e".repeat(64) } },
      { ...valid, rawProviderResponse: "forbidden" }
    ]) {
      const cache = new ExactSemanticCacheV2();
      await expect(cache.resolve(input.request, () => Promise.resolve(candidate))).rejects.toThrow();
      expect(cache.size).toBe(0);
    }
  });

  it("keys exact semantic inputs while excluding extracted exact measurements", async () => {
    const first = await prepared("Make a tray. Project external width is 120 mm.");
    const second = await prepared("Make a tray. Project external width is 130 mm.");
    expect(first.requestDigest).toBe(second.requestDigest);
    expect(first.parsedConstraints[0]?.valueUm).toBe(120_000);
    expect(second.parsedConstraints[0]?.valueUm).toBe(130_000);
  });
});
