import { randomUUID } from "node:crypto";

import type { LiveCallAttempt } from "../src/interpretation/live-ledger.js";
import { readM6UpstashConfig } from "../src/server/m6/config.js";
import { UpstashM6Store } from "../src/server/m6/upstash-store.js";

function expect(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

const suffix = randomUUID().replaceAll("-", "");
const store = new UpstashM6Store(readM6UpstashConfig());
const valueKey = `sketchycut:m6:conformance:${suffix}:value`;
expect(await store.setValue(valueKey, "owner-a", { ttlSeconds: 30, onlyIfAbsent: true }),
  "M6_UPSTASH_SET_NX_FAILED");
expect(!await store.setValue(valueKey, "owner-b", { ttlSeconds: 30, onlyIfAbsent: true }),
  "M6_UPSTASH_SET_NX_OVERWROTE");
expect(!await store.compareAndSetValue(valueKey, "owner-b", "next", 30),
  "M6_UPSTASH_CAS_WRONG_OWNER_SUCCEEDED");
expect(await store.compareAndSetValue(valueKey, "owner-a", "next", 30),
  "M6_UPSTASH_CAS_FAILED");
expect(await store.getValue(valueKey) === "next", "M6_UPSTASH_GET_FAILED");
expect(!await store.deleteIfValue(valueKey, "owner-a"), "M6_UPSTASH_DELETE_WRONG_OWNER_SUCCEEDED");
expect(await store.deleteIfValue(valueKey, "next"), "M6_UPSTASH_DELETE_FAILED");

const now = Date.now();
const sessionId = `m6-upstash-session-${suffix}`;
await store.createSession({
  schemaVersion: "1.0",
  sessionId,
  issuedAtMs: now,
  expiresAtMs: now + 60_000,
  generationDispatches: 0,
  reservedExposureMicrousd: 0,
  lastDispatchAtMs: null,
  lastProjectId: null
}, 60);
expect((await store.readSession(sessionId))?.sessionId === sessionId,
  "M6_UPSTASH_SESSION_READ_FAILED");
expect(await store.setLastProject(sessionId, `m6-upstash-project-${suffix}`),
  "M6_UPSTASH_SESSION_PROJECT_FAILED");

const accessKey = `sketchycut:m6:conformance:${suffix}:access`;
const firstAccess = await store.recordAccessAttempt({
  key: accessKey,
  verified: false,
  nowMs: now,
  windowMs: 30_000,
  maximumAttempts: 3,
  baseBackoffMs: 10,
  maximumBackoffMs: 100
});
expect(!firstAccess.allowed && firstAccess.attemptCount === 1 && firstAccess.retryAfterMs === 10,
  "M6_UPSTASH_ACCESS_BACKOFF_FAILED");
const admittedAccess = await store.recordAccessAttempt({
  key: accessKey,
  verified: true,
  nowMs: now + 10,
  windowMs: 30_000,
  maximumAttempts: 3,
  baseBackoffMs: 10,
  maximumBackoffMs: 100
});
expect(admittedAccess.allowed, "M6_UPSTASH_ACCESS_RECOVERY_FAILED");

const routeKey = `sketchycut:m6:conformance:${suffix}:route`;
for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
  const decision = await store.consumeRouteRate({
    key: routeKey,
    nowMs: now,
    windowMs: 30_000,
    maximumRequests: 2
  });
  expect(decision.allowed === (ordinal <= 2), "M6_UPSTASH_ROUTE_RATE_FAILED");
}

const reservation = await store.reserveGeneration({
  sessionId,
  clientKey: `sketchycut:m6:conformance:${suffix}:client`,
  nowMs: now,
  minimumIntervalMs: 8_000,
  maximumSessionDispatches: 4,
  requestExposureMicrousd: 250_000,
  maximumSessionExposureMicrousd: 1_000_000,
  clientWindowMs: 30_000,
  maximumClientDispatches: 4
});
expect(reservation.allowed && reservation.reason === "reserved",
  "M6_UPSTASH_GENERATION_RESERVATION_FAILED");
const interval = await store.reserveGeneration({
  sessionId,
  clientKey: `sketchycut:m6:conformance:${suffix}:client`,
  nowMs: now,
  minimumIntervalMs: 8_000,
  maximumSessionDispatches: 4,
  requestExposureMicrousd: 250_000,
  maximumSessionExposureMicrousd: 1_000_000,
  clientWindowMs: 30_000,
  maximumClientDispatches: 4
});
expect(!interval.allowed && interval.reason === "interval",
  "M6_UPSTASH_GENERATION_INTERVAL_FAILED");

const attempt: LiveCallAttempt = {
  schemaVersion: "1.0",
  attemptId: `m6-upstash-attempt-${suffix}`,
  submissionId: `m6-upstash-submission-${suffix}`,
  retryChainId: `m6-upstash-chain-${suffix}`,
  retryOfAttemptId: null,
  initiatedBy: "initial-submit",
  attemptOrdinal: 1,
  semanticRequestDigest: "a".repeat(64),
  promptHash: "b".repeat(64),
  schemaHash: "c".repeat(64),
  capabilityCatalogHash: "d".repeat(64),
  modelConfigurationHash: "e".repeat(64),
  modelId: "gpt-5.6-terra",
  reasoningEffort: "low",
  clientRequestId: `m6-upstash-client-request-${suffix}`,
  providerRequestId: null,
  responseId: null,
  dispatchState: "not-dispatched",
  outcome: "cache-hit",
  occurredAt: new Date(now).toISOString(),
  latencyMs: 0,
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
await store.appendLedgerAttempt(attempt);
let duplicateRejected = false;
try {
  await store.appendLedgerAttempt(attempt);
} catch (error) {
  duplicateRejected = error instanceof Error && error.message === "M6_LEDGER_DUPLICATE_IDENTITY";
}
expect(duplicateRejected, "M6_UPSTASH_LEDGER_DUPLICATE_NOT_REJECTED");
expect((await store.readLedgerAttempts()).some((item) => item.attemptId === attempt.attemptId),
  "M6_UPSTASH_LEDGER_READ_FAILED");

process.stdout.write(
  "Verified live Upstash REST value ownership, CAS, session persistence, access backoff, route rate, atomic generation reservation, and immutable ledger behavior.\n",
);
