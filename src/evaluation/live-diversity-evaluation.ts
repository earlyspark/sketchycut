import { z } from "zod";

import { Sha256Schema } from "../domain/contracts.js";
import { GenerationOutcomeV2Schema } from "../interpretation/generation-outcome-v2.js";
import type { GenerationSubmissionV2 } from "../interpretation/generation-submission-v2.js";
import { LiveCallAttemptSchema } from "../interpretation/live-ledger.js";
import {
  CURRENT_IMAGE_DETAIL_POLICY,
  CURRENT_PROMPT_LAYOUT_VERSION,
  CURRENT_REASONING_EFFORT
} from "../interpretation/semantic-input-contracts.js";
import type { SemanticInterpretationTransportV2 } from "../interpretation/semantic-transport.js";
import type { RuntimeConfig } from "../server/generation/config.js";
import { GlobalExposureStateSchema, type GenerationStore, type GlobalExposureState } from "../server/generation/contracts.js";
import { GENERATION_OPENAI_MODEL } from "../server/generation/cost-envelope.js";
import { buildDiversityCaseObservation } from "./diversity-observation.js";
import { executeLiveEvaluationRun } from "./live-evaluation-runner.js";
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
    networkDispatchCount: z.union([z.literal(0), z.literal(1)]),
    cacheResult: z.enum(["miss", "not-checked"]),
    result: GenerationOutcomeV2Schema,
    ledgerAttempt: LiveCallAttemptSchema
  }).strict()).length(5)
}).strict();

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
  if (protocol.cases.some((item, index) => item.id !== input.cases[index]?.id)) {
    throw new Error("LIVE_DIVERSITY_CASE_ORDER_MISMATCH");
  }
  const run = await executeLiveEvaluationRun({
    roundId: input.roundId,
    cases: input.cases,
    expectedExposureState: input.expectedExposureState,
    config: input.config,
    store: input.store,
    modelConfiguration: {
      modelId: GENERATION_OPENAI_MODEL,
      reasoningEffort: CURRENT_REASONING_EFFORT,
      imageDetailPolicy: CURRENT_IMAGE_DETAIL_POLICY,
      promptLayoutVersion: CURRENT_PROMPT_LAYOUT_VERSION,
      maxOutputTokens: 4_000,
      serviceTier: "default",
      store: false
    },
    transportForCase: input.transportForCase,
    promptHash: input.promptHash,
    submissionForCase: input.submissionForCase,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.sleep === undefined ? {} : { sleep: input.sleep })
  });
  const scores = run.cases.map((caseReport, index) => {
    const liveCase = input.cases[index]!;
    const panelCase = protocol.cases[index]!;
    const baseline = input.baselines[liveCase.id];
    if (baseline === undefined) throw new Error(`LIVE_DIVERSITY_BASELINE_MISSING:${liveCase.id}`);
    return scoreDiversityCase({
      protocol: panelCase,
      baselineDimensions: baseline.dimensions,
      baselineTopology: baseline.topology,
      observation: buildDiversityCaseObservation({ protocol: panelCase, response: caseReport.response })
    });
  });
  return LiveDiversityRoundReportSchema.parse({
    schemaVersion: "sketchycut-live-diversity-round@1.0.0",
    roundId: input.roundId,
    panelId: protocol.panelId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    promptHash: input.promptHash,
    exposureBefore: run.exposureBefore,
    exposureAfter: run.exposureAfter,
    ledgerAttemptDelta: run.ledgerAttemptDelta,
    ledgerDispatchDelta: run.ledgerDispatchDelta,
    scores,
    summary: summarizeDiversityRound(protocol, scores),
    cases: run.cases.map((item) => ({
      caseId: item.caseId,
      outcome: item.outcome,
      networkDispatchCount: item.networkDispatchCount,
      cacheResult: item.cacheResult,
      result: item.response.outcome,
      ledgerAttempt: item.ledgerAttempt
    }))
  });
}
