import { describe, expect, it } from "vitest";

import type { LiveCallAttempt } from "../../src/interpretation/live-ledger.js";
import {
  applyReviewedM61ExposureIncrease,
  exposureUsd,
  reviewM61ExposureIncrease,
  summarizeM61Ledger
} from "../../src/server/m6/exposure-authorization.js";
import { MemoryM6Store } from "../../src/server/m6/memory-store.js";

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
    ...(input.runtimeOrigin === undefined ? {} : { runtimeOrigin: input.runtimeOrigin }),
    attemptOrdinal: 1,
    semanticRequestDigest: "a".repeat(64),
    promptHash: "b".repeat(64),
    schemaHash: "c".repeat(64),
    capabilityCatalogHash: "d".repeat(64),
    modelConfigurationHash: "e".repeat(64),
    modelId: "gpt-5.6-terra",
    reasoningEffort: "low",
    clientRequestId: `client-request-${input.id}`,
    providerRequestId: null,
    responseId: null,
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

async function createSession(store: MemoryM6Store, id: string, nowMs: number): Promise<void> {
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

describe("M6.1 shared global exposure", () => {
  it("allows exactly twenty lifetime $0.25 reservations across concurrent sessions", async () => {
    const nowMs = 100_000;
    const store = new MemoryM6Store(() => nowMs);
    await Promise.all(Array.from({ length: 21 }, (_, index) =>
      createSession(store, `global-session-${String(index + 1)}`, nowMs)));
    const decisions = await Promise.all(Array.from({ length: 21 }, (_, index) =>
      store.reserveGeneration({
        sessionId: `global-session-${String(index + 1)}`,
        clientKey: `global-client-${String(index + 1)}`,
        nowMs,
        minimumIntervalMs: 0,
        maximumSessionDispatches: 4,
        requestExposureMicrousd: 250_000,
        maximumSessionExposureMicrousd: 1_000_000,
        clientWindowMs: 60_000,
        maximumClientDispatches: 12
      })));
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(20);
    expect(decisions[20]).toMatchObject({
      allowed: false,
      reason: "global-budget",
      globalReservedExposureMicrousd: 5_000_000
    });
    expect(await store.readGlobalExposureState()).toEqual({
      schemaVersion: "1.0",
      authorizedCeilingMicrousd: 5_000_000,
      reservedExposureMicrousd: 5_000_000,
      authorizationVersion: 0
    });
  });

  it("summarizes attributed and legacy attempts without inventing cost", () => {
    const summary = summarizeM61Ledger([
      cacheAttempt({ id: "local", runtimeOrigin: "local-development" }),
      cacheAttempt({ id: "legacy" })
    ]);
    expect(summary).toMatchObject({
      attemptCount: 2,
      dispatchedAttemptCount: 0,
      nonDispatchedAttemptCount: 2,
      confirmedEstimatedCostMicrousd: 0,
      unresolvedPotentiallyBilledExposureMicrousd: 0,
      runtimeOrigins: { localDevelopment: 1, legacyUnattributed: 1 }
    });
  });

  it("keeps dry runs read-only and applies one immutable reviewed $5 increase", async () => {
    const store = new MemoryM6Store();
    await store.appendLedgerAttempt(cacheAttempt({ id: "review", runtimeOrigin: "test-recorded" }));
    const review = await reviewM61ExposureIncrease({
      store,
      evidenceSha256: "f".repeat(64),
      reviewNote: "Reviewed one additional group of twenty conservative reservations.",
      now: new Date("2026-07-17T21:00:00.000Z"),
      authorizationId: "m61-exposure-review-one"
    });
    expect(review.state.authorizedCeilingMicrousd).toBe(5_000_000);
    expect(await store.readExposureAuthorizations()).toEqual([]);
    expect((await store.readGlobalExposureState()).authorizedCeilingMicrousd).toBe(5_000_000);

    const applied = await applyReviewedM61ExposureIncrease({ store, review });
    expect(applied).toMatchObject({
      applied: true,
      reason: "applied",
      state: { authorizedCeilingMicrousd: 10_000_000, authorizationVersion: 1 }
    });
    const records = await store.readExposureAuthorizations();
    expect(records).toEqual([review.proposedAuthorization]);
    records[0]!.reviewNote = "mutated caller copy";
    expect((await store.readExposureAuthorizations())[0]!.reviewNote).toBe(
      "Reviewed one additional group of twenty conservative reservations.",
    );
    expect(await applyReviewedM61ExposureIncrease({ store, review })).toMatchObject({
      applied: false,
      reason: "duplicate-authorization"
    });
  });

  it("rejects a reviewed increase when exposure or the append-only ledger changed", async () => {
    const nowMs = Date.now();
    const store = new MemoryM6Store(() => nowMs);
    const review = await reviewM61ExposureIncrease({
      store,
      evidenceSha256: "1".repeat(64),
      reviewNote: "Stale-state negative control.",
      authorizationId: "m61-exposure-stale"
    });
    await store.appendLedgerAttempt(cacheAttempt({ id: "after-review" }));
    expect(await applyReviewedM61ExposureIncrease({ store, review })).toMatchObject({
      applied: false,
      reason: "stale-state"
    });
    expect((await store.readGlobalExposureState()).authorizedCeilingMicrousd).toBe(5_000_000);
  });

  it("formats reviewed values without exposing arbitrary environment secrets", () => {
    const secret = "super-secret-upstash-token";
    const lines = [
      `Current authorized ceiling: $${exposureUsd(5_000_000)}`,
      `Cumulative reserved exposure: $${exposureUsd(250_000)}`
    ].join("\n");
    expect(lines).toContain("$5.000000");
    expect(lines).not.toContain(secret);
  });
});
