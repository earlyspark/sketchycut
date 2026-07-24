import type { Redis } from "@upstash/redis";
import { describe, expect, it } from "vitest";

import type {
  BillingReconciliation,
  LiveCallAttempt
} from "../../src/interpretation/live-ledger.js";
import {
  applyReviewedExposureIncrease,
  reviewExposureIncrease
} from "../../src/server/generation/exposure-authorization.js";
import { GENERATION_POLICY } from "../../src/server/generation/policy.js";
import { UpstashGenerationStore } from "../../src/server/generation/upstash-store.js";

class RecordedAtomicRedis {
  readonly hashes = new Map<string, Map<string, string>>();
  readonly strings = new Map<string, string>();
  readonly lists = new Map<string, string[]>();

  #hash(key: string): Map<string, string> {
    const value = this.hashes.get(key) ?? new Map<string, string>();
    this.hashes.set(key, value);
    return value;
  }

  #initializeGlobal(key: string, initialCeiling: number): Map<string, string> {
    const state = this.#hash(key);
    if (!state.has("schemaVersion")) state.set("schemaVersion", "1.0");
    if (!state.has("authorizedCeilingMicrousd")) {
      state.set("authorizedCeilingMicrousd", String(initialCeiling));
    }
    if (!state.has("reservedExposureMicrousd")) state.set("reservedExposureMicrousd", "0");
    if (!state.has("authorizationVersion")) state.set("authorizationVersion", "0");
    return state;
  }

  multi() {
    const operations: (() => void)[] = [];
    return {
      hset: (key: string, fields: Record<string, unknown>) => {
        operations.push(() => {
          const target = this.#hash(key);
          for (const [name, value] of Object.entries(fields)) target.set(name, String(value));
        });
      },
      expire: () => undefined,
      exec: () => {
        for (const operation of operations) operation();
        return Promise.resolve([]);
      }
    };
  }

  hgetall(key: string): Promise<string[]> {
    return Promise.resolve([...this.#hash(key).entries()].flat());
  }

  exists(key: string): Promise<number> {
    return Promise.resolve(Number(this.hashes.has(key) || this.strings.has(key)));
  }

  hset(key: string, fields: Record<string, unknown>): Promise<number> {
    const target = this.#hash(key);
    for (const [name, value] of Object.entries(fields)) target.set(name, String(value));
    return Promise.resolve(Object.keys(fields).length);
  }

  eval(script: string, keys: string[], args: unknown[]): Promise<unknown[]> {
    if (script.includes("'schemaVersion', ARGV[1]") && script.includes("HGETALL")) {
      if (!this.hashes.has(keys[0]!)) {
        void this.hset(keys[0]!, {
          schemaVersion: args[0],
          sessionId: args[1],
          issuedAtMs: args[2],
          expiresAtMs: args[3],
          generationDispatches: args[4],
          reservedExposureMicrousd: args[5],
          lastDispatchAtMs: args[6],
          lastProjectId: args[7]
        });
      }
      return this.hgetall(keys[0]!);
    }
    if (script.includes("local verified = ARGV[6] == '1'") &&
        script.includes("'blocked'")) {
      const now = Number(args[0]);
      const window = Number(args[1]);
      const maximum = Number(args[2]);
      const base = Number(args[3]);
      const maximumBackoff = Number(args[4]);
      const verified = String(args[5]) === "1";
      const state = this.#hash(keys[0]!);
      let count = Number(state.get("count") ?? "0");
      let started = Number(state.get("started") ?? String(now));
      let blocked = Number(state.get("blocked") ?? "0");
      if (now - started >= window) {
        count = 0;
        started = now;
        blocked = 0;
      }
      if (now < blocked) {
        return Promise.resolve([0, blocked - now, count]);
      }
      if (verified && count < maximum && now >= blocked) {
        this.hashes.delete(keys[0]!);
        return Promise.resolve([1, 0, count]);
      }
      if (!verified) {
        count += 1;
        const exponent = Math.min(20, Math.max(0, count - 1));
        const delay = Math.min(maximumBackoff, base * (2 ** exponent));
        blocked = Math.max(blocked, now + delay);
        if (count >= maximum) blocked = started + window;
        state.set("count", String(count));
        state.set("started", String(started));
        state.set("blocked", String(blocked));
      }
      return Promise.resolve([0, Math.max(0, blocked - now), count]);
    }
    if (script.includes("cjson.decode(attempt_json)")) {
      if (this.strings.has(keys[0]!)) return Promise.resolve([0]);
      const attemptJson = this.strings.get(keys[2]!);
      if (attemptJson === undefined) return Promise.resolve([2]);
      const attempt = JSON.parse(attemptJson) as LiveCallAttempt;
      if (attempt.billing.state !== "potentially-billed") {
        return Promise.resolve([2]);
      }
      if (this.strings.has(keys[3]!)) return Promise.resolve([3]);
      this.strings.set(keys[0]!, String(args[0]));
      this.lists.set(
        keys[1]!,
        [...(this.lists.get(keys[1]!) ?? []), String(args[1])],
      );
      if (String(args[2]) === "1") {
        this.strings.set(keys[3]!, String(args[1]));
      }
      return Promise.resolve([1]);
    }
    if (
      script.includes("ARGV[3] == '1'") &&
      !script.includes("cjson.decode")
    ) {
      if (
        this.strings.has(keys[0]!) ||
        this.strings.has(keys[2]!) ||
        (String(args[2]) === "1" && this.strings.has(keys[3]!))
      ) {
        return Promise.resolve([0]);
      }
      this.strings.set(keys[0]!, String(args[0]));
      this.strings.set(keys[2]!, String(args[1]));
      if (String(args[2]) === "1") {
        this.strings.set(keys[3]!, String(args[1]));
      }
      this.lists.set(
        keys[1]!,
        [...(this.lists.get(keys[1]!) ?? []), String(args[1])],
      );
      return Promise.resolve([1]);
    }
    if (script.includes("expected_reconciliation_count")) {
      const state = this.#initializeGlobal(keys[0]!, Number(args[0]));
      const ceiling = Number(state.get("authorizedCeilingMicrousd"));
      const reserved = Number(state.get("reservedExposureMicrousd"));
      const version = Number(state.get("authorizationVersion"));
      if (this.strings.has(keys[1]!)) return Promise.resolve([0, 2, ceiling, reserved, version]);
      const ledgerCount = this.lists.get(keys[3]!)?.length ?? 0;
      const reconciliationCount = this.lists.get(keys[4]!)?.length ?? 0;
      if (ceiling !== Number(args[1]) || reserved !== Number(args[2]) ||
          version !== Number(args[3]) || ledgerCount !== Number(args[4]) ||
          reconciliationCount !== Number(args[5])) {
        return Promise.resolve([0, 1, ceiling, reserved, version]);
      }
      const nextCeiling = Number(args[6]);
      this.strings.set(keys[1]!, String(args[7]));
      this.lists.set(keys[2]!, [...(this.lists.get(keys[2]!) ?? []), String(args[8])]);
      state.set("authorizedCeilingMicrousd", String(nextCeiling));
      state.set("authorizationVersion", String(version + 1));
      return Promise.resolve([1, 0, nextCeiling, reserved, version + 1]);
    }
    if (script.includes("initial_global_ceiling")) {
      const now = Number(args[0]);
      const minimumInterval = Number(args[1]);
      const maxSession = Number(args[2]);
      const requestExposure = Number(args[3]);
      const maxSessionExposure = Number(args[4]);
      const clientWindow = Number(args[5]);
      const maxClient = Number(args[6]);
      const global = this.#initializeGlobal(keys[2]!, Number(args[7]));
      const globalExposure = Number(global.get("reservedExposureMicrousd"));
      const globalCeiling = Number(global.get("authorizedCeilingMicrousd"));
      const session = this.hashes.get(keys[0]!);
      if (session === undefined) return Promise.resolve([0, 1, 0, 0, 0, globalExposure]);
      const expires = Number(session.get("expiresAtMs"));
      let count = Number(session.get("generationDispatches"));
      let exposure = Number(session.get("reservedExposureMicrousd"));
      const last = Number(session.get("lastDispatchAtMs"));
      if (expires <= now) return Promise.resolve([0, 2, 0, count, exposure, globalExposure]);
      if (last >= 0 && now - last < minimumInterval) {
        return Promise.resolve([0, 3, minimumInterval - (now - last), count, exposure, globalExposure]);
      }
      if (count >= maxSession) return Promise.resolve([0, 4, 0, count, exposure, globalExposure]);
      if (exposure + requestExposure > maxSessionExposure) {
        return Promise.resolve([0, 5, 0, count, exposure, globalExposure]);
      }
      const client = this.#hash(keys[1]!);
      let clientCount = Number(client.get("count") ?? "0");
      let clientStarted = Number(client.get("started") ?? String(now));
      if (now - clientStarted >= clientWindow) {
        clientCount = 0;
        clientStarted = now;
      }
      if (clientCount >= maxClient) {
        return Promise.resolve([0, 6, clientStarted + clientWindow - now, count, exposure, globalExposure]);
      }
      if (globalExposure + requestExposure > globalCeiling) {
        return Promise.resolve([0, 7, 0, count, exposure, globalExposure]);
      }
      count += 1;
      exposure += requestExposure;
      clientCount += 1;
      const nextGlobal = globalExposure + requestExposure;
      session.set("generationDispatches", String(count));
      session.set("reservedExposureMicrousd", String(exposure));
      session.set("lastDispatchAtMs", String(now));
      client.set("count", String(clientCount));
      client.set("started", String(clientStarted));
      global.set("reservedExposureMicrousd", String(nextGlobal));
      return Promise.resolve([1, 0, 0, count, exposure, nextGlobal]);
    }
    if (script.includes("authorizationVersion") && script.includes("HSETNX")) {
      const state = this.#initializeGlobal(keys[0]!, Number(args[0]));
      return Promise.resolve([
        Number(state.get("authorizedCeilingMicrousd")),
        Number(state.get("reservedExposureMicrousd")),
        Number(state.get("authorizationVersion"))
      ]);
    }
    throw new Error("UNEXPECTED_RECORDED_REDIS_SCRIPT");
  }

  lrange(key: string): Promise<string[]> {
    return Promise.resolve([...(this.lists.get(key) ?? [])]);
  }

  mget<T>(keys: string[]): Promise<T> {
    return Promise.resolve(keys.map((key) => this.strings.get(key) ?? null) as T);
  }
}

async function session(store: UpstashGenerationStore, id: string, nowMs: number): Promise<void> {
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

function ambiguousAttempt(id: string): LiveCallAttempt {
  return {
    schemaVersion: "1.0",
    attemptId: `attempt-${id}`,
    submissionId: `submission-${id}`,
    retryChainId: `retry-chain-${id}`,
    retryOfAttemptId: null,
    initiatedBy: "live-eval",
    runtimeOrigin: "local-development",
    attemptOrdinal: 1,
    semanticRequestDigest: "a".repeat(64),
    promptHash: "b".repeat(64),
    schemaHash: "c".repeat(64),
    capabilityCatalogHash: "d".repeat(64),
    modelConfigurationHash: "e".repeat(64),
    modelId: "gpt-5.6-sol",
    reasoningEffort: "medium",
    imageDetailPolicy: "high",
    promptLayoutVersion: "stable-prefix-current-v5",
    clientRequestId: `client-request-${id}`,
    providerRequestId: null,
    providerModelId: null,
    responseId: null,
    finishState: "not-observed",
    dispatchState: "transport-handoff",
    outcome: "ambiguous-transport",
    occurredAt: "2026-07-23T22:28:13.060Z",
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
    source: "provider-usage-dashboard",
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

describe("Upstash atomic scripts", () => {
  it("matches the access backoff matrix without extending an active or full-window lockout", async () => {
    const redis = new RecordedAtomicRedis();
    const store = new UpstashGenerationStore({
      url: "https://recorded.invalid",
      token: "recorded",
      redis: redis as unknown as Redis
    });
    const input = (nowMs: number, verified: boolean) => ({
      key: "recorded-access-client",
      nowMs,
      verified,
      ...GENERATION_POLICY.access
    });
    expect(await store.recordAccessAttempt(input(0, false))).toEqual({
      allowed: false, retryAfterMs: 500, attemptCount: 1
    });
    expect(await store.recordAccessAttempt(input(250, false))).toEqual({
      allowed: false, retryAfterMs: 250, attemptCount: 1
    });
    expect(await store.recordAccessAttempt(input(500, false))).toEqual({
      allowed: false, retryAfterMs: 1_000, attemptCount: 2
    });
    expect(await store.recordAccessAttempt(input(1_500, false))).toEqual({
      allowed: false, retryAfterMs: 2_000, attemptCount: 3
    });
    expect(await store.recordAccessAttempt(input(3_500, false))).toEqual({
      allowed: false, retryAfterMs: 4_000, attemptCount: 4
    });
    expect(await store.recordAccessAttempt(input(7_500, false))).toEqual({
      allowed: false, retryAfterMs: 8_000, attemptCount: 5
    });
    expect(await store.recordAccessAttempt(input(15_500, false))).toEqual({
      allowed: false, retryAfterMs: 14_500, attemptCount: 6
    });
    expect(await store.recordAccessAttempt(input(20_000, false))).toEqual({
      allowed: false, retryAfterMs: 10_000, attemptCount: 6
    });
    expect(await store.recordAccessAttempt(input(29_999, true))).toEqual({
      allowed: false, retryAfterMs: 1, attemptCount: 6
    });
    expect(await store.recordAccessAttempt(input(30_000, true))).toEqual({
      allowed: true, retryAfterMs: 0, attemptCount: 0
    });
  });

  it("initializes a stateless-token session once without resetting durable state", async () => {
    const redis = new RecordedAtomicRedis();
    const store = new UpstashGenerationStore({
      url: "https://recorded.invalid",
      token: "recorded",
      redis: redis as unknown as Redis
    });
    const candidate = {
      schemaVersion: "1.0" as const,
      sessionId: "upstash-lazy-session",
      issuedAtMs: 100,
      expiresAtMs: 60_100,
      generationDispatches: 0,
      reservedExposureMicrousd: 0,
      lastDispatchAtMs: null,
      lastProjectId: null
    };
    expect((await store.ensureSession(candidate, 60)).sessionId).toBe(candidate.sessionId);
    expect(await store.setLastProject(candidate.sessionId, "durable-project")).toBe(true);
    expect((await store.ensureSession(candidate, 60)).lastProjectId).toBe("durable-project");
  });

  it("exhausts the one shared ceiling across concurrent session/client reservations", async () => {
    const redis = new RecordedAtomicRedis();
    const store = new UpstashGenerationStore({
      url: "https://recorded.invalid",
      token: "recorded",
      redis: redis as unknown as Redis
    });
    const nowMs = 200_000;
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      session(store, `upstash-session-${String(index)}`, nowMs)));
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      store.reserveGeneration({
        sessionId: `upstash-session-${String(index)}`,
        clientKey: `upstash-client-${String(index)}`,
        nowMs,
        minimumIntervalMs: 0,
        maximumSessionDispatches: 4,
        requestExposureMicrousd: GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd,
        maximumSessionExposureMicrousd: GENERATION_POLICY.generation.maximumSessionExposureMicrousd,
        clientWindowMs: 60_000,
        maximumClientDispatches: 12
      })));
    expect(results.filter((result) => result.allowed)).toHaveLength(7);
    expect(results[7]).toMatchObject({
      reason: "global-budget",
      globalReservedExposureMicrousd: 4_550_000
    });
  });

  it("atomically appends a reviewed ceiling authorization and rejects stale state", async () => {
    const redis = new RecordedAtomicRedis();
    const store = new UpstashGenerationStore({
      url: "https://recorded.invalid",
      token: "recorded",
      redis: redis as unknown as Redis
    });
    const review = await reviewExposureIncrease({
      store,
      increaseMicrousd: 5_000_000,
      evidenceSha256: "a".repeat(64),
      reviewNote: "Recorded Upstash atomic authorization proof.",
      authorizationId: "upstash-authorization"
    });
    expect(await applyReviewedExposureIncrease({ store, review })).toMatchObject({
      applied: true,
      state: { authorizedCeilingMicrousd: 10_000_000 }
    });
    expect(await store.readExposureAuthorizations()).toEqual([review.proposedAuthorization]);

    const stale = await reviewExposureIncrease({
      store,
      increaseMicrousd: 5_000_000,
      evidenceSha256: "b".repeat(64),
      reviewNote: "Stale Upstash proof.",
      authorizationId: "upstash-stale"
    });
    const state = redis.hashes.values().next().value;
    if (state === undefined) throw new Error("Recorded global exposure state is missing.");
    state.set("reservedExposureMicrousd", "250000");
    expect(await applyReviewedExposureIncrease({ store, review: stale })).toMatchObject({
      applied: false,
      reason: "stale-state"
    });
  });

  it("appends billing reconciliation atomically without reducing reserved exposure", async () => {
    const redis = new RecordedAtomicRedis();
    const store = new UpstashGenerationStore({
      url: "https://recorded.invalid",
      token: "recorded",
      redis: redis as unknown as Redis
    });
    const nowMs = 300_000;
    await session(store, "upstash-reconciliation-session", nowMs);
    expect(await store.reserveGeneration({
      sessionId: "upstash-reconciliation-session",
      clientKey: "upstash-reconciliation-client",
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
    const attempt = ambiguousAttempt("upstash-reconciliation");
    await store.appendLedgerAttempt(attempt);
    const inconclusive = reconciliation({
      id: "upstash-inconclusive",
      attemptId: attempt.attemptId,
      result: "inconclusive"
    });
    const conclusive = reconciliation({
      id: "upstash-confirmed",
      attemptId: attempt.attemptId,
      result: "confirmed-billed"
    });
    await store.appendBillingReconciliation(inconclusive);
    await store.appendBillingReconciliation(conclusive);
    expect(await store.readBillingReconciliations()).toEqual([
      inconclusive,
      conclusive
    ]);
    expect((await store.readLedgerAttempts())[0]!.billing.state).toBe(
      "potentially-billed",
    );
    expect((await store.readGlobalExposureState()).reservedExposureMicrousd)
      .toBe(650_000);
    await expect(store.appendBillingReconciliation(reconciliation({
      id: "upstash-second-conclusive",
      attemptId: attempt.attemptId,
      result: "confirmed-not-billed"
    }))).rejects.toThrow(
      "GENERATION_BILLING_RECONCILIATION_ALREADY_CONCLUSIVE",
    );
  });
});
