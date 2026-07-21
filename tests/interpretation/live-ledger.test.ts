import { describe, expect, it } from "vitest";

import {
  LiveCallAttemptSchema,
  LiveCallLedgerV1Schema,
  type LiveCallAttempt
} from "../../src/interpretation/live-ledger.js";

const digest = "a".repeat(64);
const promptHash = "b".repeat(64);
const schemaHash = "c".repeat(64);
const catalogHash = "d".repeat(64);

function ambiguousAttempt(): LiveCallAttempt {
  return {
    schemaVersion: "1.0",
    attemptId: "attempt-one",
    submissionId: "submission-one",
    retryChainId: "retry-chain-one",
    retryOfAttemptId: null,
    initiatedBy: "initial-submit",
    runtimeOrigin: "test-recorded",
    attemptOrdinal: 1,
    semanticRequestDigest: digest,
    promptHash,
    schemaHash,
    capabilityCatalogHash: catalogHash,
    modelConfigurationHash: "f".repeat(64),
    modelId: "candidate-model",
    reasoningEffort: "low",
    imageDetailPolicy: "low",
    promptLayoutVersion: "stable-prefix-v1",
    clientRequestId: "client-request-one",
    providerRequestId: null,
    providerModelId: null,
    responseId: null,
    finishState: "not-observed",
    dispatchState: "transport-handoff",
    outcome: "ambiguous-transport",
    occurredAt: "2026-07-16T16:00:00.000Z",
    latencyMs: 30_000,
    cacheResult: "miss",
    errorCode: "MODEL_CONNECTION_ERROR",
    networkDispatchCount: 1,
    strictParse: "not-attempted",
    supportStateCorrect: null,
    deterministicCompile: "not-run",
    usage: {
      status: "unavailable",
      reason: "no-response"
    },
    billing: {
      state: "potentially-billed",
      estimatedCostUsd: null,
      requestBudgetUpperBoundUsd: 0.25,
      priceSnapshotId: "pricing-snapshot"
    }
  };
}

function completedRetry(): LiveCallAttempt {
  return {
    ...ambiguousAttempt(),
    attemptId: "attempt-two",
    submissionId: "submission-two",
    retryOfAttemptId: "attempt-one",
    initiatedBy: "explicit-user-retry",
    attemptOrdinal: 2,
    clientRequestId: "client-request-two",
    providerRequestId: "provider-request-two",
    providerModelId: "candidate-model",
    responseId: "response-two",
    finishState: "completed",
    dispatchState: "response-observed",
    outcome: "completed",
    occurredAt: "2026-07-16T16:01:00.000Z",
    latencyMs: 12_000,
    errorCode: null,
    strictParse: "passed",
    supportStateCorrect: true,
    deterministicCompile: "passed",
    usage: {
      status: "reported",
      inputTokens: 1_000,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 100,
      outputTokens: 500,
      totalTokens: 1_500
    },
    billing: {
      state: "confirmed-billed",
      estimatedCostUsd: 0.08,
      requestBudgetUpperBoundUsd: 0.25,
      priceSnapshotId: "pricing-snapshot"
    }
  };
}

describe("live-call cost ledger", () => {
  it("requires an ambiguous post-handoff attempt to remain potentially billed", () => {
    expect(LiveCallAttemptSchema.parse(ambiguousAttempt()).billing.state).toBe(
      "potentially-billed",
    );
    const dishonest = ambiguousAttempt();
    dishonest.billing = {
      ...dishonest.billing,
      state: "not-applicable",
      estimatedCostUsd: 0
    };
    expect(LiveCallAttemptSchema.safeParse(dishonest).success).toBe(false);
  });

  it("links an explicit retry without erasing the ambiguous attempt", () => {
    const ledger = LiveCallLedgerV1Schema.parse({
      schemaVersion: "1.0",
      ledgerId: "ledger-one",
      attempts: [ambiguousAttempt(), completedRetry()],
      reconciliations: []
    });
    expect(ledger.attempts).toHaveLength(2);
    expect(ledger.attempts[0]!.billing.state).toBe("potentially-billed");
    expect(ledger.attempts[1]!.retryOfAttemptId).toBe("attempt-one");
    expect(ledger.attempts[1]!.clientRequestId).not.toBe(
      ledger.attempts[0]!.clientRequestId,
    );
  });

  it("appends provider reconciliation while preserving original billing uncertainty", () => {
    const ledger = LiveCallLedgerV1Schema.parse({
      schemaVersion: "1.0",
      ledgerId: "ledger-one",
      attempts: [ambiguousAttempt(), completedRetry()],
      reconciliations: [
        {
          schemaVersion: "1.0",
          reconciliationId: "reconciliation-one",
          attemptId: "attempt-one",
          source: "provider-usage-dashboard",
          reconciledAt: "2026-07-17T16:00:00.000Z",
          result: "confirmed-billed",
          actualCostUsd: 0.07,
          evidenceDigest: "e".repeat(64),
          note: "Matched by client request ID and narrow UTC usage window."
        }
      ]
    });
    expect(ledger.attempts[0]!.billing.state).toBe("potentially-billed");
    expect(ledger.reconciliations[0]!.result).toBe("confirmed-billed");
  });
});
