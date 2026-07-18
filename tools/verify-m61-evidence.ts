import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { hashCanonical } from "../src/domain/hash.js";
import { CAPABILITY_CATALOG_V1 } from "../src/interpretation/capability-catalog.js";
import { INTENT_GRAPH_V1_JSON_SCHEMA } from "../src/interpretation/intent-graph.js";
import { LiveCallAttemptSchema } from "../src/interpretation/live-ledger.js";
import {
  M5_CAPABILITY_CATALOG_ID,
  M5_INTENT_SCHEMA_VERSION
} from "../src/interpretation/semantic-request.js";
import {
  M6_OPENAI_MAX_RETRIES,
  M6_OPENAI_MODEL,
  M6_PROMPT_VERSION,
  M6_TERRA_PRICE
} from "../src/server/m6/openai-transport.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const RelativePathSchema = z.string().min(1).refine((value) =>
  !path.isAbsolute(value) && !value.split("/").includes(".."),
);
const StatusSchema = z.literal("complete-software-validated-live-quality-follow-up");

const GateSchema = z.object({
  id: z.string().regex(/^M61-[A-Z0-9-]+$/),
  expected: z.string().min(1),
  observed: z.string().min(1),
  status: z.literal("pass"),
  evidence: z.array(RelativePathSchema).min(1)
}).strict();

const AcceptanceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6.1"),
  status: StatusSchema,
  reviewedAt: z.literal("2026-07-18"),
  reviewer: z.literal("Codex"),
  summary: z.string().min(1),
  gates: z.array(GateSchema).length(15),
  commands: z.array(z.object({
    command: z.string().min(1),
    result: z.literal("pass"),
    detail: z.string().min(1).optional()
  }).strict()).min(18),
  globalExposure: z.object({
    initialAuthorizedCeilingMicrousd: z.literal(5_000_000),
    requestReservationMicrousd: z.literal(250_000),
    permittedReservationCount: z.literal(20),
    nextReservationReason: z.literal("global-budget"),
    refundsOrDecrementsImplemented: z.literal(false),
    reviewedIncrementMicrousd: z.literal(5_000_000)
  }).strict(),
  apiUsage: z.object({
    paidModelRequests: z.literal(3),
    runtimeApplicationApiCalls: z.literal(3),
    networkDispatches: z.literal(3),
    reportedTokens: z.object({
      input: z.literal(7_475),
      cachedInput: z.literal(0),
      reasoning: z.literal(1_514),
      output: z.literal(3_480),
      total: z.literal(10_955)
    }).strict(),
    confirmedEstimatedCostUsd: z.literal(0.0708875),
    unresolvedPotentialExposureUsd: z.literal(0)
  }).strict(),
  liveBrowserGate: z.object({
    state: z.literal("pass-quality-follow-up-required"),
    authorized: z.literal(true),
    attempted: z.literal(true),
    automaticRetryAllowed: z.literal(false),
    automaticRetryObserved: z.literal(false),
    maximumDispatchesPerSubmission: z.literal(1),
    successfulSubmissionDispatches: z.literal(1),
    successfulGateAttemptId: z.literal("attempt-ea1e1ebf88cc4fd6bcdd2419d70783b5")
  }).strict(),
  physicalVerification: z.object({
    requiredForM61: z.literal(false),
    performed: z.literal(false),
    state: z.literal("fabrication-candidate-physical-verification-required")
  }).strict(),
  limitations: z.array(z.string().min(1)).min(4)
}).strict();

const ManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6.1"),
  status: StatusSchema,
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/),
  worktree: z.object({
    porcelainSha256: HashSchema,
    entryCount: z.number().int().positive(),
    trackedModifiedCount: z.number().int().positive(),
    untrackedCount: z.number().int().positive()
  }).strict(),
  immutableTrees: z.array(z.object({
    root: z.enum(["artifacts/m5", "artifacts/m6", "docs/evidence/m05", "docs/evidence/m06"]),
    entryCount: z.number().int().positive(),
    sha256: HashSchema
  }).strict()).length(4),
  artifactManifestSha256: HashSchema,
  runtimeApplicationApiCalls: z.literal(3),
  estimatedCostUsd: z.literal(0.0708875),
  unresolvedPotentialExposureUsd: z.literal(0),
  liveBrowserStatus: z.literal("pass-quality-follow-up-required"),
  physicalVerification: z.literal("required-not-performed"),
  entries: z.array(z.object({
    path: RelativePathSchema,
    sha256: HashSchema
  }).strict()).min(25),
  pendingEntries: z.array(z.never()).length(0)
}).strict();

const LiveEvidenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6.1"),
  status: z.literal("pass-quality-follow-up-required"),
  reviewedAt: z.literal("2026-07-18"),
  capturedAt: z.iso.datetime({ offset: true }),
  evidenceSource: z.literal("durable-upstash-ledger-readback-and-builder-observation"),
  configuration: z.object({
    promptVersion: z.literal(M6_PROMPT_VERSION),
    intentSchemaVersion: z.literal(M5_INTENT_SCHEMA_VERSION),
    capabilityCatalogVersion: z.literal(M5_CAPABILITY_CATALOG_ID),
    modelConfiguration: z.object({
      modelId: z.literal(M6_OPENAI_MODEL),
      reasoningEffort: z.literal("low"),
      maxOutputTokens: z.literal(4_000),
      serviceTier: z.literal("default"),
      store: z.literal(false)
    }).strict(),
    promptHash: HashSchema,
    schemaHash: HashSchema,
    capabilityCatalogHash: HashSchema,
    modelConfigurationHash: HashSchema,
    sdkMaximumRetries: z.literal(M6_OPENAI_MAX_RETRIES),
    priceSnapshotId: z.literal(M6_TERRA_PRICE.id)
  }).strict(),
  builderObservation: z.object({
    localBrowserGenerationCompleted: z.literal(true),
    compiledWorkspaceObserved: z.literal(true),
    resultQuality: z.literal("technically-complete-but-below-product-vision"),
    followUpMilestone: z.literal("M6.1.1"),
    physicalFabricationPerformed: z.literal(false)
  }).strict(),
  successfulGateAttemptId: z.literal("attempt-ea1e1ebf88cc4fd6bcdd2419d70783b5"),
  attempts: z.array(LiveCallAttemptSchema).length(4),
  summary: z.object({
    localAttemptRecords: z.literal(4),
    paidModelRequests: z.literal(3),
    cacheHits: z.literal(1),
    runtimeApplicationApiCalls: z.literal(3),
    networkDispatches: z.literal(3),
    linkedRetryAttempts: z.literal(0),
    reportedInputTokens: z.literal(7_475),
    reportedCachedInputTokens: z.literal(0),
    reportedReasoningTokens: z.literal(1_514),
    reportedOutputTokens: z.literal(3_480),
    reportedTotalTokens: z.literal(10_955),
    reportedDispatchLatencyMs: z.literal(36_425),
    confirmedEstimatedCostUsd: z.literal(0.0708875),
    unresolvedPotentialExposureUsd: z.literal(0),
    authorizedCeilingMicrousd: z.literal(5_000_000),
    reservedExposureMicrousd: z.literal(750_000),
    automaticRetryObserved: z.literal(false)
  }).strict(),
  limitations: z.array(z.string().min(1)).min(4)
}).strict();

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(relative: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(repositoryRoot, relative), "utf8")) as unknown;
}

async function verifyEntries(entries: readonly { path: string; sha256: string }[]): Promise<void> {
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw new Error("M61EVIDENCE001_DUPLICATE_MANIFEST_PATH");
  }
  for (const entry of entries) {
    const absolute = path.resolve(repositoryRoot, entry.path);
    if (!absolute.startsWith(repositoryRoot + path.sep)) {
      throw new Error(`M61EVIDENCE002_PATH_ESCAPE: ${entry.path}`);
    }
    if (sha256(await readFile(absolute)) !== entry.sha256) {
      throw new Error(`M61EVIDENCE003_HASH_MISMATCH: ${entry.path}`);
    }
  }
}

function currentWorktree() {
  const porcelain = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  const entries = porcelain.trimEnd().split("\n").filter(Boolean);
  return {
    porcelainSha256: sha256(porcelain),
    entryCount: entries.length,
    trackedModifiedCount: entries.filter((entry) => !entry.startsWith("??")).length,
    untrackedCount: entries.filter((entry) => entry.startsWith("??")).length
  };
}

const [
  acceptance,
  manifest,
  artifactManifest,
  frozen,
  liveEvidence,
  milestone,
  buildLog,
  followUpProposal,
] = await Promise.all([
  readJson("docs/evidence/m06-1/acceptance-report.json").then((value) => AcceptanceSchema.parse(value)),
  readJson("docs/evidence/m06-1/manifest.json").then((value) => ManifestSchema.parse(value)),
  readFile(path.join(repositoryRoot, "artifacts/m6.1/artifact-manifest.json"), "utf8"),
  readJson("artifacts/m6.1/frozen-baselines.json") as Promise<{ immutableTrees: unknown[] }>,
  readJson("docs/evidence/m06-1/live/live-evaluation.json")
    .then((value) => LiveEvidenceSchema.parse(value)),
  readFile(path.join(repositoryRoot, "docs/MILESTONE_PLAN.md"), "utf8"),
  readFile(path.join(repositoryRoot, "docs/HACKATHON_BUILD_LOG.md"), "utf8"),
  readFile(path.join(
    repositoryRoot,
    "docs/M6_1_1_INTENT_CONDITIONED_CONSTRUCTION_AND_INTERNAL_REVIEW_PROPOSAL.md",
  ), "utf8")
]);

const expectedGateIds = [
  "M61-COLD-SESSION",
  "M61-CSP-WORKER",
  "M61-LIVE-FIXTURE-MODE",
  "M61-FIXTURE-ZERO-NETWORK",
  "M61-LOCAL-LIVE-PREFLIGHT",
  "M61-GLOBAL-EXPOSURE",
  "M61-EXPOSURE-AUTHORIZATION",
  "M61-RUNTIME-ORIGIN",
  "M61-PRODUCTION-TRANSPORT-SEAM",
  "M61-ARBITRARY-BRIEF",
  "M61-CUTOUT-WITHHOLDING",
  "M61-REGRESSION-GATES",
  "M61-FROZEN-HISTORY",
  "M61-INDEPENDENT-EVIDENCE",
  "M61-LIVE-BROWSER"
];
if (acceptance.gates.map((gate) => gate.id).join("\n") !== expectedGateIds.join("\n")) {
  throw new Error("M61EVIDENCE004_GATE_SET_CHANGED");
}
if (manifest.artifactManifestSha256 !== sha256(artifactManifest) ||
    JSON.stringify(manifest.immutableTrees) !== JSON.stringify(frozen.immutableTrees) ||
    JSON.stringify(manifest.worktree) !== JSON.stringify(currentWorktree())) {
  throw new Error("M61EVIDENCE006_IDENTITY_OR_WORKTREE_MISMATCH");
}
if (manifest.baseCommit !== execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8"
}).trim()) {
  throw new Error("M61EVIDENCE007_BASE_COMMIT_CHANGED");
}
await verifyEntries(manifest.entries);
const expectedModelConfiguration = {
  modelId: M6_OPENAI_MODEL,
  reasoningEffort: "low",
  maxOutputTokens: 4_000,
  serviceTier: "default",
  store: false
} as const;
const [promptSource, expectedSchemaHash, expectedCatalogHash, expectedModelConfigurationHash] =
  await Promise.all([
    readFile(
      path.join(repositoryRoot, "docs/evidence/m05/runtime/interpretation-prompt.txt"),
      "utf8",
    ),
    hashCanonical(INTENT_GRAPH_V1_JSON_SCHEMA),
    hashCanonical(CAPABILITY_CATALOG_V1),
    hashCanonical(expectedModelConfiguration)
  ]);
if (liveEvidence.configuration.promptHash !== sha256(promptSource) ||
    liveEvidence.configuration.schemaHash !== expectedSchemaHash ||
    liveEvidence.configuration.capabilityCatalogHash !== expectedCatalogHash ||
    liveEvidence.configuration.modelConfigurationHash !== expectedModelConfigurationHash ||
    JSON.stringify(liveEvidence.configuration.modelConfiguration) !==
      JSON.stringify(expectedModelConfiguration)) {
  throw new Error("M61EVIDENCE008_LIVE_CONFIGURATION_NOT_SOURCE_BOUND");
}
const successful = liveEvidence.attempts.find((attempt) =>
  attempt.attemptId === liveEvidence.successfulGateAttemptId);
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const reported = liveEvidence.attempts.flatMap((attempt) =>
  attempt.usage.status === "reported" ? [attempt.usage] : [],
);
const dispatched = sum(liveEvidence.attempts.map((attempt) => attempt.networkDispatchCount));
const confirmedCost = Number(sum(liveEvidence.attempts.flatMap((attempt) =>
  attempt.billing.state === "confirmed-billed" && attempt.billing.estimatedCostUsd !== null
    ? [attempt.billing.estimatedCostUsd]
    : [],
)).toFixed(8));
const unresolvedExposure = Number(sum(liveEvidence.attempts.flatMap((attempt) =>
  attempt.billing.state === "potentially-billed" &&
      attempt.billing.requestBudgetUpperBoundUsd !== null
    ? [attempt.billing.requestBudgetUpperBoundUsd]
    : [],
)).toFixed(8));
const linkedRetryAttempts = liveEvidence.attempts.filter((attempt) =>
  attempt.retryOfAttemptId !== null || (attempt.retryOfRecordingIncidentId ?? null) !== null,
).length;
const derivedSummary = {
  localAttemptRecords: liveEvidence.attempts.length,
  paidModelRequests: liveEvidence.attempts.filter((attempt) =>
    attempt.billing.state === "confirmed-billed").length,
  cacheHits: liveEvidence.attempts.filter((attempt) => attempt.outcome === "cache-hit").length,
  runtimeApplicationApiCalls: dispatched,
  networkDispatches: dispatched,
  linkedRetryAttempts,
  reportedInputTokens: sum(reported.map((usage) => usage.inputTokens)),
  reportedCachedInputTokens: sum(reported.map((usage) => usage.cachedInputTokens)),
  reportedReasoningTokens: sum(reported.map((usage) => usage.reasoningTokens)),
  reportedOutputTokens: sum(reported.map((usage) => usage.outputTokens)),
  reportedTotalTokens: sum(reported.map((usage) => usage.totalTokens)),
  reportedDispatchLatencyMs: sum(liveEvidence.attempts.flatMap((attempt) =>
    attempt.networkDispatchCount === 1 && attempt.latencyMs !== null ? [attempt.latencyMs] : [],
  )),
  confirmedEstimatedCostUsd: confirmedCost,
  unresolvedPotentialExposureUsd: unresolvedExposure,
  authorizedCeilingMicrousd: liveEvidence.summary.authorizedCeilingMicrousd,
  reservedExposureMicrousd: liveEvidence.summary.reservedExposureMicrousd,
  automaticRetryObserved: false
};
const manifestRuntimeApplicationApiCalls: number = manifest.runtimeApplicationApiCalls;
const manifestEstimatedCostUsd: number = manifest.estimatedCostUsd;
const manifestUnresolvedPotentialExposureUsd: number = manifest.unresolvedPotentialExposureUsd;
for (const attempt of liveEvidence.attempts) {
  if (attempt.runtimeOrigin !== "local-development" ||
      attempt.initiatedBy !== "initial-submit" || attempt.attemptOrdinal !== 1 ||
      attempt.retryOfAttemptId !== null ||
      (attempt.retryOfRecordingIncidentId ?? null) !== null ||
      attempt.promptHash !== liveEvidence.configuration.promptHash ||
      attempt.schemaHash !== liveEvidence.configuration.schemaHash ||
      attempt.capabilityCatalogHash !== liveEvidence.configuration.capabilityCatalogHash ||
      attempt.modelConfigurationHash !== liveEvidence.configuration.modelConfigurationHash ||
      attempt.modelId !== M6_OPENAI_MODEL || attempt.reasoningEffort !== "low" ||
      (attempt.billing.state === "confirmed-billed" &&
        attempt.billing.priceSnapshotId !== M6_TERRA_PRICE.id)) {
    throw new Error(`M61EVIDENCE009_LIVE_ATTEMPT_PROVENANCE_INVALID:${attempt.attemptId}`);
  }
}
if (successful?.outcome !== "completed" || successful.deterministicCompile !== "passed" ||
    successful.networkDispatchCount !== 1 ||
    JSON.stringify(derivedSummary) !== JSON.stringify(liveEvidence.summary)) {
  throw new Error("M61EVIDENCE010_LIVE_LEDGER_SUMMARY_INVALID");
}
if (acceptance.apiUsage.paidModelRequests !== derivedSummary.paidModelRequests ||
    acceptance.apiUsage.runtimeApplicationApiCalls !== derivedSummary.runtimeApplicationApiCalls ||
    acceptance.apiUsage.networkDispatches !== derivedSummary.networkDispatches ||
    acceptance.apiUsage.reportedTokens.input !== derivedSummary.reportedInputTokens ||
    acceptance.apiUsage.reportedTokens.cachedInput !== derivedSummary.reportedCachedInputTokens ||
    acceptance.apiUsage.reportedTokens.reasoning !== derivedSummary.reportedReasoningTokens ||
    acceptance.apiUsage.reportedTokens.output !== derivedSummary.reportedOutputTokens ||
    acceptance.apiUsage.reportedTokens.total !== derivedSummary.reportedTotalTokens ||
    acceptance.apiUsage.confirmedEstimatedCostUsd !== derivedSummary.confirmedEstimatedCostUsd ||
    acceptance.apiUsage.unresolvedPotentialExposureUsd !==
      derivedSummary.unresolvedPotentialExposureUsd ||
    manifestRuntimeApplicationApiCalls !== derivedSummary.runtimeApplicationApiCalls ||
    manifestEstimatedCostUsd !== derivedSummary.confirmedEstimatedCostUsd ||
    manifestUnresolvedPotentialExposureUsd !== derivedSummary.unresolvedPotentialExposureUsd) {
  throw new Error("M61EVIDENCE011_CROSS_REPORT_API_USAGE_MISMATCH");
}
for (const evidencePath of acceptance.gates.flatMap((gate) => gate.evidence)) {
  const absolute = path.resolve(repositoryRoot, evidencePath);
  if (!absolute.startsWith(repositoryRoot + path.sep)) {
    throw new Error(`M61EVIDENCE012_GATE_PATH_ESCAPE: ${evidencePath}`);
  }
  await stat(absolute);
}
if (!milestone.includes("## M6.1 — Local runtime, live generation, and cost-control reliability") ||
    !milestone.includes("Status: complete on 2026-07-18") ||
    !milestone.includes("- [x] after all non-live gates pass") ||
    !milestone.includes(
      "## M6.1.1 — Intent-conditioned construction and bounded internal review",
    ) ||
    !buildLog.includes("## M6.1 completion and M6.1.1 design-quality planning") ||
    !followUpProposal.includes(
      "Status: proposed on 2026-07-18; awaiting builder approval; not binding and not implemented",
    ) ||
    !followUpProposal.includes(
      "There is no follow-up question, conversational revision, candidate picker",
    )) {
  throw new Error("M61EVIDENCE013_DOCUMENTATION_STATE_INCONSISTENT");
}

process.stdout.write(
  `Verified complete M6.1 evidence: 15 passed gates, ${String(manifest.entries.length)} hashed entries, 4 local attempt records, 3 paid dispatches, 1 cache hit, $0.0708875 confirmed local cost, and 4 frozen historical trees.\n`,
);
