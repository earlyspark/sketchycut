import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { z } from "zod";

import { Sha256Schema } from "../src/domain/contracts.js";
import { hashCanonical, sha256 } from "../src/domain/hash.js";
import { executeLiveDiversityRound } from "../src/evaluation/live-diversity-evaluation.js";
import {
  assertRoundBelongsToCampaign,
  buildCalibrationCandidateIdentity,
  buildCalibrationEvaluationIdentity,
  CalibrationCampaignManifestV1Schema,
  CalibrationResumeV1Schema,
  CalibrationRoundManifestV1Schema,
  compareCalibrationIdentity,
  summarizeCalibrationTokens,
  type CalibrationCampaignManifestV1,
  type CalibrationRoundManifestV1
} from "../src/evaluation/calibration-campaign.js";
import {
  evaluatePromptGenerality,
  promptExampleCatalogHash,
  promptGeneralityPolicyHash
} from "../src/evaluation/prompt-generality.js";
import { currentComponentManifestV2 } from "../src/interpretation/generation-outcome-v2.js";
import { INTENT_GRAPH_V2_JSON_SCHEMA } from "../src/interpretation/intent-graph-v2.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
  GenerationSubmissionV2Schema
} from "../src/interpretation/generation-submission-v2.js";
import { readRuntimeConfig } from "../src/server/generation/config.js";
import { GlobalExposureStateSchema } from "../src/server/generation/contracts.js";
import { currentProductionPromptHash } from "../src/server/generation/generation-service-v2.js";
import { verifyNormalizedReference } from "../src/server/generation/image-decoder.js";
import { OpenAITransportV2 } from "../src/server/generation/openai-transport-v2.js";
import { GENERATION_POLICY } from "../src/server/generation/policy.js";
import {
  attributeGenerationInputBytes,
  GENERATION_COST_ENVELOPE_POLICY,
  GENERATION_OPENAI_MODEL
} from "../src/server/generation/cost-envelope.js";
import { createGenerationStore } from "../src/server/generation/store.js";
import { DEFAULT_GENERATED_FABRICATION_CONTROLS } from "../src/ui/content/generated-setup.js";
import { FROZEN_LIVE_DIVERSITY_COHORT } from "../tests/fixtures/intent-conditioned-construction/corpus.js";
import { FROZEN_ITERATION_PANEL_PROTOCOL } from "../tests/fixtures/intent-conditioned-construction/iteration-panel-protocol.js";
import {
  FROZEN_ITERATION_PANEL_PROTOCOL_HASH,
  FROZEN_LIVE_DIVERSITY_COHORT_HASH,
  FROZEN_PROMPT_EXAMPLE_CATALOG_HASH,
  FROZEN_PROMPT_GENERALITY_POLICY_HASH,
  FROZEN_SEMANTIC_DIVERSITY_SCORER_HASH
} from "../tests/fixtures/intent-conditioned-construction/manifest.js";
import { M6_2_LIVE_COMPARISON_FINGERPRINTS } from "../tests/fixtures/intent-conditioned-construction/m6-2-live-fingerprints.js";
import {
  SealedHoldoutPanelV1Schema,
  verifyOpenedHoldoutPanel
} from "../tests/evaluation/support/holdout-policy.js";
import { buildDevelopmentEnvironment } from "./development.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const fiveCaseExposureMicrousd = 5 *
  GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd;

type ActiveRoundContext = {
  campaignPath: string;
  roundPath: string;
  campaign: CalibrationCampaignManifestV1;
  round: CalibrationRoundManifestV1;
};

async function activeRoundContext(): Promise<ActiveRoundContext> {
  const campaignPath = process.env.SKETCHYCUT_CALIBRATION_CAMPAIGN_MANIFEST;
  const roundPath = process.env.SKETCHYCUT_CALIBRATION_ROUND_MANIFEST;
  if (campaignPath === undefined || roundPath === undefined) {
    throw new Error("CALIBRATION_MANIFEST_ENV_REQUIRED");
  }
  const [campaign, round] = await Promise.all([
    readFile(campaignPath, "utf8").then((value) =>
      CalibrationCampaignManifestV1Schema.parse(JSON.parse(value))),
    readFile(roundPath, "utf8").then((value) =>
      CalibrationRoundManifestV1Schema.parse(JSON.parse(value)))
  ]);
  assertRoundBelongsToCampaign({ campaign, round });
  return { campaignPath, roundPath, campaign, round };
}

const AuthorizationSchema = z.object({
  schemaVersion: z.literal("sketchycut-live-diversity-authorization@1.0.0"),
  status: z.literal("approved"),
  roundId: z.string().min(1).max(160),
  roundKind: z.literal("iteration"),
  authorizedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  cohortHash: z.literal(FROZEN_LIVE_DIVERSITY_COHORT_HASH),
  protocolHash: z.literal(FROZEN_ITERATION_PANEL_PROTOCOL_HASH),
  scorerHash: z.literal(FROZEN_SEMANTIC_DIVERSITY_SCORER_HASH),
  promptHash: Sha256Schema,
  promptExampleCatalogHash: z.literal(FROZEN_PROMPT_EXAMPLE_CATALOG_HASH),
  promptGeneralityPolicyHash: z.literal(FROZEN_PROMPT_GENERALITY_POLICY_HASH),
  componentManifestHash: Sha256Schema,
  fullComponentManifestHash: Sha256Schema,
  packageLockHash: Sha256Schema,
  inputHashes: z.array(Sha256Schema).length(5),
  sealedHoldoutCommitment: Sha256Schema,
  maximumDispatches: z.literal(5),
  maximumAggregateExposureMicrousd: z.literal(fiveCaseExposureMicrousd),
  expectedExposureState: GlobalExposureStateSchema,
  builderReview: z.string().trim().min(1).max(500)
}).strict();

const HoldoutAuthorizationSchema = z.object({
  schemaVersion: z.literal("sketchycut-live-diversity-authorization@1.0.0"),
  status: z.literal("approved"),
  roundId: z.string().min(1).max(160),
  roundKind: z.literal("holdout"),
  authorizedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  iterationReportHash: Sha256Schema,
  scorerHash: z.literal(FROZEN_SEMANTIC_DIVERSITY_SCORER_HASH),
  promptHash: Sha256Schema,
  componentManifestHash: Sha256Schema,
  fullComponentManifestHash: Sha256Schema,
  packageLockHash: Sha256Schema,
  inputHashes: z.array(Sha256Schema).length(5),
  sealedHoldoutCommitment: Sha256Schema,
  sealedPanelDigest: Sha256Schema,
  comparatorMappingDigest: Sha256Schema,
  referencePayloadsHash: Sha256Schema.nullable(),
  maximumDispatches: z.literal(5),
  maximumAggregateExposureMicrousd: z.literal(fiveCaseExposureMicrousd),
  expectedExposureState: GlobalExposureStateSchema,
  builderReview: z.string().trim().min(1).max(500)
}).strict();

const HoldoutReferencePayloadsSchema = z.object({
  schemaVersion: z.literal("sketchycut-holdout-reference-payloads@1.0.0"),
  cases: z.array(z.object({
    caseId: z.string().min(1),
    references: z.array(z.object({
      referenceId: z.string().min(1),
      dataUrl: z.string().min(1)
    }).strict()).max(3)
  }).strict()).length(5)
}).strict();

function evidencePath(candidate: string): string {
  if (path.isAbsolute(candidate) || candidate.split(/[\\/]/u).includes("..") ||
      !candidate.startsWith("docs/evidence/calibration/")) {
    throw new Error(`LIVE_DIVERSITY_EVIDENCE_PATH:${candidate}`);
  }
  return path.join(repositoryRoot, candidate);
}

async function writeEvidenceExclusive(candidate: string, value: unknown): Promise<void> {
  const destination = evidencePath(candidate);
  await mkdir(path.dirname(destination), { recursive: true });
  const contents = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(destination, contents, { flag: "wx" });
}

function loadLocalEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  const local = path.join(repositoryRoot, ".env.local");
  if (existsSync(local)) {
    for (const [name, value] of Object.entries(parseEnv(readFileSync(local, "utf8")))) {
      if (environment[name] === undefined || environment[name].length === 0) environment[name] = value;
    }
  }
  return environment;
}

const FULL_COMPONENT_SOURCE_PATHS = [
  "package-lock.json",
  "docs/runtime/semantic-interpretation-prompt.txt",
  "src/version.ts",
  "src/evaluation/dispatch-only-semantic-cache.ts",
  "src/evaluation/diversity-observation.ts",
  "src/evaluation/live-diversity-evaluation.ts",
  "src/evaluation/calibration-campaign.ts",
  "src/evaluation/prompt-generality.ts",
  "src/evaluation/semantic-diversity.ts",
  "src/interpretation/source-evidence.ts",
  "src/interpretation/semantic-request-v2.ts",
  "src/interpretation/intent-graph-v2.ts",
  "src/interpretation/generation-outcome-v2.ts",
  "src/interpretation/constraint-sizing-solver.ts",
  "src/interpretation/topology-synthesis.ts",
  "src/interpretation/construction-composition.ts",
  "src/interpretation/construction-planner.ts",
  "src/interpretation/construction-plan-compiler.ts",
  "src/interpretation/orchestrator-v2.ts",
  "src/interpretation/semantic-cache-v2.ts",
  "src/interpretation/semantic-transport.ts",
  "src/interpretation/capability-catalog.ts",
  "src/operators/registry.ts",
  "src/operators/orthogonal-compiler.ts",
  "src/validation/geometry.ts",
  "src/validation/revolute.ts",
  "src/validation/prismatic.ts",
  "src/projections/fabrication/nesting.ts",
  "src/projections/bundle.ts",
  "src/server/generation/cost-envelope.ts",
  "src/server/generation/openai-transport-v2.ts",
  "src/server/generation/quota-transport-v2.ts",
  "src/server/generation/generation-service-v2.ts",
  "tools/run-live-diversity-evaluation.ts",
  "tests/evaluation/support/holdout-policy.ts",
  "tests/fixtures/intent-conditioned-construction/corpus.ts",
  "tests/fixtures/intent-conditioned-construction/iteration-panel-protocol.ts",
  "tests/fixtures/intent-conditioned-construction/m6-2-live-fingerprints.ts"
] as const;

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(candidate) : [candidate];
  }))).flat().sort();
}

async function fullComponentManifest() {
  const source = await Promise.all(FULL_COMPONENT_SOURCE_PATHS.map(async (relativePath) => ({
    path: relativePath,
    sha256: await sha256(await readFile(path.join(repositoryRoot, relativePath)))
  })));
  const serverRoot = path.join(repositoryRoot, ".next/server");
  const serverFiles = await filesUnder(serverRoot);
  const serverRecords = await Promise.all(serverFiles.map(async (file) => ({
    path: path.relative(repositoryRoot, file).split(path.sep).join("/"),
    sha256: await sha256(await readFile(file))
  })));
  const serverBuildIdentity = await hashCanonical(serverRecords);
  const manifest = { schemaVersion: "sketchycut-full-component-manifest@1.0.0", source, serverBuildIdentity };
  return { ...manifest, manifestHash: await hashCanonical(manifest) };
}

async function frozenIdentity(prompt: string) {
  const [componentManifest, fullManifest, packageLockHash, promptReport, inputHashes, intentSchemaHash, comparatorHash] = await Promise.all([
    currentComponentManifestV2(),
    fullComponentManifest(),
    sha256(await readFile(path.join(repositoryRoot, "package-lock.json"))),
    evaluatePromptGenerality({ prompt }),
    Promise.all(FROZEN_LIVE_DIVERSITY_COHORT.map((item) => sha256(item.brief))),
    hashCanonical(INTENT_GRAPH_V2_JSON_SCHEMA),
    hashCanonical(M6_2_LIVE_COMPARISON_FINGERPRINTS)
  ]);
  if (!promptReport.pass) throw new Error("LIVE_DIVERSITY_PROMPT_GENERALITY_FAILED");
  if (await hashCanonical(FROZEN_LIVE_DIVERSITY_COHORT) !== FROZEN_LIVE_DIVERSITY_COHORT_HASH ||
      await hashCanonical(FROZEN_ITERATION_PANEL_PROTOCOL) !== FROZEN_ITERATION_PANEL_PROTOCOL_HASH ||
      await promptExampleCatalogHash() !== FROZEN_PROMPT_EXAMPLE_CATALOG_HASH ||
      await promptGeneralityPolicyHash() !== FROZEN_PROMPT_GENERALITY_POLICY_HASH) {
    throw new Error("LIVE_DIVERSITY_FROZEN_IDENTITY_MISMATCH");
  }
  const candidate = await buildCalibrationCandidateIdentity({
    modelId: GENERATION_OPENAI_MODEL,
    reasoningEffort: "medium",
    promptHash: promptReport.promptHash,
    intentSchemaHash,
    capabilityCatalogHash: componentManifest.capabilityCatalogHash,
    componentManifestHash: componentManifest.manifestHash,
    fullComponentManifestHash: fullManifest.manifestHash,
    packageLockHash
  });
  const evaluation = await buildCalibrationEvaluationIdentity({
    suiteId: "intent-conditioned-construction-v1",
    cohortHash: FROZEN_LIVE_DIVERSITY_COHORT_HASH,
    protocolHash: FROZEN_ITERATION_PANEL_PROTOCOL_HASH,
    scorerHash: FROZEN_SEMANTIC_DIVERSITY_SCORER_HASH,
    comparatorHash,
    capabilityBoundaryHash: await hashCanonical({
      intentSchemaHash,
      capabilityCatalogHash: componentManifest.capabilityCatalogHash,
      operatorRegistryHash: componentManifest.operatorRegistryHash
    }),
    intentSchemaHash,
    dispatchPolicyHash: await hashCanonical({
      maximumDispatches: 5,
      retries: 0,
      fallback: false,
      fanOut: false,
      selectiveReruns: false,
      automaticRepair: false,
      bestOf: false
    }),
    costPolicyHash: await hashCanonical(GENERATION_COST_ENVELOPE_POLICY)
  });
  return { componentManifest, fullManifest, packageLockHash, promptReport, inputHashes, candidate, evaluation };
}

const CommitmentInputSchema = z.object({
  commitment: Sha256Schema,
  panelDigest: Sha256Schema,
  comparatorMappingDigest: Sha256Schema,
  panelOrdinal: z.number().int().positive(),
  authoredAt: z.iso.datetime({ offset: true }),
  reservedForPromptRoundOrdinal: z.number().int().positive(),
  checkerResult: z.literal("SEALED_HOLDOUT_POLICY_PASS").optional(),
  checkerOutput: z.literal("SEALED_HOLDOUT_POLICY_PASS").optional()
}).strict().refine((value) => value.checkerResult !== undefined || value.checkerOutput !== undefined, {
  message: "A passing frozen-checker result is required."
});

async function currentFrozenIdentity() {
  const prompt = await readFile(
    path.join(repositoryRoot, "docs/runtime/semantic-interpretation-prompt.txt"),
    "utf8",
  );
  return { prompt, identity: await frozenIdentity(prompt) };
}

async function writeResume(input: {
  campaignPath: string;
  roundPath: string | null;
  stage: "campaign-open" | "commitment-required" | "authorization-required" |
    "execution-authorized" | "partial-stop" | "round-complete" | "campaign-closed";
  nextCommand: string | null;
}): Promise<void> {
  const destination = path.join(repositoryRoot, "docs/evidence/calibration/resume.json");
  await mkdir(path.dirname(destination), { recursive: true });
  const resume = CalibrationResumeV1Schema.parse({
    schemaVersion: "sketchycut-calibration-resume@1.0.0",
    ...input,
    updatedAt: new Date().toISOString()
  });
  await writeFile(destination, `${JSON.stringify(resume, null, 2)}\n`);
}

function withManifestEnvironment(input: {
  campaignPath: string;
  roundPath: string;
  command: string;
}): string {
  return `SKETCHYCUT_CALIBRATION_CAMPAIGN_MANIFEST=${input.campaignPath} SKETCHYCUT_CALIBRATION_ROUND_MANIFEST=${input.roundPath} ${input.command}`;
}

async function startCampaign(input: {
  campaignId: string;
  milestoneLabel: string;
  outputPath: string;
}): Promise<void> {
  const { identity } = await currentFrozenIdentity();
  const campaign = CalibrationCampaignManifestV1Schema.parse({
    schemaVersion: "sketchycut-calibration-campaign@1.0.0",
    campaignId: input.campaignId,
    status: "open",
    createdAt: new Date().toISOString(),
    closedAt: null,
    milestoneLabel: input.milestoneLabel === "-" ? null : input.milestoneLabel,
    baselineCandidate: identity.candidate,
    evaluation: identity.evaluation,
    bridgeCampaignIds: [],
    physicalVerification: "not-run",
    notes: []
  });
  await writeEvidenceExclusive(input.outputPath, campaign);
  await writeResume({
    campaignPath: input.outputPath,
    roundPath: null,
    stage: "commitment-required",
    nextCommand: `npm run evaluate:live -- --inspect ${input.outputPath}`
  });
  process.stdout.write(`Started zero-call calibration campaign ${campaign.campaignId}.\n`);
}

async function registerRound(input: {
  campaignPath: string;
  roundId: string;
  roundOrdinal: number;
  kind: "iteration" | "holdout";
  commitmentPath: string;
  iterationReportHash: string | null;
  outputPath: string;
}): Promise<void> {
  const campaign = CalibrationCampaignManifestV1Schema.parse(JSON.parse(
    await readFile(evidencePath(input.campaignPath), "utf8"),
  ));
  const commitmentInput = CommitmentInputSchema.parse(JSON.parse(
    await readFile(input.commitmentPath, "utf8"),
  ));
  const { identity } = await currentFrozenIdentity();
  const compatibility = compareCalibrationIdentity({
    campaign,
    candidate: identity.candidate,
    evaluation: identity.evaluation
  });
  if (!compatibility.compatible) {
    throw new Error(`CALIBRATION_NEW_CAMPAIGN_REQUIRED:${compatibility.changedEvaluationFields.join(",")}`);
  }
  const round = CalibrationRoundManifestV1Schema.parse({
    schemaVersion: "sketchycut-calibration-round@1.0.0",
    campaignId: campaign.campaignId,
    roundId: input.roundId,
    roundOrdinal: input.roundOrdinal,
    kind: input.kind,
    status: "registered",
    candidate: identity.candidate,
    evaluationIdentityHash: identity.evaluation.evaluationIdentityHash,
    commitment: {
      commitment: commitmentInput.commitment,
      panelDigest: commitmentInput.panelDigest,
      comparatorMappingDigest: commitmentInput.comparatorMappingDigest,
      panelOrdinal: commitmentInput.panelOrdinal,
      authoredAt: commitmentInput.authoredAt,
      reservedForPromptRoundOrdinal: commitmentInput.reservedForPromptRoundOrdinal,
      checkerResult: commitmentInput.checkerResult ?? commitmentInput.checkerOutput
    },
    iterationReportHash: input.iterationReportHash,
    maximumDispatches: 5,
    maximumAggregateExposureMicrousd: fiveCaseExposureMicrousd,
    resultHash: null,
    summaryHash: null
  });
  assertRoundBelongsToCampaign({ campaign, round });
  await writeEvidenceExclusive(input.outputPath, round);
  await writeResume({
    campaignPath: input.campaignPath,
    roundPath: input.outputPath,
    stage: "authorization-required",
    nextCommand: withManifestEnvironment({
      campaignPath: input.campaignPath,
      roundPath: input.outputPath,
      command: `npm run evaluate:live -- --prepare docs/evidence/calibration/${round.roundId}-proposal.json`
    })
  });
  process.stdout.write(`Registered zero-call ${round.kind} round ${round.roundId}.\n`);
}

async function inspectCampaign(campaignPath: string, roundPath?: string): Promise<void> {
  const campaign = CalibrationCampaignManifestV1Schema.parse(JSON.parse(
    await readFile(evidencePath(campaignPath), "utf8"),
  ));
  const { identity } = await currentFrozenIdentity();
  const compatibility = compareCalibrationIdentity({
    campaign,
    candidate: identity.candidate,
    evaluation: identity.evaluation
  });
  let round: CalibrationRoundManifestV1 | null = null;
  if (roundPath !== undefined) {
    round = CalibrationRoundManifestV1Schema.parse(JSON.parse(
      await readFile(evidencePath(roundPath), "utf8"),
    ));
    assertRoundBelongsToCampaign({ campaign, round });
  }
  const resumePath = path.join(repositoryRoot, "docs/evidence/calibration/resume.json");
  const resume = existsSync(resumePath)
    ? CalibrationResumeV1Schema.parse(JSON.parse(await readFile(resumePath, "utf8")))
    : null;
  const activeResume = resume !== null && resume.campaignPath === campaignPath &&
    resume.roundPath === (roundPath ?? null) ? resume : null;
  const nextAction = !compatibility.compatible
    ? "Start a new campaign before further calibration."
    : round === null
      ? "Have the independent builder create and seal the next five-case panel, then register its commitment metadata."
      : activeResume?.stage === "partial-stop"
          ? "Stop. Reconcile the partial dispatch and exposure record; never rerun automatically."
        : activeResume?.stage === "round-complete"
            ? "Review the compact summary and decide whether to close the campaign or register another round."
          : activeResume?.stage === "authorization-required"
            ? "Continue only after the exact connected-read or model-call authorization required by the resume stage."
            : `Prepare ${round.kind} authorization evidence. No model call is authorized yet.`;
  process.stdout.write(`${JSON.stringify({ campaign, round, resume: activeResume, currentCandidate: identity.candidate, currentEvaluation: identity.evaluation, compatibility, nextAction }, null, 2)}\n`);
}

async function summarizeRound(reportPath: string, outputPath: string): Promise<void> {
  const reportBytes = await readFile(evidencePath(reportPath));
  const report = JSON.parse(reportBytes.toString("utf8")) as {
    roundId?: unknown;
    panelId?: unknown;
    promptHash?: unknown;
    ledgerAttemptDelta?: unknown;
    ledgerDispatchDelta?: unknown;
    exposureBefore?: unknown;
    exposureAfter?: unknown;
    summary?: unknown;
    scores?: unknown;
    cases?: { caseId?: unknown; outcome?: unknown; ledgerAttempt?: Parameters<typeof summarizeCalibrationTokens>[0][number] }[];
  };
  if (!Array.isArray(report.cases) || report.cases.length !== 5 ||
      report.cases.some((item) => item.ledgerAttempt === undefined)) {
    throw new Error("CALIBRATION_REPORT_CASES_INVALID");
  }
  const tokenSummary = summarizeCalibrationTokens(report.cases.map((item) => item.ledgerAttempt!));
  const compact = {
    schemaVersion: "sketchycut-calibration-summary@1.0.0",
    roundId: report.roundId,
    panelId: report.panelId,
    reportHash: await sha256(reportBytes),
    promptHash: report.promptHash,
    ledgerAttemptDelta: report.ledgerAttemptDelta,
    ledgerDispatchDelta: report.ledgerDispatchDelta,
    exposureBefore: report.exposureBefore,
    exposureAfter: report.exposureAfter,
    tokenSummary,
    summary: report.summary,
    scores: report.scores,
    cases: report.cases.map((item) => ({ caseId: item.caseId, outcome: item.outcome }))
  };
  await writeEvidenceExclusive(outputPath, {
    ...compact,
    summaryHash: await hashCanonical(compact)
  });
  const context = await activeRoundContext();
  await writeResume({
    campaignPath: context.campaignPath,
    roundPath: context.roundPath,
    stage: "round-complete",
    nextCommand: `npm run evaluate:live -- --inspect ${context.campaignPath} ${context.roundPath}`
  });
  process.stdout.write(`Wrote compact zero-dispatch summary for ${String(report.roundId)}.\n`);
}

async function closeCampaign(campaignPath: string, outputPath: string): Promise<void> {
  const campaign = CalibrationCampaignManifestV1Schema.parse(JSON.parse(
    await readFile(evidencePath(campaignPath), "utf8"),
  ));
  if (campaign.status !== "open") throw new Error("CALIBRATION_CAMPAIGN_ALREADY_CLOSED");
  const closed = CalibrationCampaignManifestV1Schema.parse({
    ...campaign,
    status: "closed",
    closedAt: new Date().toISOString()
  });
  await writeEvidenceExclusive(outputPath, closed);
  await writeResume({
    campaignPath: outputPath,
    roundPath: null,
    stage: "campaign-closed",
    nextCommand: null
  });
  process.stdout.write(`Closed calibration campaign ${closed.campaignId}.\n`);
}

async function prepare(output: string): Promise<void> {
  const context = await activeRoundContext();
  const { campaign, round } = context;
  if (round.status !== "registered") {
    throw new Error("CALIBRATION_REGISTERED_ROUND_REQUIRED");
  }
  const prompt = await readFile(
    path.join(repositoryRoot, "docs/runtime/semantic-interpretation-prompt.txt"),
    "utf8",
  );
  const identity = await frozenIdentity(prompt);
  const compatibility = compareCalibrationIdentity({
    campaign,
    candidate: identity.candidate,
    evaluation: identity.evaluation
  });
  if (!compatibility.compatible || identity.candidate.candidateHash !== round.candidate.candidateHash) {
    throw new Error("CALIBRATION_CAMPAIGN_OR_CANDIDATE_IDENTITY_MISMATCH");
  }
  const proposal = {
    schemaVersion: "sketchycut-live-diversity-authorization@1.0.0",
    status: "pending-builder-approval",
    roundId: round.roundId,
    roundKind: round.kind,
    cohortHash: round.kind === "iteration" ? FROZEN_LIVE_DIVERSITY_COHORT_HASH : null,
    protocolHash: round.kind === "iteration" ? FROZEN_ITERATION_PANEL_PROTOCOL_HASH : null,
    scorerHash: FROZEN_SEMANTIC_DIVERSITY_SCORER_HASH,
    promptHash: identity.promptReport.promptHash,
    modelId: identity.candidate.modelId,
    reasoningEffort: identity.candidate.reasoningEffort,
    promptExampleCatalogHash: FROZEN_PROMPT_EXAMPLE_CATALOG_HASH,
    promptGeneralityPolicyHash: FROZEN_PROMPT_GENERALITY_POLICY_HASH,
    promptGeneralityReport: identity.promptReport,
    inputAttribution: attributeGenerationInputBytes({
      prompt,
      briefs: FROZEN_LIVE_DIVERSITY_COHORT.map((item) => item.brief)
    }),
    componentManifest: identity.componentManifest,
    componentManifestHash: identity.componentManifest.manifestHash,
    fullComponentManifest: identity.fullManifest,
    fullComponentManifestHash: identity.fullManifest.manifestHash,
    packageLockHash: identity.packageLockHash,
    inputHashes: round.kind === "iteration" ? identity.inputHashes : null,
    sealedHoldoutCommitment: round.commitment.commitment,
    sealedPanelDigest: round.commitment.panelDigest,
    comparatorMappingDigest: round.commitment.comparatorMappingDigest,
    iterationReportHash: round.iterationReportHash,
    campaignId: campaign.campaignId,
    candidateHash: identity.candidate.candidateHash,
    evaluationIdentityHash: identity.evaluation.evaluationIdentityHash,
    promptCacheKey: identity.candidate.promptCacheKey,
    maximumDispatches: 5,
    maximumAggregateExposureMicrousd: 5 *
      GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd,
    expectedExposureState: null,
    authorizationExpiresAt: null,
    limitations: [
      "Preparation makes zero model and durable-store calls.",
      "A read-only connected exposure preflight and contemporaneous builder approval are still required.",
      ...(round.kind === "iteration"
        ? ["Approval of this iteration round does not authorize the sealed holdout round."]
        : ["Preparation does not open the sealed panel. Holdout authorization must explicitly authorize opening the named external file and sending its five synthetic cases to OpenAI."])
    ]
  };
  await writeEvidenceExclusive(output, proposal);
  await writeResume({
    campaignPath: context.campaignPath,
    roundPath: context.roundPath,
    stage: "authorization-required",
    nextCommand: withManifestEnvironment({
      campaignPath: context.campaignPath,
      roundPath: context.roundPath,
      command: `npm run evaluate:live -- --inspect-exposure ${output} docs/evidence/calibration/${round.roundId}-exposure.json`
    })
  });
  process.stdout.write(`Prepared zero-call authorization proposal ${round.roundId}.\n`);
}

async function inspectExposure(proposalPath: string, output: string): Promise<void> {
  const { round } = await activeRoundContext();
  const proposalBytes = await readFile(evidencePath(proposalPath));
  const proposal = JSON.parse(proposalBytes.toString("utf8")) as {
    roundId?: unknown;
    status?: unknown;
    maximumAggregateExposureMicrousd?: unknown;
  };
  if (proposal.roundId !== round.roundId || proposal.status !== "pending-builder-approval" ||
      proposal.maximumAggregateExposureMicrousd !== fiveCaseExposureMicrousd) {
    throw new Error("LIVE_DIVERSITY_PROPOSAL_INVALID");
  }
  const environment = buildDevelopmentEnvironment("live", loadLocalEnvironment());
  const config = readRuntimeConfig(environment);
  const exposure = await createGenerationStore(config).readGlobalExposureState();
  const availableExposureMicrousd = exposure.authorizedCeilingMicrousd -
    exposure.reservedExposureMicrousd;
  await writeEvidenceExclusive(output, {
    schemaVersion: "sketchycut-live-diversity-exposure-preflight@1.0.0",
    roundId: round.roundId,
    proposalPath,
    proposalSha256: await sha256(proposalBytes),
    observedAt: new Date().toISOString(),
    expectedExposureState: exposure,
    availableExposureMicrousd,
    requiredExposureMicrousd: fiveCaseExposureMicrousd,
    sufficient: availableExposureMicrousd >= fiveCaseExposureMicrousd,
    modelRequests: 0,
    storeWrites: 0
  });
  const context = await activeRoundContext();
  await writeResume({
    campaignPath: context.campaignPath,
    roundPath: context.roundPath,
    stage: "authorization-required",
    nextCommand: null
  });
  process.stdout.write(`Read-only exposure preflight ${availableExposureMicrousd >= fiveCaseExposureMicrousd ? "PASS" : "FAIL"}.\n`);
}

async function execute(authorizationPath: string, output: string): Promise<void> {
  const { campaign, round } = await activeRoundContext();
  if (round.kind !== "iteration") throw new Error("CALIBRATION_ITERATION_AUTHORIZATION_KIND_REQUIRED");
  const authorization = AuthorizationSchema.parse(JSON.parse(
    await readFile(evidencePath(authorizationPath), "utf8"),
  ));
  if (authorization.roundId !== round.roundId ||
      authorization.sealedHoldoutCommitment !== round.commitment.commitment) {
    throw new Error("CALIBRATION_ITERATION_AUTHORIZATION_MISMATCH");
  }
  const now = Date.now();
  if (Date.parse(authorization.authorizedAt) > now || Date.parse(authorization.expiresAt) <= now) {
    throw new Error("LIVE_DIVERSITY_AUTHORIZATION_EXPIRED_OR_FUTURE");
  }
  const environment = buildDevelopmentEnvironment("live", loadLocalEnvironment());
  Object.assign(process.env, {
    SKETCHYCUT_TEST_MODE: "0",
    SKETCHYCUT_GENERATION_MODE: "live",
    SKETCHYCUT_GENERATION_ENABLED: "1"
  });
  const config = readRuntimeConfig(environment);
  if (config.liveTransport === null) throw new Error("LIVE_DIVERSITY_TRANSPORT_CONFIG_MISSING");
  const identity = await frozenIdentity(config.liveTransport.interpretationPrompt);
  const compatibility = compareCalibrationIdentity({ campaign, candidate: identity.candidate, evaluation: identity.evaluation });
  if (!compatibility.compatible || identity.candidate.candidateHash !== round.candidate.candidateHash) {
    throw new Error("CALIBRATION_CAMPAIGN_OR_CANDIDATE_IDENTITY_MISMATCH");
  }
  const actualPromptHash = await currentProductionPromptHash(config);
  if (authorization.promptHash !== actualPromptHash ||
      authorization.componentManifestHash !== identity.componentManifest.manifestHash ||
      authorization.fullComponentManifestHash !== identity.fullManifest.manifestHash ||
      authorization.packageLockHash !== identity.packageLockHash ||
      authorization.inputHashes.some((hash, index) => hash !== identity.inputHashes[index])) {
    throw new Error("LIVE_DIVERSITY_AUTHORIZED_COMPONENT_MISMATCH");
  }
  const store = createGenerationStore(config);
  const report = await executeLiveDiversityRound({
    roundId: round.roundId,
    protocol: FROZEN_ITERATION_PANEL_PROTOCOL,
    cases: FROZEN_LIVE_DIVERSITY_COHORT,
    baselines: M6_2_LIVE_COMPARISON_FINGERPRINTS,
    expectedExposureState: authorization.expectedExposureState,
    config,
    store,
    transportForCase: () => new OpenAITransportV2({
      apiKey: config.liveTransport!.apiKey,
      prompt: config.liveTransport!.interpretationPrompt,
      promptCacheKey: identity.candidate.promptCacheKey,
      references: []
    }),
    promptHash: actualPromptHash,
    submissionForCase: ({ brief }) => GenerationSubmissionV2Schema.parse({
      schemaVersion: "2.0",
      brief,
      references: [],
      roleConstraints: [],
      deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
      fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
      retry: null
    })
  });
  await writeEvidenceExclusive(output, {
    ...report,
    authorization: {
      path: authorizationPath,
      authorizedAt: authorization.authorizedAt,
      expiresAt: authorization.expiresAt,
      builderReview: authorization.builderReview
    }
  });
  const context = await activeRoundContext();
  await writeResume({
    campaignPath: context.campaignPath,
    roundPath: context.roundPath,
    stage: "round-complete",
    nextCommand: withManifestEnvironment({
      campaignPath: context.campaignPath,
      roundPath: context.roundPath,
      command: `npm run evaluate:live -- --summarize ${output} docs/evidence/calibration/${round.roundId}-summary.json`
    })
  });
  process.stdout.write(`Completed ${round.roundId}: ${report.summary.pass ? "PASS" : "FAIL"}.\n`);
}

async function executeHoldout(input: {
  authorizationPath: string;
  iterationReportPath: string;
  panelPath: string;
  outputPath: string;
  referencePayloadsPath?: string;
}): Promise<void> {
  const { campaign, round } = await activeRoundContext();
  if (round.kind !== "holdout") throw new Error("CALIBRATION_HOLDOUT_AUTHORIZATION_KIND_REQUIRED");
  const authorization = HoldoutAuthorizationSchema.parse(JSON.parse(
    await readFile(evidencePath(input.authorizationPath), "utf8"),
  ));
  if (authorization.roundId !== round.roundId ||
      authorization.sealedHoldoutCommitment !== round.commitment.commitment ||
      authorization.sealedPanelDigest !== round.commitment.panelDigest ||
      authorization.comparatorMappingDigest !== round.commitment.comparatorMappingDigest ||
      authorization.iterationReportHash !== round.iterationReportHash) {
    throw new Error("CALIBRATION_HOLDOUT_AUTHORIZATION_MISMATCH");
  }
  const now = Date.now();
  if (Date.parse(authorization.authorizedAt) > now || Date.parse(authorization.expiresAt) <= now) {
    throw new Error("LIVE_DIVERSITY_AUTHORIZATION_EXPIRED_OR_FUTURE");
  }
  const iterationBytes = await readFile(evidencePath(input.iterationReportPath));
  const iterationReport = JSON.parse(iterationBytes.toString("utf8")) as {
    summary?: { pass?: unknown };
  };
  if (await sha256(iterationBytes) !== authorization.iterationReportHash ||
      iterationReport.summary?.pass !== true) {
    throw new Error("LIVE_DIVERSITY_ITERATION_PASS_REQUIRED");
  }
  const panelBytes = await readFile(input.panelPath);
  const panel = SealedHoldoutPanelV1Schema.parse(JSON.parse(panelBytes.toString("utf8")));
  const policyReport = await verifyOpenedHoldoutPanel({
    panel,
    expectedCommitment: authorization.sealedHoldoutCommitment
  });
  if (!policyReport.pass || policyReport.panelDigest !== authorization.sealedPanelDigest ||
      policyReport.comparatorMappingDigest !== authorization.comparatorMappingDigest) {
    throw new Error("LIVE_DIVERSITY_OPENED_HOLDOUT_POLICY_FAILED");
  }
  const orderedCases = panel.protocol.cases.map((protocolCase) => {
    const candidate = panel.cases.find((item) => item.caseId === protocolCase.id);
    if (candidate === undefined) throw new Error("LIVE_DIVERSITY_HOLDOUT_CASE_MISSING");
    return candidate;
  });
  const inputHashes = await Promise.all(orderedCases.map((item) => sha256(item.syntheticBrief)));
  if (authorization.inputHashes.some((hash, index) => hash !== inputHashes[index])) {
    throw new Error("LIVE_DIVERSITY_HOLDOUT_INPUT_MISMATCH");
  }
  const totalReferences = orderedCases.reduce((sum, item) => sum + item.references.length, 0);
  let referencePayloads: z.infer<typeof HoldoutReferencePayloadsSchema> | null = null;
  if (totalReferences > 0) {
    if (input.referencePayloadsPath === undefined || authorization.referencePayloadsHash === null) {
      throw new Error("LIVE_DIVERSITY_HOLDOUT_REFERENCE_PAYLOADS_REQUIRED");
    }
    const bytes = await readFile(input.referencePayloadsPath);
    if (await sha256(bytes) !== authorization.referencePayloadsHash) {
      throw new Error("LIVE_DIVERSITY_HOLDOUT_REFERENCE_PAYLOAD_HASH_MISMATCH");
    }
    referencePayloads = HoldoutReferencePayloadsSchema.parse(JSON.parse(bytes.toString("utf8")));
  } else if (input.referencePayloadsPath !== undefined || authorization.referencePayloadsHash !== null) {
    throw new Error("LIVE_DIVERSITY_HOLDOUT_UNEXPECTED_REFERENCE_PAYLOADS");
  }
  const payloadByCase = new Map(referencePayloads?.cases.map((item) => [item.caseId, item]) ?? []);
  for (const holdoutCase of orderedCases) {
    const payload = payloadByCase.get(holdoutCase.caseId);
    if ((payload?.references.length ?? 0) !== holdoutCase.references.length) {
      throw new Error(`LIVE_DIVERSITY_HOLDOUT_REFERENCE_COUNT:${holdoutCase.caseId}`);
    }
    for (const reference of holdoutCase.references) {
      const dataUrl = payload?.references.find((item) =>
        item.referenceId === reference.descriptor.referenceId
      )?.dataUrl;
      if (dataUrl === undefined) throw new Error("LIVE_DIVERSITY_HOLDOUT_REFERENCE_MISSING");
      await verifyNormalizedReference({ descriptor: reference.descriptor, dataUrl });
    }
  }
  const environment = buildDevelopmentEnvironment("live", loadLocalEnvironment());
  Object.assign(process.env, {
    SKETCHYCUT_TEST_MODE: "0",
    SKETCHYCUT_GENERATION_MODE: "live",
    SKETCHYCUT_GENERATION_ENABLED: "1"
  });
  const config = readRuntimeConfig(environment);
  if (config.liveTransport === null) throw new Error("LIVE_DIVERSITY_TRANSPORT_CONFIG_MISSING");
  const identity = await frozenIdentity(config.liveTransport.interpretationPrompt);
  const compatibility = compareCalibrationIdentity({ campaign, candidate: identity.candidate, evaluation: identity.evaluation });
  if (!compatibility.compatible || identity.candidate.candidateHash !== round.candidate.candidateHash) {
    throw new Error("CALIBRATION_CAMPAIGN_OR_CANDIDATE_IDENTITY_MISMATCH");
  }
  const actualPromptHash = await currentProductionPromptHash(config);
  if (authorization.promptHash !== actualPromptHash ||
      authorization.componentManifestHash !== identity.componentManifest.manifestHash ||
      authorization.fullComponentManifestHash !== identity.fullManifest.manifestHash ||
      authorization.packageLockHash !== identity.packageLockHash) {
    throw new Error("LIVE_DIVERSITY_AUTHORIZED_COMPONENT_MISMATCH");
  }
  const store = createGenerationStore(config);
  const report = await executeLiveDiversityRound({
    roundId: authorization.roundId,
    protocol: panel.protocol,
    cases: orderedCases.map((item) => ({ id: item.caseId, brief: item.syntheticBrief })),
    baselines: Object.fromEntries(orderedCases.map((item) => [
      item.caseId,
      M6_2_LIVE_COMPARISON_FINGERPRINTS[item.comparatorClass]
    ])),
    expectedExposureState: authorization.expectedExposureState,
    config,
    store,
    transportForCase: ({ id }) => {
      const payload = payloadByCase.get(id);
      return new OpenAITransportV2({
        apiKey: config.liveTransport!.apiKey,
        prompt: config.liveTransport!.interpretationPrompt,
        promptCacheKey: identity.candidate.promptCacheKey,
        references: payload?.references ?? []
      });
    },
    promptHash: actualPromptHash,
    submissionForCase: ({ id, brief }) => {
      const holdoutCase = orderedCases.find((item) => item.caseId === id)!;
      const payload = payloadByCase.get(id);
      return GenerationSubmissionV2Schema.parse({
        schemaVersion: "2.0",
        brief,
        references: holdoutCase.references.map((reference) => ({
          descriptor: reference.descriptor,
          dataUrl: payload?.references.find((item) =>
            item.referenceId === reference.descriptor.referenceId
          )!.dataUrl
        })),
        roleConstraints: holdoutCase.references.map((reference) => ({
          referenceId: reference.descriptor.referenceId,
          roles: reference.declaredRoles
        })),
        deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
        fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
        retry: null
      });
    }
  });
  await writeEvidenceExclusive(input.outputPath, {
    ...report,
    authorization: {
      path: input.authorizationPath,
      authorizedAt: authorization.authorizedAt,
      expiresAt: authorization.expiresAt,
      builderReview: authorization.builderReview
    },
    openedPanel: panel,
    openedPanelSha256: await sha256(panelBytes),
    policyReport
  });
  const context = await activeRoundContext();
  await writeResume({
    campaignPath: context.campaignPath,
    roundPath: context.roundPath,
    stage: "round-complete",
    nextCommand: withManifestEnvironment({
      campaignPath: context.campaignPath,
      roundPath: context.roundPath,
      command: `npm run evaluate:live -- --summarize ${input.outputPath} docs/evidence/calibration/${round.roundId}-summary.json`
    })
  });
  process.stdout.write(`Completed ${authorization.roundId}: ${report.summary.pass ? "PASS" : "FAIL"}.\n`);
}

async function main(): Promise<void> {
  const [mode, first, second, third, fourth, fifth, sixth, seventh] = process.argv.slice(2);
  if (mode === "--start-campaign" && first !== undefined && second !== undefined &&
      third !== undefined && fourth === undefined) {
    await startCampaign({ campaignId: first, milestoneLabel: second, outputPath: third });
    return;
  }
  if (mode === "--register-round" && first !== undefined && second !== undefined &&
      third !== undefined && fourth !== undefined && fifth !== undefined &&
      sixth !== undefined && seventh !== undefined) {
    if (fourth !== "iteration" && fourth !== "holdout") throw new Error("CALIBRATION_ROUND_KIND_INVALID");
    const roundOrdinal = Number.parseInt(third, 10);
    if (!Number.isSafeInteger(roundOrdinal) || roundOrdinal < 1) throw new Error("CALIBRATION_ROUND_ORDINAL_INVALID");
    await registerRound({
      campaignPath: first,
      roundId: second,
      roundOrdinal,
      kind: fourth,
      commitmentPath: fifth,
      iterationReportHash: sixth === "-" ? null : Sha256Schema.parse(sixth),
      outputPath: seventh
    });
    return;
  }
  if (mode === "--inspect" && first !== undefined && third === undefined) {
    await inspectCampaign(first, second);
    return;
  }
  if (mode === "--summarize" && first !== undefined && second !== undefined && third === undefined) {
    await summarizeRound(first, second);
    return;
  }
  if (mode === "--close-campaign" && first !== undefined && second !== undefined && third === undefined) {
    await closeCampaign(first, second);
    return;
  }
  if (mode === "--prepare" && first !== undefined && second === undefined) {
    await prepare(first);
    return;
  }
  if (mode === "--execute" && first !== undefined && second !== undefined) {
    const context = await activeRoundContext();
    await writeResume({ campaignPath: context.campaignPath, roundPath: context.roundPath, stage: "execution-authorized", nextCommand: null });
    try {
      await execute(first, second);
    } catch (error) {
      await writeResume({ campaignPath: context.campaignPath, roundPath: context.roundPath, stage: "partial-stop", nextCommand: null });
      throw error;
    }
    return;
  }
  if (mode === "--inspect-exposure" && first !== undefined && second !== undefined &&
      third === undefined) {
    await inspectExposure(first, second);
    return;
  }
  if (mode === "--execute-holdout" && first !== undefined && second !== undefined &&
      third !== undefined && fourth !== undefined && fifth === undefined) {
    const context = await activeRoundContext();
    await writeResume({ campaignPath: context.campaignPath, roundPath: context.roundPath, stage: "execution-authorized", nextCommand: null });
    try {
      await executeHoldout({
        authorizationPath: first,
        iterationReportPath: second,
        panelPath: third,
        outputPath: fourth
      });
    } catch (error) {
      await writeResume({ campaignPath: context.campaignPath, roundPath: context.roundPath, stage: "partial-stop", nextCommand: null });
      throw error;
    }
    return;
  }
  if (mode === "--execute-holdout" && first !== undefined && second !== undefined &&
      third !== undefined && fourth !== undefined && fifth !== undefined) {
    const context = await activeRoundContext();
    await writeResume({ campaignPath: context.campaignPath, roundPath: context.roundPath, stage: "execution-authorized", nextCommand: null });
    try {
      await executeHoldout({
        authorizationPath: first,
        iterationReportPath: second,
        panelPath: third,
        outputPath: fourth,
        referencePayloadsPath: fifth
      });
    } catch (error) {
      await writeResume({ campaignPath: context.campaignPath, roundPath: context.roundPath, stage: "partial-stop", nextCommand: null });
      throw error;
    }
    return;
  }
  throw new Error("LIVE_DIVERSITY_USAGE: --start-campaign <id> <milestone|-> <output> | --register-round <campaign> <round-id> <ordinal> <iteration|holdout> <commitment-json> <iteration-report-hash|-> <output> | --inspect <campaign> [round] | --prepare <output> | --inspect-exposure <proposal> <output> | --execute <authorization> <output> | --execute-holdout <authorization> <iteration-report> <sealed-panel> <output> [reference-payloads] | --summarize <report> <output> | --close-campaign <campaign> <output>");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
