import { z } from "zod";

import type { GenerationSubmissionV2 } from "../interpretation/generation-submission-v2.js";
import {
  LiveCallAttemptSchema,
  type LiveCallAttempt
} from "../interpretation/live-ledger.js";
import type { SemanticModelConfiguration } from "../interpretation/semantic-input-contracts.js";
import type { SemanticInterpretationTransportV2 } from "../interpretation/semantic-transport.js";
import type { RuntimeConfig } from "../server/generation/config.js";
import { CurrentGenerationResponseSchema } from "../server/generation/api-contracts-v2.js";
import {
  GlobalExposureStateSchema,
  type GenerationStore,
  type GlobalExposureState,
  type SessionRecord
} from "../server/generation/contracts.js";
import { executeCurrentGeneration } from "../server/generation/generation-service-v2.js";
import { GENERATION_POLICY } from "../server/generation/policy.js";
import { DispatchOnlySemanticCacheV2 } from "./dispatch-only-semantic-cache.js";

export type LiveEvaluationCase = { id: string; brief: string };

export const LiveEvaluationRunSchema = z.object({
  schemaVersion: z.literal("sketchycut-live-evaluation-run@1.0.0"),
  roundId: z.string().min(1).max(160),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }),
  exposureBefore: GlobalExposureStateSchema,
  exposureAfter: GlobalExposureStateSchema,
  ledgerAttemptDelta: z.number().int().nonnegative(),
  ledgerDispatchDelta: z.number().int().nonnegative().max(5),
  cases: z.array(z.object({
    caseId: z.string().min(1),
    outcome: z.enum(["supported", "simplified", "concept-only", "failure"]),
    networkDispatchCount: z.union([z.literal(0), z.literal(1)]),
    cacheResult: z.enum(["miss", "not-checked"]),
    response: CurrentGenerationResponseSchema,
    ledgerAttempt: LiveCallAttemptSchema
  }).strict()).length(5)
}).strict();

export type LiveEvaluationRun = z.infer<typeof LiveEvaluationRunSchema>;

function sessionRecord(input: { sessionId: string; nowMs: number }): SessionRecord {
  return {
    schemaVersion: "1.0",
    sessionId: input.sessionId,
    issuedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + GENERATION_POLICY.sessionTtlSeconds * 1_000,
    generationDispatches: 0,
    reservedExposureMicrousd: 0,
    lastDispatchAtMs: null,
    lastProjectId: null
  };
}

function sameExposure(left: GlobalExposureState, right: GlobalExposureState): boolean {
  return left.authorizedCeilingMicrousd === right.authorizedCeilingMicrousd &&
    left.reservedExposureMicrousd === right.reservedExposureMicrousd &&
    left.authorizationVersion === right.authorizationVersion;
}

function sessionRoundSegment(roundId: string): string {
  const segment = roundId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (segment.length === 0) throw new Error("LIVE_EVALUATION_ROUND_ID_HAS_NO_STABLE_SEGMENT");
  return segment;
}

function captureAppendedLedgerAttempts(store: GenerationStore): {
  store: GenerationStore;
  attempts: LiveCallAttempt[];
} {
  const attempts: LiveCallAttempt[] = [];
  const capturingStore: GenerationStore = {
    getValue: (key) => store.getValue(key),
    setValue: (key, value, options) => store.setValue(key, value, options),
    compareAndSetValue: (key, expectedValue, replacementValue, ttlSeconds) =>
      store.compareAndSetValue(key, expectedValue, replacementValue, ttlSeconds),
    deleteIfValue: (key, expectedValue) => store.deleteIfValue(key, expectedValue),
    createSession: (record, ttlSeconds) => store.createSession(record, ttlSeconds),
    ensureSession: (record, ttlSeconds) => store.ensureSession(record, ttlSeconds),
    readSession: (sessionId) => store.readSession(sessionId),
    setLastProject: (sessionId, projectId) => store.setLastProject(sessionId, projectId),
    recordAccessAttempt: (input) => store.recordAccessAttempt(input),
    consumeRouteRate: (input) => store.consumeRouteRate(input),
    reserveGeneration: (input) => store.reserveGeneration(input),
    appendLedgerAttempt: async (attemptCandidate) => {
      const attempt = LiveCallAttemptSchema.parse(attemptCandidate);
      await store.appendLedgerAttempt(attempt);
      attempts.push(structuredClone(attempt));
    },
    readLedgerAttempts: () =>
      Promise.reject(new Error("LIVE_EVALUATION_HISTORICAL_LEDGER_READ_FORBIDDEN")),
    readGlobalExposureState: () => store.readGlobalExposureState(),
    authorizeGlobalExposure: (input) => store.authorizeGlobalExposure(input),
    readExposureAuthorizations: () => store.readExposureAuthorizations()
  };
  return { store: capturingStore, attempts };
}

export async function executeLiveEvaluationRun(input: {
  roundId: string;
  cases: readonly LiveEvaluationCase[];
  expectedExposureState: GlobalExposureState;
  config: RuntimeConfig;
  store: GenerationStore;
  modelConfiguration: SemanticModelConfiguration;
  transportForCase: (liveCase: LiveEvaluationCase) => SemanticInterpretationTransportV2;
  promptHash: string;
  submissionForCase: (liveCase: LiveEvaluationCase) => GenerationSubmissionV2;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<LiveEvaluationRun> {
  if (input.cases.length !== 5 || new Set(input.cases.map((item) => item.id)).size !== 5) {
    throw new Error("LIVE_EVALUATION_EXACTLY_FIVE_UNIQUE_CASES_REQUIRED");
  }
  if (input.config.generationMode !== "live" || input.config.storeMode !== "upstash" ||
      input.config.quotaUnlimited) {
    throw new Error("LIVE_EVALUATION_DURABLE_LIVE_CONFIG_REQUIRED");
  }
  const exposureBefore = await input.store.readGlobalExposureState();
  if (!sameExposure(exposureBefore, input.expectedExposureState)) {
    throw new Error("LIVE_EVALUATION_AUTHORIZED_EXPOSURE_STATE_STALE");
  }
  const requiredExposure = 5 * GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd;
  if (exposureBefore.authorizedCeilingMicrousd - exposureBefore.reservedExposureMicrousd < requiredExposure) {
    throw new Error("LIVE_EVALUATION_GLOBAL_EXPOSURE_INSUFFICIENT");
  }
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = new Date(now()).toISOString();
  const roundSegment = sessionRoundSegment(input.roundId);
  const sessionIds = ["a", "b"].map((suffix) =>
    `live-eval-${roundSegment}-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}-${suffix}`);
  const sessions = sessionIds.map((sessionId) => sessionRecord({ sessionId, nowMs: now() }));
  for (const session of sessions) {
    await input.store.createSession(session, GENERATION_POLICY.sessionTtlSeconds);
  }
  const capturedLedger = captureAppendedLedgerAttempts(input.store);
  const caseReports: LiveEvaluationRun["cases"] = [];
  for (const [index, liveCase] of input.cases.entries()) {
    if (index > 0) await sleep(GENERATION_POLICY.generation.minimumIntervalMs);
    const sessionIndex = Math.floor(index / GENERATION_POLICY.generation.maximumDispatchesPerSession);
    const ledgerLengthBeforeCase = capturedLedger.attempts.length;
    const response = await executeCurrentGeneration({
      config: input.config,
      authenticated: {
        session: sessions[sessionIndex]!,
        clientIdentifier: `live-eval-${input.roundId}`
      },
      submission: input.submissionForCase(liveCase),
      store: capturedLedger.store,
      runtimeOrigin: "local-development",
      interpretationTransport: input.transportForCase(liveCase),
      semanticCache: new DispatchOnlySemanticCacheV2(),
      quotaClock: now,
      initiatedBy: "live-eval",
      promptHash: input.promptHash,
      evaluationModelConfiguration: input.modelConfiguration
    });
    const ledgerAttemptCandidates = capturedLedger.attempts
      .slice(ledgerLengthBeforeCase)
      .filter((item) => item.initiatedBy === "live-eval");
    if (ledgerAttemptCandidates.length !== 1) {
      throw new Error("LIVE_EVALUATION_CASE_LEDGER_CARDINALITY");
    }
    const ledgerAttempt = ledgerAttemptCandidates[0]!;
    const cacheResult = response.outcome.kind === "supported" || response.outcome.kind === "simplified"
      ? response.outcome.source.semanticProvenance.cacheResult
      : "not-checked";
    if (cacheResult !== "miss" && cacheResult !== "not-checked") {
      throw new Error("LIVE_EVALUATION_DISPATCH_CACHE_SUBSTITUTION");
    }
    caseReports.push({
      caseId: liveCase.id,
      outcome: response.outcome.kind,
      networkDispatchCount: ledgerAttempt.networkDispatchCount,
      cacheResult,
      response,
      ledgerAttempt
    });
  }
  const attempts = caseReports.map((item) => item.ledgerAttempt);
  return LiveEvaluationRunSchema.parse({
    schemaVersion: "sketchycut-live-evaluation-run@1.0.0",
    roundId: input.roundId,
    startedAt,
    completedAt: new Date(now()).toISOString(),
    exposureBefore,
    exposureAfter: await input.store.readGlobalExposureState(),
    ledgerAttemptDelta: attempts.length,
    ledgerDispatchDelta: attempts.reduce((sum, item) => sum + item.networkDispatchCount, 0),
    cases: caseReports
  });
}
