import { describe, expect, it } from "vitest";

import { hashCanonical } from "../../src/domain/hash.js";
import {
  classifySemanticReviewTriggers,
  CURRENT_BOUNDED_SEMANTIC_REVIEW_PROMPT_IDENTITY,
  CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION
} from "../../src/evaluation/bounded-semantic-review.js";
import {
  dispatchEvaluationSemanticReview,
  SEMANTIC_REVIEW_DISPATCH_EXPOSURE
} from "../../src/evaluation/semantic-review-dispatch.js";
import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION
} from "../../src/interpretation/semantic-atom-registry.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  SemanticInterpretationCandidateSchema
} from "../../src/interpretation/semantic-model-contract.js";
import {
  CURRENT_PROMPT_LAYOUT_VERSION
} from "../../src/interpretation/semantic-input-contracts.js";
import {
  CURRENT_PROMPT_IDENTITY,
  prepareSemanticGenerationRequest
} from "../../src/interpretation/semantic-request.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";

async function setup() {
  const prepared = await prepareSemanticGenerationRequest({
    brief: "Make one open rigid enclosure.",
    references: [],
    roleConstraints: [],
    promptIdentity: CURRENT_PROMPT_IDENTITY,
    promptHash: "a".repeat(64),
    modelConfiguration: {
      modelId: "gpt-5.6-sol",
      reasoningEffort: "medium",
      imageDetailPolicy: "high",
      promptLayoutVersion: CURRENT_PROMPT_LAYOUT_VERSION,
      maxOutputTokens: 6_000,
      serviceTier: "default",
      store: false
    }
  });
  const evidenceId =
    prepared.request.sourceEvidenceIndex.spans[0]!.evidenceId;
  const candidate = SemanticInterpretationCandidateSchema.parse({
    schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    items: [{
      claim: "One open rigid enclosure is semantically recoverable.",
      importance: "essential",
      evidenceBindings: [{
        evidenceId,
        aspect: "structure",
        support: "direct"
      }],
      relationships: [],
      measurements: [],
      state: "unbound",
      reason: "EVIDENCE_INSUFFICIENT",
      unsupportedSignatureIds: []
    }]
  });
  const triggerDecision = classifySemanticReviewTriggers({ candidate });
  const patch = {
    schemaVersion: CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION,
    promptIdentity: CURRENT_BOUNDED_SEMANTIC_REVIEW_PROMPT_IDENTITY,
    callACandidateDigest: await hashCanonical(candidate),
    triggerCodes: triggerDecision.triggerCodes,
    operations: [{
      kind: "replace-item-resolution" as const,
      itemId: "inventory-item-1",
      expectedItemDigest: await hashCanonical(candidate.items[0]),
      resolution: {
        state: "bound" as const,
        atoms: [{
          kind: "primary-enclosure" as const,
          enclosure: {
            quantity: null,
            priority: "must" as const,
            evidenceIds: [evidenceId]
          },
          access: {
            kind: "open-top" as const,
            priority: "must" as const,
            evidenceIds: [evidenceId]
          },
          space: {
            layout: "explicit-single-space" as const,
            priority: "must" as const,
            evidenceIds: [evidenceId]
          }
        }]
      }
    }]
  };
  const session = {
    schemaVersion: "1.0" as const,
    sessionId: "semantic-review-dispatch-session",
    issuedAtMs: 1,
    expiresAtMs: 100_000,
    generationDispatches: 0,
    reservedExposureMicrousd: 0,
    lastDispatchAtMs: null,
    lastProjectId: null
  };
  return { prepared, candidate, triggerDecision, patch, session };
}

describe("evaluation-only semantic review dispatch accounting", () => {
  it("reserves once, dispatches once, and appends one confirmed-billed Call B attempt", async () => {
    const input = await setup();
    const store = new MemoryGenerationStore(() => 10_000);
    await store.createSession(input.session, 60);
    let calls = 0;
    const result = await dispatchEvaluationSemanticReview({
      store,
      session: input.session,
      clientIdentifier: "semantic-review-client",
      request: input.prepared.request,
      callARequestDigest: input.prepared.requestDigest,
      candidate: input.candidate,
      triggerDecision: input.triggerDecision,
      deterministicDiagnostics: {
        findingCodes: ["ESSENTIAL_SEMANTIC_ITEM_UNCERTAIN"]
      },
      transport: {
        dispatch: () => {
          calls += 1;
          return Promise.resolve({
            kind: "completed" as const,
            providerRequestId: "provider-review-request",
            providerModelId: "gpt-5.6-sol",
            responseId: "response-review",
            finishState: "completed" as const,
            latencyMs: 12,
            usage: {
              inputTokens: 100,
              cachedInputTokens: 0,
              cacheWriteInputTokens: 0,
              reasoningTokens: 20,
              outputTokens: 50,
              totalTokens: 150
            },
            estimatedCostUsd: 0.002,
            requestBudgetUpperBoundUsd: 0.65,
            priceSnapshotId: "openai-public-pricing-test",
            reviewPatch: input.patch
          });
        }
      },
      reviewPromptHash: "b".repeat(64),
      runtimeOrigin: "test-recorded",
      now: () => 10_000
    });
    expect(calls).toBe(1);
    expect(result).toMatchObject({
      status: "completed",
      patch: input.patch,
      attempt: {
        initiatedBy: "live-eval",
        outcome: "completed",
        networkDispatchCount: 1,
        strictParse: "passed",
        billing: {
          state: "confirmed-billed",
          requestBudgetUpperBoundUsd: 0.65
        }
      }
    });
    expect((await store.readSession(input.session.sessionId))).toMatchObject({
      generationDispatches: 1,
      reservedExposureMicrousd: 650_000
    });
    expect(await store.readLedgerAttempts()).toHaveLength(1);
    expect(SEMANTIC_REVIEW_DISPATCH_EXPOSURE).toMatchObject({
      requestBudgetUpperBoundMicrousd: 650_000,
      automaticRetry: false,
      candidateFanOut: false,
      fallbackModel: false,
      maximumCallBPerCase: 1
    });
  });

  it("skips a correct control without reservation, transport, or ledger activity", async () => {
    const input = await setup();
    const correctCandidate = structuredClone(input.candidate);
    correctCandidate.items[0] = {
      claim: correctCandidate.items[0]!.claim,
      importance: "essential",
      evidenceBindings: correctCandidate.items[0]!.evidenceBindings,
      relationships: [],
      measurements: [],
      state: "bound",
      atoms: input.patch.operations[0]!.resolution.atoms
    };
    const decision = classifySemanticReviewTriggers({
      candidate: correctCandidate
    });
    const store = new MemoryGenerationStore(() => 10_000);
    await store.createSession(input.session, 60);
    const result = await dispatchEvaluationSemanticReview({
      store,
      session: input.session,
      clientIdentifier: "semantic-review-control",
      request: input.prepared.request,
      callARequestDigest: input.prepared.requestDigest,
      candidate: correctCandidate,
      triggerDecision: decision,
      deterministicDiagnostics: {},
      transport: {
        dispatch: () => {
          throw new Error("transport must not be called");
        }
      },
      reviewPromptHash: "b".repeat(64),
      runtimeOrigin: "test-recorded"
    });
    expect(result).toEqual({
      status: "skipped",
      patch: null,
      attempt: null
    });
    expect(await store.readLedgerAttempts()).toEqual([]);
    expect(await store.readGlobalExposureState()).toMatchObject({
      reservedExposureMicrousd: 0
    });
  });
});
