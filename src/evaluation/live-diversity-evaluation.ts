import { z } from "zod";

import { Sha256Schema } from "../domain/contracts.js";
import { GenerationOutcomeV2Schema } from "../interpretation/generation-outcome-v2.js";
import type { GenerationSubmissionV2 } from "../interpretation/generation-submission-v2.js";
import { LiveCallAttemptSchema } from "../interpretation/live-ledger.js";
import type { SemanticInterpretationTransportV2 } from "../interpretation/semantic-transport.js";
import type { RuntimeConfig } from "../server/generation/config.js";
import {
  GlobalExposureStateSchema,
  type GenerationStore,
  type GlobalExposureState,
  type SessionRecord
} from "../server/generation/contracts.js";
import { executeCurrentGeneration } from "../server/generation/generation-service-v2.js";
import { GENERATION_POLICY } from "../server/generation/policy.js";
import { DispatchOnlySemanticCacheV2 } from "./dispatch-only-semantic-cache.js";
import { buildDiversityCaseObservation } from "./diversity-observation.js";
import {
  scoreDiversityCase,
  summarizeDiversityRound,
  validateDiversityPanelProtocol,
  type DiversityPanelProtocol,
  type ResolvedDimensionFingerprint,
  type SemanticTopologyFingerprint
} from "./semantic-diversity.js";

export type LiveDiversityCase = { id: string; brief: string };
export type LiveDiversityBaseline = {
  dimensions: ResolvedDimensionFingerprint;
  topology: SemanticTopologyFingerprint;
};

const LiveDiversityRoundReportSchema = z.object({
  schemaVersion: z.literal("sketchycut-live-diversity-round@1.0.0"),
  roundId: z.string().min(1).max(160),
  panelId: z.string().min(1).max(160),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }),
  promptHash: Sha256Schema,
  exposureBefore: GlobalExposureStateSchema,
  exposureAfter: GlobalExposureStateSchema,
  ledgerAttemptDelta: z.number().int().nonnegative(),
  ledgerDispatchDelta: z.number().int().nonnegative().max(5),
  scores: z.array(z.unknown()).length(5),
  summary: z.looseObject({ pass: z.boolean() }),
  cases: z.array(z.object({
    caseId: z.string().min(1),
    outcome: z.enum(["supported", "simplified", "concept-only", "failure"]),
    attemptId: z.string().nullable(),
    providerRequestId: z.string().nullable(),
    networkDispatchCount: z.union([z.literal(0), z.literal(1)]),
    cacheResult: z.enum(["miss", "not-checked"]),
    result: GenerationOutcomeV2Schema,
    ledgerAttempt: LiveCallAttemptSchema,
    source: z.unknown().nullable(),
    canonicalResult: z.unknown().nullable()
  }).strict()).length(5)
}).strict();

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
  const segment = roundId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (segment.length === 0) throw new Error("LIVE_DIVERSITY_ROUND_ID_HAS_NO_STABLE_ID_SEGMENT");
  return segment;
}

export async function executeLiveDiversityRound(input: {
  roundId: string;
  protocol: DiversityPanelProtocol;
  cases: readonly LiveDiversityCase[];
  baselines: Readonly<Record<string, LiveDiversityBaseline>>;
  expectedExposureState: GlobalExposureState;
  config: RuntimeConfig;
  store: GenerationStore;
  transportForCase: (liveCase: LiveDiversityCase) => SemanticInterpretationTransportV2;
  promptHash: string;
  submissionForCase: (liveCase: LiveDiversityCase) => GenerationSubmissionV2;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  const protocol = validateDiversityPanelProtocol(input.protocol);
  if (input.cases.length !== 5 || protocol.cases.length !== 5) {
    throw new Error("LIVE_DIVERSITY_EXACTLY_FIVE_CASES_REQUIRED");
  }
  if (protocol.cases.some((item, index) => item.id !== input.cases[index]?.id)) {
    throw new Error("LIVE_DIVERSITY_CASE_ORDER_MISMATCH");
  }
  if (input.config.generationMode !== "live" || input.config.storeMode !== "upstash") {
    throw new Error("LIVE_DIVERSITY_DURABLE_LIVE_CONFIG_REQUIRED");
  }
  const exposureBefore = await input.store.readGlobalExposureState();
  if (!sameExposure(exposureBefore, input.expectedExposureState)) {
    throw new Error("LIVE_DIVERSITY_AUTHORIZED_EXPOSURE_STATE_STALE");
  }
  const requiredExposure = 5 * GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd;
  if (exposureBefore.authorizedCeilingMicrousd - exposureBefore.reservedExposureMicrousd < requiredExposure) {
    throw new Error("LIVE_DIVERSITY_GLOBAL_EXPOSURE_INSUFFICIENT");
  }
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = new Date(now()).toISOString();
  const roundSegment = sessionRoundSegment(input.roundId);
  const sessionIds = [
    `live-eval-${roundSegment}-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}-a`,
    `live-eval-${roundSegment}-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}-b`
  ];
  const sessions = sessionIds.map((sessionId) => sessionRecord({ sessionId, nowMs: now() }));
  for (const session of sessions) {
    await input.store.createSession(session, GENERATION_POLICY.sessionTtlSeconds);
  }
  const scores = [];
  const caseReports = [];
  for (const [index, liveCase] of input.cases.entries()) {
    if (index > 0) await sleep(GENERATION_POLICY.generation.minimumIntervalMs);
    const sessionIndex = Math.floor(index / GENERATION_POLICY.generation.maximumDispatchesPerSession);
    const ledgerLengthBeforeCase = (await input.store.readLedgerAttempts()).length;
    const response = await executeCurrentGeneration({
      config: input.config,
      authenticated: {
        session: sessions[sessionIndex]!,
        clientIdentifier: `live-eval-${input.roundId}`
      },
      submission: input.submissionForCase(liveCase),
      store: input.store,
      runtimeOrigin: "local-development",
      interpretationTransport: input.transportForCase(liveCase),
      semanticCache: new DispatchOnlySemanticCacheV2(),
      quotaClock: now,
      initiatedBy: "live-eval",
      promptHash: input.promptHash
    });
    const panelCase = protocol.cases[index]!;
    const baseline = input.baselines[liveCase.id];
    if (baseline === undefined) throw new Error(`LIVE_DIVERSITY_BASELINE_MISSING:${liveCase.id}`);
    const observation = buildDiversityCaseObservation({ protocol: panelCase, response });
    scores.push(scoreDiversityCase({
      protocol: panelCase,
      baselineDimensions: baseline.dimensions,
      baselineTopology: baseline.topology,
      observation
    }));
    const attempt = response.outcome.kind === "failure" || response.outcome.kind === "concept-only"
      ? null
      : response.outcome.source.semanticProvenance;
    const ledgerAttemptCandidates = (await input.store.readLedgerAttempts())
      .slice(ledgerLengthBeforeCase)
      .filter((item) => item.initiatedBy === "live-eval");
    if (ledgerAttemptCandidates.length !== 1) {
      throw new Error("LIVE_DIVERSITY_CASE_LEDGER_CARDINALITY");
    }
    const ledgerAttempt = ledgerAttemptCandidates[0]!;
    caseReports.push({
      caseId: liveCase.id,
      outcome: response.outcome.kind,
      attemptId: attempt?.attemptId ??
        (response.outcome.kind === "failure" ? response.outcome.attemptId : null),
      providerRequestId: attempt?.providerRequestId ?? null,
      networkDispatchCount: ledgerAttempt.networkDispatchCount,
      cacheResult: attempt?.cacheResult ?? "not-checked",
      result: response.outcome,
      ledgerAttempt,
      source: response.outcome.source,
      canonicalResult: response.outcome.canonicalResult
    });
  }
  const roundAttempts = caseReports.map((item) => item.ledgerAttempt);
  const report = {
    schemaVersion: "sketchycut-live-diversity-round@1.0.0" as const,
    roundId: input.roundId,
    panelId: protocol.panelId,
    startedAt,
    completedAt: new Date(now()).toISOString(),
    promptHash: input.promptHash,
    exposureBefore,
    exposureAfter: await input.store.readGlobalExposureState(),
    ledgerAttemptDelta: roundAttempts.length,
    ledgerDispatchDelta: roundAttempts.reduce((sum, item) => sum + item.networkDispatchCount, 0),
    scores,
    summary: summarizeDiversityRound(protocol, scores),
    cases: caseReports
  };
  return LiveDiversityRoundReportSchema.parse(report);
}
