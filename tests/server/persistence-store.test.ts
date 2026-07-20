import { describe, expect, it } from "vitest";

import type { LiveCallAttempt } from "../../src/interpretation/live-ledger.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import { QuotaTransportV2 } from "../../src/server/generation/quota-transport-v2.js";
import { prepareSemanticGenerationRequestV2 } from "../../src/interpretation/semantic-request-v2.js";

function cacheAttempt(overrides: Partial<LiveCallAttempt> = {}): LiveCallAttempt {
  return {
    schemaVersion: "1.0",
    attemptId: "attempt-cache-one",
    submissionId: "submission-cache-one",
    retryChainId: "retry-chain-cache-one",
    retryOfAttemptId: null,
    initiatedBy: "initial-submit",
    runtimeOrigin: "test-recorded",
    attemptOrdinal: 1,
    semanticRequestDigest: "a".repeat(64),
    promptHash: "b".repeat(64),
    schemaHash: "c".repeat(64),
    capabilityCatalogHash: "d".repeat(64),
    modelConfigurationHash: "e".repeat(64),
    modelId: "gpt-5.6-sol",
    reasoningEffort: "medium",
    clientRequestId: "client-request-cache-one",
    providerRequestId: null,
    responseId: null,
    dispatchState: "not-dispatched",
    outcome: "cache-hit",
    occurredAt: "2026-07-17T20:00:00.000Z",
    latencyMs: 2,
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
    },
    ...overrides
  };
}

describe("in-memory persistence contract", () => {
  it("provides expiring values and ownership-safe lock release", async () => {
    let now = 1_000;
    const store = new MemoryGenerationStore(() => now);
    expect(await store.setValue("key", "owner-a", { ttlSeconds: 1, onlyIfAbsent: true })).toBe(true);
    expect(await store.setValue("key", "owner-b", { ttlSeconds: 1, onlyIfAbsent: true })).toBe(false);
    expect(await store.deleteIfValue("key", "owner-b")).toBe(false);
    expect(await store.deleteIfValue("key", "owner-a")).toBe(true);
    await store.setValue("key", "value", { ttlSeconds: 1 });
    now = 2_001;
    expect(await store.getValue("key")).toBeNull();
  });

  it("applies increasing access backoff without accepting a correct code while blocked", async () => {
    const store = new MemoryGenerationStore();
    const policy = {
      key: "access",
      windowMs: 600_000,
      maximumAttempts: 6,
      baseBackoffMs: 1_000,
      maximumBackoffMs: 60_000
    };
    const first = await store.recordAccessAttempt({ ...policy, verified: false, nowMs: 1_000 });
    const second = await store.recordAccessAttempt({ ...policy, verified: false, nowMs: 2_000 });
    expect(first).toMatchObject({ allowed: false, retryAfterMs: 1_000, attemptCount: 1 });
    expect(second).toMatchObject({ allowed: false, retryAfterMs: 2_000, attemptCount: 2 });
    expect(await store.recordAccessAttempt({ ...policy, verified: true, nowMs: 3_000 })).toMatchObject({
      allowed: false,
      retryAfterMs: 1_000
    });
    expect(await store.recordAccessAttempt({ ...policy, verified: true, nowMs: 4_000 })).toMatchObject({
      allowed: true
    });
  });

  it("rate-limits routes and reserves dispatch quota, interval, client capacity, and exposure atomically", async () => {
    let now = 10_000;
    const store = new MemoryGenerationStore(() => now);
    expect((await store.consumeRouteRate({ key: "upload", nowMs: now, windowMs: 1_000, maximumRequests: 2 })).allowed).toBe(true);
    expect((await store.consumeRouteRate({ key: "upload", nowMs: now, windowMs: 1_000, maximumRequests: 2 })).allowed).toBe(true);
    expect((await store.consumeRouteRate({ key: "upload", nowMs: now, windowMs: 1_000, maximumRequests: 2 })).allowed).toBe(false);

    await store.createSession({
      schemaVersion: "1.0",
      sessionId: "session-one",
      issuedAtMs: now,
      expiresAtMs: now + 60_000,
      generationDispatches: 0,
      reservedExposureMicrousd: 0,
      lastDispatchAtMs: null,
      lastProjectId: null
    }, 60);
    const reserve = () => store.reserveGeneration({
      sessionId: "session-one",
      clientKey: "client-one",
      nowMs: now,
      minimumIntervalMs: 8_000,
      maximumSessionDispatches: 4,
      requestExposureMicrousd: 500_000,
      maximumSessionExposureMicrousd: 2_000_000,
      clientWindowMs: 60_000,
      maximumClientDispatches: 2
    });
    expect(await reserve()).toMatchObject({ allowed: true, reason: "reserved", generationDispatches: 1 });
    expect(await reserve()).toMatchObject({ allowed: false, reason: "interval", retryAfterMs: 8_000 });
    now += 8_000;
    expect(await reserve()).toMatchObject({ allowed: true, reason: "reserved", generationDispatches: 2 });
    now += 8_000;
    expect(await reserve()).toMatchObject({ allowed: false, reason: "client-rate" });

    await store.createSession({
      schemaVersion: "1.0",
      sessionId: "session-budget",
      issuedAtMs: now,
      expiresAtMs: now + 60_000,
      generationDispatches: 0,
      reservedExposureMicrousd: 0,
      lastDispatchAtMs: null,
      lastProjectId: null
    }, 60);
    const budgetInput = {
      sessionId: "session-budget",
      clientKey: "client-budget",
      minimumIntervalMs: 1,
      maximumSessionDispatches: 4,
      requestExposureMicrousd: 500_000,
      maximumSessionExposureMicrousd: 600_000,
      clientWindowMs: 60_000,
      maximumClientDispatches: 10
    };
    expect(await store.reserveGeneration({ ...budgetInput, nowMs: now })).toMatchObject({
      allowed: true,
      reason: "reserved"
    });
    now += 1;
    expect(await store.reserveGeneration({ ...budgetInput, nowMs: now })).toMatchObject({
      allowed: false,
      reason: "session-budget",
      reservedExposureMicrousd: 500_000
    });

    await store.createSession({
      schemaVersion: "1.0",
      sessionId: "session-dispatch-cap",
      issuedAtMs: now,
      expiresAtMs: now + 60_000,
      generationDispatches: 0,
      reservedExposureMicrousd: 0,
      lastDispatchAtMs: null,
      lastProjectId: null
    }, 60);
    const capInput = {
      ...budgetInput,
      sessionId: "session-dispatch-cap",
      clientKey: "client-dispatch-cap",
      maximumSessionDispatches: 1,
      maximumSessionExposureMicrousd: 2_000_000
    };
    expect((await store.reserveGeneration({ ...capInput, nowMs: now })).allowed).toBe(true);
    now += 1;
    expect(await store.reserveGeneration({ ...capInput, nowMs: now })).toMatchObject({
      allowed: false,
      reason: "session-quota",
      generationDispatches: 1
    });
  });

  it("persists the last project and refuses duplicate immutable ledger identities", async () => {
    const store = new MemoryGenerationStore();
    await store.createSession({
      schemaVersion: "1.0",
      sessionId: "session-project",
      issuedAtMs: 1,
      expiresAtMs: Date.now() + 60_000,
      generationDispatches: 0,
      reservedExposureMicrousd: 0,
      lastDispatchAtMs: null,
      lastProjectId: null
    }, 60);
    expect(await store.setLastProject("session-project", "project-one")).toBe(true);
    expect((await store.readSession("session-project"))?.lastProjectId).toBe("project-one");
    const ensured = await store.ensureSession({
      schemaVersion: "1.0",
      sessionId: "session-project",
      issuedAtMs: 1,
      expiresAtMs: Date.now() + 60_000,
      generationDispatches: 0,
      reservedExposureMicrousd: 0,
      lastDispatchAtMs: null,
      lastProjectId: null
    }, 60);
    expect(ensured.lastProjectId).toBe("project-one");
    const attempt = cacheAttempt();
    await store.appendLedgerAttempt(attempt);
    await expect(store.appendLedgerAttempt(attempt)).rejects.toThrow("GENERATION_LEDGER_DUPLICATE_IDENTITY");
    await expect(store.appendLedgerAttempt(cacheAttempt({
      attemptId: "attempt-cache-two",
      clientRequestId: attempt.clientRequestId
    }))).rejects.toThrow("GENERATION_LEDGER_DUPLICATE_IDENTITY");
    expect(await store.readLedgerAttempts()).toEqual([attempt]);
  });

  it("withholds the paid transport until an atomic quota reservation succeeds", async () => {
    const store = new MemoryGenerationStore();
    const now = Date.now();
    await store.createSession({
      schemaVersion: "1.0",
      sessionId: "session-quota-transport",
      issuedAtMs: now,
      expiresAtMs: now + 60_000,
      generationDispatches: 0,
      reservedExposureMicrousd: 0,
      lastDispatchAtMs: null,
      lastProjectId: null
    }, 60);
    let paidDispatches = 0;
    const transport = new QuotaTransportV2({
      store,
      sessionId: "session-quota-transport",
      clientIdentifier: "client-quota-transport",
      transport: {
        dispatch: () => {
          paidDispatches += 1;
          return Promise.resolve({ kind: "pre-dispatch-failure", errorCode: "FAKE_STOP" });
        }
      }
    });
    const { request } = await prepareSemanticGenerationRequestV2({
      brief: "Quota test",
      promptIdentity: "semantic-interpretation-current",
      promptHash: "b".repeat(64),
      references: [{
        referenceId: "reference-one",
        sha256: "a".repeat(64),
        mediaType: "image/png",
        width: 1,
        height: 1
      }],
      roleConstraints: [],
      modelConfiguration: {
        modelId: "gpt-5.6-sol",
        reasoningEffort: "medium",
        maxOutputTokens: 4_000,
        serviceTier: "default",
        store: false
      }
    });
    expect(await transport.dispatch({ request, clientRequestId: "request-one" })).toMatchObject({
      kind: "pre-dispatch-failure",
      errorCode: "FAKE_STOP"
    });
    expect(await transport.dispatch({ request, clientRequestId: "request-two" })).toMatchObject({
      kind: "pre-dispatch-failure",
      errorCode: "GENERATION_INTERVAL"
    });
    expect(paidDispatches).toBe(1);
  });
});
