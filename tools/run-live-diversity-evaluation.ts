import { Redis } from "@upstash/redis";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { z } from "zod";

import { Sha256Schema } from "../src/domain/contracts.js";
import { hashCanonical, sha256 } from "../src/domain/hash.js";
import {
  assertRoundBelongsToCampaign,
  buildCalibrationCandidateIdentity,
  buildCalibrationEvaluationIdentity,
  CalibrationCampaignManifestV1Schema,
  CalibrationResumeV1Schema,
  CalibrationRoundManifestV1Schema,
  CalibrationStudyConfigurationIdSchema,
  compareCalibrationIdentity,
  summarizeCalibrationTokens,
  type CalibrationCampaignManifestV1,
  type CalibrationRoundManifestV1
} from "../src/evaluation/calibration-campaign.js";
import { executeLiveReferenceFidelityRound } from "../src/evaluation/live-reference-fidelity-evaluation.js";
import {
  REFERENCE_FIDELITY_STUDY_CASE_IDS,
  REFERENCE_FIDELITY_STUDY_CONFIGURATIONS,
  ReferenceFidelityManifestSchema,
  referenceFidelityStudyConfiguration,
  validateReferenceFidelityStudyDefinition
} from "../src/evaluation/reference-fidelity-study.js";
import { currentComponentManifestV2 } from "../src/interpretation/generation-outcome-v2.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
  GenerationSubmissionV2Schema,
  type GenerationSubmissionV2
} from "../src/interpretation/generation-submission-v2.js";
import { INTENT_GRAPH_V2_JSON_SCHEMA } from "../src/interpretation/intent-graph-v2.js";
import type { SemanticModelConfiguration } from "../src/interpretation/semantic-input-contracts.js";
import { readRuntimeConfig } from "../src/server/generation/config.js";
import { GlobalExposureStateSchema } from "../src/server/generation/contracts.js";
import {
  GENERATION_COST_ENVELOPE_POLICY
} from "../src/server/generation/cost-envelope.js";
import { verifyNormalizedReference } from "../src/server/generation/image-decoder.js";
import { generationKeys } from "../src/server/generation/keys.js";
import { OpenAITransportV2 } from "../src/server/generation/openai-transport-v2.js";
import { GENERATION_POLICY } from "../src/server/generation/policy.js";
import { instructionsForPromptLayout } from "../src/server/generation/reference-interpretation-prompt.js";
import { createGenerationStore } from "../src/server/generation/store.js";
import { DEFAULT_GENERATED_FABRICATION_CONTROLS } from "../src/ui/content/generated-setup.js";
import { buildDevelopmentEnvironment } from "./development.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const fiveCaseExposureMicrousd = 5 * GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd;
const currentProductionConfigurationId = "high-medium-stable-prefix" as const;
const corpusPath = "tests/fixtures/reference-fidelity/manifest.json";

type ActiveRoundContext = {
  campaignPath: string;
  roundPath: string;
  campaign: CalibrationCampaignManifestV1;
  round: CalibrationRoundManifestV1;
};

type FrozenStudyCase = {
  id: string;
  brief: string;
  contract: z.infer<typeof ReferenceFidelityManifestSchema>["cases"][number];
  submission: GenerationSubmissionV2;
  transportReferences: readonly { referenceId: string; dataUrl: string }[];
};

function evidencePath(candidate: string): string {
  if (path.isAbsolute(candidate) || candidate.split(/[\\/]/u).includes("..") ||
      !candidate.startsWith("docs/evidence/calibration/")) {
    throw new Error(`CALIBRATION_EVIDENCE_PATH:${candidate}`);
  }
  return path.join(repositoryRoot, candidate);
}

async function writeEvidenceExclusive(candidate: string, value: unknown): Promise<void> {
  const destination = evidencePath(candidate);
  await mkdir(path.dirname(destination), { recursive: true });
  const contents = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(destination, contents, { flag: "wx" });
}

async function readCampaign(candidate: string): Promise<CalibrationCampaignManifestV1> {
  return CalibrationCampaignManifestV1Schema.parse(JSON.parse(
    await readFile(evidencePath(candidate), "utf8"),
  ));
}

async function readRound(candidate: string): Promise<CalibrationRoundManifestV1> {
  return CalibrationRoundManifestV1Schema.parse(JSON.parse(
    await readFile(evidencePath(candidate), "utf8"),
  ));
}

async function updateRound(
  candidate: string,
  update: (round: CalibrationRoundManifestV1) => CalibrationRoundManifestV1,
): Promise<void> {
  const destination = evidencePath(candidate);
  const next = CalibrationRoundManifestV1Schema.parse(update(await readRound(candidate)));
  await writeFile(destination, `${JSON.stringify(next, null, 2)}\n`);
}

async function updateCampaign(
  candidate: string,
  update: (campaign: CalibrationCampaignManifestV1) => CalibrationCampaignManifestV1,
): Promise<void> {
  const destination = evidencePath(candidate);
  const next = CalibrationCampaignManifestV1Schema.parse(update(await readCampaign(candidate)));
  await writeFile(destination, `${JSON.stringify(next, null, 2)}\n`);
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

async function activeRoundContext(): Promise<ActiveRoundContext> {
  const campaignPath = process.env.SKETCHYCUT_CALIBRATION_CAMPAIGN_MANIFEST;
  const roundPath = process.env.SKETCHYCUT_CALIBRATION_ROUND_MANIFEST;
  if (campaignPath === undefined || roundPath === undefined) {
    throw new Error("CALIBRATION_MANIFEST_ENV_REQUIRED");
  }
  const [campaign, round] = await Promise.all([readCampaign(campaignPath), readRound(roundPath)]);
  assertRoundBelongsToCampaign({ campaign, round });
  return { campaignPath, roundPath, campaign, round };
}

const FULL_COMPONENT_SOURCE_PATHS = [
  "package.json",
  "package-lock.json",
  "docs/runtime/semantic-interpretation-prompt.txt",
  "src/version.ts",
  "src/evaluation/calibration-campaign.ts",
  "src/evaluation/dispatch-only-semantic-cache.ts",
  "src/evaluation/live-evaluation-runner.ts",
  "src/evaluation/live-reference-fidelity-evaluation.ts",
  "src/evaluation/reference-fidelity-predicates.ts",
  "src/evaluation/reference-fidelity-study.ts",
  "src/interpretation/source-evidence.ts",
  "src/interpretation/semantic-request-v2.ts",
  "src/interpretation/intent-graph-v2.ts",
  "src/interpretation/realization-ledger.ts",
  "src/interpretation/observation-realization.ts",
  "src/interpretation/generation-outcome-v2.ts",
  "src/interpretation/constraint-sizing-solver.ts",
  "src/interpretation/topology-synthesis.ts",
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
  "src/server/generation/reference-interpretation-prompt.ts",
  "tools/development.ts",
  "tools/run-live-diversity-evaluation.ts",
  corpusPath
] as const;

async function filesUnderSource(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnderSource(candidate) : [candidate];
  }))).flat();
}

async function fullComponentManifest() {
  const sourceTreePaths = (await filesUnderSource(path.join(repositoryRoot, "src"))).map((file) =>
    path.relative(repositoryRoot, file).split(path.sep).join("/")
  );
  const sourcePaths = [...new Set([...FULL_COMPONENT_SOURCE_PATHS, ...sourceTreePaths])].sort();
  const source = await Promise.all(sourcePaths.map(async (relativePath) => ({
    path: relativePath,
    sha256: await sha256(await readFile(path.join(repositoryRoot, relativePath)))
  })));
  const manifest = {
    schemaVersion: "sketchycut-full-component-manifest@1.2.0",
    source
  };
  return { ...manifest, manifestHash: await hashCanonical(manifest) };
}

function modelConfiguration(
  configuration: ReturnType<typeof referenceFidelityStudyConfiguration>,
): SemanticModelConfiguration {
  return {
    modelId: configuration.modelId,
    reasoningEffort: configuration.reasoningEffort,
    imageDetailPolicy: configuration.imageDetailPolicy,
    promptLayoutVersion: configuration.promptLayoutVersion,
    maxOutputTokens: configuration.maxOutputTokens,
    serviceTier: configuration.serviceTier,
    store: configuration.store
  };
}

async function frozenStudyCases(): Promise<{
  cases: readonly FrozenStudyCase[];
  inputHashes: readonly string[];
  cohortHash: string;
  protocolHash: string;
  comparatorHash: string;
}> {
  validateReferenceFidelityStudyDefinition();
  const manifestBytes = await readFile(path.join(repositoryRoot, corpusPath));
  const manifest = ReferenceFidelityManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const references = new Map(manifest.references.map((item) => [item.id, item]));
  for (const reference of manifest.references) {
    const bytes = await readFile(path.join(repositoryRoot, reference.path));
    if (await sha256(bytes) !== reference.sha256) {
      throw new Error(`REFERENCE_FIDELITY_REFERENCE_HASH_MISMATCH:${reference.id}`);
    }
  }
  const contracts = REFERENCE_FIDELITY_STUDY_CASE_IDS.map((caseId) => {
    const contract = manifest.cases.find((item) => item.id === caseId);
    if (contract === undefined) throw new Error(`REFERENCE_FIDELITY_CASE_MISSING:${caseId}`);
    return contract;
  });
  const cases: FrozenStudyCase[] = [];
  for (const contract of contracts) {
    const selected = contract.referenceIds.map((id) => references.get(id)!);
    const payloads = await Promise.all(selected.map(async (reference) => {
      const bytes = await readFile(path.join(repositoryRoot, reference.path));
      const descriptor = {
        referenceId: reference.id,
        sha256: reference.sha256,
        mediaType: "image/png" as const,
        width: reference.width,
        height: reference.height
      };
      const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
      await verifyNormalizedReference({ descriptor, dataUrl });
      return { descriptor, dataUrl };
    }));
    const roleConstraints = contract.roleConstraints.flatMap((roles, index) =>
      roles.length === 0 ? [] : [{ referenceId: selected[index]!.id, roles }]);
    cases.push({
      id: contract.id,
      brief: contract.brief,
      contract,
      submission: GenerationSubmissionV2Schema.parse({
        schemaVersion: "2.0",
        brief: contract.brief,
        references: payloads,
        roleConstraints,
        deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
        fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
        retry: null
      }),
      transportReferences: payloads.map((item) => ({
        referenceId: item.descriptor.referenceId,
        dataUrl: item.dataUrl
      }))
    });
  }
  const inputHashes = await Promise.all(cases.map((item) => hashCanonical({
    id: item.id,
    brief: item.brief,
    descriptors: item.submission.references.map((reference) => reference.descriptor),
    roleConstraints: item.submission.roleConstraints,
    expectedRelationships: item.contract.expectedRelationships,
    relationshipAcceptance: item.contract.relationshipAcceptance,
    expectedOutcome: item.contract.expectedOutcome,
    outcomeAcceptance: item.contract.outcomeAcceptance,
    predicateCodes: item.contract.predicateCodes
  })));
  return {
    cases,
    inputHashes,
    cohortHash: await hashCanonical({
      corpusId: manifest.corpusId,
      manifestHash: await sha256(manifestBytes),
      studyCaseIds: REFERENCE_FIDELITY_STUDY_CASE_IDS,
      inputHashes
    }),
    protocolHash: await hashCanonical(contracts.map((item) => ({
      id: item.id,
      expectedRelationships: item.expectedRelationships,
      relationshipAcceptance: item.relationshipAcceptance,
      expectedOutcome: item.expectedOutcome,
      outcomeAcceptance: item.outcomeAcceptance,
      predicateCodes: item.predicateCodes
    }))),
    comparatorHash: await hashCanonical({
      configurations: REFERENCE_FIDELITY_STUDY_CONFIGURATIONS,
      metrics: [
        "strict-parse-rate",
        "outcome-acceptance-rate",
        "ordered-reference-coverage-rate",
        "relationship-acceptance-rate",
        "predicate-rate",
        "categorized-token-usage",
        "latency",
        "estimated-cost"
      ]
    })
  };
}

async function frozenIdentity(
  prompt: string,
  configurationId: z.infer<typeof CalibrationStudyConfigurationIdSchema>,
) {
  const configuration = referenceFidelityStudyConfiguration(configurationId);
  const [componentManifest, fullManifest, packageLockHash, suite, intentSchemaHash, scorerHash] = await Promise.all([
    currentComponentManifestV2(),
    fullComponentManifest(),
    sha256(await readFile(path.join(repositoryRoot, "package-lock.json"))),
    frozenStudyCases(),
    hashCanonical(INTENT_GRAPH_V2_JSON_SCHEMA),
    Promise.all([
      "src/evaluation/reference-fidelity-predicates.ts",
      "src/evaluation/live-reference-fidelity-evaluation.ts"
    ].map(async (relativePath) => ({
      path: relativePath,
      sha256: await sha256(await readFile(path.join(repositoryRoot, relativePath)))
    }))).then(hashCanonical)
  ]);
  const promptHash = await sha256(instructionsForPromptLayout(prompt, configuration.promptLayoutVersion));
  const candidate = await buildCalibrationCandidateIdentity({
    modelId: configuration.modelId,
    reasoningEffort: configuration.reasoningEffort,
    imageDetailPolicy: configuration.imageDetailPolicy,
    promptLayoutVersion: configuration.promptLayoutVersion,
    promptHash,
    intentSchemaHash,
    capabilityCatalogHash: componentManifest.capabilityCatalogHash,
    componentManifestHash: componentManifest.manifestHash,
    fullComponentManifestHash: fullManifest.manifestHash,
    packageLockHash
  });
  const evaluation = await buildCalibrationEvaluationIdentity({
    suiteId: "reference-fidelity-v1",
    cohortHash: suite.cohortHash,
    protocolHash: suite.protocolHash,
    scorerHash,
    comparatorHash: suite.comparatorHash,
    capabilityBoundaryHash: await hashCanonical({
      intentSchemaHash,
      capabilityCatalogHash: componentManifest.capabilityCatalogHash,
      operatorRegistryHash: componentManifest.operatorRegistryHash
    }),
    intentSchemaHash,
    dispatchPolicyHash: await hashCanonical({
      maximumDispatches: 5,
      candidatesPerCase: 1,
      retries: 0,
      fallback: false,
      cacheSubstitution: false,
      fanOut: false,
      selectiveReruns: false,
      automaticRepair: false,
      bestOf: false
    }),
    costPolicyHash: await hashCanonical({
      envelope: GENERATION_COST_ENVELOPE_POLICY,
      studyConfigurations: REFERENCE_FIDELITY_STUDY_CONFIGURATIONS,
      maximumAggregateExposureMicrousd: fiveCaseExposureMicrousd
    })
  });
  return {
    configuration,
    modelConfiguration: modelConfiguration(configuration),
    componentManifest,
    fullManifest,
    packageLockHash,
    suite,
    candidate,
    evaluation
  };
}

async function currentFrozenIdentity(
  configurationId: z.infer<typeof CalibrationStudyConfigurationIdSchema>,
) {
  const prompt = await readFile(
    path.join(repositoryRoot, "docs/runtime/semantic-interpretation-prompt.txt"),
    "utf8",
  );
  return { prompt, identity: await frozenIdentity(prompt, configurationId) };
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
  const { identity } = await currentFrozenIdentity(currentProductionConfigurationId);
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
    notes: [
      "New M7.1 campaign; no M6.3 round or burned panel is resumed.",
      "Each predeclared configuration is a separately authorized five-case iteration."
    ]
  });
  await writeEvidenceExclusive(input.outputPath, campaign);
  await writeResume({
    campaignPath: input.outputPath,
    roundPath: null,
    stage: "campaign-open",
    nextCommand: `npm run evaluate:live -- --register-study-round ${input.outputPath} <round-id> <ordinal> <configuration-id> <output>`
  });
  process.stdout.write(`Started zero-call M7.1 calibration campaign ${campaign.campaignId}.\n`);
}

async function registerStudyRound(input: {
  campaignPath: string;
  roundId: string;
  roundOrdinal: number;
  configurationId: z.infer<typeof CalibrationStudyConfigurationIdSchema>;
  outputPath: string;
}): Promise<void> {
  const campaign = await readCampaign(input.campaignPath);
  const { identity } = await currentFrozenIdentity(input.configurationId);
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
    kind: "iteration",
    studyConfigurationId: input.configurationId,
    status: "registered",
    candidate: identity.candidate,
    evaluationIdentityHash: identity.evaluation.evaluationIdentityHash,
    commitment: null,
    iterationReportHash: null,
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
  process.stdout.write(`Registered zero-call M7.1 study round ${round.roundId}.\n`);
}

async function inspectCampaign(campaignPath: string, roundPath?: string): Promise<void> {
  const campaign = await readCampaign(campaignPath);
  const round = roundPath === undefined ? null : await readRound(roundPath);
  if (round !== null && (round.campaignId !== campaign.campaignId ||
      round.evaluationIdentityHash !== campaign.evaluation.evaluationIdentityHash)) {
    throw new Error("CALIBRATION_ROUND_CAMPAIGN_MISMATCH");
  }
  const configurationId = round?.studyConfigurationId ?? currentProductionConfigurationId;
  const { identity } = await currentFrozenIdentity(configurationId);
  const compatibility = compareCalibrationIdentity({
    campaign,
    candidate: identity.candidate,
    evaluation: identity.evaluation
  });
  const resumePath = path.join(repositoryRoot, "docs/evidence/calibration/resume.json");
  const resume = existsSync(resumePath)
    ? CalibrationResumeV1Schema.parse(JSON.parse(await readFile(resumePath, "utf8")))
    : null;
  const activeResume = resume !== null && resume.campaignPath === campaignPath &&
    resume.roundPath === (roundPath ?? null) ? resume : null;
  const nextAction = !compatibility.compatible
    ? "Start a new campaign before any connected read or dispatch."
    : round === null
      ? "Register one predeclared five-case study configuration."
      : activeResume?.stage === "partial-stop"
        ? "Stop and reconcile the partial dispatch and exposure state; never rerun automatically."
        : activeResume?.stage === "round-complete"
          ? "Review the compact summary before selecting another predeclared configuration."
          : "Continue only after the exact authorization named by the resume state.";
  process.stdout.write(`${JSON.stringify({
    campaign,
    round,
    resume: activeResume,
    currentCandidate: identity.candidate,
    currentEvaluation: identity.evaluation,
    compatibility,
    nextAction
  }, null, 2)}\n`);
}

async function prepare(output: string): Promise<void> {
  const context = await activeRoundContext();
  const { campaign, round } = context;
  if (round.kind !== "iteration") throw new Error("REFERENCE_FIDELITY_STUDY_ROUND_REQUIRED");
  const { identity } = await currentFrozenIdentity(round.studyConfigurationId);
  const compatibility = compareCalibrationIdentity({
    campaign,
    candidate: identity.candidate,
    evaluation: identity.evaluation
  });
  if (!compatibility.compatible || identity.candidate.candidateHash !== round.candidate.candidateHash) {
    throw new Error("CALIBRATION_CAMPAIGN_OR_CANDIDATE_IDENTITY_MISMATCH");
  }
  const proposal = {
    schemaVersion: "sketchycut-reference-fidelity-proposal@1.0.0",
    status: "pending-builder-approval",
    campaignId: campaign.campaignId,
    roundId: round.roundId,
    roundKind: round.kind,
    studyConfigurationId: round.studyConfigurationId,
    candidateHash: identity.candidate.candidateHash,
    evaluationIdentityHash: identity.evaluation.evaluationIdentityHash,
    promptHash: identity.candidate.promptHash,
    componentManifestHash: identity.componentManifest.manifestHash,
    fullComponentManifestHash: identity.fullManifest.manifestHash,
    packageLockHash: identity.packageLockHash,
    cohortHash: identity.evaluation.cohortHash,
    protocolHash: identity.evaluation.protocolHash,
    scorerHash: identity.evaluation.scorerHash,
    inputHashes: identity.suite.inputHashes,
    maximumDispatches: 5,
    maximumAggregateExposureMicrousd: fiveCaseExposureMicrousd,
    expectedExposureState: null,
    authorizationExpiresAt: null,
    limitations: [
      "Preparation makes zero model and durable-store calls.",
      "The frozen five-case corpus contains only project-authored synthetic references.",
      "A separately exact read-only connected exposure authorization is still required.",
      "A separately exact five-dispatch model-call authorization is still required.",
      "No sealed holdout is opened or authorized by this proposal."
    ]
  };
  await writeEvidenceExclusive(output, proposal);
  await updateRound(context.roundPath, (current) => ({ ...current, status: "prepared" }));
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
  process.stdout.write(`Prepared zero-call M7.1 authorization proposal ${round.roundId}.\n`);
}

function requiredEnvironmentAlias(
  environment: NodeJS.ProcessEnv,
  names: readonly string[],
  errorCode: string,
): string {
  for (const name of names) {
    const value = environment[name];
    if (value !== undefined && value.length > 0) return value;
  }
  throw new Error(errorCode);
}

async function readExposureWithoutWrites(environment: NodeJS.ProcessEnv) {
  const url = requiredEnvironmentAlias(environment, [
    "UPSTASH_REDIS_REST_URL",
    "sketchycut_KV_REST_API_URL",
    "KV_REST_API_URL"
  ], "CALIBRATION_READ_ONLY_UPSTASH_URL_MISSING");
  const token = requiredEnvironmentAlias(environment, [
    "UPSTASH_REDIS_REST_READ_ONLY_TOKEN",
    "sketchycut_KV_REST_API_READ_ONLY_TOKEN",
    "KV_REST_API_READ_ONLY_TOKEN"
  ], "CALIBRATION_READ_ONLY_UPSTASH_TOKEN_MISSING");
  const redis = new Redis({ url, token });
  const record = await redis.hgetall<Record<string, string | number>>(generationKeys.globalExposure());
  return parseReadOnlyExposureRecord(record);
}

export function parseReadOnlyExposureRecord(
  record: Record<string, string | number> | null,
) {
  if (record?.authorizedCeilingMicrousd === undefined ||
      record.reservedExposureMicrousd === undefined || record.authorizationVersion === undefined) {
    throw new Error("CALIBRATION_READ_ONLY_EXPOSURE_STATE_MISSING");
  }
  return GlobalExposureStateSchema.parse({
    schemaVersion: "1.0",
    authorizedCeilingMicrousd: Number(record.authorizedCeilingMicrousd),
    reservedExposureMicrousd: Number(record.reservedExposureMicrousd),
    authorizationVersion: Number(record.authorizationVersion)
  });
}

async function inspectExposure(proposalPath: string, output: string): Promise<void> {
  const context = await activeRoundContext();
  const proposalBytes = await readFile(evidencePath(proposalPath));
  const proposal = JSON.parse(proposalBytes.toString("utf8")) as {
    roundId?: unknown;
    status?: unknown;
    maximumAggregateExposureMicrousd?: unknown;
  };
  if (proposal.roundId !== context.round.roundId || proposal.status !== "pending-builder-approval" ||
      proposal.maximumAggregateExposureMicrousd !== fiveCaseExposureMicrousd) {
    throw new Error("REFERENCE_FIDELITY_PROPOSAL_INVALID");
  }
  const exposure = await readExposureWithoutWrites(loadLocalEnvironment());
  const availableExposureMicrousd = exposure.authorizedCeilingMicrousd - exposure.reservedExposureMicrousd;
  await writeEvidenceExclusive(output, {
    schemaVersion: "sketchycut-reference-fidelity-exposure-preflight@1.0.0",
    roundId: context.round.roundId,
    proposalPath,
    proposalSha256: await sha256(proposalBytes),
    observedAt: new Date().toISOString(),
    expectedExposureState: exposure,
    availableExposureMicrousd,
    requiredExposureMicrousd: fiveCaseExposureMicrousd,
    sufficient: availableExposureMicrousd >= fiveCaseExposureMicrousd,
    credentialClass: "read-only",
    modelRequests: 0,
    storeWrites: 0
  });
  await writeResume({
    campaignPath: context.campaignPath,
    roundPath: context.roundPath,
    stage: "authorization-required",
    nextCommand: null
  });
  process.stdout.write(`Read-only exposure preflight ${availableExposureMicrousd >= fiveCaseExposureMicrousd ? "PASS" : "FAIL"}.\n`);
}

const AuthorizationSchema = z.object({
  schemaVersion: z.literal("sketchycut-reference-fidelity-authorization@1.0.0"),
  status: z.literal("approved"),
  roundId: z.string().min(1).max(160),
  roundKind: z.literal("iteration"),
  studyConfigurationId: CalibrationStudyConfigurationIdSchema,
  authorizedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  cohortHash: Sha256Schema,
  protocolHash: Sha256Schema,
  scorerHash: Sha256Schema,
  promptHash: Sha256Schema,
  componentManifestHash: Sha256Schema,
  fullComponentManifestHash: Sha256Schema,
  packageLockHash: Sha256Schema,
  inputHashes: z.array(Sha256Schema).length(5),
  maximumDispatches: z.literal(5),
  maximumAggregateExposureMicrousd: z.literal(fiveCaseExposureMicrousd),
  expectedExposureState: GlobalExposureStateSchema,
  builderReview: z.string().trim().min(1).max(500)
}).strict();

async function execute(authorizationPath: string, output: string): Promise<void> {
  const context = await activeRoundContext();
  const { campaign, round } = context;
  if (round.kind !== "iteration") throw new Error("CALIBRATION_ITERATION_AUTHORIZATION_KIND_REQUIRED");
  const authorization = AuthorizationSchema.parse(JSON.parse(
    await readFile(evidencePath(authorizationPath), "utf8"),
  ));
  if (authorization.roundId !== round.roundId ||
      authorization.studyConfigurationId !== round.studyConfigurationId) {
    throw new Error("REFERENCE_FIDELITY_AUTHORIZATION_ROUND_MISMATCH");
  }
  const now = Date.now();
  if (Date.parse(authorization.authorizedAt) > now || Date.parse(authorization.expiresAt) <= now) {
    throw new Error("REFERENCE_FIDELITY_AUTHORIZATION_EXPIRED_OR_FUTURE");
  }
  const environment = buildDevelopmentEnvironment("live", loadLocalEnvironment());
  const guardedLiveEnvironment = {
    SKETCHYCUT_TEST_MODE: "0",
    SKETCHYCUT_GENERATION_MODE: "live",
    SKETCHYCUT_GENERATION_ENABLED: "1",
    SKETCHYCUT_QUOTA_UNLIMITED: "0"
  } as const;
  Object.assign(environment, guardedLiveEnvironment);
  Object.assign(process.env, guardedLiveEnvironment);
  const config = readRuntimeConfig(environment);
  if (config.quotaUnlimited) throw new Error("REFERENCE_FIDELITY_QUOTA_BYPASS_FORBIDDEN");
  if (config.liveTransport === null) throw new Error("REFERENCE_FIDELITY_TRANSPORT_CONFIG_MISSING");
  const identity = await frozenIdentity(
    config.liveTransport.interpretationPrompt,
    round.studyConfigurationId,
  );
  const compatibility = compareCalibrationIdentity({
    campaign,
    candidate: identity.candidate,
    evaluation: identity.evaluation
  });
  if (!compatibility.compatible || identity.candidate.candidateHash !== round.candidate.candidateHash) {
    throw new Error("CALIBRATION_CAMPAIGN_OR_CANDIDATE_IDENTITY_MISMATCH");
  }
  const expectedBindings = [
    authorization.cohortHash === identity.evaluation.cohortHash,
    authorization.protocolHash === identity.evaluation.protocolHash,
    authorization.scorerHash === identity.evaluation.scorerHash,
    authorization.promptHash === identity.candidate.promptHash,
    authorization.componentManifestHash === identity.componentManifest.manifestHash,
    authorization.fullComponentManifestHash === identity.fullManifest.manifestHash,
    authorization.packageLockHash === identity.packageLockHash,
    authorization.inputHashes.every((hash, index) => hash === identity.suite.inputHashes[index])
  ];
  if (expectedBindings.some((item) => !item)) {
    throw new Error("REFERENCE_FIDELITY_AUTHORIZED_COMPONENT_MISMATCH");
  }
  const caseById = new Map(identity.suite.cases.map((item) => [item.id, item]));
  const store = createGenerationStore(config);
  const report = await executeLiveReferenceFidelityRound({
    roundId: round.roundId,
    studyConfigurationId: round.studyConfigurationId,
    contracts: identity.suite.cases.map((item) => item.contract),
    cases: identity.suite.cases.map((item) => ({ id: item.id, brief: item.brief })),
    expectedExposureState: authorization.expectedExposureState,
    config,
    store,
    modelConfiguration: identity.modelConfiguration,
    transportForCase: ({ id }) => {
      const studyCase = caseById.get(id);
      if (studyCase === undefined) throw new Error(`REFERENCE_FIDELITY_CASE_MISSING:${id}`);
      return new OpenAITransportV2({
        apiKey: config.liveTransport!.apiKey,
        prompt: config.liveTransport!.interpretationPrompt,
        promptCacheKey: identity.candidate.promptCacheKey,
        references: studyCase.transportReferences
      });
    },
    promptHash: identity.candidate.promptHash,
    submissionForCase: ({ id }) => {
      const studyCase = caseById.get(id);
      if (studyCase === undefined) throw new Error(`REFERENCE_FIDELITY_CASE_MISSING:${id}`);
      return studyCase.submission;
    }
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

async function summarizeRound(reportPath: string, outputPath: string): Promise<void> {
  const context = await activeRoundContext();
  const reportBytes = await readFile(evidencePath(reportPath));
  const report = JSON.parse(reportBytes.toString("utf8")) as {
    roundId?: unknown;
    studyConfigurationId?: unknown;
    promptHash?: unknown;
    ledgerAttemptDelta?: unknown;
    ledgerDispatchDelta?: unknown;
    exposureBefore?: unknown;
    exposureAfter?: unknown;
    summary?: unknown;
    scores?: unknown;
    cases?: { caseId?: unknown; result?: unknown; ledgerAttempt?: Parameters<typeof summarizeCalibrationTokens>[0][number] }[];
  };
  if (report.roundId !== context.round.roundId || !Array.isArray(report.cases) ||
      report.cases.length !== 5 || report.cases.some((item) => item.ledgerAttempt === undefined)) {
    throw new Error("REFERENCE_FIDELITY_REPORT_INVALID");
  }
  const tokenSummary = summarizeCalibrationTokens(report.cases.map((item) => item.ledgerAttempt!));
  const compact = {
    schemaVersion: "sketchycut-reference-fidelity-summary@1.0.0",
    roundId: report.roundId,
    studyConfigurationId: report.studyConfigurationId,
    reportHash: await sha256(reportBytes),
    promptHash: report.promptHash,
    ledgerAttemptDelta: report.ledgerAttemptDelta,
    ledgerDispatchDelta: report.ledgerDispatchDelta,
    exposureBefore: report.exposureBefore,
    exposureAfter: report.exposureAfter,
    summary: report.summary,
    scores: report.scores,
    tokenSummary,
    caseOutcomes: report.cases.map((item) => ({
      caseId: item.caseId,
      outcome: (item.result as { outcome?: unknown } | undefined)?.outcome
    }))
  };
  await writeEvidenceExclusive(outputPath, compact);
  const summaryBytes = await readFile(evidencePath(outputPath));
  const summaryHash = await sha256(summaryBytes);
  await updateRound(context.roundPath, (round) => ({
    ...round,
    status: (report.summary as { pass?: unknown } | undefined)?.pass === true ? "completed" : "failed",
    resultHash: compact.reportHash,
    summaryHash
  }));
  await writeResume({
    campaignPath: context.campaignPath,
    roundPath: context.roundPath,
    stage: "round-complete",
    nextCommand: `npm run evaluate:live -- --inspect ${context.campaignPath} ${context.roundPath}`
  });
  process.stdout.write(`Wrote compact M7.1 summary ${outputPath}.\n`);
}

async function closeCampaign(campaignPath: string): Promise<void> {
  const campaign = await readCampaign(campaignPath);
  if (campaign.status !== "open") throw new Error("CALIBRATION_CAMPAIGN_ALREADY_CLOSED");
  await updateCampaign(campaignPath, (current) => ({
    ...current,
    status: "closed",
    closedAt: new Date().toISOString()
  }));
  await writeResume({
    campaignPath,
    roundPath: null,
    stage: "campaign-closed",
    nextCommand: null
  });
  process.stdout.write(`Closed calibration campaign ${campaign.campaignId}.\n`);
}

function positiveOrdinal(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("CALIBRATION_ROUND_ORDINAL_INVALID");
  return parsed;
}

async function main(): Promise<void> {
  const [mode, first, second, third, fourth, fifth] = process.argv.slice(2);
  if (mode === "--start-campaign" && first !== undefined && second !== undefined &&
      third !== undefined && fourth === undefined) {
    await startCampaign({ campaignId: first, milestoneLabel: second, outputPath: third });
    return;
  }
  if (mode === "--register-study-round" && first !== undefined && second !== undefined &&
      third !== undefined && fourth !== undefined && fifth !== undefined) {
    await registerStudyRound({
      campaignPath: first,
      roundId: second,
      roundOrdinal: positiveOrdinal(third),
      configurationId: CalibrationStudyConfigurationIdSchema.parse(fourth),
      outputPath: fifth
    });
    return;
  }
  if (mode === "--inspect" && first !== undefined && third === undefined) {
    await inspectCampaign(first, second);
    return;
  }
  if (mode === "--prepare" && first !== undefined && second === undefined) {
    await prepare(first);
    return;
  }
  if (mode === "--inspect-exposure" && first !== undefined && second !== undefined && third === undefined) {
    await inspectExposure(first, second);
    return;
  }
  if (mode === "--execute" && first !== undefined && second !== undefined && third === undefined) {
    const context = await activeRoundContext();
    await writeResume({
      campaignPath: context.campaignPath,
      roundPath: context.roundPath,
      stage: "execution-authorized",
      nextCommand: null
    });
    try {
      await execute(first, second);
    } catch (error) {
      await updateRound(context.roundPath, (round) => ({ ...round, status: "partial" }));
      await writeResume({
        campaignPath: context.campaignPath,
        roundPath: context.roundPath,
        stage: "partial-stop",
        nextCommand: null
      });
      throw error;
    }
    return;
  }
  if (mode === "--summarize" && first !== undefined && second !== undefined && third === undefined) {
    await summarizeRound(first, second);
    return;
  }
  if (mode === "--close-campaign" && first !== undefined && second === undefined) {
    await closeCampaign(first);
    return;
  }
  throw new Error(
    "REFERENCE_FIDELITY_USAGE: --start-campaign <id> <milestone|-> <output> | " +
    "--register-study-round <campaign> <round-id> <ordinal> <configuration-id> <output> | " +
    "--inspect <campaign> [round] | --prepare <output> | " +
    "--inspect-exposure <proposal> <output> | --execute <authorization> <output> | " +
    "--summarize <report> <output> | --close-campaign <campaign>",
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
