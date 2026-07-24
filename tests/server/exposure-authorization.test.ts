import { describe, expect, it } from "vitest";

import type {
  BillingReconciliation,
  LiveCallAttempt
} from "../../src/interpretation/live-ledger.js";
import {
  applyReviewedExposureIncrease,
  exposureUsd,
  reviewExposureIncrease,
  summarizeLedger
} from "../../src/server/generation/exposure-authorization.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import { GENERATION_POLICY } from "../../src/server/generation/policy.js";

function cacheAttempt(input: {
  id: string;
  runtimeOrigin?: LiveCallAttempt["runtimeOrigin"];
}): LiveCallAttempt {
  return {
    schemaVersion: "1.0",
    attemptId: `attempt-${input.id}`,
    submissionId: `submission-${input.id}`,
    retryChainId: `retry-chain-${input.id}`,
    retryOfAttemptId: null,
    initiatedBy: "initial-submit",
    runtimeOrigin: input.runtimeOrigin ?? "test-recorded",
    attemptOrdinal: 1,
    semanticRequestDigest: "a".repeat(64),
    promptHash: "b".repeat(64),
    schemaHash: "c".repeat(64),
    capabilityCatalogHash: "d".repeat(64),
    modelConfigurationHash: "e".repeat(64),
    modelId: "gpt-5.6-sol",
    reasoningEffort: "medium",
    imageDetailPolicy: "low",
    promptLayoutVersion: "stable-prefix-current",
    clientRequestId: `client-request-${input.id}`,
    providerRequestId: null,
    providerModelId: null,
    responseId: null,
    finishState: "not-observed",
    dispatchState: "not-dispatched",
    outcome: "cache-hit",
    occurredAt: "2026-07-17T20:00:00.000Z",
    latencyMs: 1,
    cacheResult: "hit",
    errorCode: null,
    networkDispatchCount: 0,
    strictParse: "passed",
    supportStateCorrect: true,
    deterministicCompile: "passed",
    usage: { status: "unavailable", reason: "not-dispatched" },
    billing: {
      state: "not-applicable",
      estimatedCostUsd: 0,
      requestBudgetUpperBoundUsd: null,
      priceSnapshotId: null
    }
  };
}

function ambiguousAttempt(id: string): LiveCallAttempt {
  return {
    ...cacheAttempt({ id, runtimeOrigin: "local-development" }),
    initiatedBy: "live-eval",
    modelId: "gpt-5.6-sol",
    providerRequestId: null,
    providerModelId: null,
    responseId: null,
    finishState: "not-observed",
    dispatchState: "transport-handoff",
    outcome: "ambiguous-transport",
    latencyMs: 36,
    cacheResult: "miss",
    errorCode: "OPENAI_TRANSPORT_FAILURE",
    networkDispatchCount: 1,
    strictParse: "not-attempted",
    supportStateCorrect: null,
    deterministicCompile: "not-run",
    usage: { status: "unavailable", reason: "no-response" },
    billing: {
      state: "potentially-billed",
      estimatedCostUsd: null,
      requestBudgetUpperBoundUsd: 0.65,
      priceSnapshotId: "openai-public-pricing-2026-07-19-gpt-5-6-sol"
    }
  };
}

function reconciliation(input: {
  id: string;
  attemptId: string;
  result: BillingReconciliation["result"];
}): BillingReconciliation {
  const conclusive = input.result === "confirmed-billed" ||
    input.result === "confirmed-not-billed";
  return {
    schemaVersion: "1.0",
    reconciliationId: `reconciliation-${input.id}`,
    attemptId: input.attemptId,
    source: conclusive ? "provider-support" : "provider-usage-dashboard",
    reconciledAt: "2026-07-24T01:00:00.000Z",
    result: input.result,
    actualCostUsd: input.result === "confirmed-billed"
      ? 0.012345
      : input.result === "confirmed-not-billed"
        ? 0
        : null,
    evidenceDigest: conclusive ? "f".repeat(64) : null,
    note: `Recorded ${input.result} provider evidence.`
  };
}

async function createSession(store: MemoryGenerationStore, id: string, nowMs: number): Promise<void> {
  await store.createSession({
    schemaVersion: "1.0",
    sessionId: id,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 60_000,
    generationDispatches: 0,
    reservedExposureMicrousd: 0,
    lastDispatchAtMs: null,
    lastProjectId: null
  }, 60);
}

describe("shared global exposure", () => {
  it("allows exactly seven lifetime $0.65 reservations within the initial ceiling", async () => {
    const nowMs = 100_000;
    const store = new MemoryGenerationStore(() => nowMs);
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      createSession(store, `global-session-${String(index + 1)}`, nowMs)));
    const decisions = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      store.reserveGeneration({
        sessionId: `global-session-${String(index + 1)}`,
        clientKey: `global-client-${String(index + 1)}`,
        nowMs,
        minimumIntervalMs: 0,
        maximumSessionDispatches: 4,
        requestExposureMicrousd: GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd,
        maximumSessionExposureMicrousd: GENERATION_POLICY.generation.maximumSessionExposureMicrousd,
        clientWindowMs: 60_000,
        maximumClientDispatches: 12
      })));
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(7);
    expect(decisions[7]).toMatchObject({
      allowed: false,
      reason: "global-budget",
      globalReservedExposureMicrousd: 4_550_000
    });
    expect(await store.readGlobalExposureState()).toEqual({
      schemaVersion: "1.0",
      authorizedCeilingMicrousd: 5_000_000,
      reservedExposureMicrousd: 4_550_000,
      authorizationVersion: 0
    });
  });

  it("summarizes current attributed attempts without inventing cost", () => {
    const summary = summarizeLedger([
      cacheAttempt({ id: "local", runtimeOrigin: "local-development" }),
      cacheAttempt({ id: "recorded" })
    ]);
    expect(summary).toMatchObject({
      attemptCount: 2,
      dispatchedAttemptCount: 0,
      nonDispatchedAttemptCount: 2,
      confirmedEstimatedCostMicrousd: 0,
      unresolvedPotentiallyBilledExposureMicrousd: 0,
      runtimeOrigins: { localDevelopment: 1, testRecorded: 1 }
    });
  });

  it("clears unresolved exposure only after conclusive reconciliation without refunding reservation", async () => {
    const nowMs = 200_000;
    const store = new MemoryGenerationStore(() => nowMs);
    await createSession(store, "reconciliation-session", nowMs);
    expect(await store.reserveGeneration({
      sessionId: "reconciliation-session",
      clientKey: "reconciliation-client",
      nowMs,
      minimumIntervalMs: 0,
      maximumSessionDispatches: 4,
      requestExposureMicrousd: 650_000,
      maximumSessionExposureMicrousd: 2_600_000,
      clientWindowMs: 60_000,
      maximumClientDispatches: 12
    })).toMatchObject({
      allowed: true,
      globalReservedExposureMicrousd: 650_000
    });
    const attempt = ambiguousAttempt("reconciliation");
    await store.appendLedgerAttempt(attempt);
    expect(summarizeLedger(
      await store.readLedgerAttempts(),
      await store.readBillingReconciliations(),
    )).toMatchObject({
      confirmedEstimatedCostMicrousd: 0,
      unresolvedPotentiallyBilledExposureMicrousd: 650_000
    });

    const inconclusive = reconciliation({
      id: "inconclusive",
      attemptId: attempt.attemptId,
      result: "inconclusive"
    });
    await store.appendBillingReconciliation(inconclusive);
    expect(summarizeLedger(
      await store.readLedgerAttempts(),
      await store.readBillingReconciliations(),
    ).unresolvedPotentiallyBilledExposureMicrousd).toBe(650_000);

    const conclusive = reconciliation({
      id: "confirmed",
      attemptId: attempt.attemptId,
      result: "confirmed-billed"
    });
    await store.appendBillingReconciliation(conclusive);
    expect(summarizeLedger(
      await store.readLedgerAttempts(),
      await store.readBillingReconciliations(),
    )).toMatchObject({
      confirmedEstimatedCostMicrousd: 12_345,
      unresolvedPotentiallyBilledExposureMicrousd: 0
    });
    expect((await store.readLedgerAttempts())[0]!.billing.state).toBe(
      "potentially-billed",
    );
    expect((await store.readGlobalExposureState()).reservedExposureMicrousd)
      .toBe(650_000);
    const callerCopy = await store.readBillingReconciliations();
    callerCopy[0]!.note = "mutated caller copy";
    expect((await store.readBillingReconciliations())[0]!.note).toBe(
      inconclusive.note,
    );
    await expect(store.appendBillingReconciliation(reconciliation({
      id: "second-conclusive",
      attemptId: attempt.attemptId,
      result: "confirmed-not-billed"
    }))).rejects.toThrow(
      "GENERATION_BILLING_RECONCILIATION_ALREADY_CONCLUSIVE",
    );
  });

  it("keeps dry runs read-only and applies one immutable reviewed $5 increase", async () => {
    const store = new MemoryGenerationStore();
    await store.appendLedgerAttempt(cacheAttempt({ id: "review", runtimeOrigin: "test-recorded" }));
    const review = await reviewExposureIncrease({
      store,
      increaseMicrousd: 5_000_000,
      evidenceSha256: "f".repeat(64),
      reviewNote: "Reviewed one additional group of seven conservative reservations.",
      now: new Date("2026-07-17T21:00:00.000Z"),
      authorizationId: "exposure-review-one"
    });
    expect(review.state.authorizedCeilingMicrousd).toBe(5_000_000);
    expect(await store.readExposureAuthorizations()).toEqual([]);
    expect((await store.readGlobalExposureState()).authorizedCeilingMicrousd).toBe(5_000_000);

    const applied = await applyReviewedExposureIncrease({ store, review });
    expect(applied).toMatchObject({
      applied: true,
      reason: "applied",
      state: { authorizedCeilingMicrousd: 10_000_000, authorizationVersion: 1 }
    });
    const records = await store.readExposureAuthorizations();
    expect(records).toEqual([review.proposedAuthorization]);
    records[0]!.reviewNote = "mutated caller copy";
    expect((await store.readExposureAuthorizations())[0]!.reviewNote).toBe(
      "Reviewed one additional group of seven conservative reservations.",
    );
    expect(await applyReviewedExposureIncrease({ store, review })).toMatchObject({
      applied: false,
      reason: "duplicate-authorization"
    });
  });

  it("rejects a reviewed increase when exposure or the append-only ledger changed", async () => {
    const nowMs = Date.now();
    const store = new MemoryGenerationStore(() => nowMs);
    const review = await reviewExposureIncrease({
      store,
      increaseMicrousd: 5_000_000,
      evidenceSha256: "1".repeat(64),
      reviewNote: "Stale-state negative control.",
      authorizationId: "exposure-stale"
    });
    await store.appendLedgerAttempt(cacheAttempt({ id: "after-review" }));
    expect(await applyReviewedExposureIncrease({ store, review })).toMatchObject({
      applied: false,
      reason: "stale-state"
    });
    expect((await store.readGlobalExposureState()).authorizedCeilingMicrousd).toBe(5_000_000);
  });

  it("rejects a reviewed increase when billing reconciliation changed", async () => {
    const store = new MemoryGenerationStore();
    const attempt = ambiguousAttempt("reconciliation-stale");
    await store.appendLedgerAttempt(attempt);
    const review = await reviewExposureIncrease({
      store,
      increaseMicrousd: 5_000_000,
      evidenceSha256: "2".repeat(64),
      reviewNote: "Billing-reconciliation stale-state control.",
      authorizationId: "exposure-reconciliation-stale"
    });
    await store.appendBillingReconciliation(reconciliation({
      id: "after-review",
      attemptId: attempt.attemptId,
      result: "inconclusive"
    }));
    expect(await applyReviewedExposureIncrease({ store, review })).toMatchObject({
      applied: false,
      reason: "stale-state"
    });
  });

  it("formats reviewed values without exposing arbitrary environment secrets", () => {
    const secret = "super-secret-upstash-token";
    const lines = [
      `Current authorized ceiling: $${exposureUsd(5_000_000)}`,
      `Cumulative reserved exposure: $${exposureUsd(650_000)}`
    ].join("\n");
    expect(lines).toContain("$5.000000");
    expect(lines).not.toContain(secret);
  });
});
