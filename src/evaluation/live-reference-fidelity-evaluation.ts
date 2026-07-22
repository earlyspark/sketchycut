import { z } from "zod";

import { Sha256Schema } from "../domain/contracts.js";
import type { GenerationSubmissionV2 } from "../interpretation/generation-submission-v2.js";
import {
  IntentConflictV2Schema,
  ReferenceBriefEntryV1Schema
} from "../interpretation/intent-graph-v2.js";
import { LiveCallAttemptSchema } from "../interpretation/live-ledger.js";
import { ObservationRealizationLedgerV1Schema } from "../interpretation/observation-realization.js";
import { RequirementRealizationLedgerV1Schema } from "../interpretation/realization-ledger.js";
import {
  SemanticModelConfigurationSchema,
  type SemanticModelConfiguration
} from "../interpretation/semantic-input-contracts.js";
import type { SemanticInterpretationTransportV2 } from "../interpretation/semantic-transport.js";
import type { RuntimeConfig } from "../server/generation/config.js";
import {
  GlobalExposureStateSchema,
  type GenerationStore,
  type GlobalExposureState
} from "../server/generation/contracts.js";
import { CalibrationStudyConfigurationIdSchema } from "./calibration-campaign.js";
import {
  executeLiveEvaluationRun,
  type LiveEvaluationCase
} from "./live-evaluation-runner.js";
import {
  ReferenceFidelityCaseScoreSchema,
  scoreReferenceFidelityCase
} from "./reference-fidelity-predicates.js";
import type { ReferenceFidelityCaseContract } from "./reference-fidelity-study.js";

const PrivacySafeOutcomeSummarySchema = z.object({
  outcome: z.enum(["supported", "simplified", "concept-only", "failure"]),
  findingCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/)),
  referenceBrief: z.array(ReferenceBriefEntryV1Schema).max(3),
  conflicts: z.array(IntentConflictV2Schema).max(12),
  requirementRealization: RequirementRealizationLedgerV1Schema.nullable(),
  observationRealization: ObservationRealizationLedgerV1Schema.nullable(),
  topology: z.object({
    mechanism: z.enum(["rigid", "fixed-top-frame", "retained-pin", "captured-slide"]),
    access: z.enum(["open-top", "open-front", "covered"])
  }).strict().nullable(),
  canonicalHashes: z.object({
    documentHash: Sha256Schema,
    geometryHash: Sha256Schema,
    projectionBundleHash: Sha256Schema,
    svgGroupHash: Sha256Schema
  }).strict().nullable(),
  fabricationCandidate: z.boolean(),
  exportAllowed: z.boolean(),
  failureCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/).nullable()
}).strict();

export const LiveReferenceFidelityRoundReportSchema = z.object({
  schemaVersion: z.literal("sketchycut-reference-fidelity-round@2.0.0"),
  roundId: z.string().min(1).max(160),
  studyConfigurationId: CalibrationStudyConfigurationIdSchema,
  modelConfiguration: SemanticModelConfigurationSchema,
  promptHash: Sha256Schema,
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }),
  exposureBefore: GlobalExposureStateSchema,
  exposureAfter: GlobalExposureStateSchema,
  ledgerAttemptDelta: z.literal(5),
  ledgerDispatchDelta: z.number().int().nonnegative().max(5),
  scores: z.array(ReferenceFidelityCaseScoreSchema).length(5),
  summary: z.object({
    pass: z.boolean(),
    strictParseRate: z.number().min(0).max(1),
    outcomeAcceptanceRate: z.number().min(0).max(1),
    orderedReferenceCoverageRate: z.number().min(0).max(1),
    relationshipAcceptanceRate: z.number().min(0).max(1),
    predicateRate: z.number().min(0).max(1),
    completeCaseSet: z.boolean(),
    exactDispatchCount: z.boolean()
  }).strict(),
  cases: z.array(z.object({
    caseId: z.string().min(1),
    networkDispatchCount: z.union([z.literal(0), z.literal(1)]),
    cacheResult: z.enum(["miss", "not-checked"]),
    ledgerAttempt: LiveCallAttemptSchema,
    result: PrivacySafeOutcomeSummarySchema
  }).strict()).length(5)
}).strict();

function outcomeSummary(
  outcome: Parameters<typeof scoreReferenceFidelityCase>[0]["outcome"],
) {
  if (outcome.kind === "failure") {
    return PrivacySafeOutcomeSummarySchema.parse({
      outcome: outcome.kind,
      findingCodes: [outcome.code],
      referenceBrief: [],
      conflicts: [],
      requirementRealization: null,
      observationRealization: null,
      topology: null,
      canonicalHashes: null,
      fabricationCandidate: false,
      exportAllowed: false,
      failureCode: outcome.code
    });
  }
  const intent = outcome.kind === "concept-only" ? outcome.intent : outcome.source.intent;
  const requirementRealization = outcome.kind === "concept-only"
    ? outcome.requirementRealization
    : outcome.source.requirementRealization;
  const observationRealization = outcome.kind === "concept-only"
    ? outcome.observationRealization
    : outcome.source.observationRealization;
  const source = outcome.kind === "supported" || outcome.kind === "simplified" ? outcome.source : null;
  return PrivacySafeOutcomeSummarySchema.parse({
    outcome: outcome.kind,
    findingCodes: outcome.findingCodes,
    referenceBrief: intent.referenceBrief,
    conflicts: intent.conflicts,
    requirementRealization,
    observationRealization,
    topology: source === null ? null : {
      mechanism: source.selectedPlan.topology.mechanism,
      access: source.selectedPlan.topology.access
    },
    canonicalHashes: outcome.canonicalResult === null ? null : {
      documentHash: outcome.canonicalResult.documentHash,
      geometryHash: outcome.canonicalResult.geometryHash,
      projectionBundleHash: outcome.canonicalResult.projectionBundleHash,
      svgGroupHash: outcome.canonicalResult.svgGroupHash
    },
    fabricationCandidate: outcome.fabricationCandidate,
    exportAllowed: outcome.exportAllowed,
    failureCode: null
  });
}

function rate(values: readonly boolean[]): number {
  return values.length === 0 ? 0 : values.filter(Boolean).length / values.length;
}

export async function executeLiveReferenceFidelityRound(input: {
  roundId: string;
  studyConfigurationId: z.infer<typeof CalibrationStudyConfigurationIdSchema>;
  contracts: readonly ReferenceFidelityCaseContract[];
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
}) {
  if (input.contracts.length !== 5 || input.contracts.some((contract, index) =>
    contract.id !== input.cases[index]?.id)) {
    throw new Error("REFERENCE_FIDELITY_CASE_CONTRACT_ORDER_MISMATCH");
  }
  const run = await executeLiveEvaluationRun({
    roundId: input.roundId,
    cases: input.cases,
    expectedExposureState: input.expectedExposureState,
    config: input.config,
    store: input.store,
    modelConfiguration: input.modelConfiguration,
    transportForCase: input.transportForCase,
    promptHash: input.promptHash,
    submissionForCase: input.submissionForCase,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.sleep === undefined ? {} : { sleep: input.sleep })
  });
  const scores = run.cases.map((caseReport, index) => scoreReferenceFidelityCase({
    contract: input.contracts[index]!,
    outcome: caseReport.response.outcome
  }));
  const predicateResults = scores.flatMap((item) => item.predicateResults);
  const completeCaseSet = scores.length === 5 && scores.every((score, index) =>
    score.caseId === input.contracts[index]?.id);
  const exactDispatchCount = run.ledgerDispatchDelta === 5 &&
    run.cases.every((item) => item.networkDispatchCount === 1);
  const summary = {
    pass: completeCaseSet && exactDispatchCount && scores.every((item) => item.pass),
    strictParseRate: rate(scores.map((item) => item.strictParsePass)),
    outcomeAcceptanceRate: rate(scores.map((item) => item.outcomeAcceptancePass)),
    orderedReferenceCoverageRate: rate(scores.map((item) => item.orderedReferenceCoveragePass)),
    relationshipAcceptanceRate: rate(scores.map((item) => item.relationshipAcceptancePass)),
    predicateRate: rate(predicateResults.map((item) => item.pass)),
    completeCaseSet,
    exactDispatchCount
  };
  return LiveReferenceFidelityRoundReportSchema.parse({
    schemaVersion: "sketchycut-reference-fidelity-round@2.0.0",
    roundId: input.roundId,
    studyConfigurationId: input.studyConfigurationId,
    modelConfiguration: input.modelConfiguration,
    promptHash: input.promptHash,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    exposureBefore: run.exposureBefore,
    exposureAfter: run.exposureAfter,
    ledgerAttemptDelta: run.ledgerAttemptDelta,
    ledgerDispatchDelta: run.ledgerDispatchDelta,
    scores,
    summary,
    cases: run.cases.map((item) => ({
      caseId: item.caseId,
      networkDispatchCount: item.networkDispatchCount,
      cacheResult: item.cacheResult,
      ledgerAttempt: item.ledgerAttempt,
      result: outcomeSummary(item.response.outcome)
    }))
  });
}
