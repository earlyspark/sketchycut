import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  LiveCallAttemptSchema,
  type LiveCallAttempt
} from "../interpretation/live-ledger.js";
import type { GenerationOutcome } from "../interpretation/generation-outcome.js";
import type { SemanticAtomKind } from "../interpretation/semantic-atom-registry.js";
import type {
  SemanticInterpretationCandidate
} from "../interpretation/semantic-model-contract.js";
import type { GenerationStore } from "../server/generation/contracts.js";
import {
  interpretationFromOutcome,
  SemanticCaseOracleScoreSchema
} from "./semantic-generalization-oracle.js";

export const SemanticEvaluationModeSchema = z.enum(["development", "acceptance"]);
export type SemanticEvaluationMode = z.infer<typeof SemanticEvaluationModeSchema>;

export const SEMANTIC_EVALUATION_POLICIES = {
  development: {
    maximumCalls: 10,
    maximumCallsPerCase: 1,
    reservedUpperBoundMicrousdPerCall: 650_000,
    maximumReservedExposureMicrousd: 6_500_000,
    failFastOnQualityFailure: false,
    automaticRetry: false,
    candidateFanOut: false,
    secondModelCall: false,
    fallbackModel: false
  },
  acceptance: {
    maximumCalls: 5,
    maximumCallsPerCase: 1,
    reservedUpperBoundMicrousdPerCall: 650_000,
    maximumReservedExposureMicrousd: 3_250_000,
    failFastOnQualityFailure: true,
    automaticRetry: false,
    candidateFanOut: false,
    secondModelCall: false,
    fallbackModel: false
  }
} as const satisfies Record<SemanticEvaluationMode, {
  maximumCalls: number;
  maximumCallsPerCase: 1;
  reservedUpperBoundMicrousdPerCall: number;
  maximumReservedExposureMicrousd: number;
  failFastOnQualityFailure: boolean;
  automaticRetry: false;
  candidateFanOut: false;
  secondModelCall: false;
  fallbackModel: false;
}>;

export const SemanticEvaluationHardAnomalyCategorySchema = z.enum([
  "schema",
  "transport",
  "privacy",
  "identity",
  "cache",
  "ledger",
  "usage",
  "billing",
  "exposure",
  "deterministic"
]);
export type SemanticEvaluationHardAnomalyCategory = z.infer<
  typeof SemanticEvaluationHardAnomalyCategorySchema
>;

export const SemanticEvaluationQualityFailureCategorySchema = z.enum([
  "semantic-authorization",
  "commitment",
  "context",
  "grounding",
  "projection-coverage",
  "prohibited-binding",
  "outcome"
]);

export const SemanticEvaluationHardAnomalySchema = z.object({
  category: SemanticEvaluationHardAnomalyCategorySchema,
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/u)
}).strict();
export type SemanticEvaluationHardAnomaly = z.infer<
  typeof SemanticEvaluationHardAnomalySchema
>;

export const SemanticEvaluationQualityFailureSchema = z.object({
  category: SemanticEvaluationQualityFailureCategorySchema,
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/u)
}).strict();
export type SemanticEvaluationQualityFailure = z.infer<
  typeof SemanticEvaluationQualityFailureSchema
>;

const OutcomeSummarySchema = z.object({
  kind: z.enum(["supported", "simplified", "modified", "concept-only", "failure"]),
  exportAllowed: z.boolean().nullable(),
  findingCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/u)),
  failureStage: z.enum([
    "input",
    "transport",
    "schema",
    "interpretation",
    "planning",
    "compilation",
    "validation",
    "persistence"
  ]).nullable(),
  failureCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/u).nullable()
}).strict();

export type SemanticEvaluationOutcomeSummary = z.infer<typeof OutcomeSummarySchema>;

const SemanticDiagnosticItemSchema = z.object({
  itemId: z.string().min(1),
  importance: z.enum(["essential", "preference", "context"]),
  aspects: z.array(z.enum(["structure", "surface", "operation", "context"])),
  atomKinds: z.array(z.string().regex(/^[a-z][a-z0-9-]+$/u)),
  uncertaintyState: z.enum(["certain", "uncertain"]),
  accountingState: z.enum([
    "context",
    "bound",
    "deferred",
    "unbound",
    "uncertain"
  ]),
  accountingReason: z.string().min(1).nullable()
}).strict();

const SemanticDiagnosticMeasurementSchema = z.object({
  measurementId: z.string().min(1),
  inventoryItemId: z.string().min(1),
  interpretation: z.enum(["exact", "approximate", "range", "ambiguous"]),
  subject: z.enum(["project", "contained-object"]),
  envelope: z.enum(["external", "internal"]).nullable(),
  axis: z.enum(["width", "depth", "height"])
}).strict();

export const SemanticEvaluationDiagnosticsSchema = z.object({
  inventoryItems: z.array(SemanticDiagnosticItemSchema),
  requirementKinds: z.array(z.string().min(1)),
  bodyRoles: z.array(z.string().min(1)),
  interfaceBehaviors: z.array(z.string().min(1)),
  accessKinds: z.array(z.string().min(1)),
  organization: z.array(z.object({
    basis: z.enum([
      "default-single-space-policy",
      "explicit-single-space",
      "explicit-count",
      "explicit-grid",
      "minimum-separated-policy"
    ]),
    desiredSpaceCount: z.number().int().min(1),
    rows: z.number().int().positive().nullable(),
    columns: z.number().int().positive().nullable()
  }).strict()),
  measurements: z.array(SemanticDiagnosticMeasurementSchema),
  blockedRequirementIds: z.array(z.string().min(1)),
  blockedInventoryItemIds: z.array(z.string().min(1))
}).strict();
export type SemanticEvaluationDiagnostics = z.infer<
  typeof SemanticEvaluationDiagnosticsSchema
>;

export function summarizeGenerationOutcome(
  outcome: GenerationOutcome,
): SemanticEvaluationOutcomeSummary {
  if (outcome.kind === "failure") {
    return OutcomeSummarySchema.parse({
      kind: outcome.kind,
      exportAllowed: null,
      findingCodes: [],
      failureStage: outcome.stage,
      failureCode: outcome.code
    });
  }
  return OutcomeSummarySchema.parse({
    kind: outcome.kind,
    exportAllowed: outcome.kind === "concept-only" ? false : outcome.exportAllowed,
    findingCodes: outcome.kind === "concept-only" ? outcome.findingCodes : outcome.findingCodes,
    failureStage: null,
    failureCode: null
  });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export type SemanticCandidateAtomKindsByItemId = ReadonlyMap<
  string,
  readonly SemanticAtomKind[]
>;

export function semanticCandidateAtomKindsByItemId(
  candidate: SemanticInterpretationCandidate,
): SemanticCandidateAtomKindsByItemId {
  return new Map(candidate.items.map((item, index) => [
    `inventory-item-${String(index + 1)}`,
    item.state === "bound"
      ? uniqueSorted(item.atoms.map((atom) => atom.kind)) as SemanticAtomKind[]
      : []
  ]));
}

export function summarizeSemanticEvaluationDiagnostics(
  outcome: GenerationOutcome,
  atomKindsByItemId: SemanticCandidateAtomKindsByItemId = new Map(),
): SemanticEvaluationDiagnostics | null {
  const interpretation = interpretationFromOutcome(outcome);
  if (interpretation === null) return null;
  const accounting = new Map(
    interpretation.projection.accounting.map((item) => [item.itemId, item]),
  );
  return SemanticEvaluationDiagnosticsSchema.parse({
    inventoryItems: interpretation.inventory.items.map((item) => {
      const record = accounting.get(item.id);
      return {
        itemId: item.id,
        importance: item.importance,
        aspects: uniqueSorted(item.aspects),
        atomKinds: uniqueSorted(atomKindsByItemId.get(item.id) ?? []),
        uncertaintyState: item.uncertainty.state,
        accountingState: item.importance === "context"
          ? "context"
          : record?.state ?? "unbound",
        accountingReason: item.importance === "context"
          ? null
          : record?.reason ?? null
      };
    }),
    requirementKinds: uniqueSorted(
      interpretation.projection.requirements.map((item) => item.kind),
    ),
    bodyRoles: uniqueSorted(
      interpretation.projection.constructionBodies.map((item) => item.role),
    ),
    interfaceBehaviors: uniqueSorted(
      interpretation.projection.interfaces.map((item) => item.behavior),
    ),
    accessKinds: uniqueSorted(
      interpretation.projection.access.map((item) => item.kind),
    ),
    organization: interpretation.projection.organization.map((item) => ({
      basis: item.basis,
      desiredSpaceCount: item.desiredSpaceCount,
      rows: item.rows,
      columns: item.columns
    })),
    measurements: interpretation.inventory.measurementTargets.map((item) => ({
      measurementId: item.id,
      inventoryItemId: item.inventoryItemId,
      interpretation: item.interpretation,
      subject: item.target.subject,
      envelope: item.target.subject === "project" ? item.target.envelope : null,
      axis: item.target.axis
    })),
    blockedRequirementIds: outcome.kind === "concept-only"
      ? uniqueSorted(outcome.blockedRequirementIds)
      : [],
    blockedInventoryItemIds: outcome.kind === "concept-only"
      ? uniqueSorted(outcome.blockedInventoryItemIds)
      : outcome.kind === "modified"
        ? uniqueSorted(outcome.omittedSemanticIds)
        : []
  });
}

export const SemanticEvaluationRawCaseResultSchema = z.object({
  caseId: z.string().min(1),
  attempts: z.array(LiveCallAttemptSchema).max(2),
  score: SemanticCaseOracleScoreSchema.nullable(),
  outcome: OutcomeSummarySchema.nullable(),
  semanticDiagnostics: SemanticEvaluationDiagnosticsSchema.nullable(),
  compiledDigest: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  sessionDispatches: z.number().int().nonnegative(),
  sessionReservedExposureMicrousd: z.number().int().nonnegative(),
  globalReservedExposureBeforeMicrousd: z.number().int().nonnegative(),
  globalReservedExposureAfterMicrousd: z.number().int().nonnegative(),
  additionalHardAnomalies: z.array(SemanticEvaluationHardAnomalySchema)
}).strict();
export type SemanticEvaluationRawCaseResult = z.infer<
  typeof SemanticEvaluationRawCaseResultSchema
>;

export const SemanticEvaluationCaseResultSchema = SemanticEvaluationRawCaseResultSchema.extend({
  schemaVersion: z.literal("sketchycut-semantic-evaluation-case@2.0.0"),
  mode: SemanticEvaluationModeSchema,
  runId: z.string().regex(/^[a-z0-9][a-z0-9-]{7,159}$/u),
  completedAt: z.iso.datetime({ offset: true }),
  qualityStatus: z.enum(["pass", "fail", "not-scored"]),
  qualityFailures: z.array(SemanticEvaluationQualityFailureSchema),
  hardAnomalies: z.array(SemanticEvaluationHardAnomalySchema)
}).strict();
export type SemanticEvaluationCaseResult = z.infer<
  typeof SemanticEvaluationCaseResultSchema
>;

const RunCountsSchema = z.object({
  selected: z.number().int().nonnegative(),
  attempted: z.number().int().nonnegative(),
  dispatched: z.number().int().nonnegative(),
  scored: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  unscored: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative()
}).strict();

export const SemanticEvaluationSummarySchema = z.object({
  schemaVersion: z.literal("sketchycut-semantic-evaluation-summary@2.0.0"),
  mode: SemanticEvaluationModeSchema,
  runId: z.string().regex(/^[a-z0-9][a-z0-9-]{7,159}$/u),
  completedAt: z.iso.datetime({ offset: true }),
  executionStatus: z.enum(["completed", "aborted", "blocked-preflight"]),
  qualityStatus: z.enum(["pass", "fail", "not-scored"]),
  selectedCaseIds: z.array(z.string().min(1)),
  attemptedCaseIds: z.array(z.string().min(1)),
  counts: RunCountsSchema,
  aggregate: z.object({
    commitmentPredicates: z.object({
      passed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative()
    }).strict(),
    contextPredicates: z.object({
      passed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative()
    }).strict(),
    prohibitedBindingPredicates: z.object({
      passed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative()
    }).strict(),
    evidenceGroundedCases: z.number().int().nonnegative(),
    projectionCoveredCases: z.number().int().nonnegative(),
    acceptedOutcomeCases: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    confirmedEstimatedCostMicrousd: z.number().int().nonnegative(),
    runOwnedReservedExposureMicrousd: z.number().int().nonnegative()
  }).strict(),
  hardStopReason: SemanticEvaluationHardAnomalySchema.nullable(),
  stoppedWithoutRetry: z.literal(true),
  historicalHeldoutCalls: z.literal(0),
  broadLiveGeneralizationClaimed: z.literal(false)
}).strict();
export type SemanticEvaluationSummary = z.infer<
  typeof SemanticEvaluationSummarySchema
>;

const FORBIDDEN_ARTIFACT_KEYS = new Set([
  "brief",
  "dataUrl",
  "interpretationCandidate",
  "modelContent",
  "prompt",
  "rawBrief",
  "referenceBytes",
  "semanticBrief"
]);

export function evaluationArtifactPrivacyIssues(value: unknown): string[] {
  const issues: string[] = [];
  const visit = (candidate: unknown, location: string): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => {
        visit(item, `${location}[${String(index)}]`);
      });
      return;
    }
    if (typeof candidate !== "object" || candidate === null) return;
    for (const [key, item] of Object.entries(candidate)) {
      const next = location.length === 0 ? key : `${location}.${key}`;
      if (FORBIDDEN_ARTIFACT_KEYS.has(key)) issues.push(next);
      visit(item, next);
    }
  };
  visit(value, "");
  return issues;
}

export function classifySemanticEvaluationCase(input: {
  mode: SemanticEvaluationMode;
  expectedCaseId: string;
  raw: SemanticEvaluationRawCaseResult;
}): {
  qualityStatus: "pass" | "fail" | "not-scored";
  qualityFailures: SemanticEvaluationQualityFailure[];
  hardAnomalies: SemanticEvaluationHardAnomaly[];
} {
  const raw = SemanticEvaluationRawCaseResultSchema.parse(input.raw);
  const hardAnomalies = [...raw.additionalHardAnomalies];
  const qualityFailures: SemanticEvaluationQualityFailure[] = [];
  const hard = (
    category: SemanticEvaluationHardAnomalyCategory,
    code: string,
  ): void => {
    hardAnomalies.push(SemanticEvaluationHardAnomalySchema.parse({ category, code }));
  };
  const quality = (
    category: z.infer<typeof SemanticEvaluationQualityFailureCategorySchema>,
    code: string,
  ): void => {
    qualityFailures.push(SemanticEvaluationQualityFailureSchema.parse({ category, code }));
  };

  if (raw.caseId !== input.expectedCaseId) hard("identity", "EVALUATION_CASE_IDENTITY_DRIFT");
  if (raw.attempts.length !== 1) hard("ledger", "EVALUATION_LEDGER_ATTRIBUTION_COUNT");
  const attempt = raw.attempts.length === 1 ? raw.attempts[0]! : null;
  if (attempt !== null) {
    if (attempt.initiatedBy !== "live-eval" || attempt.retryOfAttemptId !== null ||
        attempt.attemptOrdinal !== 1) {
      hard("ledger", "EVALUATION_RETRY_OR_INITIATOR_POLICY");
    }
    if (attempt.outcome === "cache-hit" || attempt.cacheResult !== "miss") {
      hard("cache", "EVALUATION_CACHE_SUBSTITUTION");
    }
    if (attempt.outcome === "schema-failure" || attempt.strictParse === "failed") {
      hard("schema", "EVALUATION_STRICT_SCHEMA_FAILURE");
    }
    if (attempt.outcome === "semantic-authorization-failure") {
      quality("semantic-authorization", "EVALUATION_SEMANTIC_AUTHORIZATION_FAILURE");
    }
    if (["ambiguous-transport", "provider-not-accepted", "model-failure"].includes(
      attempt.outcome,
    )) {
      hard("transport", `EVALUATION_${attempt.outcome.replaceAll("-", "_").toUpperCase()}`);
    }
    if (attempt.outcome === "pre-dispatch-failure") {
      if (attempt.errorCode === "GENERATION_GLOBAL_BUDGET") {
        hard("exposure", "EVALUATION_GLOBAL_EXPOSURE_EXHAUSTED");
      } else {
        hard("transport", "EVALUATION_PRE_DISPATCH_FAILURE");
      }
    }
    if (attempt.networkDispatchCount !== 1 ||
        attempt.dispatchState !== "response-observed") {
      hard("transport", "EVALUATION_SINGLE_DISPATCH_NOT_OBSERVED");
    }
    if (attempt.usage.status !== "reported") hard("usage", "EVALUATION_USAGE_UNREPORTED");
    if (attempt.billing.state !== "confirmed-billed" ||
        attempt.billing.estimatedCostUsd === null ||
        attempt.billing.requestBudgetUpperBoundUsd !== 0.65 ||
        attempt.billing.priceSnapshotId === null) {
      hard("billing", "EVALUATION_BILLING_UNCONFIRMED");
    }
    if (attempt.deterministicCompile === "failed") {
      hard("deterministic", "EVALUATION_DETERMINISTIC_COMPILE_FAILURE");
    }
  }

  if (raw.sessionDispatches !== 1 ||
      raw.sessionReservedExposureMicrousd !==
        SEMANTIC_EVALUATION_POLICIES[input.mode].reservedUpperBoundMicrousdPerCall ||
      raw.globalReservedExposureAfterMicrousd <
        raw.globalReservedExposureBeforeMicrousd +
          SEMANTIC_EVALUATION_POLICIES[input.mode].reservedUpperBoundMicrousdPerCall) {
    hard("exposure", "EVALUATION_RUN_OWNED_EXPOSURE_MISMATCH");
  }
  if (raw.outcome?.kind === "failure" && [
    "planning",
    "compilation",
    "validation",
    "persistence"
  ].includes(raw.outcome.failureStage ?? "")) {
    hard("deterministic", "EVALUATION_DETERMINISTIC_PIPELINE_FAILURE");
  }

  const score = raw.score;
  if (score !== null) {
    if (raw.outcome?.kind !== score.observedOutcomeKind) {
      hard("identity", "EVALUATION_OUTCOME_SCORE_MISMATCH");
    }
    if (input.mode === "acceptance" &&
        score.outcomePolicy.purpose !== "svg-acceptance") {
      hard("identity", "EVALUATION_ACCEPTANCE_OUTCOME_POLICY_MISMATCH");
    }
    if (input.mode === "acceptance" && raw.outcome?.exportAllowed !== true) {
      quality("outcome", "EVALUATION_ACCEPTANCE_EXPORT_REQUIRED");
    }
    for (const predicate of score.commitmentPredicates) {
      if (!predicate.pass) quality("commitment", predicate.code);
    }
    for (const predicate of score.contextPredicates) {
      if (!predicate.pass) quality("context", predicate.code);
    }
    for (const predicate of score.prohibitedBindingPredicates) {
      if (predicate.pass) quality("prohibited-binding", predicate.code);
    }
    if (!score.evidenceGrounded) quality("grounding", "EVALUATION_EVIDENCE_GROUNDING");
    if (!score.inventoryProjectionCoverage) {
      quality("projection-coverage", "EVALUATION_INVENTORY_PROJECTION_COVERAGE");
    }
    if (!score.outcomeAccepted) quality("outcome", "EVALUATION_OUTCOME_NOT_ACCEPTED");
    if (!score.primaryPass && qualityFailures.length === 0) {
      quality("outcome", "EVALUATION_SEMANTIC_ORACLE_FAILURE");
    }
  }

  const uniqueHard = [...new Map(hardAnomalies.map((item) => [
    `${item.category}:${item.code}`,
    SemanticEvaluationHardAnomalySchema.parse(item)
  ])).values()];
  const uniqueQuality = [...new Map(qualityFailures.map((item) => [
    `${item.category}:${item.code}`,
    SemanticEvaluationQualityFailureSchema.parse(item)
  ])).values()];
  return {
    qualityStatus: uniqueHard.length > 0
      ? "not-scored"
      : uniqueQuality.length > 0
        ? "fail"
        : score === null
          ? "not-scored"
          : "pass",
    qualityFailures: uniqueQuality,
    hardAnomalies: uniqueHard
  };
}

async function writeExclusive(file: string, value: unknown): Promise<void> {
  const privacyIssues = evaluationArtifactPrivacyIssues(value);
  if (privacyIssues.length > 0) {
    throw new Error(
      `EVALUATION_ARTIFACT_PRIVACY_VIOLATION:${privacyIssues[0] ?? "unknown"}`,
    );
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
}

function aggregateCaseResults(results: readonly SemanticEvaluationCaseResult[]) {
  const scores = results.flatMap((item) => item.score === null ? [] : [item.score]);
  const attempts = results.flatMap((item) => item.attempts);
  const commitmentPredicates = scores.flatMap((item) => item.commitmentPredicates);
  const contextPredicates = scores.flatMap((item) => item.contextPredicates);
  const prohibitedBindingPredicates = scores.flatMap(
    (item) => item.prohibitedBindingPredicates,
  );
  const reportedUsage = attempts.flatMap((attempt) =>
    attempt.usage.status === "reported" ? [attempt.usage] : [],
  );
  const confirmedCosts = attempts.flatMap((attempt) =>
    attempt.billing.state === "confirmed-billed" &&
      attempt.billing.estimatedCostUsd !== null
      ? [attempt.billing.estimatedCostUsd]
      : [],
  );
  return {
    commitmentPredicates: {
      passed: commitmentPredicates.filter((item) => item.pass).length,
      total: commitmentPredicates.length
    },
    contextPredicates: {
      passed: contextPredicates.filter((item) => item.pass).length,
      total: contextPredicates.length
    },
    prohibitedBindingPredicates: {
      passed: prohibitedBindingPredicates.filter((item) => !item.pass).length,
      total: prohibitedBindingPredicates.length
    },
    evidenceGroundedCases: scores.filter((item) => item.evidenceGrounded).length,
    projectionCoveredCases: scores.filter((item) => item.inventoryProjectionCoverage).length,
    acceptedOutcomeCases: scores.filter((item) => item.outcomeAccepted).length,
    inputTokens: reportedUsage.reduce((sum, item) => sum + item.inputTokens, 0),
    outputTokens: reportedUsage.reduce((sum, item) => sum + item.outputTokens, 0),
    reasoningTokens: reportedUsage.reduce((sum, item) => sum + item.reasoningTokens, 0),
    latencyMs: attempts.reduce((sum, item) => sum + (item.latencyMs ?? 0), 0),
    confirmedEstimatedCostMicrousd: confirmedCosts.reduce(
      (sum, value) => sum + Math.round(value * 1_000_000),
      0,
    ),
    runOwnedReservedExposureMicrousd: results.reduce(
      (sum, item) => sum + item.sessionReservedExposureMicrousd,
      0,
    )
  };
}

export class SemanticEvaluationExecutionError extends Error {
  constructor(
    readonly anomaly: SemanticEvaluationHardAnomaly,
  ) {
    super(anomaly.code);
  }
}

export async function runSemanticEvaluationBatch(input: {
  mode: SemanticEvaluationMode;
  runId: string;
  runDirectory: string;
  caseIds: readonly string[];
  executeCase: (caseId: string, index: number) => Promise<SemanticEvaluationRawCaseResult>;
  now?: () => Date;
}): Promise<SemanticEvaluationSummary> {
  const mode = SemanticEvaluationModeSchema.parse(input.mode);
  const policy = SEMANTIC_EVALUATION_POLICIES[mode];
  if (input.caseIds.length !== policy.maximumCalls ||
      input.caseIds.length > policy.maximumCalls) {
    throw new Error("EVALUATION_PROFILE_CALL_CEILING_MISMATCH");
  }
  const now = input.now ?? (() => new Date());
  await writeExclusive(path.join(input.runDirectory, "execution-start.json"), {
    schemaVersion: "sketchycut-semantic-evaluation-execution-start@1.0.0",
    mode,
    runId: input.runId,
    startedAt: now().toISOString(),
    selectedCaseIds: input.caseIds,
    automaticRetry: false,
    candidateFanOut: false,
    secondModelCall: false,
    fallbackModel: false
  });

  const results: SemanticEvaluationCaseResult[] = [];
  let hardStopReason: SemanticEvaluationHardAnomaly | null = null;
  for (const [index, caseId] of input.caseIds.entries()) {
    const caseDirectory = path.join(
      input.runDirectory,
      "cases",
      `${String(index + 1).padStart(2, "0")}-${caseId}`,
    );
    await writeExclusive(path.join(caseDirectory, "pre-dispatch.json"), {
      schemaVersion: "sketchycut-semantic-evaluation-pre-dispatch@1.0.0",
      mode,
      runId: input.runId,
      caseId,
      ordinal: index + 1,
      maximumCallsPerCase: 1,
      recordedAt: now().toISOString()
    });

    let raw: SemanticEvaluationRawCaseResult;
    try {
      raw = SemanticEvaluationRawCaseResultSchema.parse(
        await input.executeCase(caseId, index),
      );
    } catch (error) {
      const anomaly = error instanceof SemanticEvaluationExecutionError
        ? error.anomaly
        : SemanticEvaluationHardAnomalySchema.parse({
            category: "deterministic",
            code: "EVALUATION_CASE_EXECUTION_EXCEPTION"
          });
      raw = SemanticEvaluationRawCaseResultSchema.parse({
        caseId,
        attempts: [],
        score: null,
        outcome: null,
        semanticDiagnostics: null,
        compiledDigest: null,
        sessionDispatches: 0,
        sessionReservedExposureMicrousd: 0,
        globalReservedExposureBeforeMicrousd: 0,
        globalReservedExposureAfterMicrousd: 0,
        additionalHardAnomalies: [anomaly]
      });
    }
    const classified = classifySemanticEvaluationCase({
      mode,
      expectedCaseId: caseId,
      raw
    });
    const result = SemanticEvaluationCaseResultSchema.parse({
      schemaVersion: "sketchycut-semantic-evaluation-case@2.0.0",
      mode,
      runId: input.runId,
      completedAt: now().toISOString(),
      ...raw,
      ...classified
    });
    await writeExclusive(path.join(caseDirectory, "result.json"), result);
    results.push(result);
    hardStopReason = result.hardAnomalies[0] ?? null;
    if (hardStopReason !== null ||
        (policy.failFastOnQualityFailure && result.qualityStatus === "fail")) {
      break;
    }
  }

  const failed = results.filter((item) => item.qualityStatus === "fail").length;
  const unscored = results.filter((item) => item.qualityStatus === "not-scored").length;
  const passed = results.filter((item) => item.qualityStatus === "pass").length;
  const executionStatus = hardStopReason === null &&
      results.length === input.caseIds.length
    ? "completed" as const
    : "aborted" as const;
  const qualityStatus = failed > 0
    ? "fail" as const
    : unscored > 0 || executionStatus !== "completed"
      ? "not-scored" as const
      : "pass" as const;
  const summary = SemanticEvaluationSummarySchema.parse({
    schemaVersion: "sketchycut-semantic-evaluation-summary@2.0.0",
    mode,
    runId: input.runId,
    completedAt: now().toISOString(),
    executionStatus,
    qualityStatus,
    selectedCaseIds: input.caseIds,
    attemptedCaseIds: results.map((item) => item.caseId),
    counts: {
      selected: input.caseIds.length,
      attempted: results.length,
      dispatched: results.reduce((sum, item) =>
        sum + item.attempts.reduce(
          (caseSum, attempt) => caseSum + attempt.networkDispatchCount,
          0,
        ), 0),
      scored: results.filter((item) => item.score !== null).length,
      passed,
      failed,
      unscored,
      remaining: input.caseIds.length - results.length
    },
    aggregate: aggregateCaseResults(results),
    hardStopReason,
    stoppedWithoutRetry: true,
    historicalHeldoutCalls: 0,
    broadLiveGeneralizationClaimed: false
  });
  await writeExclusive(path.join(input.runDirectory, "summary.json"), summary);
  return summary;
}

export function semanticEvaluationExitCode(
  summary: SemanticEvaluationSummary,
): 0 | 1 | 2 {
  if (summary.executionStatus !== "completed" || summary.hardStopReason !== null) return 1;
  return summary.qualityStatus === "pass" ? 0 : 2;
}

export function blockedSemanticEvaluationSummary(input: {
  mode: SemanticEvaluationMode;
  runId: string;
  selectedCaseIds: readonly string[];
  hardStopReason: SemanticEvaluationHardAnomaly;
  completedAt?: Date;
}): SemanticEvaluationSummary {
  return SemanticEvaluationSummarySchema.parse({
    schemaVersion: "sketchycut-semantic-evaluation-summary@2.0.0",
    mode: input.mode,
    runId: input.runId,
    completedAt: (input.completedAt ?? new Date()).toISOString(),
    executionStatus: "blocked-preflight",
    qualityStatus: "not-scored",
    selectedCaseIds: input.selectedCaseIds,
    attemptedCaseIds: [],
    counts: {
      selected: input.selectedCaseIds.length,
      attempted: 0,
      dispatched: 0,
      scored: 0,
      passed: 0,
      failed: 0,
      unscored: 0,
      remaining: input.selectedCaseIds.length
    },
    aggregate: aggregateCaseResults([]),
    hardStopReason: input.hardStopReason,
    stoppedWithoutRetry: true,
    historicalHeldoutCalls: 0,
    broadLiveGeneralizationClaimed: false
  });
}

export function createRunOwnedGenerationStore(
  store: GenerationStore,
  attempts: LiveCallAttempt[],
): GenerationStore {
  return {
    getValue: (key) => store.getValue(key),
    setValue: (key, value, options) => store.setValue(key, value, options),
    compareAndSetValue: (key, expectedValue, replacementValue, ttlSeconds) =>
      store.compareAndSetValue(key, expectedValue, replacementValue, ttlSeconds),
    deleteIfValue: (key, expectedValue) => store.deleteIfValue(key, expectedValue),
    createSession: (record, ttlSeconds) => store.createSession(record, ttlSeconds),
    ensureSession: (record, ttlSeconds) => store.ensureSession(record, ttlSeconds),
    readSession: (sessionId) => store.readSession(sessionId),
    setLastProject: (sessionId, projectId) =>
      store.setLastProject(sessionId, projectId),
    recordAccessAttempt: (value) => store.recordAccessAttempt(value),
    consumeRouteRate: (value) => store.consumeRouteRate(value),
    reserveGeneration: (value) => store.reserveGeneration(value),
    appendLedgerAttempt: async (attempt) => {
      await store.appendLedgerAttempt(attempt);
      attempts.push(structuredClone(attempt));
    },
    readLedgerAttempts: () => store.readLedgerAttempts(),
    readGlobalExposureState: () => store.readGlobalExposureState(),
    authorizeGlobalExposure: (value) => store.authorizeGlobalExposure(value),
    readExposureAuthorizations: () => store.readExposureAuthorizations()
  };
}

export async function writeSemanticEvaluationArtifact(
  file: string,
  value: unknown,
): Promise<void> {
  await writeExclusive(file, value);
}
