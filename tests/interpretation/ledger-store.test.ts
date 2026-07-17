import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LiveCallAttempt } from "../../src/interpretation/live-ledger.js";
import { AppendOnlyM5LedgerStore } from "../../tools/m5-ledger-store.js";
import type { M5LiveRecordingIncident } from "../../tools/m5-live-recording-incident.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true
  })));
});

function potentiallyBilledAttempt(): LiveCallAttempt {
  return {
    schemaVersion: "1.0",
    attemptId: "attempt-store-one",
    submissionId: "submission-store-one",
    retryChainId: "retry-chain-store-one",
    retryOfAttemptId: null,
    initiatedBy: "live-eval",
    attemptOrdinal: 1,
    semanticRequestDigest: "a".repeat(64),
    promptHash: "b".repeat(64),
    schemaHash: "c".repeat(64),
    capabilityCatalogHash: "d".repeat(64),
    modelConfigurationHash: "e".repeat(64),
    modelId: "candidate-model",
    reasoningEffort: "low",
    clientRequestId: "client-request-store-one",
    providerRequestId: null,
    responseId: null,
    dispatchState: "transport-handoff",
    outcome: "ambiguous-transport",
    occurredAt: "2026-07-17T12:00:00.000Z",
    latencyMs: 100,
    cacheResult: "miss",
    errorCode: "AMBIGUOUS_TRANSPORT",
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
      priceSnapshotId: null
    }
  };
}

function recordingIncident(): M5LiveRecordingIncident {
  return {
    schemaVersion: "1.0",
    incidentId: "incident-sol-revision-2-ledger-validation",
    evaluationId: "m5-live-gpt-5.6-sol-attempt-2",
    modelId: "gpt-5.6-sol",
    recordedAt: "2026-07-17T14:00:00.000Z",
    command: "npm run evaluate:m5:sol:revision-2",
    result: {
      networkDispatchCount: 1,
      providerResponseReachedLocalPipeline: true,
      strictParse: "passed",
      deterministicCompile: "passed",
      supportStateCorrect: null,
      immutableEvaluationReportWritten: false,
      ordinaryAttemptLedgerRecordWritten: false,
      terraDispatched: false
    },
    provenance: {
      clientRequestId: null,
      providerRequestId: null,
      responseId: null,
      usage: { status: "unavailable", reason: "post-response-local-recording-failure" },
      identifierReason: "Identifiers existed in process memory but were not persisted before the local ledger rejected the completed attempt."
    },
    billing: {
      state: "potentially-billed",
      estimatedCostUsd: null,
      unresolvedPotentialExposureUsd: 0.25,
      configuredPriceSnapshotId: "openai-public-pricing-2026-07-17-gpt-5.6-sol"
    },
    failure: {
      stage: "local-recording",
      code: "LOCAL_LEDGER_PRICE_SNAPSHOT_ID_VALIDATION_AFTER_COMPLETED_RESPONSE",
      stackLocation: "src/interpretation/orchestrator.ts:649 -> tools/m5-ledger-store.ts:78",
      cause: "The configured price snapshot ID contained dots and failed the ledger StableId schema after the completed response was compiled."
    },
    evidenceBasis: [
      "The thrown ZodError identifies billing.priceSnapshotId and the StableId regex.",
      "The orchestrator stack reached the successful completed-attempt append after strict parse, mapping, and deterministic compilation.",
      "No attempt-2 evaluation report or ordinary ledger attempt was written, and Terra remained undispatched."
    ],
    privacy: {
      rawReferencePersisted: false,
      rawProviderResponsePersisted: false,
      fullPromptPersisted: false,
      apiKeyPersisted: false
    },
    limitations: [
      "The model output, exact support-state result, provider identifiers, token usage, latency, and exact cost cannot be recovered from local evidence.",
      "This incident proves a completed local interpretation pipeline, not a passing frozen evaluation rubric.",
      "A further dispatch requires separate explicit builder authorization and must not reuse or overwrite revision-2 evidence."
    ]
  };
}

function completedIncidentRetry(): LiveCallAttempt {
  return {
    ...potentiallyBilledAttempt(),
    attemptId: "attempt-store-incident-retry",
    submissionId: "submission-store-incident-retry",
    retryChainId: "retry-chain-store-incident-retry",
    retryOfRecordingIncidentId: "incident-sol-revision-2-ledger-validation",
    initiatedBy: "explicit-user-retry",
    clientRequestId: "client-request-store-incident-retry",
    providerRequestId: "provider-request-store-incident-retry",
    responseId: "response-store-incident-retry",
    dispatchState: "response-observed",
    outcome: "completed",
    occurredAt: "2026-07-17T15:00:00.000Z",
    latencyMs: 800,
    errorCode: null,
    strictParse: "passed",
    supportStateCorrect: true,
    deterministicCompile: "passed",
    usage: {
      status: "reported",
      inputTokens: 100,
      cachedInputTokens: 0,
      reasoningTokens: 20,
      outputTokens: 50,
      totalTokens: 150
    },
    billing: {
      state: "confirmed-billed",
      estimatedCostUsd: 0.002,
      requestBudgetUpperBoundUsd: 0.25,
      priceSnapshotId: "openai-public-pricing-2026-07-17-gpt-5-6-sol"
    }
  };
}

describe("append-only M5 ledger store", () => {
  it("appends validated attempt and reconciliation records without rewriting prior bytes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sketchycut-ledger-"));
    temporaryRoots.push(root);
    const store = new AppendOnlyM5LedgerStore(root);
    await store.append(potentiallyBilledAttempt());
    const before = await readFile(store.filePath, "utf8");
    await store.appendReconciliation({
      schemaVersion: "1.0",
      reconciliationId: "reconciliation-store-one",
      attemptId: "attempt-store-one",
      source: "provider-usage-dashboard",
      reconciledAt: "2026-07-17T13:00:00.000Z",
      result: "confirmed-billed",
      actualCostUsd: 0.001,
      evidenceDigest: "f".repeat(64),
      note: "Matched to the attributed provider request."
    });
    const after = await readFile(store.filePath, "utf8");
    const ledger = await store.read();
    expect(after.startsWith(before)).toBe(true);
    expect(after.trim().split("\n")).toHaveLength(2);
    expect(ledger?.attempts).toHaveLength(1);
    expect(ledger?.reconciliations).toHaveLength(1);
    expect(ledger?.attempts[0]?.billing.state).toBe("potentially-billed");
    expect(ledger?.reconciliations[0]?.result).toBe("confirmed-billed");
  });

  it("records a completed response with the frozen price ID and links an explicit retry to an immutable incident", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sketchycut-ledger-"));
    temporaryRoots.push(root);
    const store = new AppendOnlyM5LedgerStore(root);
    await store.appendRecordingIncident(recordingIncident());
    await store.append(completedIncidentRetry());
    const ledger = await store.read();
    expect(ledger?.attempts).toHaveLength(1);
    expect(ledger?.attempts[0]).toMatchObject({
      outcome: "completed",
      retryOfRecordingIncidentId: "incident-sol-revision-2-ledger-validation",
      billing: {
        state: "confirmed-billed",
        priceSnapshotId: "openai-public-pricing-2026-07-17-gpt-5-6-sol"
      }
    });
    expect((await readFile(store.filePath, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  it("rejects an incident-linked retry when the referenced incident is absent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sketchycut-ledger-"));
    temporaryRoots.push(root);
    const store = new AppendOnlyM5LedgerStore(root);
    await expect(store.append(completedIncidentRetry())).rejects.toThrow(
      "M5_LEDGER_RETRY_RECORDING_INCIDENT_NOT_FOUND",
    );
  });
});
