import { describe, expect, it } from "vitest";

import type { LiveCallAttempt } from "../../src/interpretation/live-ledger.js";
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
