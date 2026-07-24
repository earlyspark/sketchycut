import { describe, expect, it } from "vitest";

import { hashCanonical, sha256 } from "../../src/domain/hash.js";
import { generationFailure } from "../../src/interpretation/generation-outcome.js";
import type { LiveCallAttempt } from "../../src/interpretation/live-ledger.js";
import { CurrentSemanticOrchestrator } from "../../src/interpretation/orchestrator.js";
import {
  CachedSemanticValueSchema,
  CURRENT_SEMANTIC_CACHE_VALUE_VERSION,
  ExactSemanticCache
} from "../../src/interpretation/semantic-cache.js";
import {
  CURRENT_PROMPT_IDENTITY,
  prepareSemanticGenerationRequest
} from "../../src/interpretation/semantic-request.js";
import { semanticInterpretationProviderSchema } from "../../src/interpretation/semantic-model-contract.js";
import type {
  SemanticInterpretationTransport,
  SemanticTransportOutcome
} from "../../src/interpretation/semantic-transport.js";
import { basicSemanticCandidate } from "../helpers/semantic-interpretation.js";

const MODEL_CONFIGURATION = {
  modelId: "fixture-model",
  reasoningEffort: "low" as const,
  imageDetailPolicy: "low" as const,
  promptLayoutVersion: "stable-prefix-current-v5" as const,
  maxOutputTokens: 6_000,
  serviceTier: "default" as const,
  store: false as const
};

async function prepared() {
  return prepareSemanticGenerationRequest({
    brief: "Make a private open-top catchall.",
    references: [],
    roleConstraints: [],
    promptIdentity: CURRENT_PROMPT_IDENTITY,
    promptHash: await sha256("fixture-prompt"),
    modelConfiguration: MODEL_CONFIGURATION
  });
}

async function cacheValue(input: Awaited<ReturnType<typeof prepared>>) {
  const candidate = basicSemanticCandidate({ sourceEvidenceIndex: input.sourceEvidenceIndex });
  return {
    schemaVersion: CURRENT_SEMANTIC_CACHE_VALUE_VERSION,
    candidate,
    provenance: {
      modelId: input.request.modelConfiguration.modelId,
      providerModelId: "fixture-model",
      providerRequestId: "provider-request",
      modelConfigurationHash: await hashCanonical(input.request.modelConfiguration),
      responseId: "response",
      finishState: "completed" as const,
      usage: { inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningTokens: 10, outputTokens: 20, totalTokens: 120 },
      latencyMs: 10,
      estimatedCostUsd: 0.001,
      requestBudgetUpperBoundUsd: 0.5,
      priceSnapshotId: "pricing-snapshot",
      outputDigest: await hashCanonical(candidate),
      promptIdentity: input.request.promptIdentity,
      promptHash: input.request.promptHash,
      semanticSchemaId: input.request.semanticSchemaId,
      atomTemplateVersion: input.request.atomTemplateVersion,
      capabilityCatalogVersion: input.request.capabilityCatalogVersion,
      unsupportedSemanticSignatureRegistryVersion:
        input.request.unsupportedSemanticSignatureRegistryVersion
    }
  };
}

class QueueTransport implements SemanticInterpretationTransport {
  count = 0;
  constructor(readonly outcomes: SemanticTransportOutcome[]) {}
  dispatch(): Promise<SemanticTransportOutcome> {
    this.count += 1;
    const next = this.outcomes.shift();
    if (next === undefined) throw new Error("UNEXPECTED_DISPATCH");
    return Promise.resolve(next);
  }
}

function completed(interpretationCandidate: unknown): SemanticTransportOutcome {
  return {
    kind: "completed",
    interpretationCandidate,
    providerRequestId: "provider-request",
    providerModelId: "fixture-model",
    responseId: "response",
    finishState: "completed",
    latencyMs: 10,
    usage: { inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningTokens: 10, outputTokens: 20, totalTokens: 120 },
    estimatedCostUsd: 0.001,
    requestBudgetUpperBoundUsd: 0.5,
    priceSnapshotId: "pricing-snapshot"
  };
}

describe("current semantic cache and one-call orchestrator", () => {
  it("strict-validates semantic cache values and singleflights without caching raw request bytes", async () => {
    const input = await prepared();
    const value = await cacheValue(input);
    const cache = new ExactSemanticCache();
    let dispatches = 0;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const dispatch = async () => {
      dispatches += 1;
      await held;
      return value;
    };
    const first = cache.resolve(input.request, dispatch);
    const follower = cache.resolve(input.request, dispatch);
    release?.();
    expect((await Promise.all([first, follower])).map((item) => item.cacheResult).sort())
      .toEqual(["miss", "singleflight-hit"]);
    expect((await cache.resolve(input.request, dispatch)).cacheResult).toBe("hit");
    expect(dispatches).toBe(1);
    expect(JSON.stringify(cache.inspectPrivacySafeValues())).not.toContain(input.request.semanticBrief);
    expect(CachedSemanticValueSchema.safeParse({
      ...value,
      schemaVersion: "3.0"
    }).success).toBe(false);

    await expect(new ExactSemanticCache().resolve(input.request, () => Promise.resolve({
      ...value,
      provenance: { ...value.provenance, outputDigest: "f".repeat(64) }
    }))).rejects.toThrow("CACHE_OUTPUT_DIGEST_MISMATCH");
  });

  it("dispatches once by default, recompiles on a cache hit, and records both attempts", async () => {
    const input = await prepared();
    const candidate = basicSemanticCandidate({ sourceEvidenceIndex: input.sourceEvidenceIndex });
    const transport = new QueueTransport([completed(candidate)]);
    const attempts: LiveCallAttempt[] = [];
    let deterministicRuns = 0;
    const orchestrator = new CurrentSemanticOrchestrator({
      cache: new ExactSemanticCache(),
      transport,
      promptHash: input.request.promptHash,
      runtimeOrigin: "test-recorded",
      transportMode: "fixture",
      dispatchExposure: { requestBudgetUpperBoundUsd: 0.5, priceSnapshotId: "pricing-snapshot" },
      appendAttempt: (attempt) => { attempts.push(attempt); return Promise.resolve(); },
      process: ({ request, attemptId }) => {
        deterministicRuns += 1;
        return Promise.resolve(generationFailure({
          requestId: `deterministic-${String(deterministicRuns)}`,
          transportMode: "fixture",
          semanticRequestDigest: request.sourceEvidenceIndex.digest,
          stage: "planning",
          code: "TEST_DETERMINISTIC_STOP",
          retryable: false,
          attemptId
        }));
      }
    });
    await orchestrator.generate({ request: input.request });
    await orchestrator.generate({ request: input.request });
    expect(transport.count).toBe(1);
    expect(deterministicRuns).toBe(2);
    expect(attempts.map((item) => item.networkDispatchCount)).toEqual([1, 0]);
    expect(attempts[0]?.schemaHash).toBe(await hashCanonical(
      semanticInterpretationProviderSchema(input.sourceEvidenceIndex),
    ));
  });

  it("does not retry ambiguous handoffs and retains potentially billed exposure", async () => {
    const input = await prepared();
    const transport = new QueueTransport([{
      kind: "ambiguous-transport",
      providerRequestId: null,
      latencyMs: 5,
      requestBudgetUpperBoundUsd: 0.5,
      priceSnapshotId: "pricing-snapshot",
      errorCode: "OPENAI_TRANSPORT_TIMEOUT"
    }]);
    const attempts: LiveCallAttempt[] = [];
    const orchestrator = new CurrentSemanticOrchestrator({
      cache: new ExactSemanticCache(),
      transport,
      promptHash: input.request.promptHash,
      runtimeOrigin: "test-recorded",
      transportMode: "live",
      dispatchExposure: { requestBudgetUpperBoundUsd: 0.5, priceSnapshotId: "pricing-snapshot" },
      appendAttempt: (attempt) => { attempts.push(attempt); return Promise.resolve(); },
      process: () => Promise.reject(new Error("must not run"))
    });
    const result = await orchestrator.generate({ request: input.request });
    expect(transport.count).toBe(1);
    expect(result.outcome).toMatchObject({ kind: "failure", retryable: true, stage: "transport" });
    expect(attempts[0]).toMatchObject({
      networkDispatchCount: 1,
      billing: { state: "potentially-billed", estimatedCostUsd: null }
    });
  });

  it("records structurally valid unsupported semantics in a separate fail-closed authorization phase", async () => {
    const input = await prepared();
    const candidate = basicSemanticCandidate({ sourceEvidenceIndex: input.sourceEvidenceIndex });
    if (candidate.items[0]?.state !== "bound") throw new Error("expected bound candidate");
    candidate.items[0].atoms.push({
      kind: "qualitative-proportion",
      targetBodyRole: "primary-enclosure",
      numeratorAxis: "height",
      denominatorAxis: "height",
      strength: "strong",
      priority: "must",
      confidence: "medium"
    });
    const transport = new QueueTransport([completed(candidate)]);
    const attempts: LiveCallAttempt[] = [];
    const orchestrator = new CurrentSemanticOrchestrator({
      cache: new ExactSemanticCache(),
      transport,
      promptHash: input.request.promptHash,
      runtimeOrigin: "test-recorded",
      transportMode: "live",
      dispatchExposure: { requestBudgetUpperBoundUsd: 0.5, priceSnapshotId: "pricing-snapshot" },
      appendAttempt: (attempt) => { attempts.push(attempt); return Promise.resolve(); },
      process: () => Promise.reject(new Error("must not run"))
    });
    const result = await orchestrator.generate({ request: input.request });
    expect(transport.count).toBe(1);
    expect(result.outcome).toMatchObject({
      kind: "failure",
      stage: "interpretation",
      code: "SEMANTIC_AUTHORIZATION_FAILED",
      retryable: false
    });
    expect(attempts[0]).toMatchObject({
      outcome: "semantic-authorization-failure",
      strictParse: "passed",
      semanticAuthorizationFindings: [
        expect.objectContaining({ code: "SEMANTIC_ATOM_INVALID" })
      ],
      networkDispatchCount: 1
    });
  });
});
