import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { sha256 } from "../src/domain/hash.js";
import { LiveCallAttemptSchema } from "../src/interpretation/live-ledger.js";
import { M5LiveEvaluationReportSchema } from "./m5-live-evaluation-report.js";
import { M5LiveRecordingIncidentSchema } from "./m5-live-recording-incident.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const RelativePathSchema = z.string().min(1).refine((value) =>
  !path.isAbsolute(value) && !value.split("/").includes(".."),
"Evidence paths must remain repository-relative.");

const AcceptanceReportSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    milestone: z.literal("M5"),
    status: z.enum(["pending-live-evaluation", "pass"]),
    asOf: z.iso.datetime({ offset: true }),
    checkpoint1: z.literal("pass"),
    checkpoint2NonLive: z.literal("pass"),
    liveEvaluation: z
      .object({
        status: z.enum([
          "awaiting-explicit-builder-authorization",
          "failed-provider-rejected-awaiting-explicit-revision-2-authorization",
          "sol-recording-incident-remediated-terra-canary-authorized",
          "terra-schema-failure-prompt-remediated-revision-2-authorized",
          "terra-concept-only-mapper-remediated-revision-3-authorized",
          "terra-pass-sol-comparison-authorized",
          "pass"
        ]),
        solAttempts: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
        terraAttempts: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
        networkDispatches: z.number().int().min(0).max(6),
        reportedTokens: z.number().int().positive().nullable(),
        confirmedEstimatedCostUsd: z.number().nonnegative(),
        unresolvedPotentialExposureUsd: z.number().nonnegative(),
        productionDefault: z.enum(["gpt-5.6-sol", "gpt-5.6-terra"]).nullable()
      })
      .strict(),
    commands: z.array(z.object({
      command: z.string().min(1),
      result: z.enum([
        "pass",
        "failed-provider-rejected",
        "failed-local-recording",
        "failed-schema",
        "failed-concept-only"
      ]),
      detail: z.string().min(1)
    }).strict()).min(6),
    hashes: z.record(z.string(), HashSchema),
    evidence: z.object({
      replayScenarios: z.literal(11),
      compiledCandidates: z.literal(9),
      conceptOnlyOutcomes: z.literal(1),
      strictSchemaFailures: z.literal(1),
      motifRecipes: z.number().int().min(3),
      artifactFilesVerified: z.literal(99),
      studioComplexityImport: z.literal("pass"),
      visualReview: z.literal("pass")
    }).strict(),
    apiUsage: z.object({
      runtimeApplicationApiCalls: z.number().int().min(0).max(5),
      estimatedCostUsd: z.number().nonnegative(),
      liveLedgerPresent: z.boolean()
    }).strict(),
    physicalVerification: z.object({
      required: z.literal(true),
      performed: z.literal(false),
      state: z.literal("fabrication candidate")
    }).strict(),
    limitations: z.array(z.string().min(1)).min(3)
  })
  .strict();

const ManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M5"),
  status: z.enum(["pending-live-evaluation", "pass"]),
  runtimeApplicationApiCalls: z.number().int().min(0).max(5),
  estimatedCostUsd: z.number().nonnegative(),
  physicalVerification: z.literal("required-not-performed"),
  entries: z.array(z.object({
    path: RelativePathSchema,
    sha256: HashSchema
  }).strict()).min(8),
  pendingEntries: z.array(RelativePathSchema)
}).strict();

const VisualReviewSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M5"),
  status: z.literal("pass"),
  reviewedAt: z.iso.datetime({ offset: true }),
  transportMode: z.literal("replay"),
  runtimeApplicationApiCalls: z.literal(0),
  observations: z.array(z.string().min(1)).min(4),
  captures: z.array(z.object({
    path: RelativePathSchema,
    sha256: HashSchema
  }).strict()).min(6),
  claimLimit: z.string().min(1)
}).strict();

const AttemptEventSchema = z.object({
  recordType: z.literal("attempt"),
  attempt: LiveCallAttemptSchema
}).strict();

const RecordingIncidentEventSchema = z.object({
  recordType: z.literal("recording-incident"),
  incident: M5LiveRecordingIncidentSchema
}).strict();

const LedgerEventSchema = z.discriminatedUnion("recordType", [
  AttemptEventSchema,
  RecordingIncidentEventSchema
]);

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function verifyEntries(
  entries: readonly { path: string; sha256: string }[],
  label: string,
): Promise<void> {
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw new Error(`${label} contains duplicate evidence paths.`);
  }
  for (const entry of entries) {
    const absolute = path.resolve(repositoryRoot, entry.path);
    if (!absolute.startsWith(repositoryRoot + path.sep)) {
      throw new Error(`${label} escapes the repository root: ${entry.path}`);
    }
    const bytes = await readFile(absolute);
    if (await sha256(bytes) !== entry.sha256) {
      throw new Error(`${label} hash mismatch: ${entry.path}`);
    }
  }
}

const [acceptanceSource, manifestSource, visualSource, milestoneSource, buildLogSource] =
  await Promise.all([
    readFile(path.join(repositoryRoot, "docs/evidence/m05/acceptance-report.json"), "utf8"),
    readFile(path.join(repositoryRoot, "docs/evidence/m05/manifest.json"), "utf8"),
    readFile(path.join(repositoryRoot, "docs/evidence/m05/reports/visual-review.json"), "utf8"),
    readFile(path.join(repositoryRoot, "docs/MILESTONE_PLAN.md"), "utf8"),
    readFile(path.join(repositoryRoot, "docs/HACKATHON_BUILD_LOG.md"), "utf8")
  ]);
const acceptance = AcceptanceReportSchema.parse(JSON.parse(acceptanceSource) as unknown);
const manifest = ManifestSchema.parse(JSON.parse(manifestSource) as unknown);
const visual = VisualReviewSchema.parse(JSON.parse(visualSource) as unknown);

await Promise.all([
  verifyEntries(manifest.entries, "M5 manifest"),
  verifyEntries(visual.captures, "M5 visual review")
]);
if (acceptance.status !== manifest.status ||
    acceptance.apiUsage.runtimeApplicationApiCalls !== manifest.runtimeApplicationApiCalls ||
    acceptance.apiUsage.estimatedCostUsd !== manifest.estimatedCostUsd) {
  throw new Error("M5 acceptance report and evidence manifest disagree.");
}
if (acceptance.status === "pending-live-evaluation") {
  if (acceptance.liveEvaluation.status === "awaiting-explicit-builder-authorization") {
    if (acceptance.liveEvaluation.solAttempts !== 0 ||
        acceptance.liveEvaluation.terraAttempts !== 0 ||
        acceptance.liveEvaluation.networkDispatches !== 0 ||
        acceptance.liveEvaluation.reportedTokens !== null ||
        acceptance.liveEvaluation.productionDefault !== null ||
        acceptance.apiUsage.runtimeApplicationApiCalls !== 0 ||
        acceptance.apiUsage.liveLedgerPresent || manifest.pendingEntries.length !== 3 ||
        !milestoneSource.includes("pending the builder-authorized one-call Sol evaluation")) {
      throw new Error("M5 awaiting-authorization evidence is internally inconsistent.");
    }
  } else if (acceptance.liveEvaluation.status ===
      "failed-provider-rejected-awaiting-explicit-revision-2-authorization") {
    if (acceptance.liveEvaluation.solAttempts !== 1 ||
        acceptance.liveEvaluation.terraAttempts !== 0 ||
        acceptance.liveEvaluation.networkDispatches !== 1 ||
        acceptance.liveEvaluation.reportedTokens !== null ||
        acceptance.liveEvaluation.confirmedEstimatedCostUsd !== 0 ||
        acceptance.liveEvaluation.unresolvedPotentialExposureUsd !== 0 ||
        acceptance.liveEvaluation.productionDefault !== null ||
        acceptance.apiUsage.runtimeApplicationApiCalls !== 0 ||
        acceptance.apiUsage.estimatedCostUsd !== 0 ||
        !acceptance.apiUsage.liveLedgerPresent || manifest.pendingEntries.length !== 2 ||
        !milestoneSource.includes("The first builder-authorized Sol dispatch received an authoritative HTTP 400")) {
      throw new Error("M5 failed-provider-rejection evidence is internally inconsistent.");
    }
    const report = M5LiveEvaluationReportSchema.parse(JSON.parse(await readFile(path.join(
      repositoryRoot,
      "docs/evidence/m05/live/evaluation-gpt-5.6-sol-attempt-1.json",
    ), "utf8")) as unknown);
    const ledgerEvents = (await readFile(path.join(
      repositoryRoot,
      "docs/evidence/m05/live/live-call-ledger.ndjson",
    ), "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => AttemptEventSchema.parse(JSON.parse(line) as unknown));
    const attempt = report.attempt;
    if (report.modelId !== "gpt-5.6-sol" || report.passed ||
        report.result.kind !== "failure" || report.result.failureStage !== "transport" ||
        report.result.failureCode !== "OPENAI_HTTP_400" ||
        attempt?.outcome !== "provider-not-accepted" ||
        attempt.billing.state !== "confirmed-not-billed" ||
        attempt.billing.estimatedCostUsd !== 0 ||
        attempt.networkDispatchCount !== 1 || ledgerEvents.length !== 1 ||
        ledgerEvents[0]?.attempt.attemptId !== attempt.attemptId) {
      throw new Error("M5 immutable failed Sol report does not match its append-only ledger.");
    }
  } else if (acceptance.liveEvaluation.status ===
      "sol-recording-incident-remediated-terra-canary-authorized") {
    if (acceptance.liveEvaluation.solAttempts !== 2 ||
        acceptance.liveEvaluation.terraAttempts !== 0 ||
        acceptance.liveEvaluation.networkDispatches !== 2 ||
        acceptance.liveEvaluation.reportedTokens !== null ||
        acceptance.liveEvaluation.confirmedEstimatedCostUsd !== 0 ||
        acceptance.liveEvaluation.unresolvedPotentialExposureUsd !== 0.25 ||
        acceptance.liveEvaluation.productionDefault !== null ||
        acceptance.apiUsage.runtimeApplicationApiCalls !== 1 ||
        acceptance.apiUsage.estimatedCostUsd !== 0 ||
        !acceptance.apiUsage.liveLedgerPresent || manifest.pendingEntries.length !== 2 ||
        !milestoneSource.includes("Terra-first integration canary")) {
      throw new Error("M5 Sol recording-incident evidence is internally inconsistent.");
    }
    const incident = M5LiveRecordingIncidentSchema.parse(JSON.parse(await readFile(path.join(
      repositoryRoot,
      "docs/evidence/m05/live/incident-gpt-5.6-sol-attempt-2.json",
    ), "utf8")) as unknown);
    const ledgerEvents = (await readFile(path.join(
      repositoryRoot,
      "docs/evidence/m05/live/live-call-ledger.ndjson",
    ), "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => LedgerEventSchema.parse(JSON.parse(line) as unknown));
    if (incident.incidentId !== "incident-sol-revision-2-ledger-validation" ||
        ledgerEvents.length !== 2 || ledgerEvents[1]?.recordType !== "recording-incident" ||
        ledgerEvents[1].incident.incidentId !== incident.incidentId) {
      throw new Error("M5 immutable Sol recording incident does not match the append-only ledger.");
    }
  } else if (acceptance.liveEvaluation.status ===
      "terra-schema-failure-prompt-remediated-revision-2-authorized") {
    if (acceptance.liveEvaluation.solAttempts !== 2 ||
        acceptance.liveEvaluation.terraAttempts !== 1 ||
        acceptance.liveEvaluation.networkDispatches !== 3 ||
        acceptance.liveEvaluation.reportedTokens !== 2_976 ||
        acceptance.liveEvaluation.confirmedEstimatedCostUsd !== 0.02089 ||
        acceptance.liveEvaluation.unresolvedPotentialExposureUsd !== 0.25 ||
        acceptance.liveEvaluation.productionDefault !== null ||
        acceptance.apiUsage.runtimeApplicationApiCalls !== 2 ||
        acceptance.apiUsage.estimatedCostUsd !== 0.02089 ||
        !acceptance.apiUsage.liveLedgerPresent || manifest.pendingEntries.length !== 2 ||
        !milestoneSource.includes("Terra attempt 1 completed the SDK and recording path")) {
      throw new Error("M5 Terra schema-failure evidence is internally inconsistent.");
    }
    const terraReport = M5LiveEvaluationReportSchema.parse(JSON.parse(await readFile(path.join(
      repositoryRoot,
      "docs/evidence/m05/live/evaluation-gpt-5.6-terra-attempt-1.json",
    ), "utf8")) as unknown);
    const ledgerEvents = (await readFile(path.join(
      repositoryRoot,
      "docs/evidence/m05/live/live-call-ledger.ndjson",
    ), "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => LedgerEventSchema.parse(JSON.parse(line) as unknown));
    if (terraReport.modelId !== "gpt-5.6-terra" || terraReport.passed ||
        terraReport.result.failureStage !== "schema" ||
        terraReport.result.failureCode !== "STRICT_INTENT_SCHEMA_FAILURE" ||
        terraReport.attempt?.outcome !== "schema-failure" ||
        terraReport.attempt.usage.status !== "reported" ||
        terraReport.attempt.billing.estimatedCostUsd !== 0.02089 ||
        ledgerEvents.length !== 3 || ledgerEvents[2]?.recordType !== "attempt" ||
        ledgerEvents[2].attempt.attemptId !== terraReport.attempt.attemptId) {
      throw new Error("M5 immutable Terra schema-failure report does not match its ledger.");
    }
  } else if (acceptance.liveEvaluation.status ===
      "terra-concept-only-mapper-remediated-revision-3-authorized") {
    if (acceptance.liveEvaluation.solAttempts !== 2 ||
        acceptance.liveEvaluation.terraAttempts !== 2 ||
        acceptance.liveEvaluation.networkDispatches !== 4 ||
        acceptance.liveEvaluation.reportedTokens !== 5_768 ||
        acceptance.liveEvaluation.confirmedEstimatedCostUsd !== 0.03732 ||
        acceptance.liveEvaluation.unresolvedPotentialExposureUsd !== 0.25 ||
        acceptance.liveEvaluation.productionDefault !== null ||
        acceptance.apiUsage.runtimeApplicationApiCalls !== 3 ||
        acceptance.apiUsage.estimatedCostUsd !== 0.03732 ||
        !acceptance.apiUsage.liveLedgerPresent || manifest.pendingEntries.length !== 2 ||
        !milestoneSource.includes("Terra revision 2 passed strict parsing")) {
      throw new Error("M5 Terra concept-only evidence is internally inconsistent.");
    }
    const terraReport = M5LiveEvaluationReportSchema.parse(JSON.parse(await readFile(path.join(
      repositoryRoot,
      "docs/evidence/m05/live/evaluation-gpt-5.6-terra-attempt-2.json",
    ), "utf8")) as unknown);
    const ledgerEvents = (await readFile(path.join(
      repositoryRoot,
      "docs/evidence/m05/live/live-call-ledger.ndjson",
    ), "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => LedgerEventSchema.parse(JSON.parse(line) as unknown));
    if (terraReport.modelId !== "gpt-5.6-terra" || terraReport.passed ||
        terraReport.result.kind !== "concept-only" ||
        terraReport.attempt?.outcome !== "completed" ||
        terraReport.attempt.usage.status !== "reported" ||
        terraReport.attempt.billing.estimatedCostUsd !== 0.01643 ||
        ledgerEvents.length !== 4 || ledgerEvents[3]?.recordType !== "attempt" ||
        ledgerEvents[3].attempt.attemptId !== terraReport.attempt.attemptId) {
      throw new Error("M5 immutable Terra concept-only report does not match its ledger.");
    }
  } else if (acceptance.liveEvaluation.status === "terra-pass-sol-comparison-authorized") {
    if (acceptance.liveEvaluation.solAttempts !== 2 ||
        acceptance.liveEvaluation.terraAttempts !== 3 ||
        acceptance.liveEvaluation.networkDispatches !== 5 ||
        acceptance.liveEvaluation.reportedTokens !== 8_703 ||
        acceptance.liveEvaluation.confirmedEstimatedCostUsd !== 0.0544325 ||
        acceptance.liveEvaluation.unresolvedPotentialExposureUsd !== 0.25 ||
        acceptance.liveEvaluation.productionDefault !== null ||
        acceptance.apiUsage.runtimeApplicationApiCalls !== 4 ||
        acceptance.apiUsage.estimatedCostUsd !== 0.0544325 ||
        !acceptance.apiUsage.liveLedgerPresent || manifest.pendingEntries.length !== 1 ||
        !milestoneSource.includes("Terra revision 3 passed all 12 frozen rubric checks")) {
      throw new Error("M5 passing Terra evidence is internally inconsistent.");
    }
    const terraReport = M5LiveEvaluationReportSchema.parse(JSON.parse(await readFile(path.join(
      repositoryRoot,
      "docs/evidence/m05/live/evaluation-gpt-5.6-terra-attempt-3.json",
    ), "utf8")) as unknown);
    const ledgerEvents = (await readFile(path.join(
      repositoryRoot,
      "docs/evidence/m05/live/live-call-ledger.ndjson",
    ), "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => LedgerEventSchema.parse(JSON.parse(line) as unknown));
    if (terraReport.modelId !== "gpt-5.6-terra" || !terraReport.passed ||
        terraReport.result.kind !== "supported" ||
        terraReport.rubric.some((item) => !item.passed) ||
        terraReport.attempt?.outcome !== "completed" ||
        terraReport.attempt.billing.estimatedCostUsd !== 0.0171125 ||
        ledgerEvents.length !== 5 || ledgerEvents[4]?.recordType !== "attempt" ||
        ledgerEvents[4].attempt.attemptId !== terraReport.attempt.attemptId) {
      throw new Error("M5 immutable passing Terra report does not match its ledger.");
    }
  } else {
    throw new Error("M5 pending status cannot claim a passing live evaluation.");
  }
  for (const pending of manifest.pendingEntries) {
    if (await exists(path.join(repositoryRoot, pending))) {
      throw new Error(`Pending M5 live evidence already exists: ${pending}`);
    }
  }
} else {
  if (acceptance.liveEvaluation.status !== "pass" ||
      acceptance.liveEvaluation.solAttempts !== 3 ||
      acceptance.liveEvaluation.terraAttempts !== 3 ||
      acceptance.liveEvaluation.networkDispatches !== 6 ||
      acceptance.liveEvaluation.reportedTokens !== 12_111 ||
      acceptance.liveEvaluation.confirmedEstimatedCostUsd !== 0.1028475 ||
      acceptance.liveEvaluation.unresolvedPotentialExposureUsd !== 0.25 ||
      acceptance.liveEvaluation.productionDefault !== "gpt-5.6-terra" ||
      acceptance.apiUsage.runtimeApplicationApiCalls !== 5 ||
      acceptance.apiUsage.estimatedCostUsd !== 0.1028475 ||
      !acceptance.apiUsage.liveLedgerPresent || manifest.pendingEntries.length !== 0 ||
      !milestoneSource.includes("Status: complete")) {
    throw new Error("M5 completed evidence is internally inconsistent.");
  }
  const reportPaths = [
    "docs/evidence/m05/live/evaluation-gpt-5.6-sol-attempt-1.json",
    "docs/evidence/m05/live/evaluation-gpt-5.6-terra-attempt-1.json",
    "docs/evidence/m05/live/evaluation-gpt-5.6-terra-attempt-2.json",
    "docs/evidence/m05/live/evaluation-gpt-5.6-terra-attempt-3.json",
    "docs/evidence/m05/live/evaluation-gpt-5.6-sol-attempt-3.json"
  ];
  const reports = await Promise.all(reportPaths.map(async (reportPath) =>
    M5LiveEvaluationReportSchema.parse(JSON.parse(await readFile(
      path.join(repositoryRoot, reportPath),
      "utf8",
    )) as unknown)
  ));
  const terraPass = reports[3];
  const solPass = reports[4];
  const ledgerEvents = (await readFile(path.join(
    repositoryRoot,
    "docs/evidence/m05/live/live-call-ledger.ndjson",
  ), "utf8"))
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => LedgerEventSchema.parse(JSON.parse(line) as unknown));
  const reportAttempts = reports.map((report) => report.attempt);
  const reportedTokens = reportAttempts.reduce((total, attempt) =>
    total + (attempt?.usage.status === "reported" ? attempt.usage.totalTokens : 0), 0
  );
  const confirmedCost = reportAttempts.reduce((total, attempt) =>
    total + (attempt?.billing.state === "confirmed-billed"
      ? attempt.billing.estimatedCostUsd ?? 0
      : 0), 0
  );
  if (terraPass === undefined || solPass === undefined ||
      !terraPass.passed || !solPass.passed ||
      terraPass.rubric.some((item) => !item.passed) ||
      solPass.rubric.some((item) => !item.passed) ||
      terraPass.result.kind !== "supported" || solPass.result.kind !== "supported" ||
      terraPass.result.geometrySha256 !== solPass.result.geometrySha256 ||
      JSON.stringify(terraPass.frozenInput) !== JSON.stringify(solPass.frozenInput) ||
      terraPass.configuration.promptSha256 !== solPass.configuration.promptSha256 ||
      terraPass.configuration.intentSchemaSha256 !== solPass.configuration.intentSchemaSha256 ||
      terraPass.configuration.capabilityCatalogSha256 !==
        solPass.configuration.capabilityCatalogSha256 ||
      solPass.attempt?.retryOfRecordingIncidentId !==
        "incident-sol-revision-2-ledger-validation" ||
      reportedTokens !== 12_111 || confirmedCost !== 0.1028475 ||
      ledgerEvents.length !== 6 || ledgerEvents[1]?.recordType !== "recording-incident" ||
      ledgerEvents[5]?.recordType !== "attempt" ||
      ledgerEvents[5].attempt.attemptId !== solPass.attempt.attemptId) {
    throw new Error("M5 passing model comparison does not match its immutable reports and ledger.");
  }
}
if (!buildLogSource.startsWith("# Hackathon build log\n") ||
    buildLogSource.indexOf("## M5 implementation and non-live acceptance") >
      buildLogSource.indexOf("## M5 planning")) {
  throw new Error("The newest M5 build-log entry is not in reverse chronological order.");
}

process.stdout.write(
  `Verified M5 ${acceptance.status} evidence, ${String(manifest.entries.length)} manifest hashes, ${String(visual.captures.length)} direct-review captures, API usage, and documentation consistency.\n`,
);
