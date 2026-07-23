import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { hashCanonical, sha256 } from "../src/domain/hash.js";
import {
  blockedSemanticEvaluationSummary,
  createRunOwnedGenerationStore,
  SEMANTIC_EVALUATION_POLICIES,
  SemanticEvaluationExecutionError,
  SemanticEvaluationHardAnomalySchema,
  SemanticEvaluationModeSchema,
  SemanticEvaluationSummarySchema,
  runSemanticEvaluationBatch,
  semanticEvaluationExitCode,
  semanticCandidateAtomKindsByItemId,
  summarizeGenerationOutcome,
  summarizeSemanticEvaluationDiagnostics,
  writeSemanticEvaluationArtifact,
  type SemanticEvaluationHardAnomaly,
  type SemanticEvaluationMode,
  type SemanticEvaluationRawCaseResult
} from "../src/evaluation/semantic-live-evaluator.js";
import {
  SEMANTIC_GENERALIZATION_CORPUS
} from "../src/evaluation/semantic-generalization.js";
import {
  scoreSemanticCaseOracle
} from "../src/evaluation/semantic-generalization-oracle.js";
import { DispatchOnlySemanticCache } from "../src/evaluation/dispatch-only-semantic-cache.js";
import { CAPABILITY_CATALOG } from "../src/interpretation/capability-catalog.js";
import {
  semanticAtomTemplateRegistryHash
} from "../src/interpretation/semantic-atom-registry.js";
import {
  semanticInterpretationProviderSchema
} from "../src/interpretation/semantic-model-contract.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
  GenerationSubmissionSchema,
  type GenerationSubmission
} from "../src/interpretation/generation-submission.js";
import type { LiveCallAttempt } from "../src/interpretation/live-ledger.js";
import {
  CURRENT_PROMPT_IDENTITY,
  prepareSemanticGenerationRequest
} from "../src/interpretation/semantic-request.js";
import {
  CURRENT_IMAGE_DETAIL_POLICY,
  CURRENT_PROMPT_LAYOUT_VERSION,
  CURRENT_REASONING_EFFORT,
  SemanticModelConfigurationSchema
} from "../src/interpretation/semantic-input-contracts.js";
import {
  readRuntimeConfig,
  readUpstashConfig
} from "../src/server/generation/config.js";
import type { GenerationStore, GlobalExposureState, SessionRecord } from "../src/server/generation/contracts.js";
import {
  GENERATION_OPENAI_MAX_RETRIES,
  GENERATION_OPENAI_MODEL,
  GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT,
  GENERATION_OPENAI_PRICE
} from "../src/server/generation/cost-envelope.js";
import {
  currentProductionPromptHash,
  executeCurrentGeneration
} from "../src/server/generation/generation-service.js";
import {
  summarizeLedger
} from "../src/server/generation/exposure-authorization.js";
import { verifyNormalizedReference } from "../src/server/generation/image-decoder.js";
import { OpenAITransport } from "../src/server/generation/openai-transport.js";
import {
  instructionsForPromptLayout
} from "../src/server/generation/semantic-interpretation-prompt.js";
import { UpstashGenerationStore } from "../src/server/generation/upstash-store.js";
import { GENERATION_POLICY } from "../src/server/generation/policy.js";
import { DEFAULT_GENERATED_FABRICATION_CONTROLS } from "../src/ui/content/generated-setup.js";
import {
  SEMANTIC_EVALUATION_CAMPAIGN_SLUG,
  SEMANTIC_EVALUATION_CASE_PROFILES,
  semanticEvaluationSelectionFileName
} from "./semantic-evaluation-profile.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = path.join(repositoryRoot, "docs/evidence/m07-3");
const runsRoot = path.join(evidenceRoot, "reports/semantic-evaluation-runs");
const promptPath = path.join(repositoryRoot, "docs/runtime/semantic-interpretation-prompt.txt");
const requestExposureMicrousd = 650_000;

type SemanticCase = (typeof SEMANTIC_GENERALIZATION_CORPUS.cases)[number];

const REFERENCE_ASSETS = {
  "open-tray": {
    path: "tests/fixtures/reference-fidelity/references/open-tray.png",
    sha256: "12c80d3f95f7098b31f9e4b100bda9524171c4652785b56320e48ecfce3ee297"
  }
} as const;

const MODEL_CONFIGURATION = SemanticModelConfigurationSchema.parse({
  modelId: GENERATION_OPENAI_MODEL,
  reasoningEffort: CURRENT_REASONING_EFFORT,
  imageDetailPolicy: CURRENT_IMAGE_DETAIL_POLICY,
  promptLayoutVersion: CURRENT_PROMPT_LAYOUT_VERSION,
  maxOutputTokens: GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT,
  serviceTier: "default",
  store: false
});

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const RunIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{7,159}$/u);

const IdentitySchema = z.object({
  sourceTreeHash: Sha256Schema,
  corpusSha256: Sha256Schema,
  promptHash: Sha256Schema,
  providerSchemaHash: Sha256Schema,
  semanticAtomTemplateRegistryHash: Sha256Schema,
  capabilityCatalogHash: Sha256Schema,
  modelConfigurationHash: Sha256Schema,
  oracleSourceHash: Sha256Schema,
  metricsSourceHash: Sha256Schema,
  transportSourceHash: Sha256Schema,
  evaluatorSourceHash: Sha256Schema,
  exposureSourceHash: Sha256Schema,
  durableStoreIdentityHash: Sha256Schema,
  packageJsonHash: Sha256Schema,
  packageLockHash: Sha256Schema
}).strict();
type Identity = z.infer<typeof IdentitySchema>;

const RegisteredCaseSchema = z.object({
  caseId: z.string().min(1),
  ordinal: z.number().int().positive(),
  inputDigest: Sha256Schema,
  providerSchemaHash: Sha256Schema
}).strict();
type RegisteredCase = z.infer<typeof RegisteredCaseSchema>;

const ExposureSnapshotSchema = z.object({
  schemaVersion: z.literal("1.0"),
  authorizedCeilingMicrousd: z.number().int().nonnegative(),
  reservedExposureMicrousd: z.number().int().nonnegative(),
  authorizationVersion: z.number().int().nonnegative()
}).strict();

const ManifestSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-semantic-evaluation-functional-name-correction-run@1.0.0",
  ),
  status: z.literal("prepared"),
  mode: SemanticEvaluationModeSchema,
  runId: RunIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  identities: IdentitySchema,
  registeredCases: z.array(RegisteredCaseSchema),
  maximumExposure: z.object({
    maximumCalls: z.number().int().positive(),
    maximumCallsPerCase: z.literal(1),
    reservedUpperBoundMicrousdPerCall: z.literal(requestExposureMicrousd),
    maximumReservedExposureMicrousd: z.number().int().positive(),
    priceSnapshotId: z.literal(GENERATION_OPENAI_PRICE.id),
    sdkMaxRetries: z.literal(GENERATION_OPENAI_MAX_RETRIES),
    candidateFanOut: z.literal(false),
    secondModelCall: z.literal(false),
    fallbackModel: z.literal(false)
  }).strict(),
  exposureSnapshot: ExposureSnapshotSchema,
  availableHeadroomMicrousd: z.number().int().nonnegative(),
  unresolvedPotentiallyBilledExposureMicrousd: z.literal(0),
  offlineGate: z.object({
    command: z.literal("npm run verify"),
    status: z.literal("passed")
  }).strict(),
  developmentGate: z.object({
    runId: RunIdSchema,
    manifestSha256: Sha256Schema,
    summarySha256: Sha256Schema,
    identitiesHash: Sha256Schema,
    registeredProfileHash: Sha256Schema,
    acceptanceSubsetVerified: z.literal(true)
  }).strict().nullable(),
  privacy: z.object({
    rawBriefsIncluded: z.literal(false),
    referenceBytesIncluded: z.literal(false),
    modelContentIncluded: z.literal(false),
    registeredInputsAreDigestsOnly: z.literal(true)
  }).strict(),
  historicalHeldoutCallsAuthorized: z.literal(false),
  globalExposureCeilingIncreaseAuthorized: z.literal(false)
}).strict().superRefine((manifest, context) => {
  const policy = SEMANTIC_EVALUATION_POLICIES[manifest.mode];
  const expectedIds = SEMANTIC_EVALUATION_CASE_PROFILES[manifest.mode];
  if (manifest.registeredCases.length !== policy.maximumCalls ||
      manifest.maximumExposure.maximumCalls !== policy.maximumCalls ||
      manifest.maximumExposure.maximumReservedExposureMicrousd !==
        policy.maximumReservedExposureMicrousd) {
    context.addIssue({ code: "custom", message: "Evaluation policy does not match its mode." });
  }
  if (manifest.registeredCases.some((item, index) =>
    item.caseId !== expectedIds[index] || item.ordinal !== index + 1)) {
    context.addIssue({ code: "custom", message: "Evaluation case profile does not match its mode." });
  }
  if ((manifest.mode === "development") !== (manifest.developmentGate === null)) {
    context.addIssue({
      code: "custom",
      message: "Only acceptance may bind a passing development gate."
    });
  }
});
type Manifest = z.infer<typeof ManifestSchema>;

const SelectionSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-semantic-evaluation-functional-name-correction-selection@1.0.0",
  ),
  mode: SemanticEvaluationModeSchema,
  runId: RunIdSchema,
  runDirectory: z.string().min(1),
  selectedAt: z.iso.datetime({ offset: true }),
  oneShot: z.literal(true)
}).strict();

function selectionPath(mode: SemanticEvaluationMode): string {
  return path.join(
    evidenceRoot,
    semanticEvaluationSelectionFileName(mode),
  );
}

function runDirectory(runId: string): string {
  return path.join(runsRoot, RunIdSchema.parse(runId));
}

function manifestPath(runId: string): string {
  return path.join(runDirectory(runId), "manifest.json");
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

function opaqueRunId(mode: SemanticEvaluationMode): string {
  const timestamp = new Date().toISOString()
    .replaceAll(/[-:.TZ]/gu, "")
    .slice(0, 14);
  return `m07-3-${SEMANTIC_EVALUATION_CAMPAIGN_SLUG}-${mode}-${timestamp}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function loadLocalEnvironment(): Promise<void> {
  const environmentPath = path.join(repositoryRoot, ".env.local");
  if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);
  process.env.SKETCHYCUT_INTERPRETATION_PROMPT = await readFile(promptPath, "utf8");
  process.env.SKETCHYCUT_GENERATION_ENABLED = "1";
  process.env.SKETCHYCUT_GENERATION_MODE = "live";
  process.env.SKETCHYCUT_STORE = "upstash";
  process.env.SKETCHYCUT_QUOTA_UNLIMITED = "0";
}

function configuredRuntime() {
  const config = readRuntimeConfig();
  if (!config.generationEnabled || config.generationMode !== "live" ||
      config.liveTransport === null || config.quotaUnlimited) {
    throw new SemanticEvaluationExecutionError({
      category: "identity",
      code: "EVALUATION_RUNTIME_CONFIGURATION_INVALID"
    });
  }
  return config;
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(candidate);
    return entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name) ? [candidate] : [];
  }));
  return paths.flat().sort();
}

async function sourceTreeHash(): Promise<string> {
  const files = await filesUnder(path.join(repositoryRoot, "src"));
  return hashCanonical(await Promise.all(files.map(async (file) => ({
    path: path.relative(repositoryRoot, file),
    sha256: await sha256(await readFile(file))
  }))));
}

function selectedCases(mode: SemanticEvaluationMode): SemanticCase[] {
  const byId = new Map(
    SEMANTIC_GENERALIZATION_CORPUS.cases.map((item) => [item.id, item]),
  );
  return SEMANTIC_EVALUATION_CASE_PROFILES[mode].map((caseId) => {
    const testCase = byId.get(caseId);
    if (testCase === undefined) throw new Error(`EVALUATION_CASE_MISSING:${caseId}`);
    if (mode === "acceptance" &&
        testCase.expected.outcomePolicy.purpose !== "svg-acceptance") {
      throw new Error(`EVALUATION_ACCEPTANCE_CASE_NOT_SVG_SCOPED:${caseId}`);
    }
    return testCase;
  });
}

async function referencePayloadsFor(testCase: SemanticCase) {
  const references = [];
  for (const referenceId of testCase.referenceIds ?? []) {
    if (!(referenceId in REFERENCE_ASSETS)) {
      throw new Error(`EVALUATION_REFERENCE_NOT_AUTHORIZED:${referenceId}`);
    }
    const asset = REFERENCE_ASSETS[
      referenceId as keyof typeof REFERENCE_ASSETS
    ];
    const bytes = await readFile(path.join(repositoryRoot, asset.path));
    if (await sha256(bytes) !== asset.sha256) {
      throw new Error(`EVALUATION_REFERENCE_HASH_MISMATCH:${referenceId}`);
    }
    const payload = {
      descriptor: {
        referenceId,
        sha256: asset.sha256,
        mediaType: "image/png" as const,
        width: 512,
        height: 512
      },
      dataUrl: `data:image/png;base64,${bytes.toString("base64")}`
    };
    await verifyNormalizedReference(payload);
    references.push(payload);
  }
  return references;
}

async function preparedCase(testCase: SemanticCase, promptHash: string) {
  const references = await referencePayloadsFor(testCase);
  const roleConstraints = references.map((reference, index) => {
    const roles = testCase.referenceRoles[index] ?? [];
    if (roles.length === 0) {
      throw new Error(`EVALUATION_REFERENCE_ROLE_REQUIRED:${reference.descriptor.referenceId}`);
    }
    return { referenceId: reference.descriptor.referenceId, roles };
  });
  const submission: GenerationSubmission = GenerationSubmissionSchema.parse({
    schemaVersion: "4.0",
    brief: testCase.brief,
    references,
    roleConstraints,
    deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
    fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
    retry: null
  });
  const prepared = await prepareSemanticGenerationRequest({
    brief: submission.brief,
    references: submission.references.map((reference) => reference.descriptor),
    roleConstraints: submission.roleConstraints,
    promptIdentity: CURRENT_PROMPT_IDENTITY,
    promptHash,
    modelConfiguration: MODEL_CONFIGURATION
  });
  return {
    testCase,
    submission,
    request: prepared.request,
    transportReferences: references.map((reference) => ({
      referenceId: reference.descriptor.referenceId,
      dataUrl: reference.dataUrl
    })),
    inputDigest: await hashCanonical({
      caseId: testCase.id,
      failureClass: testCase.failureClass,
      brief: testCase.brief,
      referenceDescriptors: references.map((reference) => reference.descriptor),
      roleConstraints,
      expected: testCase.expected
    }),
    providerSchemaHash: await hashCanonical(
      semanticInterpretationProviderSchema(prepared.request.sourceEvidenceIndex),
    )
  };
}

async function currentIdentities(mode: SemanticEvaluationMode): Promise<Identity> {
  const prompt = await readFile(promptPath, "utf8");
  const promptHash = await sha256(instructionsForPromptLayout(prompt));
  const first = await preparedCase(selectedCases(mode)[0]!, promptHash);
  const upstash = readUpstashConfig();
  return IdentitySchema.parse({
    sourceTreeHash: await sourceTreeHash(),
    corpusSha256: await sha256(
      await readFile(path.join(repositoryRoot, "tests/fixtures/semantic-generalization/manifest.json")),
    ),
    promptHash,
    providerSchemaHash: await hashCanonical(
      semanticInterpretationProviderSchema(first.request.sourceEvidenceIndex),
    ),
    semanticAtomTemplateRegistryHash: await semanticAtomTemplateRegistryHash(),
    capabilityCatalogHash: await hashCanonical(CAPABILITY_CATALOG),
    modelConfigurationHash: await hashCanonical(MODEL_CONFIGURATION),
    oracleSourceHash: await sha256(
      await readFile(path.join(repositoryRoot, "src/evaluation/semantic-generalization-oracle.ts")),
    ),
    metricsSourceHash: await sha256(
      await readFile(path.join(repositoryRoot, "src/evaluation/semantic-generalization.ts")),
    ),
    transportSourceHash: await sha256(
      await readFile(path.join(repositoryRoot, "src/server/generation/openai-transport.ts")),
    ),
    evaluatorSourceHash: await hashCanonical({
      runner: await sha256(
        await readFile(path.join(repositoryRoot, "src/evaluation/semantic-live-evaluator.ts")),
      ),
      profile: await sha256(
        await readFile(path.join(repositoryRoot, "tools/semantic-evaluation-profile.ts")),
      ),
      command: await sha256(
        await readFile(path.join(repositoryRoot, "tools/run-live-semantic-evaluation.ts")),
      )
    }),
    exposureSourceHash: await hashCanonical({
      contracts: await sha256(
        await readFile(path.join(repositoryRoot, "src/server/generation/contracts.ts")),
      ),
      authorization: await sha256(
        await readFile(path.join(repositoryRoot, "src/server/generation/exposure-authorization.ts")),
      ),
      store: await sha256(
        await readFile(path.join(repositoryRoot, "src/server/generation/upstash-store.ts")),
      )
    }),
    durableStoreIdentityHash: await hashCanonical({
      endpointSha256: await sha256(upstash.url),
      namespace: GENERATION_POLICY.namespace,
      storeMode: "upstash"
    }),
    packageJsonHash: await sha256(await readFile(path.join(repositoryRoot, "package.json"))),
    packageLockHash: await sha256(
      await readFile(path.join(repositoryRoot, "package-lock.json")),
    )
  });
}

async function currentRegistration(
  mode: SemanticEvaluationMode,
  identities: Identity,
): Promise<RegisteredCase[]> {
  const cases = await Promise.all(
    selectedCases(mode).map((testCase) => preparedCase(testCase, identities.promptHash)),
  );
  return cases.map((item, index) => RegisteredCaseSchema.parse({
    caseId: item.testCase.id,
    ordinal: index + 1,
    inputDigest: item.inputDigest,
    providerSchemaHash: item.providerSchemaHash
  }));
}

async function assertFrozen(manifest: Manifest): Promise<void> {
  const identities = await currentIdentities(manifest.mode);
  if (await hashCanonical(identities) !== await hashCanonical(manifest.identities)) {
    throw new SemanticEvaluationExecutionError({
      category: "identity",
      code: "EVALUATION_BATCH_IDENTITY_DRIFT"
    });
  }
  const registration = await currentRegistration(manifest.mode, identities);
  if (await hashCanonical(registration) !==
      await hashCanonical(manifest.registeredCases)) {
    throw new SemanticEvaluationExecutionError({
      category: "identity",
      code: "EVALUATION_CASE_REGISTRATION_DRIFT"
    });
  }
}

function runOfflineGate(): void {
  const result = spawnSync("npm", ["run", "verify"], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) {
    throw new SemanticEvaluationExecutionError({
      category: "deterministic",
      code: "EVALUATION_OFFLINE_GATE_FAILED"
    });
  }
}

async function passingDevelopmentRun(): Promise<{
  selection: z.infer<typeof SelectionSchema>;
  manifest: Manifest;
  summary: z.infer<typeof SemanticEvaluationSummarySchema>;
  manifestBytes: Buffer;
  summaryBytes: Buffer;
}> {
  const selection = SelectionSchema.parse(await readJson(selectionPath("development")));
  const developmentDirectory = runDirectory(selection.runId);
  const developmentManifestPath = path.join(developmentDirectory, "manifest.json");
  const developmentSummaryPath = path.join(developmentDirectory, "summary.json");
  const [manifestBytes, summaryBytes] = await Promise.all([
    readFile(developmentManifestPath),
    readFile(developmentSummaryPath)
  ]);
  const manifest = ManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const summary = SemanticEvaluationSummarySchema.parse(
    JSON.parse(summaryBytes.toString("utf8")),
  );
  if (summary.mode !== "development" ||
      manifest.mode !== "development" ||
      manifest.runId !== selection.runId ||
      summary.executionStatus !== "completed" ||
      summary.qualityStatus !== "pass" ||
      summary.counts.selected !== 10 ||
      summary.counts.attempted !== 10 ||
      summary.counts.dispatched !== 10 ||
      summary.counts.scored !== 10 ||
      summary.counts.passed !== 10 ||
      summary.hardStopReason !== null) {
    throw new SemanticEvaluationExecutionError({
      category: "identity",
      code: "EVALUATION_ACCEPTANCE_DEVELOPMENT_GATE_MISSING"
    });
  }
  return { selection, manifest, summary, manifestBytes, summaryBytes };
}

async function acceptanceDevelopmentGate(input: {
  identities: Identity;
  registeredCases: readonly RegisteredCase[];
}): Promise<NonNullable<Manifest["developmentGate"]>> {
  const development = await passingDevelopmentRun();
  if (await hashCanonical(development.manifest.identities) !==
      await hashCanonical(input.identities)) {
    throw new SemanticEvaluationExecutionError({
      category: "identity",
      code: "EVALUATION_ACCEPTANCE_DIAGNOSTIC_IDENTITY_MISMATCH"
    });
  }
  const developmentById = new Map(
    development.manifest.registeredCases.map((item) => [item.caseId, item]),
  );
  const subsetMatches = input.registeredCases.every((acceptanceCase) => {
    const diagnosticCase = developmentById.get(acceptanceCase.caseId);
    return diagnosticCase?.inputDigest === acceptanceCase.inputDigest &&
      diagnosticCase.providerSchemaHash === acceptanceCase.providerSchemaHash;
  });
  if (!subsetMatches) {
    throw new SemanticEvaluationExecutionError({
      category: "identity",
      code: "EVALUATION_ACCEPTANCE_DIAGNOSTIC_PROFILE_MISMATCH"
    });
  }
  return {
    runId: development.selection.runId,
    manifestSha256: await sha256(development.manifestBytes),
    summarySha256: await sha256(development.summaryBytes),
    identitiesHash: await hashCanonical(development.manifest.identities),
    registeredProfileHash: await hashCanonical(
      development.manifest.registeredCases,
    ),
    acceptanceSubsetVerified: true
  };
}

async function assertAcceptanceDevelopmentBinding(
  manifest: Manifest,
): Promise<void> {
  if (manifest.mode !== "acceptance" || manifest.developmentGate === null) return;
  const current = await acceptanceDevelopmentGate({
    identities: manifest.identities,
    registeredCases: manifest.registeredCases
  });
  if (await hashCanonical(current) !==
      await hashCanonical(manifest.developmentGate)) {
    throw new SemanticEvaluationExecutionError({
      category: "identity",
      code: "EVALUATION_ACCEPTANCE_DIAGNOSTIC_BINDING_DRIFT"
    });
  }
}

function safeAnomaly(error: unknown): SemanticEvaluationHardAnomaly {
  if (error instanceof SemanticEvaluationExecutionError) return error.anomaly;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("PRIVACY")) {
    return { category: "privacy", code: "EVALUATION_PREFLIGHT_PRIVACY_FAILURE" };
  }
  if (message.includes("LEDGER")) {
    return { category: "ledger", code: "EVALUATION_PREFLIGHT_LEDGER_FAILURE" };
  }
  return { category: "deterministic", code: "EVALUATION_PREFLIGHT_EXCEPTION" };
}

async function prepareRun(mode: SemanticEvaluationMode): Promise<void> {
  if (existsSync(selectionPath(mode))) {
    throw new Error(`EVALUATION_${mode.toUpperCase()}_ONE_SHOT_ALREADY_SELECTED`);
  }
  const runId = opaqueRunId(mode);
  const directory = runDirectory(runId);
  await mkdir(runsRoot, { recursive: true });
  const selection = SelectionSchema.parse({
    schemaVersion:
      "sketchycut-semantic-evaluation-functional-name-correction-selection@1.0.0",
    mode,
    runId,
    runDirectory: path.relative(repositoryRoot, directory),
    selectedAt: new Date().toISOString(),
    oneShot: true
  });
  await mkdir(directory, { recursive: false });
  try {
    runOfflineGate();
    await loadLocalEnvironment();
    configuredRuntime();
    const identities = await currentIdentities(mode);
    const registeredCases = await currentRegistration(mode, identities);
    const developmentGate = mode === "acceptance"
      ? await acceptanceDevelopmentGate({ identities, registeredCases })
      : null;
    const store = new UpstashGenerationStore(readUpstashConfig());
    const [exposure, attempts] = await Promise.all([
      store.readGlobalExposureState(),
      store.readLedgerAttempts()
    ]);
    const ledgerSummary = summarizeLedger(attempts);
    if (ledgerSummary.unresolvedPotentiallyBilledExposureMicrousd !== 0) {
      throw new SemanticEvaluationExecutionError({
        category: "billing",
        code: "EVALUATION_UNRESOLVED_POTENTIALLY_BILLED_EXPOSURE"
      });
    }
    const policy = SEMANTIC_EVALUATION_POLICIES[mode];
    const headroom = exposure.authorizedCeilingMicrousd -
      exposure.reservedExposureMicrousd;
    if (headroom < policy.maximumReservedExposureMicrousd) {
      throw new SemanticEvaluationExecutionError({
        category: "exposure",
        code: "EVALUATION_EXISTING_HEADROOM_INSUFFICIENT"
      });
    }
    const manifest = ManifestSchema.parse({
      schemaVersion:
        "sketchycut-semantic-evaluation-functional-name-correction-run@1.0.0",
      status: "prepared",
      mode,
      runId,
      createdAt: new Date().toISOString(),
      identities,
      registeredCases,
      maximumExposure: {
        maximumCalls: policy.maximumCalls,
        maximumCallsPerCase: 1,
        reservedUpperBoundMicrousdPerCall: requestExposureMicrousd,
        maximumReservedExposureMicrousd: policy.maximumReservedExposureMicrousd,
        priceSnapshotId: GENERATION_OPENAI_PRICE.id,
        sdkMaxRetries: GENERATION_OPENAI_MAX_RETRIES,
        candidateFanOut: false,
        secondModelCall: false,
        fallbackModel: false
      },
      exposureSnapshot: exposure,
      availableHeadroomMicrousd: headroom,
      unresolvedPotentiallyBilledExposureMicrousd: 0,
      offlineGate: {
        command: "npm run verify",
        status: "passed"
      },
      developmentGate,
      privacy: {
        rawBriefsIncluded: false,
        referenceBytesIncluded: false,
        modelContentIncluded: false,
        registeredInputsAreDigestsOnly: true
      },
      historicalHeldoutCallsAuthorized: false,
      globalExposureCeilingIncreaseAuthorized: false
    });
    await writeSemanticEvaluationArtifact(manifestPath(runId), manifest);
    await writeSemanticEvaluationArtifact(selectionPath(mode), selection);
    process.stdout.write(`${JSON.stringify({
      mode,
      runId,
      manifestPath: path.relative(repositoryRoot, manifestPath(runId)),
      maximumCalls: policy.maximumCalls,
      maximumReservedExposureUsd: policy.maximumReservedExposureMicrousd / 1_000_000,
      availableHeadroomUsd: headroom / 1_000_000,
      executionReady: true
    }, null, 2)}\n`);
  } catch (error) {
    const hardStopReason = SemanticEvaluationHardAnomalySchema.parse(safeAnomaly(error));
    const summary = blockedSemanticEvaluationSummary({
      mode,
      runId,
      selectedCaseIds: SEMANTIC_EVALUATION_CASE_PROFILES[mode],
      hardStopReason
    });
    await writeSemanticEvaluationArtifact(path.join(directory, "summary.json"), summary);
    process.stderr.write(`${hardStopReason.code}\n`);
    process.exitCode = 1;
  }
}

async function preDispatchChecks(input: {
  manifest: Manifest;
  store: GenerationStore;
  remainingCalls: number;
}): Promise<GlobalExposureState> {
  await assertFrozen(input.manifest);
  const config = configuredRuntime();
  if (await currentProductionPromptHash(config) !== input.manifest.identities.promptHash) {
    throw new SemanticEvaluationExecutionError({
      category: "identity",
      code: "EVALUATION_RUNTIME_PROMPT_DRIFT"
    });
  }
  const [exposure, attempts] = await Promise.all([
    input.store.readGlobalExposureState(),
    input.store.readLedgerAttempts()
  ]);
  const ledgerSummary = summarizeLedger(attempts);
  if (ledgerSummary.unresolvedPotentiallyBilledExposureMicrousd !== 0) {
    throw new SemanticEvaluationExecutionError({
      category: "billing",
      code: "EVALUATION_UNRESOLVED_POTENTIALLY_BILLED_EXPOSURE"
    });
  }
  if (exposure.authorizedCeilingMicrousd - exposure.reservedExposureMicrousd <
      input.remainingCalls * requestExposureMicrousd) {
    throw new SemanticEvaluationExecutionError({
      category: "exposure",
      code: "EVALUATION_REMAINING_BATCH_HEADROOM_INSUFFICIENT"
    });
  }
  return exposure;
}

function newSession(runId: string, index: number): SessionRecord {
  const now = Date.now();
  return {
    schemaVersion: "1.0",
    sessionId: `${runId}-case-${String(index + 1)}-${crypto.randomUUID().replaceAll("-", "")}`,
    issuedAtMs: now,
    expiresAtMs: now + 60 * 60 * 1_000,
    generationDispatches: 0,
    reservedExposureMicrousd: 0,
    lastDispatchAtMs: null,
    lastProjectId: null
  };
}

async function executeCase(input: {
  manifest: Manifest;
  store: GenerationStore;
  caseId: string;
  index: number;
}): Promise<SemanticEvaluationRawCaseResult> {
  const beforeExposure = await preDispatchChecks({
    manifest: input.manifest,
    store: input.store,
    remainingCalls: input.manifest.registeredCases.length - input.index
  });
  const testCase = selectedCases(input.manifest.mode)[input.index];
  if (testCase?.id !== input.caseId) {
    throw new SemanticEvaluationExecutionError({
      category: "identity",
      code: "EVALUATION_CASE_ORDER_DRIFT"
    });
  }
  const prepared = await preparedCase(testCase, input.manifest.identities.promptHash);
  const registered = input.manifest.registeredCases[input.index];
  if (registered?.caseId !== input.caseId ||
      registered.inputDigest !== prepared.inputDigest ||
      registered.providerSchemaHash !== prepared.providerSchemaHash) {
    throw new SemanticEvaluationExecutionError({
      category: "identity",
      code: "EVALUATION_CASE_REGISTRATION_DRIFT"
    });
  }

  const session = newSession(input.manifest.runId, input.index);
  await input.store.createSession(session, 60 * 60);
  const attributedAttempts: LiveCallAttempt[] = [];
  const ownedStore = createRunOwnedGenerationStore(input.store, attributedAttempts);
  let atomKindsByItemId:
    ReturnType<typeof semanticCandidateAtomKindsByItemId> = new Map();
  let response: Awaited<ReturnType<typeof executeCurrentGeneration>> | null = null;
  const additionalHardAnomalies: SemanticEvaluationHardAnomaly[] = [];
  try {
    const config = configuredRuntime();
    response = await executeCurrentGeneration({
      config,
      authenticated: {
        session,
        clientIdentifier:
          `${input.manifest.runId}-case-${String(input.index + 1)}`
      },
      submission: prepared.submission,
      store: ownedStore,
      runtimeOrigin: "local-development",
      interpretationTransport: new OpenAITransport({
        apiKey: config.liveTransport!.apiKey,
        prompt: config.liveTransport!.interpretationPrompt,
        references: prepared.transportReferences
      }),
      semanticCache: new DispatchOnlySemanticCache(),
      initiatedBy: "live-eval",
      promptHash: input.manifest.identities.promptHash,
      evaluationModelConfiguration: MODEL_CONFIGURATION,
      onSemanticCandidate: (candidate) => {
        atomKindsByItemId = semanticCandidateAtomKindsByItemId(candidate);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    additionalHardAnomalies.push({
      category: message.includes("LEDGER") ? "ledger" : "deterministic",
      code: message.includes("LEDGER")
        ? "EVALUATION_LEDGER_APPEND_EXCEPTION"
        : "EVALUATION_GENERATION_EXECUTION_EXCEPTION"
    });
    if (attributedAttempts.length === 0) {
      additionalHardAnomalies.push({
        category: "ledger",
        code: "EVALUATION_GENERATION_ATTEMPT_NOT_RECORDED"
      });
    }
  }
  let ownedSession: SessionRecord | null = null;
  let afterExposure = beforeExposure;
  try {
    [ownedSession, afterExposure] = await Promise.all([
      input.store.readSession(session.sessionId),
      input.store.readGlobalExposureState()
    ]);
  } catch {
    additionalHardAnomalies.push({
      category: "exposure",
      code: "EVALUATION_POST_DISPATCH_ACCOUNTING_UNAVAILABLE"
    });
  }
  let score: ReturnType<typeof scoreSemanticCaseOracle> | null = null;
  let outcome: ReturnType<typeof summarizeGenerationOutcome> | null = null;
  let semanticDiagnostics:
    ReturnType<typeof summarizeSemanticEvaluationDiagnostics> = null;
  let compiledDigest: string | null = null;
  if (response !== null) {
    try {
      score = scoreSemanticCaseOracle({
        testCase,
        request: prepared.request,
        outcome: response.outcome
      });
      outcome = summarizeGenerationOutcome(response.outcome);
      semanticDiagnostics = summarizeSemanticEvaluationDiagnostics(
        response.outcome,
        atomKindsByItemId,
      );
      compiledDigest = response.compiled === null
        ? null
        : await hashCanonical(response.compiled);
    } catch {
      additionalHardAnomalies.push({
        category: "deterministic",
        code: "EVALUATION_RESULT_SCORING_EXCEPTION"
      });
    }
  }
  return {
    caseId: input.caseId,
    attempts: attributedAttempts,
    score,
    outcome,
    semanticDiagnostics,
    compiledDigest,
    sessionDispatches: ownedSession?.generationDispatches ?? 0,
    sessionReservedExposureMicrousd:
      ownedSession?.reservedExposureMicrousd ?? 0,
    globalReservedExposureBeforeMicrousd:
      beforeExposure.reservedExposureMicrousd,
    globalReservedExposureAfterMicrousd:
      afterExposure.reservedExposureMicrousd,
    additionalHardAnomalies
  };
}

async function executeRun(
  mode: SemanticEvaluationMode,
  runIdCandidate: string,
): Promise<void> {
  const runId = RunIdSchema.parse(runIdCandidate);
  const directory = runDirectory(runId);
  let selectedCaseIds: readonly string[] = SEMANTIC_EVALUATION_CASE_PROFILES[mode];
  try {
    await loadLocalEnvironment();
    const manifest = ManifestSchema.parse(await readJson(manifestPath(runId)));
    selectedCaseIds = manifest.registeredCases.map((item) => item.caseId);
    if (manifest.mode !== mode) throw new Error("EVALUATION_MODE_RUN_MISMATCH");
    const selection = SelectionSchema.parse(await readJson(selectionPath(mode)));
    if (selection.runId !== runId) {
      throw new Error("EVALUATION_ONE_SHOT_SELECTION_MISMATCH");
    }
    if (existsSync(path.join(directory, "execution-start.json")) ||
        existsSync(path.join(directory, "summary.json"))) {
      throw new Error("EVALUATION_RUN_ALREADY_STARTED");
    }
    await assertFrozen(manifest);
    await assertAcceptanceDevelopmentBinding(manifest);
    const store = new UpstashGenerationStore(readUpstashConfig());
    await preDispatchChecks({
      manifest,
      store,
      remainingCalls: manifest.registeredCases.length
    });
    const summary = await runSemanticEvaluationBatch({
      mode,
      runId,
      runDirectory: directory,
      caseIds: selectedCaseIds,
      executeCase: (caseId, index) => executeCase({
        manifest,
        store,
        caseId,
        index
      })
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exitCode = semanticEvaluationExitCode(summary);
  } catch (error) {
    if (existsSync(path.join(directory, "summary.json"))) throw error;
    const hardStopReason = SemanticEvaluationHardAnomalySchema.parse(
      safeAnomaly(error),
    );
    const summary = blockedSemanticEvaluationSummary({
      mode,
      runId,
      selectedCaseIds,
      hardStopReason
    });
    await writeSemanticEvaluationArtifact(path.join(directory, "summary.json"), summary);
    process.stderr.write(`${hardStopReason.code}\n`);
    process.exitCode = 1;
  }
}

async function inspect(mode: SemanticEvaluationMode, runIdCandidate?: string): Promise<void> {
  if (runIdCandidate !== undefined) {
    const runId = RunIdSchema.parse(runIdCandidate);
    const directory = runDirectory(runId);
    process.stdout.write(`${JSON.stringify({
      mode,
      runId,
      selected: existsSync(selectionPath(mode)),
      manifestPresent: existsSync(path.join(directory, "manifest.json")),
      executionStarted: existsSync(path.join(directory, "execution-start.json")),
      summaryPresent: existsSync(path.join(directory, "summary.json"))
    }, null, 2)}\n`);
    return;
  }
  const selectionPresent = existsSync(selectionPath(mode));
  const selection = selectionPresent
    ? SelectionSchema.parse(await readJson(selectionPath(mode)))
    : null;
  process.stdout.write(`${JSON.stringify({
    mode,
    oneShotSelectionPresent: selectionPresent,
    runId: selection?.runId ?? null,
    manifestPresent: selection === null
      ? false
      : existsSync(path.join(repositoryRoot, selection.runDirectory, "manifest.json")),
    summaryPresent: selection === null
      ? false
      : existsSync(path.join(repositoryRoot, selection.runDirectory, "summary.json")),
    maximumCalls: SEMANTIC_EVALUATION_POLICIES[mode].maximumCalls,
    maximumReservedExposureUsd:
      SEMANTIC_EVALUATION_POLICIES[mode].maximumReservedExposureMicrousd / 1_000_000
  }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] !== "--mode") {
    throw new Error(
      "Usage: --mode development|acceptance --prepare | --execute <run-id> | --inspect [run-id]",
    );
  }
  const mode = SemanticEvaluationModeSchema.parse(arguments_[1]);
  const command = arguments_[2];
  const argument = arguments_[3];
  const extra = arguments_[4];
  if (command === "--prepare" && argument === undefined && extra === undefined) {
    await prepareRun(mode);
  } else if (command === "--execute" && argument !== undefined && extra === undefined) {
    await executeRun(mode, argument);
  } else if (command === "--inspect" && extra === undefined) {
    await inspect(mode, argument);
  } else {
    throw new Error(
      "Usage: --mode development|acceptance --prepare | --execute <run-id> | --inspect [run-id]",
    );
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "EVALUATION_COMMAND_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
