import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  lstat,
  readFile,
  realpath,
  readdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { hashCanonical, sha256 } from "../src/domain/hash.js";
import {
  applySemanticReviewPatch,
  classifySemanticReviewTriggers
} from "../src/evaluation/bounded-semantic-review.js";
import { DispatchOnlySemanticCache } from "../src/evaluation/dispatch-only-semantic-cache.js";
import {
  aggregatePairedSemanticReviewResults,
  buildPairedSemanticReviewCaseResult,
  PairedSemanticReviewAggregateSchema,
  PairedSemanticReviewCaseResultSchema,
  type PairedSemanticReviewCaseResult
} from "../src/evaluation/paired-semantic-review-evaluator.js";
import {
  readSealedPartitionCommitment,
  SEALED_PARTITION_COMMITMENT_VERSION,
  SEALED_PARTITION_MANIFEST_VERSION,
  SEALED_PARTITION_OPENING_VERSION,
  SEALED_SEMANTIC_CASE_VERSION,
  SealedPartitionOpeningSchema,
  verifySealedPartitionCommitment,
  type SealedSemanticCasePayload
} from "../src/evaluation/sealed-partition.js";
import { OpenAISemanticReviewTransport } from "../src/evaluation/openai-semantic-review-transport.js";
import {
  dispatchEvaluationSemanticReview
} from "../src/evaluation/semantic-review-dispatch.js";
import {
  classifySemanticEvaluationCase,
  createRunOwnedGenerationStore,
  semanticCandidateAtomKindsByItemId,
  semanticCandidateUnsupportedSignaturesByItemId,
  summarizeGenerationOutcome,
  summarizeSemanticEvaluationDiagnostics,
  writeSemanticEvaluationArtifact,
  type SemanticCandidateAtomKindsByItemId,
  type SemanticCandidateUnsupportedSignaturesByItemId,
  type SemanticEvaluationHardAnomaly,
  type SemanticEvaluationMode,
  type SemanticEvaluationRawCaseResult
} from "../src/evaluation/semantic-live-evaluator.js";
import {
  CURRENT_PRIVATE_SEMANTIC_REPLAY_CAPSULE_VERSION,
  PrivateSemanticReplayEvidenceSchema,
  PrivateSemanticReplayPreflightSchema,
  buildPrivateSemanticReplayCapsule,
  ensurePrivateSemanticReplayRoot,
  loadPrivateSemanticReplayCapsule,
  replayPrivateSemanticCapsule,
  writePrivateSemanticReplayCapsule,
  type PrivateSemanticReplayEvidence
} from "../src/evaluation/private-semantic-replay.js";
import {
  SEMANTIC_GENERALIZATION_CORPUS
} from "../src/evaluation/semantic-generalization.js";
import {
  scoreSemanticCaseOracle
} from "../src/evaluation/semantic-generalization-oracle.js";
import {
  capabilityCatalogHash
} from "../src/interpretation/capability-catalog.js";
import type { GenerationOutcome } from "../src/interpretation/generation-outcome.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
  GenerationSubmissionSchema,
  type GenerationSubmission
} from "../src/interpretation/generation-submission.js";
import {
  CURRENT_IMAGE_DETAIL_POLICY,
  CURRENT_PROMPT_LAYOUT_VERSION,
  CURRENT_REASONING_EFFORT,
  SemanticModelConfigurationSchema
} from "../src/interpretation/semantic-input-contracts.js";
import {
  LiveCallAttemptSchema,
  type LiveCallAttempt
} from "../src/interpretation/live-ledger.js";
import {
  semanticAtomTemplateRegistryHash
} from "../src/interpretation/semantic-atom-registry.js";
import {
  CURRENT_RETAINED_SCOPE_POLICY_VERSION
} from "../src/interpretation/retained-scope.js";
import {
  semanticInterpretationProviderSchema,
  type SemanticInterpretationCandidate
} from "../src/interpretation/semantic-model-contract.js";
import {
  CURRENT_PROMPT_IDENTITY,
  prepareSemanticGenerationRequest,
  type PreparedSemanticGenerationRequest
} from "../src/interpretation/semantic-request.js";
import {
  substitutionGraphRegistryHash
} from "../src/interpretation/substitution-graph.js";
import {
  unsupportedSemanticSignatureRegistryHash
} from "../src/interpretation/unsupported-semantic-signatures.js";
import {
  readRuntimeConfig,
  readUpstashConfig
} from "../src/server/generation/config.js";
import type {
  BillingReconciliationGenerationStore,
  GenerationStore,
  GlobalExposureState,
  SessionRecord
} from "../src/server/generation/contracts.js";
import {
  GENERATION_OPENAI_MAX_RETRIES,
  GENERATION_OPENAI_MODEL,
  GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT,
  GENERATION_OPENAI_PRICE
} from "../src/server/generation/cost-envelope.js";
import {
  currentProductionPromptHash,
  evaluateSemanticCandidateForOfflineReplay,
  evaluatePatchedSemanticCandidateForEvaluation,
  executeCurrentGeneration
} from "../src/server/generation/generation-service.js";
import {
  summarizeLedger
} from "../src/server/generation/exposure-authorization.js";
import { verifyNormalizedReference } from "../src/server/generation/image-decoder.js";
import { OpenAITransport } from "../src/server/generation/openai-transport.js";
import { GENERATION_POLICY } from "../src/server/generation/policy.js";
import {
  instructionsForPromptLayout
} from "../src/server/generation/semantic-interpretation-prompt.js";
import { UpstashGenerationStore } from "../src/server/generation/upstash-store.js";
import {
  DEFAULT_GENERATED_FABRICATION_CONTROLS
} from "../src/ui/content/generated-setup.js";
import {
  assertM74CallBDispatchAuthority,
  assertM74HeadroomAvailable,
  assertM74PaidDispatchAuthority,
  M74_ACCEPTANCE_CLAIM_FIRST_IDENTITY_DELTA,
  M74_BURNED_ACCEPTANCE_PREPARATION,
  M74_BURNED_CORRECTIVE_PREPARATION,
  M74_CONSUMED_SEALED_ACCEPTANCE,
  M74_CORRECTIVE_DEVELOPMENT,
  M74_CUMULATIVE_LIVE_AUTHORITY,
  M74_GIT_OBJECT_ID_PATTERN,
  M74_LIVE_EXPOSURE_POLICY,
  M74_OPEN_PAIRED_REVIEW_CASE_IDS,
  M74_REPLACEMENT_DEVELOPMENT,
  M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX,
  M74_SEALED_RECOVERY_IDENTITY_DELTA,
  M74_SEALED_RECOVERY_ROOT_BINDING_DOMAIN,
  M74_TERMINAL_DEVELOPMENT,
  SEMANTIC_EVALUATION_CASE_PROFILES,
  SEMANTIC_EVALUATION_CAMPAIGN_SLUG,
  semanticEvaluationSelectionFileName
} from "./semantic-evaluation-profile.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const evidenceRoot = path.join(repositoryRoot, "docs/evidence/m07-4/evaluation");
const runsRoot = path.join(evidenceRoot, "runs");
const terminalDevelopmentSelectionPath = path.join(
  evidenceRoot,
  M74_TERMINAL_DEVELOPMENT.selectionFileName,
);
const replacementDevelopmentSelectionPath = path.join(
  evidenceRoot,
  M74_REPLACEMENT_DEVELOPMENT.selectionFileName,
);
const burnedCorrectivePreparationSelectionPath = path.join(
  evidenceRoot,
  M74_BURNED_CORRECTIVE_PREPARATION.selectionFileName,
);
const burnedCorrectivePreparationReportPath = path.join(
  path.dirname(evidenceRoot),
  M74_BURNED_CORRECTIVE_PREPARATION.reportFileName,
);
const correctiveDevelopmentSelectionPath = path.join(
  evidenceRoot,
  M74_CORRECTIVE_DEVELOPMENT.selectionFileName,
);
const burnedAcceptancePreparationSelectionPath = path.join(
  evidenceRoot,
  M74_BURNED_ACCEPTANCE_PREPARATION.selectionFileName,
);
const burnedAcceptancePreparationReportPath = path.join(
  path.dirname(evidenceRoot),
  M74_BURNED_ACCEPTANCE_PREPARATION.reportFileName,
);
const consumedCommitmentPath = path.join(
  repositoryRoot,
  "docs/evidence/m07-4/sealed-partition-commitment.json",
);
const consumedOpeningPath = path.join(
  repositoryRoot,
  "docs/evidence/m07-4/sealed-partition-opening.json",
);
const consumedAcceptanceSelectionPath = path.join(
  evidenceRoot,
  M74_CONSUMED_SEALED_ACCEPTANCE.selectionFileName,
);
const consumedAcceptanceManifestPath = path.join(
  runsRoot,
  M74_CONSUMED_SEALED_ACCEPTANCE.runId,
  "manifest.json",
);
const consumedVerifiedRegistrationPath = path.join(
  runsRoot,
  M74_CONSUMED_SEALED_ACCEPTANCE.runId,
  M74_CONSUMED_SEALED_ACCEPTANCE.verifiedRegistrationFileName,
);
const consumedHardStopPath = path.join(
  path.dirname(evidenceRoot),
  M74_CONSUMED_SEALED_ACCEPTANCE.hardStopFileName,
);
const consumedFinalAuditPath = path.join(
  path.dirname(evidenceRoot),
  M74_CONSUMED_SEALED_ACCEPTANCE.finalAuditFileName,
);
const recoveryCommitmentPath = path.join(
  repositoryRoot,
  "docs/evidence/m07-4/sealed-recovery-partition-commitment.json",
);
const recoveryOpeningPath = path.join(
  repositoryRoot,
  "docs/evidence/m07-4/sealed-recovery-partition-opening.json",
);
const recoveryPreparationClaimPath = path.join(
  repositoryRoot,
  "docs/evidence/m07-4/sealed-recovery-preparation-claim.json",
);
const recoveryAuthorizationBaselineSupplementPath = path.join(
  repositoryRoot,
  "docs/evidence/m07-4/reports/sealed-recovery-authorization-baseline-supplement.json",
);
const recoveryAuthorizationFreezePath = path.join(
  repositoryRoot,
  "docs/evidence/m07-4/reports/sealed-recovery-authorization-freeze.json",
);
const recoveryExecutionIdentityFreezePath = path.join(
  repositoryRoot,
  "docs/evidence/m07-4/reports/sealed-recovery-execution-identity-freeze.json",
);
const recoveryBuilderAttestationPath = path.join(
  repositoryRoot,
  "docs/evidence/m07-4/sealed-recovery-builder-attestation.json",
);
const recoveryPreparationTerminalStopPath = path.join(
  repositoryRoot,
  "docs/evidence/m07-4/reports/sealed-recovery-preparation-terminal-stop.json",
);
const callAPromptPath = path.join(
  repositoryRoot,
  "docs/runtime/semantic-interpretation-prompt.txt",
);
const callBPromptPath = path.join(
  repositoryRoot,
  "docs/runtime/bounded-semantic-review-prompt.txt",
);
const privateReplayRoot = path.join(
  repositoryRoot,
  "docs/private-evaluation-replay/m07-4",
);
const corpusPath = path.join(
  repositoryRoot,
  "tests/fixtures/semantic-generalization/manifest.json",
);
const requestExposureMicrousd =
  GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd;
const durableExposureCeilingMicrousd = 72_550_000;

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
const GitObjectIdSchema = z.string().regex(M74_GIT_OBJECT_ID_PATTERN);
const RunIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{7,159}$/u);
const IdentitySchema = z.object({
  gitHead: GitObjectIdSchema,
  sourceStateHash: Sha256Schema,
  callAPromptHash: Sha256Schema,
  callBPromptHash: Sha256Schema,
  callAProviderContractSourceHash: Sha256Schema,
  callBProviderContractSourceHash: Sha256Schema,
  semanticAtomTemplateRegistryHash: Sha256Schema,
  capabilityCatalogHash: Sha256Schema,
  unsupportedSignatureRegistryHash: Sha256Schema,
  substitutionGraphRegistryHash: Sha256Schema,
  corpusHash: Sha256Schema,
  sealedCommitmentRecordHash: Sha256Schema,
  canonicalPlanHash: Sha256Schema,
  evaluatorHash: Sha256Schema,
  modelConfigurationHash: Sha256Schema,
  packageJsonHash: Sha256Schema,
  packageLockHash: Sha256Schema,
  privateReplayCapsuleSchemaVersion: z.literal(
    CURRENT_PRIVATE_SEMANTIC_REPLAY_CAPSULE_VERSION,
  ),
  privateReplayImplementationHash: Sha256Schema,
  durableStoreIdentityHash: Sha256Schema
}).strict();
type Identity = z.infer<typeof IdentitySchema>;

const PriorCapsuleReplayCaseSchema = z.object({
  caseId: z.string().min(1),
  attemptId: z.string().min(1),
  capsuleSha256: Sha256Schema,
  outcomeKind: z.enum([
    "supported",
    "simplified",
    "modified",
    "concept-only"
  ]),
  exportAllowed: z.boolean(),
  compiledDigest: Sha256Schema.nullable(),
  packageSha256: Sha256Schema.nullable(),
  oracleScoreHash: Sha256Schema,
  primaryPass: z.literal(true)
}).strict();

const PriorCapsuleReplayAuditSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m74-prior-capsule-current-source-audit@1.0.0",
  ),
  currentSourceStateHash: Sha256Schema,
  retainedScopePolicyVersion: z.literal(
    CURRENT_RETAINED_SCOPE_POLICY_VERSION,
  ),
  capsuleCount: z.literal(12),
  passedCount: z.literal(12),
  modelCalls: z.literal(0),
  runtimeApplicationApiCalls: z.literal(0),
  cases: z.array(PriorCapsuleReplayCaseSchema).length(12),
  auditHash: Sha256Schema
}).strict().superRefine((audit, context) => {
  const keys = audit.cases.map((item) =>
    `${item.caseId}\u0000${item.attemptId}`
  );
  if (keys.some((key, index) =>
    index > 0 && keys[index - 1]! >= key
  )) {
    context.addIssue({
      code: "custom",
      message: "Prior capsule replay cases must be uniquely sorted."
    });
  }
});

const RegisteredCallACaseSchema = z.object({
  caseId: z.string().min(1),
  ordinal: z.number().int().positive(),
  lane: z.enum(["track-a", "paired-review", "sealed"]),
  inputDigest: Sha256Schema,
  providerSchemaHash: Sha256Schema.nullable(),
  preparedRequestDigest: Sha256Schema.nullable()
}).strict();

const TerminalDevelopmentLineageSchema = z.object({
  runId: z.literal(M74_TERMINAL_DEVELOPMENT.runId),
  selectionHash: z.literal(
    M74_TERMINAL_DEVELOPMENT.selectionSha256,
  ),
  manifestHash: z.literal(
    M74_TERMINAL_DEVELOPMENT.manifestSha256,
  ),
  summaryHash: z.literal(
    M74_TERMINAL_DEVELOPMENT.summarySha256,
  ),
  observedCalls: z.literal(
    M74_TERMINAL_DEVELOPMENT.observedCalls,
  ),
  observedReservedExposureMicrousd: z.literal(
    M74_TERMINAL_DEVELOPMENT.observedReservedExposureMicrousd,
  )
}).strict();

const ReplacementDevelopmentLineageSchema = z.object({
  runId: z.literal(M74_REPLACEMENT_DEVELOPMENT.runId),
  selectionHash: z.literal(
    M74_REPLACEMENT_DEVELOPMENT.selectionSha256,
  ),
  manifestHash: z.literal(
    M74_REPLACEMENT_DEVELOPMENT.manifestSha256,
  ),
  summaryHash: z.literal(
    M74_REPLACEMENT_DEVELOPMENT.summarySha256,
  ),
  observedCalls: z.literal(
    M74_REPLACEMENT_DEVELOPMENT.observedCalls,
  ),
  observedReservedExposureMicrousd: z.literal(
    M74_REPLACEMENT_DEVELOPMENT.observedReservedExposureMicrousd,
  )
}).strict();

const BurnedCorrectivePreparationLineageSchema = z.object({
  runId: z.literal(M74_BURNED_CORRECTIVE_PREPARATION.runId),
  selectionHash: z.literal(
    M74_BURNED_CORRECTIVE_PREPARATION.selectionSha256,
  ),
  manifestHash: z.literal(
    M74_BURNED_CORRECTIVE_PREPARATION.manifestSha256,
  ),
  reportHash: z.literal(
    M74_BURNED_CORRECTIVE_PREPARATION.reportSha256,
  ),
  stopCode: z.literal(
    M74_BURNED_CORRECTIVE_PREPARATION.stopCode,
  ),
  frozenAttemptCount: z.literal(
    M74_BURNED_CORRECTIVE_PREPARATION.frozenAttemptCount,
  ),
  frozenReservedExposureMicrousd: z.literal(
    M74_BURNED_CORRECTIVE_PREPARATION
      .frozenReservedExposureMicrousd,
  ),
  observedCalls: z.literal(0),
  observedReservedExposureMicrousd: z.literal(0)
}).strict();

const CorrectiveDevelopmentLineageSchema = z.object({
  runId: z.literal(M74_CORRECTIVE_DEVELOPMENT.runId),
  selectionHash: z.literal(
    M74_CORRECTIVE_DEVELOPMENT.selectionSha256,
  ),
  manifestHash: z.literal(
    M74_CORRECTIVE_DEVELOPMENT.manifestSha256,
  ),
  summaryHash: z.literal(
    M74_CORRECTIVE_DEVELOPMENT.summarySha256,
  ),
  identityHash: z.literal(
    M74_CORRECTIVE_DEVELOPMENT.identityHash,
  ),
  observedCalls: z.literal(
    M74_CORRECTIVE_DEVELOPMENT.observedCalls,
  ),
  observedReservedExposureMicrousd: z.literal(
    M74_CORRECTIVE_DEVELOPMENT.observedReservedExposureMicrousd,
  ),
  trackAPass: z.literal(true)
}).strict();

const BurnedAcceptancePreparationLineageSchema = z.object({
  runId: z.literal(M74_BURNED_ACCEPTANCE_PREPARATION.runId),
  selectionHash: z.literal(
    M74_BURNED_ACCEPTANCE_PREPARATION.selectionSha256,
  ),
  manifestHash: z.literal(
    M74_BURNED_ACCEPTANCE_PREPARATION.manifestSha256,
  ),
  reportHash: z.literal(
    M74_BURNED_ACCEPTANCE_PREPARATION.reportSha256,
  ),
  stopCode: z.literal(
    M74_BURNED_ACCEPTANCE_PREPARATION.stopCode,
  ),
  frozenAttemptCount: z.literal(
    M74_BURNED_ACCEPTANCE_PREPARATION.frozenAttemptCount,
  ),
  frozenReservedExposureMicrousd: z.literal(
    M74_BURNED_ACCEPTANCE_PREPARATION
      .frozenReservedExposureMicrousd,
  ),
  observedCalls: z.literal(0),
  observedReservedExposureMicrousd: z.literal(0),
  sealedPayloadByteReads: z.literal(0),
  sealedOpeningClaims: z.literal(0)
}).strict();

const ConsumedSealedAcceptanceLineageSchema = z.object({
  runId: z.literal(M74_CONSUMED_SEALED_ACCEPTANCE.runId),
  partitionId: z.literal(M74_CONSUMED_SEALED_ACCEPTANCE.partitionId),
  caseIds: z.tuple([
    z.literal(M74_CONSUMED_SEALED_ACCEPTANCE.caseIds[0]),
    z.literal(M74_CONSUMED_SEALED_ACCEPTANCE.caseIds[1])
  ]),
  commitmentHash: z.literal(
    M74_CONSUMED_SEALED_ACCEPTANCE.commitmentSha256,
  ),
  openingHash: z.literal(
    M74_CONSUMED_SEALED_ACCEPTANCE.openingSha256,
  ),
  selectionHash: z.literal(
    M74_CONSUMED_SEALED_ACCEPTANCE.selectionSha256,
  ),
  manifestHash: z.literal(
    M74_CONSUMED_SEALED_ACCEPTANCE.manifestSha256,
  ),
  verifiedRegistrationHash: z.literal(
    M74_CONSUMED_SEALED_ACCEPTANCE.verifiedRegistrationSha256,
  ),
  hardStopHash: z.literal(
    M74_CONSUMED_SEALED_ACCEPTANCE.hardStopSha256,
  ),
  finalAuditHash: z.literal(
    M74_CONSUMED_SEALED_ACCEPTANCE.finalAuditSha256,
  ),
  observedCalls: z.literal(0),
  observedReservedExposureMicrousd: z.literal(0),
  openingClaims: z.literal(1),
  partitionLoadPasses: z.literal(2),
  payloadFileReads: z.literal(4),
  preservedByteForByte: z.literal(true)
}).strict();

const RecoveryIdentityDeltaSchema = z.object({
  policyVersion: z.literal(
    M74_SEALED_RECOVERY_IDENTITY_DELTA.policyVersion,
  ),
  authorizationId: z.literal(
    M74_SEALED_RECOVERY_IDENTITY_DELTA.authorizationId,
  ),
  recoveryIdentityHash: Sha256Schema,
  recoveryCaseIds: z.tuple([
    z.literal(M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds[0]),
    z.literal(M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds[1])
  ]),
  consumedCaseIds: z.tuple([
    z.literal(M74_SEALED_RECOVERY_IDENTITY_DELTA.consumedCaseIds[0]),
    z.literal(M74_SEALED_RECOVERY_IDENTITY_DELTA.consumedCaseIds[1])
  ]),
  frozenSemanticAndFabricationIdentity: z.object({
    gitHead: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity.gitHead,
    ),
    callAPromptHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity.callAPromptHash,
    ),
    callBPromptHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity.callBPromptHash,
    ),
    callAProviderContractSourceHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity
        .callAProviderContractSourceHash,
    ),
    callBProviderContractSourceHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity
        .callBProviderContractSourceHash,
    ),
    semanticAtomTemplateRegistryHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity
        .semanticAtomTemplateRegistryHash,
    ),
    capabilityCatalogHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity.capabilityCatalogHash,
    ),
    unsupportedSignatureRegistryHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity
        .unsupportedSignatureRegistryHash,
    ),
    substitutionGraphRegistryHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity
        .substitutionGraphRegistryHash,
    ),
    corpusHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity.corpusHash,
    ),
    modelConfigurationHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity.modelConfigurationHash,
    ),
    packageJsonHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity.packageJsonHash,
    ),
    packageLockHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity.packageLockHash,
    ),
    privateReplayCapsuleSchemaVersion: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity
        .privateReplayCapsuleSchemaVersion,
    ),
    privateReplayImplementationHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity
        .privateReplayImplementationHash,
    ),
    durableStoreIdentityHash: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity.durableStoreIdentityHash,
    )
  }).strict(),
  permittedInfrastructureIdentityFields: z.tuple([
    z.literal("sourceStateHash"),
    z.literal("sealedCommitmentRecordHash"),
    z.literal("canonicalPlanHash"),
    z.literal("evaluatorHash")
  ]),
  semanticOrFabricationAuthorityChanged: z.literal(false),
  recoveryCommitmentMayDifferFromCorrectiveCommitment: z.literal(true)
}).strict();

const RecoveryAuthorizationBaselineProjectionSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m74-sealed-recovery-authorization-baseline-supplement@1.0.0",
  ),
  milestone: z.literal("M7.4"),
  authorizationId: z.literal(
    M74_SEALED_RECOVERY_IDENTITY_DELTA.authorizationId,
  ),
  maximumCallA: z.literal(2),
  maximumCallB: z.literal(1),
  maximumCalls: z.literal(3),
  maximumReservedExposureMicrousd: z.literal(1_950_000),
  cumulativeMaximumCalls: z.literal(22),
  cumulativeMaximumReservedExposureMicrousd: z.literal(14_300_000),
  durableCeilingMicrousd: z.literal(durableExposureCeilingMicrousd),
  retryAuthorized: z.literal(false),
  replacementRecoveryPartitionAuthorized: z.literal(false),
  furtherCampaignAuthorized: z.literal(false),
  preimplementationFileCount: z.literal(
    M74_SEALED_RECOVERY_IDENTITY_DELTA
      .preimplementationInvariantFileCount,
  ),
  preimplementationSourceStateHash: z.literal(
    M74_SEALED_RECOVERY_IDENTITY_DELTA
      .preimplementationInvariantSourceStateHash,
  ),
  excludedRecoveryInfrastructurePaths: z.tuple([
    z.literal("tests/evaluation/sealed-partition.test.ts"),
    z.literal("tests/evaluation/semantic-live-evaluator.test.ts"),
    z.literal("tools/SEALED_SEMANTIC_EVALUATION.md"),
    z.literal("tools/run-live-semantic-evaluation.ts"),
    z.literal("tools/semantic-evaluation-profile.ts")
  ]),
  sealedPartitionSourceSha256: z.literal(
    M74_SEALED_RECOVERY_IDENTITY_DELTA.sealedPartitionSourceSha256,
  ),
  frozenSemanticAndFabricationIdentity:
    RecoveryIdentityDeltaSchema.shape
      .frozenSemanticAndFabricationIdentity
}).strict();

const RecoveryFrozenDurablePrefixSchema = z.object({
  authorizedCeilingMicrousd: z.literal(
    M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX
      .authorizedCeilingMicrousd,
  ),
  reservedExposureMicrousd: z.literal(
    M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX
      .reservedExposureMicrousd,
  ),
  authorizationVersion: z.literal(
    M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX.authorizationVersion,
  ),
  authorizationCount: z.literal(
    M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX.authorizationCount,
  ),
  authorizationsHash: z.literal(
    M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX.authorizationsHash,
  ),
  attemptCount: z.literal(
    M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX.attemptCount,
  ),
  attemptsHash: z.literal(
    M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX.attemptsHash,
  ),
  billingReconciliationCount: z.literal(
    M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX
      .billingReconciliationCount,
  ),
  billingReconciliationsHash: z.literal(
    M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX
      .billingReconciliationsHash,
  ),
  globalExposureStateHash: z.literal(
    M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX
      .globalExposureStateHash,
  ),
  ledgerSummaryHash: z.literal(
    M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX.ledgerSummaryHash,
  ),
  unresolvedPotentiallyBilledExposureMicrousd: z.literal(0),
  confirmedEstimatedCostMicrousd: z.literal(
    M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX
      .confirmedEstimatedCostMicrousd,
  )
}).strict();

const RecoveryConsumedLineageFreezeSchema = z.object({
  terminalDevelopment: z.object({
    selectionSha256: z.literal(M74_TERMINAL_DEVELOPMENT.selectionSha256),
    manifestSha256: z.literal(M74_TERMINAL_DEVELOPMENT.manifestSha256),
    summarySha256: z.literal(M74_TERMINAL_DEVELOPMENT.summarySha256)
  }).strict(),
  replacementDevelopment: z.object({
    selectionSha256: z.literal(
      M74_REPLACEMENT_DEVELOPMENT.selectionSha256,
    ),
    manifestSha256: z.literal(
      M74_REPLACEMENT_DEVELOPMENT.manifestSha256,
    ),
    summarySha256: z.literal(
      M74_REPLACEMENT_DEVELOPMENT.summarySha256,
    )
  }).strict(),
  burnedCorrectivePreparation: z.object({
    selectionSha256: z.literal(
      M74_BURNED_CORRECTIVE_PREPARATION.selectionSha256,
    ),
    manifestSha256: z.literal(
      M74_BURNED_CORRECTIVE_PREPARATION.manifestSha256,
    ),
    reportSha256: z.literal(
      M74_BURNED_CORRECTIVE_PREPARATION.reportSha256,
    )
  }).strict(),
  correctiveDevelopment: z.object({
    selectionSha256: z.literal(
      M74_CORRECTIVE_DEVELOPMENT.selectionSha256,
    ),
    manifestSha256: z.literal(
      M74_CORRECTIVE_DEVELOPMENT.manifestSha256,
    ),
    summarySha256: z.literal(
      M74_CORRECTIVE_DEVELOPMENT.summarySha256,
    ),
    identityHash: z.literal(M74_CORRECTIVE_DEVELOPMENT.identityHash)
  }).strict(),
  burnedAcceptancePreparation: z.object({
    selectionSha256: z.literal(
      M74_BURNED_ACCEPTANCE_PREPARATION.selectionSha256,
    ),
    manifestSha256: z.literal(
      M74_BURNED_ACCEPTANCE_PREPARATION.manifestSha256,
    ),
    reportSha256: z.literal(
      M74_BURNED_ACCEPTANCE_PREPARATION.reportSha256,
    )
  }).strict(),
  consumedSealedAcceptance: z.object({
    commitmentSha256: z.literal(
      M74_CONSUMED_SEALED_ACCEPTANCE.commitmentSha256,
    ),
    openingSha256: z.literal(
      M74_CONSUMED_SEALED_ACCEPTANCE.openingSha256,
    ),
    selectionSha256: z.literal(
      M74_CONSUMED_SEALED_ACCEPTANCE.selectionSha256,
    ),
    manifestSha256: z.literal(
      M74_CONSUMED_SEALED_ACCEPTANCE.manifestSha256,
    ),
    verifiedRegistrationSha256: z.literal(
      M74_CONSUMED_SEALED_ACCEPTANCE.verifiedRegistrationSha256,
    ),
    hardStopSha256: z.literal(
      M74_CONSUMED_SEALED_ACCEPTANCE.hardStopSha256,
    ),
    finalAuditSha256: z.literal(
      M74_CONSUMED_SEALED_ACCEPTANCE.finalAuditSha256,
    )
  }).strict()
}).strict();

const RecoveryExecutionIdentityFreezeSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m74-sealed-recovery-execution-identity-freeze@1.0.0",
  ),
  campaign: z.literal(SEMANTIC_EVALUATION_CAMPAIGN_SLUG),
  frozenAt: z.iso.datetime({ offset: true }),
  authorizationBaselineSupplementSha256: z.literal(
    M74_SEALED_RECOVERY_IDENTITY_DELTA
      .authorizationBaselineSupplementSha256,
  ),
  authorizationFreezeSha256: z.literal(
    M74_SEALED_RECOVERY_IDENTITY_DELTA.authorizationFreezeSha256,
  ),
  canonicalPlanSha256: Sha256Schema,
  fullSourceStateHash: Sha256Schema,
  infrastructureFileSha256: z.object({
    "tests/evaluation/sealed-partition.test.ts": Sha256Schema,
    "tests/evaluation/semantic-live-evaluator.test.ts": Sha256Schema,
    "tools/SEALED_SEMANTIC_EVALUATION.md": Sha256Schema,
    "tools/run-live-semantic-evaluation.ts": Sha256Schema,
    "tools/semantic-evaluation-profile.ts": Sha256Schema
  }).strict(),
  executionAffectingSourceComplement: z.object({
    excludedRelativePaths: z.tuple([
      z.literal("tests/evaluation/sealed-partition.test.ts"),
      z.literal("tests/evaluation/semantic-live-evaluator.test.ts"),
      z.literal("tools/SEALED_SEMANTIC_EVALUATION.md"),
      z.literal("tools/run-live-semantic-evaluation.ts"),
      z.literal("tools/semantic-evaluation-profile.ts")
    ]),
    fileCount: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .preimplementationInvariantFileCount,
    ),
    sha256: z.literal(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .preimplementationInvariantSourceStateHash,
    )
  }).strict(),
  frozenSemanticAndFabricationIdentity:
    RecoveryIdentityDeltaSchema.shape
      .frozenSemanticAndFabricationIdentity,
  sealedPartitionSourceSha256: z.literal(
    M74_SEALED_RECOVERY_IDENTITY_DELTA.sealedPartitionSourceSha256,
  ),
  durablePrefix: RecoveryFrozenDurablePrefixSchema,
  consumedLineage: RecoveryConsumedLineageFreezeSchema
}).strict();

const RecoveryBuilderAttestationSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m74-sealed-recovery-builder-attestation@1.0.0",
  ),
  campaign: z.literal(SEMANTIC_EVALUATION_CAMPAIGN_SLUG),
  authorizationId: z.literal(
    M74_SEALED_RECOVERY_IDENTITY_DELTA.authorizationId,
  ),
  attestedAt: z.iso.datetime({ offset: true }),
  validationCompletedAt: z.iso.datetime({ offset: true }),
  ingestionCompletedAt: z.iso.datetime({ offset: true }),
  independentAuthorRole: z.enum(["builder", "independent-party"]),
  independentlyAuthored: z.literal(true),
  validationPassed: z.literal(true),
  ingestionPassed: z.literal(true),
  createdAfterExecutionFreeze: z.literal(true),
  nonOverwritingCommitment: z.literal(true),
  nonOverwritingAttestation: z.literal(true),
  codexPayloadAccess: z.literal(false),
  retryAuthorized: z.literal(false),
  replacementAuthorized: z.literal(false),
  furtherCampaignAuthorized: z.literal(false),
  partitionId: z.string().min(1),
  caseIds: z.tuple([
    z.literal(M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds[0]),
    z.literal(M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds[1])
  ]),
  executionIdentityFreezeRecordSha256: Sha256Schema,
  commitmentRecordSha256: Sha256Schema,
  commitmentSha256: Sha256Schema,
  externalRootBinding: z.object({
    domain: z.literal(M74_SEALED_RECOVERY_ROOT_BINDING_DOMAIN),
    nonce: z.string().regex(/^[a-f0-9]{64}$/u),
    canonicalRealpathSha256: Sha256Schema
  }).strict()
}).strict();

const RecoveryBuilderAttestationBindingSchema = z.object({
  recordSha256: Sha256Schema,
  executionIdentityFreezeRecordSha256: Sha256Schema,
  commitmentRecordSha256: Sha256Schema,
  commitmentSha256: Sha256Schema,
  partitionId: z.string().min(1),
  caseIds: z.tuple([
    z.literal(M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds[0]),
    z.literal(M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds[1])
  ])
}).strict();

const CumulativeAuthoritySchema = z.object({
  terminalObservedCalls: z.literal(
    M74_CUMULATIVE_LIVE_AUTHORITY.terminalObservedCalls,
  ),
  replacementObservedCalls: z.literal(
    M74_CUMULATIVE_LIVE_AUTHORITY.replacementObservedCalls,
  ),
  correctiveMaximumCalls: z.literal(
    M74_CUMULATIVE_LIVE_AUTHORITY.correctiveMaximumCalls,
  ),
  acceptanceMaximumCalls: z.literal(
    M74_CUMULATIVE_LIVE_AUTHORITY.acceptanceMaximumCalls,
  ),
  maximumCalls: z.literal(
    M74_CUMULATIVE_LIVE_AUTHORITY.maximumCalls,
  ),
  terminalObservedReservedExposureMicrousd: z.literal(
    M74_CUMULATIVE_LIVE_AUTHORITY
      .terminalObservedReservedExposureMicrousd,
  ),
  replacementObservedReservedExposureMicrousd: z.literal(
    M74_CUMULATIVE_LIVE_AUTHORITY
      .replacementObservedReservedExposureMicrousd,
  ),
  correctiveMaximumReservedExposureMicrousd: z.literal(
    M74_CUMULATIVE_LIVE_AUTHORITY
      .correctiveMaximumReservedExposureMicrousd,
  ),
  acceptanceMaximumReservedExposureMicrousd: z.literal(
    M74_CUMULATIVE_LIVE_AUTHORITY
      .acceptanceMaximumReservedExposureMicrousd,
  ),
  maximumReservedExposureMicrousd: z.literal(
    M74_CUMULATIVE_LIVE_AUTHORITY.maximumReservedExposureMicrousd,
  )
}).strict();

const DurableSnapshotRecordSchema = z.object({
  authorizedCeilingMicrousd: z.literal(durableExposureCeilingMicrousd),
  reservedExposureMicrousd: z.number().int().nonnegative(),
  authorizationVersion: z.number().int().nonnegative(),
  authorizationCount: z.number().int().nonnegative(),
  authorizationsHash: Sha256Schema,
  attemptCount: z.number().int().nonnegative(),
  attemptsHash: Sha256Schema,
  billingReconciliationCount: z.number().int().nonnegative(),
  billingReconciliationsHash: Sha256Schema,
  globalExposureStateHash: Sha256Schema,
  ledgerSummaryHash: Sha256Schema,
  snapshotHash: Sha256Schema,
  unresolvedPotentiallyBilledExposureMicrousd:
    z.number().int().nonnegative()
}).strict();

const DevelopmentGateSchema = z.object({
  runId: RunIdSchema,
  selectionHash: Sha256Schema,
  manifestHash: Sha256Schema,
  summaryHash: Sha256Schema,
  identityHash: Sha256Schema,
  commitmentHash: Sha256Schema,
  authoritativeCalls: z.number().int().nonnegative(),
  authoritativeReservedExposureMicrousd:
    z.number().int().nonnegative(),
  trackAPass: z.literal(true),
  executionCompletedWithoutHardAnomaly: z.literal(true),
  pairedThresholdPass: z.null(),
  callBProductionDecision: z.literal("rejected-for-production")
}).strict();

const RecoveryPreparationClaimSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m74-sealed-recovery-preparation-claim@1.0.0",
  ),
  campaign: z.literal(SEMANTIC_EVALUATION_CAMPAIGN_SLUG),
  runId: RunIdSchema,
  claimedAt: z.iso.datetime({ offset: true }),
  state: z.literal("claimed-before-preparation-gates"),
  oneShot: z.literal(true)
}).strict();

const RecoveryExecutionClaimSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m74-sealed-recovery-execution-claim@1.0.0",
  ),
  campaign: z.literal(SEMANTIC_EVALUATION_CAMPAIGN_SLUG),
  runId: RunIdSchema,
  claimedAt: z.iso.datetime({ offset: true }),
  state: z.literal("claimed-before-execution-gates"),
  oneShot: z.literal(true)
}).strict();

const RecoveryPreparationStopSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m74-sealed-recovery-preparation-stop@1.0.0",
  ),
  campaign: z.literal(SEMANTIC_EVALUATION_CAMPAIGN_SLUG),
  runId: RunIdSchema,
  stoppedAt: z.iso.datetime({ offset: true }),
  phase: z.literal("post-preparation-claim"),
  hardStopReason: z.object({
    category: z.string().min(1),
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/u)
  }).strict(),
  modelDispatches: z.literal(0),
  retryAuthorized: z.literal(false),
  replacementAuthorized: z.literal(false),
  furtherCampaignAuthorized: z.literal(false)
}).strict();

const RecoveryExecutionStopSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m74-sealed-recovery-execution-stop@1.0.0",
  ),
  campaign: z.literal(SEMANTIC_EVALUATION_CAMPAIGN_SLUG),
  runId: RunIdSchema,
  stoppedAt: z.iso.datetime({ offset: true }),
  phase: z.literal("post-execution-claim"),
  hardStopReason: z.object({
    category: z.string().min(1),
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/u)
  }).strict(),
  sealedAccess: z.object({
    openingClaimed: z.boolean(),
    openingRecordSha256: Sha256Schema.nullable(),
    verifierInvoked: z.boolean(),
    readReceiptObserved: z.boolean(),
    readReceiptWritten: z.boolean(),
    readReceiptRecordSha256: Sha256Schema.nullable()
  }).strict(),
  runAccounting: z.object({
    callAAttempts: z.number().int().nonnegative().nullable(),
    callBAttempts: z.number().int().nonnegative().nullable(),
    networkDispatches: z.number().int().nonnegative().nullable(),
    reservedExposureBeforeMicrousd:
      z.number().int().nonnegative().nullable(),
    reservedExposureAfterMicrousd:
      z.number().int().nonnegative().nullable()
  }).strict(),
  retryAuthorized: z.literal(false),
  replacementAuthorized: z.literal(false),
  furtherCampaignAuthorized: z.literal(false)
}).strict();

const SealedReadReceiptSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m74-sealed-recovery-read-receipt@1.0.0",
  ),
  partitionId: z.string().min(1),
  commitmentSha256: Sha256Schema,
  commitmentRecordSha256: Sha256Schema,
  caseIds: z.tuple([
    z.literal(M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds[0]),
    z.literal(M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds[1])
  ]),
  verifierInvocations: z.literal(1),
  externalManifestByteReads: z.literal(1),
  externalCasePayloadByteReads: z.literal(2),
  totalExternalByteReads: z.literal(3),
  totalPayloadBytes: z.number().int().positive(),
  derivation: z.literal("single-frozen-helper-invocation"),
  openingClaim: z.object({
    value: SealedPartitionOpeningSchema,
    byteCount: z.number().int().positive(),
    sha256: Sha256Schema
  }).strict(),
  externalManifest: z.object({
    byteReads: z.literal(1),
    byteCount: z.number().int().positive(),
    sha256: Sha256Schema,
    schemaVersion: z.literal(SEALED_PARTITION_MANIFEST_VERSION)
  }).strict(),
  externalCasePayloads: z.tuple([
    z.object({
      caseId: z.literal(
        M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds[0],
      ),
      byteReads: z.literal(1),
      byteCount: z.number().int().positive(),
      sha256: Sha256Schema,
      caseContractVersion: z.literal(SEALED_SEMANTIC_CASE_VERSION)
    }).strict(),
    z.object({
      caseId: z.literal(
        M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds[1],
      ),
      byteReads: z.literal(1),
      byteCount: z.number().int().positive(),
      sha256: Sha256Schema,
      caseContractVersion: z.literal(SEALED_SEMANTIC_CASE_VERSION)
    }).strict()
  ]),
  contractIdentities: z.object({
    partitionManifestVersion: z.literal(
      SEALED_PARTITION_MANIFEST_VERSION,
    ),
    semanticCaseVersion: z.literal(SEALED_SEMANTIC_CASE_VERSION),
    commitmentVersion: z.literal(SEALED_PARTITION_COMMITMENT_VERSION),
    openingVersion: z.literal(SEALED_PARTITION_OPENING_VERSION),
    callAProviderContractSourceHash: Sha256Schema,
    callBProviderContractSourceHash: Sha256Schema,
    modelConfigurationHash: Sha256Schema,
    recoveryIdentityHash: Sha256Schema
  }).strict(),
  sealedPartitionSourceSha256: z.literal(
    M74_SEALED_RECOVERY_IDENTITY_DELTA.sealedPartitionSourceSha256,
  ),
  snapshotHeldInMemory: z.literal(true),
  postSnapshotExternalReads: z.literal(0)
}).strict();

const ManifestSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m7-4-governed-semantic-evaluation-run@7.0.0",
  ),
  status: z.literal("prepared"),
  campaign: z.literal(SEMANTIC_EVALUATION_CAMPAIGN_SLUG),
  mode: z.literal("acceptance"),
  runId: RunIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  preparationClaimHash: Sha256Schema,
  executionIdentityFreezeSha256: Sha256Schema,
  builderAttestationSha256: Sha256Schema,
  builderAttestation: RecoveryBuilderAttestationBindingSchema,
  identities: IdentitySchema,
  priorCapsuleReplayAudit: PriorCapsuleReplayAuditSchema,
  priorTerminalDevelopment: TerminalDevelopmentLineageSchema,
  priorReplacementDevelopment: ReplacementDevelopmentLineageSchema,
  priorBurnedCorrectivePreparation:
    BurnedCorrectivePreparationLineageSchema,
  successfulCorrectiveDevelopment:
    CorrectiveDevelopmentLineageSchema,
  priorBurnedAcceptancePreparation:
    BurnedAcceptancePreparationLineageSchema,
  priorConsumedSealedAcceptance:
    ConsumedSealedAcceptanceLineageSchema,
  recoveryIdentityDelta: RecoveryIdentityDeltaSchema,
  cumulativeAuthority: CumulativeAuthoritySchema,
  commitment: z.object({
    partitionId: z.string().min(1),
    commitmentSha256: Sha256Schema,
    caseIds: z.array(z.string().min(1)).min(2),
    totalPayloadBytes: z.number().int().positive()
  }).strict(),
  registeredCallACases: z.array(RegisteredCallACaseSchema).min(2),
  maximumExposure: z.object({
    maximumCallA: z.number().int().positive(),
    maximumCallB: z.number().int().nonnegative(),
    maximumCalls: z.number().int().positive(),
    maximumCallAPerCase: z.literal(1),
    reservedUpperBoundMicrousdPerCall: z.literal(requestExposureMicrousd),
    maximumReservedExposureMicrousd: z.number().int().positive(),
    priceSnapshotId: z.literal(GENERATION_OPENAI_PRICE.id),
    sdkMaxRetries: z.literal(GENERATION_OPENAI_MAX_RETRIES),
    candidateFanOut: z.literal(false),
    paidRetry: z.literal(false),
    fallbackModel: z.literal(false),
    unplannedAdditionalCallAuthorized: z.literal(false)
  }).strict(),
  exposureSnapshot: DurableSnapshotRecordSchema,
  availableHeadroomMicrousd: z.number().int().nonnegative(),
  downstreamReservedExposureMicrousd: z.number().int().nonnegative(),
  requiredHeadroomAtPreparationMicrousd: z.number().int().nonnegative(),
  offlineGate: z.object({
    command: z.literal("npm run verify"),
    status: z.literal("passed")
  }).strict(),
  privateReplayPreflight: PrivateSemanticReplayPreflightSchema,
  developmentGate: DevelopmentGateSchema.nullable(),
  sealedOpeningRequired: z.boolean(),
  privacy: z.object({
    rawBriefsIncluded: z.literal(false),
    referenceBytesIncluded: z.literal(false),
    modelContentIncluded: z.literal(false),
    registeredInputsAreDigestsOnly: z.literal(true),
    strictCandidatesStoredOnlyInProtectedReplayRoot: z.literal(true),
    publishableReplayEvidenceDigestOnly: z.literal(true)
  }).strict(),
  durableCeilingIncreaseAuthorized: z.literal(false)
}).strict().superRefine((manifest, context) => {
  const policy = M74_LIVE_EXPOSURE_POLICY[manifest.mode];
  if (
    manifest.maximumExposure.maximumCallA !== policy.maximumCallA ||
    manifest.maximumExposure.maximumCallB !== policy.maximumCallB ||
    manifest.maximumExposure.maximumCalls !== policy.maximumCalls ||
    manifest.maximumExposure.maximumReservedExposureMicrousd !==
      policy.maximumReservedExposureMicrousd
  ) {
    context.addIssue({
      code: "custom",
      message: "M7.4 frozen exposure policy mismatch."
    });
  }
  if (
    manifest.developmentGate === null ||
    !manifest.sealedOpeningRequired
  ) {
    context.addIssue({
      code: "custom",
      message: "M7.4 stage gate mismatch."
    });
  }
  if (
    manifest.priorCapsuleReplayAudit.currentSourceStateHash !==
      manifest.identities.sourceStateHash
  ) {
    context.addIssue({
      code: "custom",
      message: "M7.4 prior capsule replay source identity mismatch."
    });
  }
  const downstreamReservedExposureMicrousd = 0;
  const requiredHeadroomAtPreparationMicrousd =
    policy.maximumReservedExposureMicrousd +
    downstreamReservedExposureMicrousd;
  if (
    manifest.exposureSnapshot
      .unresolvedPotentiallyBilledExposureMicrousd !== 0 ||
    manifest.downstreamReservedExposureMicrousd !==
      downstreamReservedExposureMicrousd ||
    manifest.requiredHeadroomAtPreparationMicrousd !==
      requiredHeadroomAtPreparationMicrousd ||
    manifest.availableHeadroomMicrousd <
      requiredHeadroomAtPreparationMicrousd
  ) {
    context.addIssue({
      code: "custom",
      message: "M7.4 preparation headroom or reconciliation gate mismatch."
    });
  }
  if (
    manifest.registeredCallACases.some((item) =>
      item.preparedRequestDigest !== null
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "M7.4 registered request-digest stage mismatch."
    });
  }
  if (
    manifest.commitment.caseIds.length !== 2 ||
    JSON.stringify(manifest.commitment.caseIds) !==
      JSON.stringify(
        M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds,
      ) ||
    manifest.commitment.partitionId ===
      M74_CONSUMED_SEALED_ACCEPTANCE.partitionId ||
    manifest.commitment.caseIds.some((caseId) =>
      M74_CONSUMED_SEALED_ACCEPTANCE.caseIds.includes(
        caseId as (typeof M74_CONSUMED_SEALED_ACCEPTANCE.caseIds)[number],
      )
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "M7.4 recovery partition identity mismatch."
    });
  }
});
type Manifest = z.infer<typeof ManifestSchema>;

const SelectionSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m7-4-governed-semantic-evaluation-selection@7.0.0",
  ),
  campaign: z.literal(SEMANTIC_EVALUATION_CAMPAIGN_SLUG),
  mode: z.literal("acceptance"),
  runId: RunIdSchema,
  manifestHash: Sha256Schema,
  identityHash: Sha256Schema,
  executionIdentityFreezeSha256: Sha256Schema,
  builderAttestationSha256: Sha256Schema,
  selectedAt: z.iso.datetime({ offset: true }),
  oneShot: z.literal(true)
}).strict();

const TerminalSelectionEvidenceSchema = z.object({
  mode: z.literal("development"),
  runId: z.literal(M74_TERMINAL_DEVELOPMENT.runId),
  oneShot: z.literal(true)
}).loose();

const TerminalManifestEvidenceSchema = z.object({
  mode: z.literal("development"),
  runId: z.literal(M74_TERMINAL_DEVELOPMENT.runId)
}).loose();

const TerminalSummaryEvidenceSchema = z.object({
  mode: z.literal("development"),
  runId: z.literal(M74_TERMINAL_DEVELOPMENT.runId),
  executionStatus: z.literal("aborted"),
  runAccounting: z.object({
    callAAttempts: z.literal(
      M74_TERMINAL_DEVELOPMENT.observedCalls,
    ),
    callBAttempts: z.literal(0),
    networkDispatches: z.literal(
      M74_TERMINAL_DEVELOPMENT.observedCalls,
    ),
    runOwnedReservedExposureMicrousd: z.literal(
      M74_TERMINAL_DEVELOPMENT.observedReservedExposureMicrousd,
    )
  }).loose()
}).loose();

const ReplacementSelectionEvidenceSchema = z.object({
  mode: z.literal("development"),
  runId: z.literal(M74_REPLACEMENT_DEVELOPMENT.runId),
  oneShot: z.literal(true)
}).loose();

const ReplacementManifestEvidenceSchema = z.object({
  mode: z.literal("development"),
  runId: z.literal(M74_REPLACEMENT_DEVELOPMENT.runId)
}).loose();

const ReplacementSummaryEvidenceSchema = z.object({
  mode: z.literal("development"),
  runId: z.literal(M74_REPLACEMENT_DEVELOPMENT.runId),
  executionStatus: z.literal("completed"),
  replayCapsules: z.array(PrivateSemanticReplayEvidenceSchema).length(8),
  runAccounting: z.object({
    callAAttempts: z.literal(
      M74_REPLACEMENT_DEVELOPMENT.observedCalls,
    ),
    callBAttempts: z.literal(0),
    networkDispatches: z.literal(
      M74_REPLACEMENT_DEVELOPMENT.observedCalls,
    ),
    runOwnedReservedExposureMicrousd: z.literal(
      M74_REPLACEMENT_DEVELOPMENT.observedReservedExposureMicrousd,
    )
  }).loose()
}).loose();

const BurnedCorrectiveSelectionEvidenceSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m7-4-governed-semantic-evaluation-selection@4.0.0",
  ),
  campaign: z.literal(
    M74_BURNED_CORRECTIVE_PREPARATION.campaignSlug,
  ),
  mode: z.literal("development"),
  runId: z.literal(M74_BURNED_CORRECTIVE_PREPARATION.runId),
  manifestHash: z.literal(
    M74_BURNED_CORRECTIVE_PREPARATION.manifestSha256,
  ),
  oneShot: z.literal(true)
}).loose();

const BurnedCorrectiveManifestEvidenceSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m7-4-governed-semantic-evaluation-run@4.0.0",
  ),
  status: z.literal("prepared"),
  campaign: z.literal(
    M74_BURNED_CORRECTIVE_PREPARATION.campaignSlug,
  ),
  mode: z.literal("development"),
  runId: z.literal(M74_BURNED_CORRECTIVE_PREPARATION.runId),
  exposureSnapshot: z.object({
    reservedExposureMicrousd: z.literal(
      M74_BURNED_CORRECTIVE_PREPARATION
        .frozenReservedExposureMicrousd,
    ),
    attemptCount: z.literal(
      M74_BURNED_CORRECTIVE_PREPARATION.frozenAttemptCount,
    )
  }).loose(),
  maximumExposure: z.object({
    maximumCallA: z.literal(4),
    maximumCallB: z.literal(0),
    maximumCalls: z.literal(4),
    maximumReservedExposureMicrousd: z.literal(2_600_000)
  }).loose()
}).loose();

const BurnedCorrectiveStopEvidenceSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m74-corrective-predispatch-stop@1.0.0",
  ),
  campaign: z.literal(
    M74_BURNED_CORRECTIVE_PREPARATION.campaignSlug,
  ),
  runId: z.literal(M74_BURNED_CORRECTIVE_PREPARATION.runId),
  stopCode: z.literal(
    M74_BURNED_CORRECTIVE_PREPARATION.stopCode,
  ),
  durableStateBefore: z.object({
    reservedExposureMicrousd: z.literal(
      M74_BURNED_CORRECTIVE_PREPARATION
        .frozenReservedExposureMicrousd,
    ),
    attemptCount: z.literal(
      M74_BURNED_CORRECTIVE_PREPARATION.frozenAttemptCount,
    )
  }).loose(),
  durableStateAfter: z.object({
    reservedExposureMicrousd: z.literal(
      M74_BURNED_CORRECTIVE_PREPARATION
        .frozenReservedExposureMicrousd,
    ),
    attemptCount: z.literal(
      M74_BURNED_CORRECTIVE_PREPARATION.frozenAttemptCount,
    )
  }).loose(),
  accounting: z.object({
    modelDispatches: z.literal(0),
    newAttempts: z.literal(0),
    reservedExposureDeltaMicrousd: z.literal(0),
    sealedOpeningClaims: z.literal(0)
  }).loose(),
  disposition: z.object({
    selectionStatus: z.literal("burned-and-preserved"),
    summaryPresent: z.literal(false),
    paidRetry: z.literal(false),
    additionalPaidCampaignAuthorized: z.literal(false),
    replacementSelectionWithinSameAuthorizedCorrectiveCampaign:
      z.literal(true)
  }).loose()
}).loose();

const CorrectiveSelectionEvidenceSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m7-4-governed-semantic-evaluation-selection@5.0.0",
  ),
  campaign: z.literal(M74_CORRECTIVE_DEVELOPMENT.campaignSlug),
  mode: z.literal("development"),
  runId: z.literal(M74_CORRECTIVE_DEVELOPMENT.runId),
  manifestHash: z.literal(
    M74_CORRECTIVE_DEVELOPMENT.manifestSha256,
  ),
  identityHash: z.literal(
    M74_CORRECTIVE_DEVELOPMENT.identityHash,
  ),
  oneShot: z.literal(true)
}).loose();

const CorrectiveManifestEvidenceSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m7-4-governed-semantic-evaluation-run@5.0.0",
  ),
  status: z.literal("prepared"),
  campaign: z.literal(M74_CORRECTIVE_DEVELOPMENT.campaignSlug),
  mode: z.literal("development"),
  runId: z.literal(M74_CORRECTIVE_DEVELOPMENT.runId)
}).loose();

const CorrectiveSummaryEvidenceSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m7-4-governed-semantic-evaluation-summary@5.0.0",
  ),
  campaign: z.literal(M74_CORRECTIVE_DEVELOPMENT.campaignSlug),
  mode: z.literal("development"),
  runId: z.literal(M74_CORRECTIVE_DEVELOPMENT.runId),
  executionStatus: z.literal("completed"),
  qualityStatus: z.literal("pass"),
  replayCapsules: z.array(PrivateSemanticReplayEvidenceSchema).length(4),
  trackA: z.object({
    qualityStatus: z.literal("pass"),
    shippingDecision: z.literal("accepted")
  }).loose(),
  runAccounting: z.object({
    callAAttempts: z.literal(
      M74_CORRECTIVE_DEVELOPMENT.observedCalls,
    ),
    callBAttempts: z.literal(0),
    networkDispatches: z.literal(
      M74_CORRECTIVE_DEVELOPMENT.observedCalls,
    ),
    runOwnedReservedExposureMicrousd: z.literal(
      M74_CORRECTIVE_DEVELOPMENT
        .observedReservedExposureMicrousd,
    )
  }).loose(),
  hardStopReason: z.null()
}).loose();

const BurnedAcceptanceSelectionEvidenceSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m7-4-governed-semantic-evaluation-selection@5.0.0",
  ),
  campaign: z.literal(
    M74_BURNED_ACCEPTANCE_PREPARATION.campaignSlug,
  ),
  mode: z.literal("acceptance"),
  runId: z.literal(M74_BURNED_ACCEPTANCE_PREPARATION.runId),
  manifestHash: z.literal(
    M74_BURNED_ACCEPTANCE_PREPARATION.manifestSha256,
  ),
  identityHash: z.literal(
    M74_CORRECTIVE_DEVELOPMENT.identityHash,
  ),
  oneShot: z.literal(true)
}).loose();

const BurnedAcceptanceManifestEvidenceSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m7-4-governed-semantic-evaluation-run@5.0.0",
  ),
  status: z.literal("prepared"),
  campaign: z.literal(
    M74_BURNED_ACCEPTANCE_PREPARATION.campaignSlug,
  ),
  mode: z.literal("acceptance"),
  runId: z.literal(M74_BURNED_ACCEPTANCE_PREPARATION.runId),
  exposureSnapshot: z.object({
    reservedExposureMicrousd: z.literal(
      M74_BURNED_ACCEPTANCE_PREPARATION
        .frozenReservedExposureMicrousd,
    ),
    attemptCount: z.literal(
      M74_BURNED_ACCEPTANCE_PREPARATION.frozenAttemptCount,
    )
  }).loose(),
  maximumExposure: z.object({
    maximumCallA: z.literal(2),
    maximumCallB: z.literal(1),
    maximumCalls: z.literal(3),
    maximumReservedExposureMicrousd: z.literal(1_950_000)
  }).loose()
}).loose();

const BurnedAcceptanceStopEvidenceSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m74-acceptance-predispatch-stop@1.0.0",
  ),
  campaign: z.literal(
    M74_BURNED_ACCEPTANCE_PREPARATION.campaignSlug,
  ),
  runId: z.literal(M74_BURNED_ACCEPTANCE_PREPARATION.runId),
  stopCode: z.literal(
    M74_BURNED_ACCEPTANCE_PREPARATION.stopCode,
  ),
  preChangeAcceptanceSourceBoundary: z.object({
    allowedChangedFiles: z.tuple([
      z.literal("tests/evaluation/semantic-live-evaluator.test.ts"),
      z.literal("tools/run-live-semantic-evaluation.ts"),
      z.literal("tools/semantic-evaluation-profile.ts")
    ]),
    invariantFileCount: z.literal(
      M74_ACCEPTANCE_CLAIM_FIRST_IDENTITY_DELTA.invariantFileCount,
    ),
    invariantSourceStateHash: z.literal(
      M74_ACCEPTANCE_CLAIM_FIRST_IDENTITY_DELTA
        .invariantSourceStateHash,
    )
  }).loose(),
  accounting: z.object({
    modelDispatches: z.literal(0),
    newAttempts: z.literal(0),
    reservedExposureDeltaMicrousd: z.literal(0),
    sealedPayloadByteReads: z.literal(0),
    sealedOpeningClaims: z.literal(0)
  }).loose(),
  disposition: z.object({
    selectionStatus: z.literal("burned-and-preserved"),
    summaryPresent: z.literal(false),
    paidRetry: z.literal(false),
    replacementSealedPayloadAuthorized: z.literal(false),
    replacementSelectionWithinSameSealedAcceptanceLane:
      z.literal(true)
  }).loose()
}).loose();

const SafePairedCaseArtifactSchema = z.object({
  schemaVersion: z.literal("sketchycut-m7-4-paired-case-artifact@1.0.0"),
  mode: z.literal("acceptance"),
  result: PairedSemanticReviewCaseResultSchema,
  callAAttempt: LiveCallAttemptSchema,
  callBAttempt: LiveCallAttemptSchema.nullable()
}).strict();

const RunSummarySchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-m7-4-governed-semantic-evaluation-summary@7.0.0",
  ),
  campaign: z.literal(SEMANTIC_EVALUATION_CAMPAIGN_SLUG),
  mode: z.literal("acceptance"),
  runId: RunIdSchema,
  manifestHash: Sha256Schema,
  selectionHash: Sha256Schema,
  identityHash: Sha256Schema,
  priorTerminalDevelopment: TerminalDevelopmentLineageSchema,
  priorReplacementDevelopment: ReplacementDevelopmentLineageSchema,
  priorBurnedCorrectivePreparation:
    BurnedCorrectivePreparationLineageSchema,
  successfulCorrectiveDevelopment:
    CorrectiveDevelopmentLineageSchema,
  priorBurnedAcceptancePreparation:
    BurnedAcceptancePreparationLineageSchema,
  priorConsumedSealedAcceptance:
    ConsumedSealedAcceptanceLineageSchema,
  recoveryIdentityDelta: RecoveryIdentityDeltaSchema,
  completedAt: z.iso.datetime({ offset: true }),
  executionStatus: z.enum(["completed", "aborted", "blocked-preflight"]),
  qualityStatus: z.enum(["pass", "fail", "not-scored"]),
  trackA: z.object({
    executed: z.boolean(),
    qualityStatus: z.enum(["pass", "fail", "not-scored"]).nullable(),
    summaryHash: Sha256Schema.nullable(),
    shippingDecision: z.enum(["accepted", "not-accepted", "not-applicable"])
  }).strict(),
  pairedReview: z.object({
    attemptedCaseIds: z.array(z.string().min(1)),
    aggregate: PairedSemanticReviewAggregateSchema.nullable(),
    thresholdPass: z.boolean().nullable(),
    productionDecision: z.enum([
      "remain-evaluation-only-pending-builder-decision",
      "rejected-for-production",
      "not-evaluated"
    ])
  }).strict(),
  replayCapsules: z.array(PrivateSemanticReplayEvidenceSchema),
  runAccounting: z.object({
    callAAttempts: z.number().int().nonnegative(),
    callBAttempts: z.number().int().nonnegative(),
    unattributedAttempts: z.number().int().nonnegative(),
    networkDispatches: z.number().int().nonnegative(),
    reservedExposureBeforeMicrousd: z.number().int().nonnegative(),
    reservedExposureAfterMicrousd: z.number().int().nonnegative(),
    runOwnedReservedExposureMicrousd: z.number().int().nonnegative(),
    confirmedEstimatedCostMicrousd: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative()
  }).strict(),
  durableLineage: z.object({
    frozenAttemptCount: z.number().int().nonnegative(),
    finalAttemptCount: z.number().int().nonnegative(),
    frozenAttemptsHash: Sha256Schema,
    runAttemptsHash: Sha256Schema,
    billingReconciliationCount: z.number().int().nonnegative(),
    billingReconciliationsHash: Sha256Schema,
    authorizationCount: z.number().int().nonnegative(),
    authorizationsHash: Sha256Schema
  }).strict(),
  cumulativeAccounting: z.object({
    terminalCalls: z.literal(
      M74_TERMINAL_DEVELOPMENT.observedCalls,
    ),
    terminalReservedExposureMicrousd: z.literal(
      M74_TERMINAL_DEVELOPMENT.observedReservedExposureMicrousd,
    ),
    replacementCalls: z.literal(
      M74_REPLACEMENT_DEVELOPMENT.observedCalls,
    ),
    replacementReservedExposureMicrousd: z.literal(
      M74_REPLACEMENT_DEVELOPMENT.observedReservedExposureMicrousd,
    ),
    correctiveCalls: z.number().int().nonnegative(),
    correctiveReservedExposureMicrousd:
      z.number().int().nonnegative(),
    acceptanceCalls: z.number().int().nonnegative(),
    acceptanceReservedExposureMicrousd:
      z.number().int().nonnegative(),
    totalCalls: z.number().int().nonnegative(),
    totalReservedExposureMicrousd:
      z.number().int().nonnegative(),
    withinFrozenAuthority: z.boolean()
  }).strict(),
  hardStopReason: z.object({
    category: z.string().min(1),
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/u)
  }).strict().nullable(),
  stoppedWithoutRetry: z.literal(true),
  durableCeilingIncrease: z.literal(0),
  broadGeneralizationClaimed: z.literal(false)
}).strict().superRefine((summary, context) => {
  const attemptCount =
    summary.runAccounting.callAAttempts +
    summary.runAccounting.callBAttempts +
    summary.runAccounting.unattributedAttempts;
  const replayAttemptIds = summary.replayCapsules.map((item) =>
    item.attemptId
  );
  if (
    new Set(replayAttemptIds).size !== replayAttemptIds.length ||
    summary.replayCapsules.length > summary.runAccounting.callAAttempts ||
    (
      summary.hardStopReason === null &&
      summary.replayCapsules.length !== summary.runAccounting.callAAttempts
    ) ||
    summary.durableLineage.finalAttemptCount !==
      summary.durableLineage.frozenAttemptCount + attemptCount ||
    summary.runAccounting.networkDispatches > attemptCount ||
    summary.runAccounting.runOwnedReservedExposureMicrousd !==
      summary.runAccounting.reservedExposureAfterMicrousd -
        summary.runAccounting.reservedExposureBeforeMicrousd
  ) {
    context.addIssue({
      code: "custom",
      message: "M7.4 summary durable attempt or exposure accounting mismatch."
    });
  }
  const cumulative = summary.cumulativeAccounting;
  const modePolicy = M74_LIVE_EXPOSURE_POLICY[summary.mode];
  const withinFrozenAuthority =
    cumulative.totalCalls <=
      M74_CUMULATIVE_LIVE_AUTHORITY.maximumCalls &&
    cumulative.totalReservedExposureMicrousd <=
      M74_CUMULATIVE_LIVE_AUTHORITY
        .maximumReservedExposureMicrousd &&
    cumulative.correctiveCalls <=
      M74_LIVE_EXPOSURE_POLICY.development.maximumCalls &&
    cumulative.correctiveReservedExposureMicrousd <=
      M74_LIVE_EXPOSURE_POLICY.development
        .maximumReservedExposureMicrousd &&
    cumulative.acceptanceCalls <=
      M74_LIVE_EXPOSURE_POLICY.acceptance.maximumCalls &&
    cumulative.acceptanceReservedExposureMicrousd <=
      M74_LIVE_EXPOSURE_POLICY.acceptance
        .maximumReservedExposureMicrousd &&
    summary.runAccounting.callAAttempts <= modePolicy.maximumCallA &&
    summary.runAccounting.callBAttempts <= modePolicy.maximumCallB &&
    summary.runAccounting.unattributedAttempts === 0 &&
    summary.runAccounting.networkDispatches <= modePolicy.maximumCalls &&
    summary.runAccounting.runOwnedReservedExposureMicrousd <=
      modePolicy.maximumReservedExposureMicrousd;
  if (
    cumulative.totalCalls !==
      cumulative.terminalCalls +
        cumulative.replacementCalls +
        cumulative.correctiveCalls +
        cumulative.acceptanceCalls ||
    cumulative.totalReservedExposureMicrousd !==
      cumulative.terminalReservedExposureMicrousd +
        cumulative.replacementReservedExposureMicrousd +
        cumulative.correctiveReservedExposureMicrousd +
        cumulative.acceptanceReservedExposureMicrousd ||
    cumulative.withinFrozenAuthority !== withinFrozenAuthority ||
    (!withinFrozenAuthority && summary.hardStopReason === null) ||
    cumulative.acceptanceCalls !==
      summary.runAccounting.networkDispatches ||
    cumulative.acceptanceReservedExposureMicrousd !==
      summary.runAccounting.runOwnedReservedExposureMicrousd
  ) {
    context.addIssue({
      code: "custom",
      message: "M7.4 summary cumulative authority mismatch."
    });
  }
});
type RunSummary = z.infer<typeof RunSummarySchema>;

type SemanticCase = (typeof SEMANTIC_GENERALIZATION_CORPUS.cases)[number];

type PreparedCase = {
  caseId: string;
  submission: GenerationSubmission;
  prepared: PreparedSemanticGenerationRequest;
  transportReferences: { referenceId: string; dataUrl: string }[];
  inputDigest: string;
  committedPayloadDigest: string | null;
  providerSchemaHash: string;
};

type CallAExecution = {
  caseId: string;
  submission: GenerationSubmission;
  prepared: PreparedSemanticGenerationRequest;
  transportReferences: { referenceId: string; dataUrl: string }[];
  session: SessionRecord;
  candidate: SemanticInterpretationCandidate | null;
  outcome: GenerationOutcome;
  response: Awaited<ReturnType<typeof executeCurrentGeneration>>;
  attempt: LiveCallAttempt | null;
  replayCapsule: PrivateSemanticReplayEvidence | null;
  raw: SemanticEvaluationRawCaseResult;
};

type ExecutionAccounting = {
  callAAttempts: LiveCallAttempt[];
  callBAttempts: LiveCallAttempt[];
  chronologicalAttempts: LiveCallAttempt[];
  replayCapsules: PrivateSemanticReplayEvidence[];
};

type RecoveryOpeningClaim = {
  value: z.infer<typeof SealedPartitionOpeningSchema>;
  bytes: Buffer;
  recordSha256: string;
};

type RecoverySealedAccessState = {
  opening: z.infer<typeof SealedPartitionOpeningSchema> | null;
  openingRecordSha256: string | null;
  verifierInvoked: boolean;
  receipt: z.infer<typeof SealedReadReceiptSchema> | null;
  receiptRecordSha256: string | null;
  receiptWritten: boolean;
};

type RecoveryExecutionTerminalContext = {
  accounting: ExecutionAccounting;
  accessState: RecoverySealedAccessState;
  authoritativeAccounting: {
    callAAttempts: number | null;
    callBAttempts: number | null;
    networkDispatches: number | null;
  };
  reservedExposureBeforeMicrousd: number | null;
  reservedExposureAfterMicrousd: number | null;
};

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

function summaryPath(runId: string): string {
  return path.join(runDirectory(runId), "summary.json");
}

function opaqueRunId(mode: SemanticEvaluationMode): string {
  const timestamp = new Date().toISOString()
    .replaceAll(/[-:.TZ]/gu, "")
    .slice(0, 14);
  return `m07-4-${mode}-${timestamp}-${randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

function artifactBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function claimRecoveryPreparation(runId: string): Promise<{
  claim: z.infer<typeof RecoveryPreparationClaimSchema>;
  claimHash: string;
}> {
  const claim = RecoveryPreparationClaimSchema.parse({
    schemaVersion:
      "sketchycut-m74-sealed-recovery-preparation-claim@1.0.0",
    campaign: SEMANTIC_EVALUATION_CAMPAIGN_SLUG,
    runId,
    claimedAt: new Date().toISOString(),
    state: "claimed-before-preparation-gates",
    oneShot: true
  });
  const bytes = artifactBytes(claim);
  await writeFile(recoveryPreparationClaimPath, bytes, {
    flag: "wx"
  });
  return {
    claim,
    claimHash: await sha256(bytes)
  };
}

async function claimRecoveryExecution(
  runId: string,
): Promise<z.infer<typeof RecoveryExecutionClaimSchema>> {
  const claim = RecoveryExecutionClaimSchema.parse({
    schemaVersion:
      "sketchycut-m74-sealed-recovery-execution-claim@1.0.0",
    campaign: SEMANTIC_EVALUATION_CAMPAIGN_SLUG,
    runId,
    claimedAt: new Date().toISOString(),
    state: "claimed-before-execution-gates",
    oneShot: true
  });
  await writeFile(
    path.join(runDirectory(runId), "execution-claim.json"),
    artifactBytes(claim),
    { flag: "wx" },
  );
  return claim;
}

async function terminalDevelopmentLineage(): Promise<
  z.infer<typeof TerminalDevelopmentLineageSchema>
> {
  const terminalRunId = M74_TERMINAL_DEVELOPMENT.runId;
  const [selectionBytes, manifestBytes, summaryBytes] =
    await Promise.all([
      readFile(terminalDevelopmentSelectionPath),
      readFile(manifestPath(terminalRunId)),
      readFile(summaryPath(terminalRunId))
    ]);
  const [selectionHash, manifestHash, summaryHash] =
    await Promise.all([
      sha256(selectionBytes),
      sha256(manifestBytes),
      sha256(summaryBytes)
    ]);
  if (
    selectionHash !== M74_TERMINAL_DEVELOPMENT.selectionSha256 ||
    manifestHash !== M74_TERMINAL_DEVELOPMENT.manifestSha256 ||
    summaryHash !== M74_TERMINAL_DEVELOPMENT.summarySha256
  ) {
    throw new Error("M74_TERMINAL_DEVELOPMENT_EVIDENCE_DRIFT");
  }
  TerminalSelectionEvidenceSchema.parse(
    JSON.parse(selectionBytes.toString("utf8")) as unknown,
  );
  TerminalManifestEvidenceSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")) as unknown,
  );
  TerminalSummaryEvidenceSchema.parse(
    JSON.parse(summaryBytes.toString("utf8")) as unknown,
  );
  return TerminalDevelopmentLineageSchema.parse({
    runId: terminalRunId,
    selectionHash,
    manifestHash,
    summaryHash,
    observedCalls: M74_TERMINAL_DEVELOPMENT.observedCalls,
    observedReservedExposureMicrousd:
      M74_TERMINAL_DEVELOPMENT.observedReservedExposureMicrousd
  });
}

async function replacementDevelopmentLineage(): Promise<
  z.infer<typeof ReplacementDevelopmentLineageSchema>
> {
  const runId = M74_REPLACEMENT_DEVELOPMENT.runId;
  const [selectionBytes, manifestBytes, summaryBytes] =
    await Promise.all([
      readFile(replacementDevelopmentSelectionPath),
      readFile(manifestPath(runId)),
      readFile(summaryPath(runId))
    ]);
  const [selectionHash, manifestHash, summaryHash] =
    await Promise.all([
      sha256(selectionBytes),
      sha256(manifestBytes),
      sha256(summaryBytes)
    ]);
  if (
    selectionHash !== M74_REPLACEMENT_DEVELOPMENT.selectionSha256 ||
    manifestHash !== M74_REPLACEMENT_DEVELOPMENT.manifestSha256 ||
    summaryHash !== M74_REPLACEMENT_DEVELOPMENT.summarySha256
  ) {
    throw new Error("M74_REPLACEMENT_DEVELOPMENT_EVIDENCE_DRIFT");
  }
  ReplacementSelectionEvidenceSchema.parse(
    JSON.parse(selectionBytes.toString("utf8")) as unknown,
  );
  ReplacementManifestEvidenceSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")) as unknown,
  );
  ReplacementSummaryEvidenceSchema.parse(
    JSON.parse(summaryBytes.toString("utf8")) as unknown,
  );
  return ReplacementDevelopmentLineageSchema.parse({
    runId,
    selectionHash,
    manifestHash,
    summaryHash,
    observedCalls: M74_REPLACEMENT_DEVELOPMENT.observedCalls,
    observedReservedExposureMicrousd:
      M74_REPLACEMENT_DEVELOPMENT.observedReservedExposureMicrousd
  });
}

async function burnedCorrectivePreparationLineage(): Promise<
  z.infer<typeof BurnedCorrectivePreparationLineageSchema>
> {
  const runId = M74_BURNED_CORRECTIVE_PREPARATION.runId;
  const [selectionBytes, manifestBytes, reportBytes] =
    await Promise.all([
      readFile(burnedCorrectivePreparationSelectionPath),
      readFile(manifestPath(runId)),
      readFile(burnedCorrectivePreparationReportPath)
    ]);
  const [selectionHash, manifestHash, reportHash] =
    await Promise.all([
      sha256(selectionBytes),
      sha256(manifestBytes),
      sha256(reportBytes)
    ]);
  if (
    selectionHash !==
      M74_BURNED_CORRECTIVE_PREPARATION.selectionSha256 ||
    manifestHash !==
      M74_BURNED_CORRECTIVE_PREPARATION.manifestSha256 ||
    reportHash !==
      M74_BURNED_CORRECTIVE_PREPARATION.reportSha256 ||
    existsSync(summaryPath(runId))
  ) {
    throw new Error(
      "M74_BURNED_CORRECTIVE_PREPARATION_EVIDENCE_DRIFT",
    );
  }
  BurnedCorrectiveSelectionEvidenceSchema.parse(
    JSON.parse(selectionBytes.toString("utf8")) as unknown,
  );
  BurnedCorrectiveManifestEvidenceSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")) as unknown,
  );
  BurnedCorrectiveStopEvidenceSchema.parse(
    JSON.parse(reportBytes.toString("utf8")) as unknown,
  );
  return BurnedCorrectivePreparationLineageSchema.parse({
    runId,
    selectionHash,
    manifestHash,
    reportHash,
    stopCode: M74_BURNED_CORRECTIVE_PREPARATION.stopCode,
    frozenAttemptCount:
      M74_BURNED_CORRECTIVE_PREPARATION.frozenAttemptCount,
    frozenReservedExposureMicrousd:
      M74_BURNED_CORRECTIVE_PREPARATION
        .frozenReservedExposureMicrousd,
    observedCalls: 0,
    observedReservedExposureMicrousd: 0
  });
}

async function correctiveDevelopmentLineage(): Promise<
  z.infer<typeof CorrectiveDevelopmentLineageSchema>
> {
  const runId = M74_CORRECTIVE_DEVELOPMENT.runId;
  const [selectionBytes, manifestBytes, summaryBytes] =
    await Promise.all([
      readFile(correctiveDevelopmentSelectionPath),
      readFile(manifestPath(runId)),
      readFile(summaryPath(runId))
    ]);
  const [selectionHash, manifestHash, summaryHash] =
    await Promise.all([
      sha256(selectionBytes),
      sha256(manifestBytes),
      sha256(summaryBytes)
    ]);
  if (
    selectionHash !== M74_CORRECTIVE_DEVELOPMENT.selectionSha256 ||
    manifestHash !== M74_CORRECTIVE_DEVELOPMENT.manifestSha256 ||
    summaryHash !== M74_CORRECTIVE_DEVELOPMENT.summarySha256
  ) {
    throw new Error("M74_CORRECTIVE_DEVELOPMENT_EVIDENCE_DRIFT");
  }
  const selection = CorrectiveSelectionEvidenceSchema.parse(
    JSON.parse(selectionBytes.toString("utf8")) as unknown,
  );
  CorrectiveManifestEvidenceSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")) as unknown,
  );
  CorrectiveSummaryEvidenceSchema.parse(
    JSON.parse(summaryBytes.toString("utf8")) as unknown,
  );
  return CorrectiveDevelopmentLineageSchema.parse({
    runId,
    selectionHash,
    manifestHash,
    summaryHash,
    identityHash: selection.identityHash,
    observedCalls: M74_CORRECTIVE_DEVELOPMENT.observedCalls,
    observedReservedExposureMicrousd:
      M74_CORRECTIVE_DEVELOPMENT.observedReservedExposureMicrousd,
    trackAPass: true
  });
}

async function burnedAcceptancePreparationLineage(): Promise<
  z.infer<typeof BurnedAcceptancePreparationLineageSchema>
> {
  const runId = M74_BURNED_ACCEPTANCE_PREPARATION.runId;
  const [selectionBytes, manifestBytes, reportBytes] =
    await Promise.all([
      readFile(burnedAcceptancePreparationSelectionPath),
      readFile(manifestPath(runId)),
      readFile(burnedAcceptancePreparationReportPath)
    ]);
  const [selectionHash, manifestHash, reportHash] =
    await Promise.all([
      sha256(selectionBytes),
      sha256(manifestBytes),
      sha256(reportBytes)
    ]);
  if (
    selectionHash !==
      M74_BURNED_ACCEPTANCE_PREPARATION.selectionSha256 ||
    manifestHash !==
      M74_BURNED_ACCEPTANCE_PREPARATION.manifestSha256 ||
    reportHash !==
      M74_BURNED_ACCEPTANCE_PREPARATION.reportSha256 ||
    existsSync(summaryPath(runId))
  ) {
    throw new Error(
      "M74_BURNED_ACCEPTANCE_PREPARATION_EVIDENCE_DRIFT",
    );
  }
  BurnedAcceptanceSelectionEvidenceSchema.parse(
    JSON.parse(selectionBytes.toString("utf8")) as unknown,
  );
  BurnedAcceptanceManifestEvidenceSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")) as unknown,
  );
  BurnedAcceptanceStopEvidenceSchema.parse(
    JSON.parse(reportBytes.toString("utf8")) as unknown,
  );
  return BurnedAcceptancePreparationLineageSchema.parse({
    runId,
    selectionHash,
    manifestHash,
    reportHash,
    stopCode: M74_BURNED_ACCEPTANCE_PREPARATION.stopCode,
    frozenAttemptCount:
      M74_BURNED_ACCEPTANCE_PREPARATION.frozenAttemptCount,
    frozenReservedExposureMicrousd:
      M74_BURNED_ACCEPTANCE_PREPARATION
        .frozenReservedExposureMicrousd,
    observedCalls: 0,
    observedReservedExposureMicrousd: 0,
    sealedPayloadByteReads: 0,
    sealedOpeningClaims: 0
  });
}

async function consumedSealedAcceptanceLineage(): Promise<
  z.infer<typeof ConsumedSealedAcceptanceLineageSchema>
> {
  const [
    commitmentBytes,
    openingBytes,
    selectionBytes,
    manifestBytes,
    registrationBytes,
    hardStopBytes,
    finalAuditBytes
  ] = await Promise.all([
    readFile(consumedCommitmentPath),
    readFile(consumedOpeningPath),
    readFile(consumedAcceptanceSelectionPath),
    readFile(consumedAcceptanceManifestPath),
    readFile(consumedVerifiedRegistrationPath),
    readFile(consumedHardStopPath),
    readFile(consumedFinalAuditPath)
  ]);
  const [
    commitmentHash,
    openingHash,
    selectionHash,
    manifestHash,
    verifiedRegistrationHash,
    hardStopHash,
    finalAuditHash
  ] = await Promise.all([
    sha256(commitmentBytes),
    sha256(openingBytes),
    sha256(selectionBytes),
    sha256(manifestBytes),
    sha256(registrationBytes),
    sha256(hardStopBytes),
    sha256(finalAuditBytes)
  ]);
  if (
    commitmentHash !==
      M74_CONSUMED_SEALED_ACCEPTANCE.commitmentSha256 ||
    openingHash !== M74_CONSUMED_SEALED_ACCEPTANCE.openingSha256 ||
    selectionHash !==
      M74_CONSUMED_SEALED_ACCEPTANCE.selectionSha256 ||
    manifestHash !==
      M74_CONSUMED_SEALED_ACCEPTANCE.manifestSha256 ||
    verifiedRegistrationHash !==
      M74_CONSUMED_SEALED_ACCEPTANCE.verifiedRegistrationSha256 ||
    hardStopHash !==
      M74_CONSUMED_SEALED_ACCEPTANCE.hardStopSha256 ||
    finalAuditHash !==
      M74_CONSUMED_SEALED_ACCEPTANCE.finalAuditSha256
  ) {
    throw new Error("M74_CONSUMED_SEALED_ACCEPTANCE_EVIDENCE_DRIFT");
  }
  const commitment = z.object({
    partitionId: z.literal(
      M74_CONSUMED_SEALED_ACCEPTANCE.partitionId,
    ),
    caseIds: z.tuple([
      z.literal(M74_CONSUMED_SEALED_ACCEPTANCE.caseIds[0]),
      z.literal(M74_CONSUMED_SEALED_ACCEPTANCE.caseIds[1])
    ])
  }).loose().parse(
    JSON.parse(commitmentBytes.toString("utf8")) as unknown,
  );
  z.object({
    partitionId: z.literal(commitment.partitionId),
    caseIds: z.tuple([
      z.literal(commitment.caseIds[0]),
      z.literal(commitment.caseIds[1])
    ])
  }).loose().parse(
    JSON.parse(openingBytes.toString("utf8")) as unknown,
  );
  return ConsumedSealedAcceptanceLineageSchema.parse({
    runId: M74_CONSUMED_SEALED_ACCEPTANCE.runId,
    partitionId: commitment.partitionId,
    caseIds: commitment.caseIds,
    commitmentHash,
    openingHash,
    selectionHash,
    manifestHash,
    verifiedRegistrationHash,
    hardStopHash,
    finalAuditHash,
    observedCalls: 0,
    observedReservedExposureMicrousd: 0,
    openingClaims: 1,
    partitionLoadPasses: 2,
    payloadFileReads: 4,
    preservedByteForByte: true
  });
}

async function priorCapsuleReplayAudit(
  identities: Identity,
): Promise<z.infer<typeof PriorCapsuleReplayAuditSchema>> {
  const [replacementSummary, correctiveSummary] = await Promise.all([
    readJson(summaryPath(M74_REPLACEMENT_DEVELOPMENT.runId))
      .then((value) => ReplacementSummaryEvidenceSchema.parse(value)),
    readJson(summaryPath(M74_CORRECTIVE_DEVELOPMENT.runId))
      .then((value) => CorrectiveSummaryEvidenceSchema.parse(value))
  ]);
  const replayEvidence = [
    ...replacementSummary.replayCapsules,
    ...correctiveSummary.replayCapsules
  ];
  const caseById = new Map<string, SemanticCase>(
    SEMANTIC_GENERALIZATION_CORPUS.cases.map((item) => [item.id, item]),
  );
  const cases = (await Promise.all(replayEvidence.map(
    async (evidence) => {
      const capsule = await loadPrivateSemanticReplayCapsule({
        rootDirectory: privateReplayRoot,
        caseId: evidence.caseId,
        attemptId: evidence.attemptId,
        expectedEvidence: evidence
      });
      const deterministic = await evaluateSemanticCandidateForOfflineReplay({
        controls: {
          deterministicControls: capsule.deterministicControls,
          fabricationControls: capsule.fabricationControls
        },
        request: capsule.request,
        candidate: capsule.candidate,
        requestId: `corrective-replay-${capsule.caseId}`
      });
      const replay = await replayPrivateSemanticCapsule(capsule);
      const testCase = caseById.get(capsule.caseId);
      if (testCase === undefined) {
        throw new Error("M74_PRIOR_CAPSULE_CASE_UNREGISTERED");
      }
      const candidateUnsupportedSignatureIds = capsule.candidate.items
        .flatMap((item) =>
          item.state === "unbound" || item.state === "uncertain"
            ? item.unsupportedSignatureIds
            : []
        );
      const score = scoreSemanticCaseOracle({
        testCase,
        request: capsule.request,
        outcome: deterministic.outcome,
        candidateUnsupportedSignatureIds
      });
      if (
        !score.primaryPass ||
        replay.outcomeKind !== deterministic.outcome.kind ||
        replay.exportAllowed !== deterministic.outcome.exportAllowed
      ) {
        throw new Error(
          "M74_PRIOR_CAPSULE_CURRENT_SOURCE_QUALITY_FAILURE",
        );
      }
      return PriorCapsuleReplayCaseSchema.parse({
        caseId: capsule.caseId,
        attemptId: capsule.attemptId,
        capsuleSha256: evidence.capsuleSha256,
        outcomeKind: replay.outcomeKind,
        exportAllowed: replay.exportAllowed,
        compiledDigest: replay.compiledDigest,
        packageSha256: replay.packageSha256,
        oracleScoreHash: await hashCanonical(score),
        primaryPass: true
      });
    },
  ))).toSorted((left, right) =>
    left.caseId < right.caseId
      ? -1
      : left.caseId > right.caseId
        ? 1
        : left.attemptId < right.attemptId
          ? -1
          : left.attemptId > right.attemptId
            ? 1
            : 0
  );
  const base = {
    schemaVersion:
      "sketchycut-m74-prior-capsule-current-source-audit@1.0.0" as const,
    currentSourceStateHash: identities.sourceStateHash,
    retainedScopePolicyVersion: CURRENT_RETAINED_SCOPE_POLICY_VERSION,
    capsuleCount: 12 as const,
    passedCount: 12 as const,
    modelCalls: 0 as const,
    runtimeApplicationApiCalls: 0 as const,
    cases
  };
  return PriorCapsuleReplayAuditSchema.parse({
    ...base,
    auditHash: await hashCanonical(base)
  });
}

async function loadLocalEnvironment(): Promise<void> {
  const environmentPath = path.join(repositoryRoot, ".env.local");
  if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);
  process.env.SKETCHYCUT_INTERPRETATION_PROMPT = await readFile(
    callAPromptPath,
    "utf8",
  );
  process.env.SKETCHYCUT_GENERATION_ENABLED = "1";
  process.env.SKETCHYCUT_GENERATION_MODE = "live";
  process.env.SKETCHYCUT_STORE = "upstash";
  process.env.SKETCHYCUT_QUOTA_UNLIMITED = "0";
}

function configuredRuntime() {
  const config = readRuntimeConfig();
  if (
    !config.generationEnabled ||
    config.generationMode !== "live" ||
    config.liveTransport === null ||
    config.storeMode !== "upstash" ||
    config.quotaUnlimited
  ) {
    throw new Error("M74_EVALUATION_RUNTIME_CONFIGURATION_INVALID");
  }
  return config;
}

async function collectIdentityFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectIdentityFiles(candidate);
    return entry.isFile() ? [candidate] : [];
  }));
  return nested.flat().sort();
}

async function sourceStateRecords(
  excludedRelativePaths: ReadonlySet<string> = new Set(),
) {
  const roots = ["src", "tests", "tools"].map((root) =>
    path.join(repositoryRoot, root)
  );
  const files = (
    await Promise.all(roots.map((root) => collectIdentityFiles(root)))
  ).flat().filter((file) =>
    /\.(?:ts|tsx|js|mjs|json|md)$/u.test(file)
  );
  const extra = [
    path.join(repositoryRoot, "package.json"),
    path.join(repositoryRoot, "package-lock.json"),
    path.join(repositoryRoot, "eslint.config.mjs"),
    path.join(repositoryRoot, "next-env.d.ts"),
    path.join(repositoryRoot, "next.config.ts"),
    path.join(repositoryRoot, "playwright.config.ts"),
    path.join(repositoryRoot, "playwright.deployment.config.ts"),
    path.join(repositoryRoot, "playwright.live-probe.config.ts"),
    path.join(repositoryRoot, "tsconfig.build.json"),
    path.join(repositoryRoot, "tsconfig.json"),
    path.join(repositoryRoot, "vitest.config.ts"),
    callAPromptPath,
    callBPromptPath
  ];
  return Promise.all(
    [...new Set([...files, ...extra])]
      .sort()
      .filter((file) =>
        !excludedRelativePaths.has(
          path.relative(repositoryRoot, file),
        )
      )
      .map(async (file) => ({
        path: path.relative(repositoryRoot, file),
        sha256: await sha256(await readFile(file))
      })),
  );
}

async function sourceStateHash(): Promise<string> {
  return hashCanonical(await sourceStateRecords());
}

async function recoveryInvariantSourceStateHash() {
  const records = await sourceStateRecords(new Set(
    M74_SEALED_RECOVERY_IDENTITY_DELTA
      .recoveryInfrastructurePaths,
  ));
  return {
    fileCount: records.length,
    hash: await hashCanonical(records)
  };
}

function gitHead(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false
  });
  if (result.status !== 0) throw new Error("M74_GIT_HEAD_UNAVAILABLE");
  return GitObjectIdSchema.parse(result.stdout.trim());
}

async function currentIdentities(): Promise<Identity> {
  const [callAPrompt, callBPrompt] = await Promise.all([
    readFile(callAPromptPath, "utf8"),
    readFile(callBPromptPath, "utf8")
  ]);
  const upstash = readUpstashConfig();
  return IdentitySchema.parse({
    gitHead: gitHead(),
    sourceStateHash: await sourceStateHash(),
    callAPromptHash: await sha256(
      instructionsForPromptLayout(callAPrompt),
    ),
    callBPromptHash: await sha256(callBPrompt),
    callAProviderContractSourceHash: await sha256(await readFile(
      path.join(
        repositoryRoot,
        "src/interpretation/semantic-model-contract.ts",
      ),
    )),
    callBProviderContractSourceHash: await hashCanonical({
      contract: await sha256(await readFile(path.join(
        repositoryRoot,
        "src/evaluation/bounded-semantic-review.ts",
      ))),
      transport: await sha256(await readFile(path.join(
        repositoryRoot,
        "src/evaluation/openai-semantic-review-transport.ts",
      )))
    }),
    semanticAtomTemplateRegistryHash:
      await semanticAtomTemplateRegistryHash(),
    capabilityCatalogHash: await capabilityCatalogHash(),
    unsupportedSignatureRegistryHash:
      await unsupportedSemanticSignatureRegistryHash(),
    substitutionGraphRegistryHash: await substitutionGraphRegistryHash(),
    corpusHash: await sha256(await readFile(corpusPath)),
    sealedCommitmentRecordHash: await sha256(
      await readFile(recoveryCommitmentPath),
    ),
    canonicalPlanHash: await sha256(await readFile(path.join(
      repositoryRoot,
      "docs/M7_4_BOUNDED_SEMANTIC_REVIEW_AND_SUBSTITUTION_GRAPH_PLAN.md",
    ))),
    evaluatorHash: await hashCanonical({
      oracle: await sha256(await readFile(path.join(
        repositoryRoot,
        "src/evaluation/semantic-generalization-oracle.ts",
      ))),
      live: await sha256(await readFile(path.join(
        repositoryRoot,
        "src/evaluation/semantic-live-evaluator.ts",
      ))),
      paired: await sha256(await readFile(path.join(
        repositoryRoot,
        "src/evaluation/paired-semantic-review-evaluator.ts",
      ))),
      runner: await sha256(await readFile(path.join(
        repositoryRoot,
        "tools/run-live-semantic-evaluation.ts",
      ))),
      profile: await sha256(await readFile(path.join(
        repositoryRoot,
        "tools/semantic-evaluation-profile.ts",
      )))
    }),
    modelConfigurationHash: await hashCanonical(MODEL_CONFIGURATION),
    packageJsonHash: await sha256(await readFile(path.join(
      repositoryRoot,
      "package.json",
    ))),
    packageLockHash: await sha256(await readFile(path.join(
      repositoryRoot,
      "package-lock.json",
    ))),
    privateReplayCapsuleSchemaVersion:
      CURRENT_PRIVATE_SEMANTIC_REPLAY_CAPSULE_VERSION,
    privateReplayImplementationHash: await sha256(await readFile(path.join(
      repositoryRoot,
      "src/evaluation/private-semantic-replay.ts",
    ))),
    durableStoreIdentityHash: await hashCanonical({
      endpointSha256: await sha256(upstash.url),
      namespace: GENERATION_POLICY.namespace,
      storeMode: "upstash"
    })
  });
}

const RECOVERY_FROZEN_IDENTITY_FIELDS = [
  "gitHead",
  "callAPromptHash",
  "callBPromptHash",
  "callAProviderContractSourceHash",
  "callBProviderContractSourceHash",
  "semanticAtomTemplateRegistryHash",
  "capabilityCatalogHash",
  "unsupportedSignatureRegistryHash",
  "substitutionGraphRegistryHash",
  "corpusHash",
  "modelConfigurationHash",
  "packageJsonHash",
  "packageLockHash",
  "privateReplayCapsuleSchemaVersion",
  "privateReplayImplementationHash",
  "durableStoreIdentityHash"
] as const satisfies readonly (keyof Identity)[];

async function assertRecoveryAuthorizationBaseline(): Promise<void> {
  const [authorizationFreezeBytes, bytes] = await Promise.all([
    readFile(recoveryAuthorizationFreezePath),
    readFile(recoveryAuthorizationBaselineSupplementPath)
  ]);
  if (
    await sha256(authorizationFreezeBytes) !==
      M74_SEALED_RECOVERY_IDENTITY_DELTA.authorizationFreezeSha256
  ) {
    throw new Error("M74_RECOVERY_AUTHORIZATION_FREEZE_DRIFT");
  }
  if (
    await sha256(bytes) !==
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .authorizationBaselineSupplementSha256
  ) {
    throw new Error(
      "M74_RECOVERY_AUTHORIZATION_BASELINE_SUPPLEMENT_DRIFT",
    );
  }
  const record = z.record(z.string(), z.unknown()).parse(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
  const authorization = z.record(z.string(), z.unknown()).parse(
    record.authorization,
  );
  const complement = z.record(z.string(), z.unknown()).parse(
    record.preimplementationSourceComplement,
  );
  const baselineFrozenIdentity =
    z.record(z.string(), z.unknown()).parse(
      record.frozenSemanticAndFabricationIdentity,
    );
  const projection =
    RecoveryAuthorizationBaselineProjectionSchema.parse({
      schemaVersion: record.schemaVersion,
      milestone: record.milestone,
      authorizationId: authorization.authorizationId,
      maximumCallA: authorization.maximumCallA,
      maximumCallB: authorization.maximumCallB,
      maximumCalls: authorization.maximumCalls,
      maximumReservedExposureMicrousd:
        authorization.maximumReservedExposureMicrousd,
      cumulativeMaximumCalls: authorization.cumulativeMaximumCalls,
      cumulativeMaximumReservedExposureMicrousd:
        authorization.cumulativeMaximumReservedExposureMicrousd,
      durableCeilingMicrousd: authorization.durableCeilingMicrousd,
      retryAuthorized: authorization.retryAuthorized,
      replacementRecoveryPartitionAuthorized:
        authorization.replacementRecoveryPartitionAuthorized,
      furtherCampaignAuthorized:
        authorization.furtherCampaignAuthorized,
      preimplementationFileCount: complement.fileCount,
      preimplementationSourceStateHash: complement.sha256,
      excludedRecoveryInfrastructurePaths:
        complement.excludedRecoveryInfrastructurePaths,
      sealedPartitionSourceSha256:
        baselineFrozenIdentity.sealedPartitionSourceSha256,
      frozenSemanticAndFabricationIdentity: Object.fromEntries(
        RECOVERY_FROZEN_IDENTITY_FIELDS.map((field) => [
          field,
          field === "gitHead"
            ? M74_SEALED_RECOVERY_IDENTITY_DELTA
                .frozenSemanticAndFabricationIdentity.gitHead
            : baselineFrozenIdentity[field]
        ]),
      )
    });
  if (
    await hashCanonical(
      projection.frozenSemanticAndFabricationIdentity,
    ) !== await hashCanonical(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity,
    )
  ) {
    throw new Error(
      "M74_RECOVERY_AUTHORIZATION_SEMANTIC_IDENTITY_DRIFT",
    );
  }
}

async function assertRecoveryIdentityDelta(
  recoveryIdentities: Identity,
) {
  const frozen =
    M74_SEALED_RECOVERY_IDENTITY_DELTA
      .frozenSemanticAndFabricationIdentity;
  if (
    RECOVERY_FROZEN_IDENTITY_FIELDS.some((field) =>
      recoveryIdentities[field] !== frozen[field]
    )
  ) {
    throw new Error(
      "M74_SEALED_RECOVERY_SEMANTIC_OR_FABRICATION_IDENTITY_DRIFT",
    );
  }
  const invariant = await recoveryInvariantSourceStateHash();
  if (
    invariant.fileCount !==
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .preimplementationInvariantFileCount ||
    invariant.hash !==
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .preimplementationInvariantSourceStateHash
  ) {
    throw new Error(
      "M74_SEALED_RECOVERY_SOURCE_COMPLEMENT_DRIFT",
    );
  }
  return RecoveryIdentityDeltaSchema.parse({
    policyVersion: M74_SEALED_RECOVERY_IDENTITY_DELTA.policyVersion,
    authorizationId:
      M74_SEALED_RECOVERY_IDENTITY_DELTA.authorizationId,
    recoveryIdentityHash: await hashCanonical(recoveryIdentities),
    recoveryCaseIds:
      M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds,
    consumedCaseIds:
      M74_SEALED_RECOVERY_IDENTITY_DELTA.consumedCaseIds,
    frozenSemanticAndFabricationIdentity: frozen,
    permittedInfrastructureIdentityFields:
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .permittedInfrastructureIdentityFields,
    semanticOrFabricationAuthorityChanged: false,
    recoveryCommitmentMayDifferFromCorrectiveCommitment: true
  });
}

async function assertRecoveryExecutionIdentityFreeze(
  identities: Identity,
): Promise<{
  freeze: z.infer<typeof RecoveryExecutionIdentityFreezeSchema>;
  recordSha256: string;
}> {
  const freezeBytes = await readFile(
    recoveryExecutionIdentityFreezePath,
  );
  const freeze = RecoveryExecutionIdentityFreezeSchema.parse(
    JSON.parse(freezeBytes.toString("utf8")) as unknown,
  );
  const infrastructureEntries = Object.entries(
    freeze.infrastructureFileSha256,
  );
  const [infrastructureHashes, complement, sealedPartitionHash] =
    await Promise.all([
      Promise.all(infrastructureEntries.map(async ([relativePath]) => [
        relativePath,
        await sha256(await readFile(path.join(
          repositoryRoot,
          relativePath,
        )))
      ] as const)),
      recoveryInvariantSourceStateHash(),
      sha256(await readFile(path.join(
        repositoryRoot,
        "src/evaluation/sealed-partition.ts",
      )))
    ]);
  const observedInfrastructure = Object.fromEntries(
    infrastructureHashes,
  );
  const canonicalPlanSha256 = await sha256(await readFile(path.join(
    repositoryRoot,
    "docs/M7_4_BOUNDED_SEMANTIC_REVIEW_AND_SUBSTITUTION_GRAPH_PLAN.md",
  )));
  if (
    identities.sourceStateHash !== freeze.fullSourceStateHash ||
    identities.canonicalPlanHash !== freeze.canonicalPlanSha256 ||
    canonicalPlanSha256 !== freeze.canonicalPlanSha256 ||
    JSON.stringify(observedInfrastructure) !==
      JSON.stringify(freeze.infrastructureFileSha256) ||
    complement.fileCount !==
      freeze.executionAffectingSourceComplement.fileCount ||
    complement.hash !==
      freeze.executionAffectingSourceComplement.sha256 ||
    sealedPartitionHash !== freeze.sealedPartitionSourceSha256 ||
    await hashCanonical(
      freeze.frozenSemanticAndFabricationIdentity,
    ) !== await hashCanonical(
      M74_SEALED_RECOVERY_IDENTITY_DELTA
        .frozenSemanticAndFabricationIdentity,
    )
  ) {
    throw new Error("M74_SEALED_RECOVERY_EXECUTION_IDENTITY_DRIFT");
  }
  return {
    freeze,
    recordSha256: await sha256(freezeBytes)
  };
}

async function assertRecoveryBuilderAttestation(input: {
  executionFreeze: Awaited<
    ReturnType<typeof assertRecoveryExecutionIdentityFreeze>
  >;
  identities: Identity;
  commitment: Awaited<
    ReturnType<typeof readSealedPartitionCommitment>
  >;
}): Promise<{
  attestation: z.infer<typeof RecoveryBuilderAttestationSchema>;
  binding: z.infer<typeof RecoveryBuilderAttestationBindingSchema>;
}> {
  const attestationBytes = await readFile(
    recoveryBuilderAttestationPath,
  );
  const attestation = RecoveryBuilderAttestationSchema.parse(
    JSON.parse(attestationBytes.toString("utf8")) as unknown,
  );
  const attestationTime = Date.parse(attestation.attestedAt);
  const validationTime = Date.parse(attestation.validationCompletedAt);
  const ingestionTime = Date.parse(attestation.ingestionCompletedAt);
  const freezeTime = Date.parse(input.executionFreeze.freeze.frozenAt);
  const authorizationTime = Date.parse(
    input.commitment.authorization.authorizedAt,
  );
  const commitmentTime = Date.parse(input.commitment.committedAt);
  if (
    attestation.executionIdentityFreezeRecordSha256 !==
      input.executionFreeze.recordSha256 ||
    attestation.commitmentRecordSha256 !==
      input.identities.sealedCommitmentRecordHash ||
    attestation.commitmentSha256 !==
      input.commitment.commitmentSha256 ||
    attestation.partitionId !== input.commitment.partitionId ||
    JSON.stringify(attestation.caseIds) !==
      JSON.stringify(input.commitment.caseIds) ||
    validationTime <= freezeTime ||
    authorizationTime <= freezeTime ||
    authorizationTime > validationTime ||
    ingestionTime < validationTime ||
    commitmentTime < validationTime ||
    commitmentTime > ingestionTime ||
    attestationTime < ingestionTime
  ) {
    throw new Error("M74_RECOVERY_BUILDER_ATTESTATION_DRIFT");
  }
  const binding = RecoveryBuilderAttestationBindingSchema.parse({
    recordSha256: await sha256(attestationBytes),
    executionIdentityFreezeRecordSha256:
      attestation.executionIdentityFreezeRecordSha256,
    commitmentRecordSha256: attestation.commitmentRecordSha256,
    commitmentSha256: attestation.commitmentSha256,
    partitionId: attestation.partitionId,
    caseIds: attestation.caseIds
  });
  return { attestation, binding };
}

async function preflightAndBindRecoveryInputRoot(input: {
  inputRoot: string;
  attestation: z.infer<typeof RecoveryBuilderAttestationSchema>;
}): Promise<string> {
  let rootMetadata: Awaited<ReturnType<typeof lstat>>;
  try {
    rootMetadata = await lstat(input.inputRoot);
  } catch {
    throw new Error("M74_RECOVERY_EXTERNAL_ROOT_METADATA_UNAVAILABLE");
  }
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("M74_RECOVERY_EXTERNAL_ROOT_NOT_REGULAR_DIRECTORY");
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(input.inputRoot);
  } catch {
    throw new Error("M74_RECOVERY_EXTERNAL_ROOT_REALPATH_UNAVAILABLE");
  }
  const rootBinding = await sha256(Buffer.from(
    `${M74_SEALED_RECOVERY_ROOT_BINDING_DOMAIN}\u0000` +
      `${input.attestation.externalRootBinding.nonce}\u0000` +
      canonicalRoot,
    "utf8",
  ));
  if (
    rootBinding !==
      input.attestation.externalRootBinding.canonicalRealpathSha256
  ) {
    throw new Error("M74_RECOVERY_EXTERNAL_ROOT_BINDING_MISMATCH");
  }
  return canonicalRoot;
}

async function prepareSubmission(input: {
  caseId: string;
  brief: string;
  references: {
    referenceId: string;
    sha256: string;
    mediaType: "image/jpeg" | "image/png" | "image/webp";
    width: number;
    height: number;
    dataBase64: string;
  }[];
  roleConstraints: {
    referenceId: string;
    roles: ("structure" | "surface")[];
  }[];
  promptHash: string;
  registrationValue: unknown;
}): Promise<PreparedCase> {
  const references = input.references.map((reference) => ({
    descriptor: {
      referenceId: reference.referenceId,
      sha256: reference.sha256,
      mediaType: reference.mediaType,
      width: reference.width,
      height: reference.height
    },
    dataUrl:
      `data:${reference.mediaType};base64,${reference.dataBase64}`
  }));
  for (const reference of references) {
    await verifyNormalizedReference(reference);
  }
  const submission = GenerationSubmissionSchema.parse({
    schemaVersion: "4.0",
    brief: input.brief,
    references,
    roleConstraints: input.roleConstraints,
    deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
    fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
    retry: null
  });
  const prepared = await prepareSemanticGenerationRequest({
    brief: submission.brief,
    references: submission.references.map((reference) =>
      reference.descriptor
    ),
    roleConstraints: submission.roleConstraints,
    promptIdentity: CURRENT_PROMPT_IDENTITY,
    promptHash: input.promptHash,
    modelConfiguration: MODEL_CONFIGURATION
  });
  return {
    caseId: input.caseId,
    submission,
    prepared,
    transportReferences: references.map((reference) => ({
      referenceId: reference.descriptor.referenceId,
      dataUrl: reference.dataUrl
    })),
    inputDigest: await hashCanonical(input.registrationValue),
    committedPayloadDigest: null,
    providerSchemaHash: await hashCanonical(
      semanticInterpretationProviderSchema(
        prepared.request.sourceEvidenceIndex,
      ),
    )
  };
}

async function preparedPairedCase(
  testCase: SealedSemanticCasePayload,
  promptHash: string,
): Promise<PreparedCase> {
  return prepareSubmission({
    caseId: testCase.caseId,
    brief: testCase.submission.brief,
    references: testCase.submission.references,
    roleConstraints: testCase.submission.roleConstraints,
    promptHash,
    registrationValue: testCase
  });
}

function assertRecoveryCommitmentBoundary(
  commitment: Awaited<
    ReturnType<typeof readSealedPartitionCommitment>
  >,
): void {
  if (
    commitment.authorization.authorizationId !==
      M74_SEALED_RECOVERY_IDENTITY_DELTA.authorizationId
  ) {
    throw new Error(
      "M74_RECOVERY_COMMITMENT_AUTHORIZATION_INVALID",
    );
  }
  if (
    commitment.partitionId ===
      M74_CONSUMED_SEALED_ACCEPTANCE.partitionId ||
    commitment.caseIds.length !== 2 ||
    commitment.payloads.length !== 2 ||
    JSON.stringify(commitment.caseIds) !==
      JSON.stringify(SEMANTIC_EVALUATION_CASE_PROFILES.acceptance) ||
    commitment.caseIds.some((caseId) =>
      M74_CONSUMED_SEALED_ACCEPTANCE.caseIds.some(
        (consumedCaseId) => consumedCaseId === caseId,
      )
    )
  ) {
    throw new Error("M74_RECOVERY_CASE_IDS_INVALID");
  }
}

async function sealedRegistration(): Promise<
  z.infer<typeof RegisteredCallACaseSchema>[]
> {
  const commitment = await readSealedPartitionCommitment(
    recoveryCommitmentPath,
  );
  assertRecoveryCommitmentBoundary(commitment);
  return commitment.payloads.map((payload, index) =>
    RegisteredCallACaseSchema.parse({
      caseId: payload.caseId,
      ordinal: index + 1,
      lane: "sealed",
      inputDigest: payload.payloadSha256,
      providerSchemaHash: null,
      preparedRequestDigest: null
    })
  );
}

function runOfflineGate(): void {
  const result = spawnSync("npm", ["run", "verify"], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error("M74_EVALUATION_OFFLINE_GATE_FAILED");
  }
}

function reconciliationStore(
  store: GenerationStore,
): BillingReconciliationGenerationStore {
  const candidate = store as Partial<BillingReconciliationGenerationStore>;
  if (
    typeof candidate.readBillingReconciliations !== "function" ||
    typeof candidate.appendBillingReconciliation !== "function"
  ) {
    throw new Error("M74_BILLING_RECONCILIATION_STORE_UNAVAILABLE");
  }
  return candidate as BillingReconciliationGenerationStore;
}

async function readDurableSnapshotOnce(store: GenerationStore) {
  const reconciliations = reconciliationStore(store);
  const [
    state,
    attempts,
    billingReconciliations,
    authorizations
  ] = await Promise.all([
    store.readGlobalExposureState(),
    store.readLedgerAttempts(),
    reconciliations.readBillingReconciliations(),
    store.readExposureAuthorizations()
  ]);
  const ledger = summarizeLedger(attempts, billingReconciliations);
  const snapshotRecordBase = {
    authorizedCeilingMicrousd: state.authorizedCeilingMicrousd,
    reservedExposureMicrousd: state.reservedExposureMicrousd,
    authorizationVersion: state.authorizationVersion,
    authorizationCount: authorizations.length,
    authorizationsHash: await hashCanonical(authorizations),
    attemptCount: attempts.length,
    attemptsHash: await hashCanonical(attempts),
    billingReconciliationCount: billingReconciliations.length,
    billingReconciliationsHash:
      await hashCanonical(billingReconciliations),
    globalExposureStateHash: await hashCanonical(state),
    ledgerSummaryHash: await hashCanonical(ledger),
    unresolvedPotentiallyBilledExposureMicrousd:
      ledger.unresolvedPotentiallyBilledExposureMicrousd
  };
  const record = DurableSnapshotRecordSchema.parse({
    ...snapshotRecordBase,
    snapshotHash: await hashCanonical(snapshotRecordBase)
  });
  return {
    state,
    attempts,
    authorizations,
    billingReconciliations,
    record,
    ledger,
    consistencyHash: await hashCanonical({
      state,
      attempts,
      billingReconciliations,
      authorizations,
      ledger
    })
  };
}

async function durableSnapshot(
  store: GenerationStore,
  allowUnresolvedPotentialBilling = false,
) {
  const first = await readDurableSnapshotOnce(store);
  const snapshot = await readDurableSnapshotOnce(store);
  if (first.consistencyHash !== snapshot.consistencyHash) {
    throw new Error("M74_DURABLE_SNAPSHOT_UNSTABLE");
  }
  if (
    snapshot.state.authorizedCeilingMicrousd !==
      durableExposureCeilingMicrousd
  ) {
    throw new Error("M74_DURABLE_EXPOSURE_CEILING_DRIFT");
  }
  if (
    !allowUnresolvedPotentialBilling &&
    snapshot.ledger.unresolvedPotentiallyBilledExposureMicrousd !== 0
  ) {
    throw new Error("M74_UNRESOLVED_POTENTIALLY_BILLED_EXPOSURE");
  }
  return snapshot;
}

function assertRecoveryFrozenDurablePrefix(
  snapshot: Awaited<ReturnType<typeof durableSnapshot>>,
): void {
  RecoveryFrozenDurablePrefixSchema.parse({
    authorizedCeilingMicrousd:
      snapshot.record.authorizedCeilingMicrousd,
    reservedExposureMicrousd:
      snapshot.record.reservedExposureMicrousd,
    authorizationVersion: snapshot.record.authorizationVersion,
    authorizationCount: snapshot.record.authorizationCount,
    authorizationsHash: snapshot.record.authorizationsHash,
    attemptCount: snapshot.record.attemptCount,
    attemptsHash: snapshot.record.attemptsHash,
    billingReconciliationCount:
      snapshot.record.billingReconciliationCount,
    billingReconciliationsHash:
      snapshot.record.billingReconciliationsHash,
    globalExposureStateHash:
      snapshot.record.globalExposureStateHash,
    ledgerSummaryHash: snapshot.record.ledgerSummaryHash,
    unresolvedPotentiallyBilledExposureMicrousd:
      snapshot.record.unresolvedPotentiallyBilledExposureMicrousd,
    confirmedEstimatedCostMicrousd:
      snapshot.ledger.confirmedEstimatedCostMicrousd
  });
}

async function developmentGate(
  store: GenerationStore,
): Promise<
  z.infer<typeof DevelopmentGateSchema>
> {
  const [
    selectionBytes,
    terminalLineage,
    replacementLineage,
    burnedCorrectiveLineage,
    correctiveLineage
  ] =
    await Promise.all([
      readFile(correctiveDevelopmentSelectionPath),
      terminalDevelopmentLineage(),
      replacementDevelopmentLineage(),
      burnedCorrectivePreparationLineage(),
      correctiveDevelopmentLineage()
    ]);
  const selection = CorrectiveSelectionEvidenceSchema.parse(
    JSON.parse(selectionBytes.toString("utf8")) as unknown,
  );
  const [manifestBytes, summaryBytes] = await Promise.all([
    readFile(manifestPath(selection.runId)),
    readFile(summaryPath(selection.runId))
  ]);
  const manifestValue =
    JSON.parse(manifestBytes.toString("utf8")) as unknown;
  const summaryValue =
    JSON.parse(summaryBytes.toString("utf8")) as unknown;
  CorrectiveManifestEvidenceSchema.parse(manifestValue);
  CorrectiveSummaryEvidenceSchema.parse(summaryValue);
  const manifest = z.object({
    mode: z.literal("development"),
    runId: z.literal(M74_CORRECTIVE_DEVELOPMENT.runId),
    identities: IdentitySchema,
    commitment: ManifestSchema.shape.commitment,
    priorTerminalDevelopment: TerminalDevelopmentLineageSchema,
    priorReplacementDevelopment: ReplacementDevelopmentLineageSchema,
    priorBurnedCorrectivePreparation:
      BurnedCorrectivePreparationLineageSchema,
    exposureSnapshot: DurableSnapshotRecordSchema
  }).loose().parse(manifestValue);
  const summary = z.object({
    runId: z.literal(M74_CORRECTIVE_DEVELOPMENT.runId),
    mode: z.literal("development"),
    manifestHash: Sha256Schema,
    selectionHash: Sha256Schema,
    identityHash: Sha256Schema,
    priorTerminalDevelopment: TerminalDevelopmentLineageSchema,
    priorReplacementDevelopment: ReplacementDevelopmentLineageSchema,
    priorBurnedCorrectivePreparation:
      BurnedCorrectivePreparationLineageSchema,
    executionStatus: z.literal("completed"),
    hardStopReason: z.null(),
    trackA: RunSummarySchema.shape.trackA,
    pairedReview: RunSummarySchema.shape.pairedReview,
    runAccounting: RunSummarySchema.shape.runAccounting,
    durableLineage: RunSummarySchema.shape.durableLineage,
    cumulativeAccounting: RunSummarySchema.shape.cumulativeAccounting
  }).loose().parse(summaryValue);
  const [selectionHash, manifestHash, summaryHash, identityHash] =
    await Promise.all([
      sha256(selectionBytes),
      sha256(manifestBytes),
      sha256(summaryBytes),
      hashCanonical(manifest.identities)
    ]);
  const durable = await durableSnapshot(store);
  const frozenAttemptCount =
    manifest.exposureSnapshot.attemptCount;
  const finalAttemptCount =
    summary.durableLineage.finalAttemptCount;
  const durableRunAttempts = durable.attempts.slice(
    frozenAttemptCount,
    finalAttemptCount,
  );
  if (
    selection.manifestHash !== manifestHash ||
    selection.identityHash !== identityHash ||
    summary.manifestHash !== manifestHash ||
    summary.selectionHash !== selectionHash ||
    summary.identityHash !== identityHash ||
    selectionHash !== correctiveLineage.selectionHash ||
    summaryHash !== correctiveLineage.summaryHash ||
    await hashCanonical(manifest.priorTerminalDevelopment) !==
      await hashCanonical(terminalLineage) ||
    await hashCanonical(summary.priorTerminalDevelopment) !==
      await hashCanonical(terminalLineage) ||
    await hashCanonical(manifest.priorReplacementDevelopment) !==
      await hashCanonical(replacementLineage) ||
    await hashCanonical(summary.priorReplacementDevelopment) !==
      await hashCanonical(replacementLineage) ||
    await hashCanonical(
      manifest.priorBurnedCorrectivePreparation,
    ) !== await hashCanonical(burnedCorrectiveLineage) ||
    await hashCanonical(
      summary.priorBurnedCorrectivePreparation,
    ) !== await hashCanonical(burnedCorrectiveLineage) ||
    summary.trackA.qualityStatus !== "pass" ||
    summary.trackA.shippingDecision !== "accepted" ||
    summary.pairedReview.thresholdPass !== null ||
    summary.pairedReview.aggregate !== null ||
    summary.pairedReview.productionDecision !==
      "rejected-for-production" ||
    JSON.stringify(summary.pairedReview.attemptedCaseIds) !==
      JSON.stringify(M74_OPEN_PAIRED_REVIEW_CASE_IDS) ||
    summary.cumulativeAccounting.correctiveCalls !==
      summary.runAccounting.networkDispatches ||
    summary.cumulativeAccounting
      .correctiveReservedExposureMicrousd !==
      summary.runAccounting.runOwnedReservedExposureMicrousd ||
    summary.durableLineage.frozenAttemptCount !==
      frozenAttemptCount ||
    summary.durableLineage.frozenAttemptsHash !==
      manifest.exposureSnapshot.attemptsHash ||
    durable.attempts.length !== finalAttemptCount ||
    await hashCanonical(
      durable.attempts.slice(0, frozenAttemptCount),
    ) !== manifest.exposureSnapshot.attemptsHash ||
    await hashCanonical(durableRunAttempts) !==
      summary.durableLineage.runAttemptsHash ||
    durable.billingReconciliations.length !==
      summary.durableLineage.billingReconciliationCount ||
    durable.record.billingReconciliationsHash !==
      summary.durableLineage.billingReconciliationsHash ||
    durable.authorizations.length !==
      summary.durableLineage.authorizationCount ||
    durable.record.authorizationsHash !==
      summary.durableLineage.authorizationsHash ||
    durable.state.reservedExposureMicrousd !==
      summary.runAccounting.reservedExposureAfterMicrousd ||
    !summary.cumulativeAccounting.withinFrozenAuthority
  ) {
    throw new Error("M74_ACCEPTANCE_DEVELOPMENT_GATE_MISSING");
  }
  return DevelopmentGateSchema.parse({
    runId: selection.runId,
    selectionHash,
    manifestHash,
    summaryHash,
    identityHash,
    commitmentHash: await hashCanonical(manifest.commitment),
    authoritativeCalls: summary.runAccounting.networkDispatches,
    authoritativeReservedExposureMicrousd:
      summary.runAccounting.runOwnedReservedExposureMicrousd,
    trackAPass: true,
    executionCompletedWithoutHardAnomaly: true,
    pairedThresholdPass: null,
    callBProductionDecision: "rejected-for-production"
  });
}

async function recordRecoveryPreparationTerminalStop(
  runId: string,
  error: unknown,
): Promise<void> {
  const stop = RecoveryPreparationStopSchema.parse({
    schemaVersion:
      "sketchycut-m74-sealed-recovery-preparation-stop@1.0.0",
    campaign: SEMANTIC_EVALUATION_CAMPAIGN_SLUG,
    runId,
    stoppedAt: new Date().toISOString(),
    phase: "post-preparation-claim",
    hardStopReason: safeHardAnomaly(error),
    modelDispatches: 0,
    retryAuthorized: false,
    replacementAuthorized: false,
    furtherCampaignAuthorized: false
  });
  await writeFile(
    recoveryPreparationTerminalStopPath,
    artifactBytes(stop),
    { flag: "wx" },
  );
}

async function prepareRun(mode: SemanticEvaluationMode): Promise<void> {
  if (mode !== "acceptance") {
    throw new Error("M74_CORRECTIVE_DEVELOPMENT_ALREADY_COMPLETE");
  }
  const runId = opaqueRunId(mode);
  const preparationClaim = await claimRecoveryPreparation(runId);
  try {
    await prepareClaimedRecovery(mode, runId, preparationClaim);
  } catch (error) {
    await recordRecoveryPreparationTerminalStop(runId, error);
    throw error;
  }
}

async function prepareClaimedRecovery(
  mode: "acceptance",
  runId: string,
  preparationClaim: Awaited<
    ReturnType<typeof claimRecoveryPreparation>
  >,
): Promise<void> {
  if (existsSync(recoveryOpeningPath)) {
    throw new Error("M74_SEALED_RECOVERY_PARTITION_ALREADY_OPENED");
  }
  if (existsSync(selectionPath(mode))) {
    throw new Error(`M74_${mode.toUpperCase()}_ONE_SHOT_ALREADY_SELECTED`);
  }
  runOfflineGate();
  await loadLocalEnvironment();
  configuredRuntime();
  const privateReplayPreflight =
    await ensurePrivateSemanticReplayRoot({
      rootDirectory: privateReplayRoot,
      repositoryRoot
    });
  const [
    identities,
    commitment,
    priorTerminalDevelopment,
    priorReplacementDevelopment,
    priorBurnedCorrectivePreparation,
    successfulCorrectiveDevelopment,
    priorBurnedAcceptancePreparation,
    priorConsumedSealedAcceptance,
    consumedCommitment
  ] =
    await Promise.all([
      currentIdentities(),
      readSealedPartitionCommitment(recoveryCommitmentPath),
      terminalDevelopmentLineage(),
      replacementDevelopmentLineage(),
      burnedCorrectivePreparationLineage(),
      correctiveDevelopmentLineage(),
      burnedAcceptancePreparationLineage(),
      consumedSealedAcceptanceLineage(),
      readSealedPartitionCommitment(consumedCommitmentPath)
    ]);
  assertRecoveryCommitmentBoundary(commitment);
  await assertRecoveryAuthorizationBaseline();
  const recoveryIdentityDelta =
    await assertRecoveryIdentityDelta(identities);
  const executionFreeze =
    await assertRecoveryExecutionIdentityFreeze(identities);
  const builderAttestation =
    await assertRecoveryBuilderAttestation({
      executionFreeze,
      identities,
      commitment
    });
  const priorCapsuleReplay =
    await priorCapsuleReplayAudit(identities);
  const registeredCallACases = await sealedRegistration();
  const store = new UpstashGenerationStore(readUpstashConfig());
  const gate = await developmentGate(store);
  const commitmentRecord = {
    partitionId: commitment.partitionId,
    commitmentSha256: commitment.commitmentSha256,
    caseIds: commitment.caseIds,
    totalPayloadBytes: commitment.totalPayloadBytes
  };
  const consumedCommitmentRecord = {
    partitionId: consumedCommitment.partitionId,
    commitmentSha256: consumedCommitment.commitmentSha256,
    caseIds: consumedCommitment.caseIds,
    totalPayloadBytes: consumedCommitment.totalPayloadBytes
  };
  if (
    gate.commitmentHash !==
      await hashCanonical(consumedCommitmentRecord) ||
    gate.identityHash !==
      successfulCorrectiveDevelopment.identityHash ||
    commitmentRecord.partitionId === consumedCommitmentRecord.partitionId ||
    JSON.stringify(commitmentRecord.caseIds) !==
      JSON.stringify(SEMANTIC_EVALUATION_CASE_PROFILES.acceptance) ||
    commitmentRecord.caseIds.some((caseId) =>
      consumedCommitmentRecord.caseIds.includes(caseId)
    )
  ) {
    throw new Error("M74_ACCEPTANCE_DEVELOPMENT_IDENTITY_MISMATCH");
  }
  const snapshot = await durableSnapshot(store);
  assertRecoveryFrozenDurablePrefix(snapshot);
  const policy = M74_LIVE_EXPOSURE_POLICY[mode];
  const availableHeadroomMicrousd =
    snapshot.state.authorizedCeilingMicrousd -
    snapshot.state.reservedExposureMicrousd;
  const downstreamReservedExposureMicrousd = 0;
  const requiredHeadroomAtPreparationMicrousd =
    assertM74HeadroomAvailable({
      mode,
      maximumRemainingCalls: policy.maximumCalls,
      availableHeadroomMicrousd
    });
  if (
    M74_CUMULATIVE_LIVE_AUTHORITY.terminalObservedCalls +
      M74_CUMULATIVE_LIVE_AUTHORITY.replacementObservedCalls +
      M74_CUMULATIVE_LIVE_AUTHORITY.correctiveMaximumCalls +
      M74_CUMULATIVE_LIVE_AUTHORITY.acceptanceMaximumCalls !==
        M74_CUMULATIVE_LIVE_AUTHORITY.maximumCalls ||
    M74_CUMULATIVE_LIVE_AUTHORITY
      .terminalObservedReservedExposureMicrousd +
      M74_CUMULATIVE_LIVE_AUTHORITY
        .replacementObservedReservedExposureMicrousd +
      M74_CUMULATIVE_LIVE_AUTHORITY
        .correctiveMaximumReservedExposureMicrousd +
      M74_CUMULATIVE_LIVE_AUTHORITY
        .acceptanceMaximumReservedExposureMicrousd !==
        M74_CUMULATIVE_LIVE_AUTHORITY
          .maximumReservedExposureMicrousd
  ) {
    throw new Error("M74_CUMULATIVE_AUTHORITY_INVALID");
  }
  const manifest = ManifestSchema.parse({
    schemaVersion:
      "sketchycut-m7-4-governed-semantic-evaluation-run@7.0.0",
    status: "prepared",
    campaign: SEMANTIC_EVALUATION_CAMPAIGN_SLUG,
    mode,
    runId,
    createdAt: new Date().toISOString(),
    preparationClaimHash: preparationClaim.claimHash,
    executionIdentityFreezeSha256:
      executionFreeze.recordSha256,
    builderAttestationSha256:
      builderAttestation.binding.recordSha256,
    builderAttestation: builderAttestation.binding,
    identities,
    priorCapsuleReplayAudit: priorCapsuleReplay,
    priorTerminalDevelopment,
    priorReplacementDevelopment,
    priorBurnedCorrectivePreparation,
    successfulCorrectiveDevelopment,
    priorBurnedAcceptancePreparation,
    priorConsumedSealedAcceptance,
    recoveryIdentityDelta,
    cumulativeAuthority: M74_CUMULATIVE_LIVE_AUTHORITY,
    commitment: commitmentRecord,
    registeredCallACases,
    maximumExposure: {
      ...policy,
      maximumCallAPerCase: 1,
      reservedUpperBoundMicrousdPerCall: requestExposureMicrousd,
      priceSnapshotId: GENERATION_OPENAI_PRICE.id,
      sdkMaxRetries: GENERATION_OPENAI_MAX_RETRIES,
      candidateFanOut: false,
      paidRetry: false,
      fallbackModel: false,
      unplannedAdditionalCallAuthorized: false
    },
    exposureSnapshot: snapshot.record,
    availableHeadroomMicrousd,
    downstreamReservedExposureMicrousd,
    requiredHeadroomAtPreparationMicrousd,
    offlineGate: {
      command: "npm run verify",
      status: "passed"
    },
    privateReplayPreflight,
    developmentGate: gate,
    sealedOpeningRequired: true,
    privacy: {
      rawBriefsIncluded: false,
      referenceBytesIncluded: false,
      modelContentIncluded: false,
      registeredInputsAreDigestsOnly: true,
      strictCandidatesStoredOnlyInProtectedReplayRoot: true,
      publishableReplayEvidenceDigestOnly: true
    },
    durableCeilingIncreaseAuthorized: false
  });
  const manifestHash = await sha256(artifactBytes(manifest));
  const selection = SelectionSchema.parse({
    schemaVersion:
      "sketchycut-m7-4-governed-semantic-evaluation-selection@7.0.0",
    campaign: SEMANTIC_EVALUATION_CAMPAIGN_SLUG,
    mode,
    runId,
    manifestHash,
    identityHash: await hashCanonical(identities),
    executionIdentityFreezeSha256:
      manifest.executionIdentityFreezeSha256,
    builderAttestationSha256:
      manifest.builderAttestationSha256,
    selectedAt: new Date().toISOString(),
    oneShot: true
  });
  await writeSemanticEvaluationArtifact(manifestPath(runId), manifest);
  await writeSemanticEvaluationArtifact(selectionPath(mode), selection);
  process.stdout.write(`${JSON.stringify({
    mode,
    runId,
    campaign: SEMANTIC_EVALUATION_CAMPAIGN_SLUG,
    registeredCallACaseIds:
      manifest.registeredCallACases.map((item) => item.caseId),
    maximumCalls: policy.maximumCalls,
    maximumReservedExposureUsd:
      policy.maximumReservedExposureMicrousd / 1_000_000,
    requiredHeadroomUsd:
      requiredHeadroomAtPreparationMicrousd / 1_000_000,
    availableHeadroomUsd: availableHeadroomMicrousd / 1_000_000,
    executionReady: true
  }, null, 2)}\n`);
}

async function assertFrozenPreAccess(
  manifest: Manifest,
): Promise<{
  commitment: Awaited<
    ReturnType<typeof readSealedPartitionCommitment>
  >;
  attestation: z.infer<typeof RecoveryBuilderAttestationSchema>;
}> {
  const identities = await currentIdentities();
  const [
    terminalLineage,
    replacementLineage,
    burnedCorrectiveLineage,
    correctiveLineage,
    burnedAcceptanceLineage,
    consumedAcceptanceLineage,
    recoveryIdentityDelta,
    commitment,
    replayPreflight,
    preparationClaimBytes
  ] =
    await Promise.all([
      terminalDevelopmentLineage(),
      replacementDevelopmentLineage(),
      burnedCorrectivePreparationLineage(),
      correctiveDevelopmentLineage(),
      burnedAcceptancePreparationLineage(),
      consumedSealedAcceptanceLineage(),
      assertRecoveryIdentityDelta(identities),
      readSealedPartitionCommitment(recoveryCommitmentPath),
      ensurePrivateSemanticReplayRoot({
        rootDirectory: privateReplayRoot,
        repositoryRoot
      }),
      readFile(recoveryPreparationClaimPath)
    ]);
  assertRecoveryCommitmentBoundary(commitment);
  await assertRecoveryAuthorizationBaseline();
  const executionFreeze =
    await assertRecoveryExecutionIdentityFreeze(identities);
  const builderAttestation =
    await assertRecoveryBuilderAttestation({
      executionFreeze,
      identities,
      commitment
    });
  if (
    await hashCanonical(identities) !==
      await hashCanonical(manifest.identities)
  ) {
    throw new Error("M74_EVALUATION_BATCH_IDENTITY_DRIFT");
  }
  const replayAudit = await priorCapsuleReplayAudit(identities);
  if (
    await hashCanonical(replayAudit) !==
      await hashCanonical(manifest.priorCapsuleReplayAudit)
  ) {
    throw new Error("M74_PRIOR_CAPSULE_REPLAY_AUDIT_DRIFT");
  }
  if (
    await hashCanonical(replayPreflight) !==
      await hashCanonical(manifest.privateReplayPreflight)
  ) {
    throw new Error("M74_PRIVATE_REPLAY_PREFLIGHT_DRIFT");
  }
  if (
    await hashCanonical(terminalLineage) !==
      await hashCanonical(manifest.priorTerminalDevelopment)
  ) {
    throw new Error("M74_TERMINAL_DEVELOPMENT_LINEAGE_DRIFT");
  }
  if (
    await hashCanonical(replacementLineage) !==
      await hashCanonical(manifest.priorReplacementDevelopment)
  ) {
    throw new Error("M74_REPLACEMENT_DEVELOPMENT_LINEAGE_DRIFT");
  }
  if (
    await hashCanonical(burnedCorrectiveLineage) !==
      await hashCanonical(
        manifest.priorBurnedCorrectivePreparation,
      )
  ) {
    throw new Error(
      "M74_BURNED_CORRECTIVE_PREPARATION_LINEAGE_DRIFT",
    );
  }
  if (
    await hashCanonical(correctiveLineage) !==
      await hashCanonical(manifest.successfulCorrectiveDevelopment)
  ) {
    throw new Error("M74_CORRECTIVE_DEVELOPMENT_LINEAGE_DRIFT");
  }
  if (
    await hashCanonical(burnedAcceptanceLineage) !==
      await hashCanonical(
        manifest.priorBurnedAcceptancePreparation,
      )
  ) {
    throw new Error(
      "M74_BURNED_ACCEPTANCE_PREPARATION_LINEAGE_DRIFT",
    );
  }
  if (
    await hashCanonical(consumedAcceptanceLineage) !==
      await hashCanonical(manifest.priorConsumedSealedAcceptance)
  ) {
    throw new Error(
      "M74_CONSUMED_SEALED_ACCEPTANCE_LINEAGE_DRIFT",
    );
  }
  if (
    await hashCanonical(recoveryIdentityDelta) !==
      await hashCanonical(manifest.recoveryIdentityDelta)
  ) {
    throw new Error(
      "M74_SEALED_RECOVERY_IDENTITY_DELTA_DRIFT",
    );
  }
  if (
    executionFreeze.recordSha256 !==
      manifest.executionIdentityFreezeSha256 ||
    builderAttestation.binding.recordSha256 !==
      manifest.builderAttestationSha256 ||
    await hashCanonical(builderAttestation.binding) !==
      await hashCanonical(manifest.builderAttestation)
  ) {
    throw new Error("M74_RECOVERY_BUILDER_ATTESTATION_DRIFT");
  }
  if (
    await hashCanonical(manifest.commitment) !==
      await hashCanonical({
        partitionId: commitment.partitionId,
        commitmentSha256: commitment.commitmentSha256,
        caseIds: commitment.caseIds,
        totalPayloadBytes: commitment.totalPayloadBytes
      })
  ) {
    throw new Error("M74_SEALED_COMMITMENT_IDENTITY_DRIFT");
  }
  if (
    manifest.developmentGate?.identityHash !==
      manifest.successfulCorrectiveDevelopment.identityHash
  ) {
    throw new Error("M74_ACCEPTANCE_DEVELOPMENT_IDENTITY_MISMATCH");
  }
  const registration = await sealedRegistration();
  if (
    await hashCanonical(registration) !==
      await hashCanonical(manifest.registeredCallACases)
  ) {
    throw new Error("M74_EVALUATION_CASE_REGISTRATION_DRIFT");
  }
  const config = configuredRuntime();
  if (
    await currentProductionPromptHash(config) !==
      manifest.identities.callAPromptHash
  ) {
    throw new Error("M74_RUNTIME_PROMPT_DRIFT");
  }
  if (
    await sha256(preparationClaimBytes) !==
      manifest.preparationClaimHash
  ) {
    throw new Error("M74_RECOVERY_PREPARATION_CLAIM_DRIFT");
  }
  const preparationClaim = RecoveryPreparationClaimSchema.parse(
    JSON.parse(preparationClaimBytes.toString("utf8")) as unknown,
  );
  if (preparationClaim.runId !== manifest.runId) {
    throw new Error("M74_RECOVERY_PREPARATION_CLAIM_RUN_MISMATCH");
  }
  return {
    commitment,
    attestation: builderAttestation.attestation
  };
}

async function assertDurableRunLineage(
  manifest: Manifest,
  snapshot: Awaited<ReturnType<typeof durableSnapshot>>,
): Promise<{
  attempts: LiveCallAttempt[];
  callAAttempts: LiveCallAttempt[];
  callBAttempts: LiveCallAttempt[];
  unattributedAttempts: LiveCallAttempt[];
}> {
  const frozen = manifest.exposureSnapshot;
  if (
    snapshot.attempts.length < frozen.attemptCount ||
    await hashCanonical(
      snapshot.attempts.slice(0, frozen.attemptCount),
    ) !== frozen.attemptsHash
  ) {
    throw new Error("M74_DURABLE_LEDGER_PREFIX_DRIFT");
  }
  if (
    snapshot.billingReconciliations.length !==
      frozen.billingReconciliationCount ||
    snapshot.record.billingReconciliationsHash !==
      frozen.billingReconciliationsHash ||
    snapshot.authorizations.length !== frozen.authorizationCount ||
    snapshot.record.authorizationsHash !==
      frozen.authorizationsHash ||
    snapshot.state.authorizationVersion !==
      frozen.authorizationVersion
  ) {
    throw new Error("M74_DURABLE_GOVERNANCE_LINEAGE_DRIFT");
  }
  const attempts = snapshot.attempts.slice(frozen.attemptCount);
  const callAAttempts = attempts.filter((attempt) =>
    attempt.promptHash === manifest.identities.callAPromptHash
  );
  const callBAttempts = attempts.filter((attempt) =>
    attempt.promptHash === manifest.identities.callBPromptHash
  );
  const unattributedAttempts = attempts.filter((attempt) =>
    attempt.promptHash !== manifest.identities.callAPromptHash &&
    attempt.promptHash !== manifest.identities.callBPromptHash
  );
  if (
    manifest.identities.callAPromptHash ===
      manifest.identities.callBPromptHash ||
    attempts.some((attempt) =>
      attempt.initiatedBy !== "live-eval" ||
      attempt.runtimeOrigin !== "local-development" ||
      ![
        manifest.identities.callAPromptHash,
        manifest.identities.callBPromptHash
      ].includes(attempt.promptHash)
    ) ||
    attempts.length >
      manifest.maximumExposure.maximumCalls ||
    callAAttempts.length >
      manifest.maximumExposure.maximumCallA ||
    callBAttempts.length >
      manifest.maximumExposure.maximumCallB ||
    attempts.reduce(
      (total, attempt) => total + attempt.networkDispatchCount,
      0,
    ) > manifest.maximumExposure.maximumCalls
  ) {
    throw new Error("M74_DURABLE_RUN_ATTEMPT_AUTHORITY_EXCEEDED");
  }
  const reservedDelta =
    snapshot.state.reservedExposureMicrousd -
    frozen.reservedExposureMicrousd;
  const attemptAttributedReservedExposureMicrousd =
    attempts.reduce((total, attempt) =>
      total + Math.round(
        (attempt.billing.requestBudgetUpperBoundUsd ?? 0) *
          1_000_000,
      ), 0);
  if (
    reservedDelta < 0 ||
    reservedDelta >
      manifest.maximumExposure.maximumReservedExposureMicrousd ||
    reservedDelta % requestExposureMicrousd !== 0 ||
    reservedDelta !== attemptAttributedReservedExposureMicrousd
  ) {
    throw new Error("M74_DURABLE_RUN_EXPOSURE_DRIFT");
  }
  return {
    attempts,
    callAAttempts,
    callBAttempts,
    unattributedAttempts
  };
}

async function preAccessChecks(input: {
  manifest: Manifest;
  store: GenerationStore;
  maximumRemainingCalls: number;
  inputRoot: string;
}): Promise<{
  state: GlobalExposureState;
  commitment: Awaited<
    ReturnType<typeof readSealedPartitionCommitment>
  >;
  boundInputRoot: string;
}> {
  assertM74PaidDispatchAuthority(input.maximumRemainingCalls);
  const frozen = await assertFrozenPreAccess(input.manifest);
  const state = await postOpeningDispatchChecks(input);
  const boundInputRoot = await preflightAndBindRecoveryInputRoot({
    inputRoot: input.inputRoot,
    attestation: frozen.attestation
  });
  return {
    state,
    commitment: frozen.commitment,
    boundInputRoot
  };
}

async function postOpeningDispatchChecks(input: {
  manifest: Manifest;
  store: GenerationStore;
  maximumRemainingCalls: number;
}): Promise<GlobalExposureState> {
  assertM74PaidDispatchAuthority(input.maximumRemainingCalls);
  const snapshot = await durableSnapshot(input.store);
  const lineage = await assertDurableRunLineage(
    input.manifest,
    snapshot,
  );
  if (
    input.maximumRemainingCalls !==
      input.manifest.maximumExposure.maximumCalls -
        lineage.attempts.length
  ) {
    throw new Error("M74_REMAINING_BATCH_ATTEMPT_COUNT_DRIFT");
  }
  const available =
    snapshot.state.authorizedCeilingMicrousd -
    snapshot.state.reservedExposureMicrousd;
  const required = assertM74HeadroomAvailable({
    mode: input.manifest.mode,
    maximumRemainingCalls: input.maximumRemainingCalls,
    availableHeadroomMicrousd: available
  });
  if (required < requestExposureMicrousd) {
    throw new Error("M74_REMAINING_BATCH_HEADROOM_INVALID");
  }
  return snapshot.state;
}

function newSession(runId: string, caseId: string): SessionRecord {
  const now = Date.now();
  return {
    schemaVersion: "1.0",
    sessionId:
      `${runId}-${caseId}-${randomUUID().replaceAll("-", "")}`,
    issuedAtMs: now,
    expiresAtMs: now + 60 * 60 * 1_000,
    generationDispatches: 0,
    reservedExposureMicrousd: 0,
    lastDispatchAtMs: null,
    lastProjectId: null
  };
}

function safeHardAnomaly(error: unknown): SemanticEvaluationHardAnomaly {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("CALL_CEILING") ||
    message.includes("ATTEMPT_CEILING")
  ) {
    return {
      category: "exposure",
      code: "M74_EVALUATION_CALL_CEILING_FAILURE"
    };
  }
  if (message.includes("EXPOSURE") || message.includes("HEADROOM")) {
    return { category: "exposure", code: "M74_EVALUATION_EXPOSURE_FAILURE" };
  }
  if (message.includes("LEDGER") || message.includes("DURABLE")) {
    return { category: "ledger", code: "M74_EVALUATION_LEDGER_FAILURE" };
  }
  if (message.includes("IDENTITY") || message.includes("DRIFT")) {
    return { category: "identity", code: "M74_EVALUATION_IDENTITY_FAILURE" };
  }
  if (message.includes("PRIVACY")) {
    return { category: "privacy", code: "M74_EVALUATION_PRIVACY_FAILURE" };
  }
  if (message.includes("SCHEMA") || message.includes("PARSE")) {
    return { category: "schema", code: "M74_EVALUATION_SCHEMA_FAILURE" };
  }
  return {
    category: "deterministic",
    code: "M74_EVALUATION_EXECUTION_FAILURE"
  };
}

async function executeCallA(input: {
  manifest: Manifest;
  store: GenerationStore;
  preparedCase: PreparedCase;
  maximumRemainingCalls: number;
  testCase?: SemanticCase;
}): Promise<CallAExecution> {
  const beforeExposure = await postOpeningDispatchChecks({
    manifest: input.manifest,
    store: input.store,
    maximumRemainingCalls: input.maximumRemainingCalls
  });
  const registration = input.manifest.registeredCallACases.find(
    (item) => item.caseId === input.preparedCase.caseId,
  );
  const observedInputDigest =
    input.preparedCase.committedPayloadDigest ??
    input.preparedCase.inputDigest;
  if (
    registration?.inputDigest !== observedInputDigest ||
    (
      registration.providerSchemaHash !== null &&
      registration.providerSchemaHash !==
        input.preparedCase.providerSchemaHash
    ) ||
    (
      registration.preparedRequestDigest !== null &&
      registration.preparedRequestDigest !==
        input.preparedCase.prepared.requestDigest
    )
  ) {
    throw new Error("M74_CALL_A_REGISTRATION_DRIFT");
  }
  const session = newSession(
    input.manifest.runId,
    input.preparedCase.caseId,
  );
  await input.store.createSession(session, 60 * 60);
  const attributedAttempts: LiveCallAttempt[] = [];
  const ownedStore = createRunOwnedGenerationStore(
    input.store,
    attributedAttempts,
  );
  let atomKindsByItemId: SemanticCandidateAtomKindsByItemId = new Map();
  let unsupportedSignaturesByItemId:
    SemanticCandidateUnsupportedSignaturesByItemId = new Map();
  let candidate: SemanticInterpretationCandidate | null = null;
  const replayState: {
    candidateObserved: boolean;
    capsule: PrivateSemanticReplayEvidence | null;
    retentionFailed: boolean;
  } = {
    candidateObserved: false,
    capsule: null,
    retentionFailed: false
  };
  const config = configuredRuntime();
  const response = await executeCurrentGeneration({
    config,
    authenticated: {
      session,
      clientIdentifier:
        `${input.manifest.runId}-${input.preparedCase.caseId}`
    },
    submission: input.preparedCase.submission,
    store: ownedStore,
    runtimeOrigin: "local-development",
    interpretationTransport: new OpenAITransport({
      apiKey: config.liveTransport!.apiKey,
      prompt: config.liveTransport!.interpretationPrompt,
      references: input.preparedCase.transportReferences
    }),
    semanticCache: new DispatchOnlySemanticCache(),
    initiatedBy: "live-eval",
    promptHash: input.manifest.identities.callAPromptHash,
    evaluationModelConfiguration: MODEL_CONFIGURATION,
    onSemanticCandidate: async (observed, observation) => {
      candidate = observed;
      replayState.candidateObserved = true;
      atomKindsByItemId = semanticCandidateAtomKindsByItemId(observed);
      unsupportedSignaturesByItemId =
        semanticCandidateUnsupportedSignaturesByItemId(observed);
      if (
        observation.attemptId === null ||
        observation.cacheResult !== "miss"
      ) {
        replayState.retentionFailed = true;
        throw new Error("M74_PRIVATE_REPLAY_OBSERVATION_INVALID");
      }
      try {
        const capsule = await buildPrivateSemanticReplayCapsule({
          createdAt: new Date().toISOString(),
          caseId: input.preparedCase.caseId,
          attemptId: observation.attemptId,
          semanticRequestDigest:
            input.preparedCase.prepared.requestDigest,
          providerSchemaHash: input.preparedCase.providerSchemaHash,
          request: input.preparedCase.prepared.request,
          candidate: observed,
          deterministicControls:
            input.preparedCase.submission.deterministicControls,
          fabricationControls:
            input.preparedCase.submission.fabricationControls
        });
        replayState.capsule = await writePrivateSemanticReplayCapsule({
          rootDirectory: privateReplayRoot,
          capsule
        });
      } catch {
        replayState.retentionFailed = true;
        throw new Error("M74_PRIVATE_REPLAY_PRIVACY_FAILURE");
      }
    }
  });
  if (
    replayState.retentionFailed ||
    (replayState.candidateObserved && replayState.capsule === null)
  ) {
    throw new Error("M74_PRIVATE_REPLAY_PRIVACY_FAILURE");
  }
  const [ownedSession, afterExposure] = await Promise.all([
    input.store.readSession(session.sessionId),
    input.store.readGlobalExposureState()
  ]);
  let score = null;
  if (input.testCase !== undefined) {
    score = scoreSemanticCaseOracle({
      testCase: input.testCase,
      request: input.preparedCase.prepared.request,
      outcome: response.outcome,
      candidateUnsupportedSignatureIds: [
        ...unsupportedSignaturesByItemId.values()
      ].flat()
    });
  }
  const raw: SemanticEvaluationRawCaseResult = {
    caseId: input.preparedCase.caseId,
    attempts: attributedAttempts,
    score,
    outcome: summarizeGenerationOutcome(response.outcome),
    semanticDiagnostics: summarizeSemanticEvaluationDiagnostics(
      response.outcome,
      atomKindsByItemId,
      unsupportedSignaturesByItemId,
    ),
    compiledDigest: response.compiled === null
      ? null
      : await hashCanonical(response.compiled),
    sessionDispatches: ownedSession?.generationDispatches ?? 0,
    sessionReservedExposureMicrousd:
      ownedSession?.reservedExposureMicrousd ?? 0,
    globalReservedExposureBeforeMicrousd:
      beforeExposure.reservedExposureMicrousd,
    globalReservedExposureAfterMicrousd:
      afterExposure.reservedExposureMicrousd,
    additionalHardAnomalies: []
  };
  if (replayState.capsule !== null) {
    await writeSemanticEvaluationArtifact(
      path.join(
        runDirectory(input.manifest.runId),
        "replay-evidence",
        `${input.preparedCase.caseId}.json`,
      ),
      replayState.capsule,
    );
  }
  return {
    caseId: input.preparedCase.caseId,
    submission: input.preparedCase.submission,
    prepared: input.preparedCase.prepared,
    transportReferences: input.preparedCase.transportReferences,
    session,
    candidate,
    outcome: response.outcome,
    response,
    attempt: attributedAttempts[0] ?? null,
    replayCapsule: replayState.capsule,
    raw
  };
}

function accountingFromAttempts(
  attempts: readonly LiveCallAttempt[],
  before: number,
  after: number,
) {
  const reported = attempts.filter((attempt) =>
    attempt.usage.status === "reported"
  );
  return {
    networkDispatches: attempts.reduce(
      (total, attempt) => total + attempt.networkDispatchCount,
      0,
    ),
    reservedExposureBeforeMicrousd: before,
    reservedExposureAfterMicrousd: after,
    runOwnedReservedExposureMicrousd: after - before,
    confirmedEstimatedCostMicrousd: Math.round(
      attempts.reduce((total, attempt) =>
        total + (
          attempt.billing.state === "confirmed-billed" &&
          attempt.billing.estimatedCostUsd !== null
            ? attempt.billing.estimatedCostUsd
            : 0
        ), 0) * 1_000_000,
    ),
    inputTokens: reported.reduce(
      (total, attempt) =>
        total + (
          attempt.usage.status === "reported"
            ? attempt.usage.inputTokens
            : 0
        ),
      0,
    ),
    outputTokens: reported.reduce(
      (total, attempt) =>
        total + (
          attempt.usage.status === "reported"
            ? attempt.usage.outputTokens
            : 0
        ),
      0,
    ),
    reasoningTokens: reported.reduce(
      (total, attempt) =>
        total + (
          attempt.usage.status === "reported"
            ? attempt.usage.reasoningTokens
            : 0
        ),
      0,
    )
  };
}

function hardAnomaliesForCallA(
  mode: SemanticEvaluationMode,
  execution: CallAExecution,
): SemanticEvaluationHardAnomaly[] {
  return classifySemanticEvaluationCase({
    mode,
    expectedCaseId: execution.caseId,
    raw: execution.raw
  }).hardAnomalies;
}

function hardAnomalyForCallB(
  attempt: LiveCallAttempt | null,
): SemanticEvaluationHardAnomaly | null {
  if (attempt === null) return null;
  if (
    attempt.networkDispatchCount !== 1 ||
    attempt.dispatchState !== "response-observed"
  ) {
    return {
      category: attempt.billing.state === "potentially-billed"
        ? "billing"
        : "transport",
      code: attempt.billing.state === "potentially-billed"
        ? "M74_CALL_B_AMBIGUOUS_BILLING"
        : "M74_CALL_B_DISPATCH_NOT_CONFIRMED"
    };
  }
  if (
    attempt.outcome === "schema-failure" ||
    attempt.strictParse === "failed"
  ) {
    return { category: "schema", code: "M74_CALL_B_SCHEMA_FAILURE" };
  }
  if (
    attempt.outcome !== "completed" ||
    attempt.usage.status !== "reported" ||
    attempt.billing.state !== "confirmed-billed"
  ) {
    return { category: "transport", code: "M74_CALL_B_NOT_COMPLETED" };
  }
  return null;
}

async function evaluatePairedCase(input: {
  manifest: Manifest;
  store: GenerationStore;
  testCase: SealedSemanticCasePayload;
  callA: CallAExecution;
  maximumRemainingCalls: number;
  accounting: ExecutionAccounting;
  callBPrompt: string;
}): Promise<{
  result: PairedSemanticReviewCaseResult;
  hardAnomaly: SemanticEvaluationHardAnomaly | null;
}> {
  if (input.callA.candidate === null || input.callA.attempt === null) {
    throw new Error("M74_PAIRED_CALL_A_CANDIDATE_OR_ATTEMPT_MISSING");
  }
  const triggerDecision = classifySemanticReviewTriggers({
    candidate: input.callA.candidate,
    authorizationFindings:
      input.callA.attempt.semanticAuthorizationFindings ?? []
  });
  let reviewDispatched = false;
  let reviewApplication: Awaited<
    ReturnType<typeof applySemanticReviewPatch>
  > | null = null;
  let reviewedCandidate: SemanticInterpretationCandidate | null = null;
  let reviewedOutcome: GenerationOutcome | null = null;
  let callBAttempt: LiveCallAttempt | null = null;
  if (triggerDecision.eligible) {
    assertM74CallBDispatchAuthority({
      maximumRemainingCalls: input.maximumRemainingCalls,
      callBAttemptCount: input.accounting.callBAttempts.length,
      maximumCallB: input.manifest.maximumExposure.maximumCallB
    });
    await postOpeningDispatchChecks({
      manifest: input.manifest,
      store: input.store,
      maximumRemainingCalls: input.maximumRemainingCalls
    });
    const config = configuredRuntime();
    const dispatch = await dispatchEvaluationSemanticReview({
      store: input.store,
      session: input.callA.session,
      clientIdentifier:
        `${input.manifest.runId}-${input.testCase.caseId}`,
      request: input.callA.prepared.request,
      callARequestDigest: input.callA.prepared.requestDigest,
      candidate: input.callA.candidate,
      triggerDecision,
      deterministicDiagnostics: input.callA.raw.semanticDiagnostics,
      transport: new OpenAISemanticReviewTransport({
        apiKey: config.liveTransport!.apiKey,
        prompt: input.callBPrompt,
        references: input.callA.transportReferences
      }),
      reviewPromptHash: input.manifest.identities.callBPromptHash,
      runtimeOrigin: "local-development"
    });
    callBAttempt = dispatch.attempt;
    if (callBAttempt !== null) {
      input.accounting.callBAttempts.push(callBAttempt);
      input.accounting.chronologicalAttempts.push(callBAttempt);
    }
    reviewDispatched =
      callBAttempt?.networkDispatchCount === 1;
    if (dispatch.status === "completed" && dispatch.patch !== null) {
      reviewApplication = await applySemanticReviewPatch({
        candidate: input.callA.candidate,
        sourceEvidenceIndex:
          input.callA.prepared.request.sourceEvidenceIndex,
        triggerDecision,
        patch: dispatch.patch
      });
      if (reviewApplication.kind === "applied") {
        reviewedCandidate = reviewApplication.candidate;
        const deterministic = await
        evaluatePatchedSemanticCandidateForEvaluation({
          submission: input.callA.submission,
          prepared: input.callA.prepared,
          candidate: reviewedCandidate,
          callAAttempt: input.callA.attempt,
          requestId:
            `reviewed-${input.manifest.runId}-${input.testCase.caseId}`
        });
        reviewedOutcome = deterministic.outcome;
      }
    }
  }
  const result = await buildPairedSemanticReviewCaseResult({
    testCase: input.testCase,
    callACandidate: input.callA.candidate,
    baselineOutcome: input.callA.outcome,
    reviewDispatched,
    reviewPatch: reviewApplication,
    reviewedCandidate,
    reviewedOutcome,
    triggerDecision
  });
  await writeSemanticEvaluationArtifact(
    path.join(
      runDirectory(input.manifest.runId),
      "paired-cases",
      `${input.testCase.caseId}.json`,
    ),
    SafePairedCaseArtifactSchema.parse({
      schemaVersion: "sketchycut-m7-4-paired-case-artifact@1.0.0",
      mode: input.manifest.mode,
      result,
      callAAttempt: input.callA.attempt,
      callBAttempt
    }),
  );
  return {
    result,
    hardAnomaly: hardAnomalyForCallB(callBAttempt)
  };
}

async function verifyAndLoadRecoveryOnce(
  manifest: Manifest,
  inputRoot: string,
  commitment: Awaited<
    ReturnType<typeof readSealedPartitionCommitment>
  >,
  openingClaim: RecoveryOpeningClaim,
  accessState: RecoverySealedAccessState,
) {
  const opening = openingClaim.value;
  if (
    opening.partitionId !== manifest.commitment.partitionId ||
    opening.commitmentSha256 !== manifest.commitment.commitmentSha256 ||
    JSON.stringify(opening.caseIds) !==
      JSON.stringify(manifest.commitment.caseIds)
  ) {
    throw new Error("M74_SEALED_OPENING_COMMITMENT_DRIFT");
  }
  let verifierInvocations = 0;
  verifierInvocations += 1;
  accessState.verifierInvoked = true;
  const verified = await verifySealedPartitionCommitment({
    inputRoot,
    commitment
  });
  const externalManifestByteReads = verifierInvocations;
  const observedPayloads = await Promise.all(
    verified.payloads.map(async (item) => ({
      caseId: item.caseId,
      byteReads: verifierInvocations,
      byteCount: item.payloadBytes.byteLength,
      sha256: await sha256(item.payloadBytes),
      caseContractVersion: item.payload.schemaVersion
    })),
  );
  const externalCasePayloadByteReads = observedPayloads.reduce(
    (total, item) => total + item.byteReads,
    0,
  );
  const totalExternalByteReads =
    externalManifestByteReads + externalCasePayloadByteReads;
  const observedTotalPayloadBytes = observedPayloads.reduce(
    (total, item) => total + item.byteCount,
    0,
  );
  if (
    verified.manifest.partitionId !== manifest.commitment.partitionId ||
    JSON.stringify(verified.payloads.map((item) => item.caseId)) !==
      JSON.stringify(manifest.commitment.caseIds)
  ) {
    throw new Error("M74_SEALED_RECOVERY_PARTITION_IDENTITY_DRIFT");
  }
  const evaluationClasses = verified.payloads.map((item) =>
    item.payload.evaluationClass
  ).toSorted();
  if (
    JSON.stringify(evaluationClasses) !== JSON.stringify([
      "already-correct-control",
      "review-eligible-error"
    ])
  ) {
    throw new Error(
      "M74_RECOVERY_EVALUATION_CLASS_PARTITION_INVALID",
    );
  }
  const observedManifestSha256 = await sha256(
    verified.manifestBytes,
  );
  const observedCommitmentPayloads = observedPayloads.map((item) => ({
    caseId: item.caseId,
    payloadBytes: item.byteCount,
    payloadSha256: item.sha256
  }));
  if (
    verifierInvocations !== 1 ||
    verified.manifestBytes.byteLength !== commitment.manifestBytes ||
    observedManifestSha256 !== commitment.manifestSha256 ||
    JSON.stringify(observedCommitmentPayloads) !==
      JSON.stringify(commitment.payloads) ||
    observedTotalPayloadBytes !== commitment.totalPayloadBytes ||
    manifest.identities.sealedCommitmentRecordHash !==
      manifest.builderAttestation.commitmentRecordSha256
  ) {
    throw new Error("M74_RECOVERY_READ_RECEIPT_OBSERVATION_DRIFT");
  }
  const receipt = SealedReadReceiptSchema.parse({
    schemaVersion:
      "sketchycut-m74-sealed-recovery-read-receipt@1.0.0",
    partitionId: commitment.partitionId,
    commitmentSha256: commitment.commitmentSha256,
    commitmentRecordSha256:
      manifest.identities.sealedCommitmentRecordHash,
    caseIds: commitment.caseIds,
    verifierInvocations,
    externalManifestByteReads,
    externalCasePayloadByteReads,
    totalExternalByteReads,
    totalPayloadBytes: observedTotalPayloadBytes,
    derivation: "single-frozen-helper-invocation",
    openingClaim: {
      value: opening,
      byteCount: openingClaim.bytes.byteLength,
      sha256: openingClaim.recordSha256
    },
    externalManifest: {
      byteReads: externalManifestByteReads,
      byteCount: verified.manifestBytes.byteLength,
      sha256: observedManifestSha256,
      schemaVersion: verified.manifest.schemaVersion
    },
    externalCasePayloads: observedPayloads,
    contractIdentities: {
      partitionManifestVersion: SEALED_PARTITION_MANIFEST_VERSION,
      semanticCaseVersion: SEALED_SEMANTIC_CASE_VERSION,
      commitmentVersion: SEALED_PARTITION_COMMITMENT_VERSION,
      openingVersion: SEALED_PARTITION_OPENING_VERSION,
      callAProviderContractSourceHash:
        manifest.identities.callAProviderContractSourceHash,
      callBProviderContractSourceHash:
        manifest.identities.callBProviderContractSourceHash,
      modelConfigurationHash:
        manifest.identities.modelConfigurationHash,
      recoveryIdentityHash:
        manifest.recoveryIdentityDelta.recoveryIdentityHash
    },
    sealedPartitionSourceSha256:
      M74_SEALED_RECOVERY_IDENTITY_DELTA.sealedPartitionSourceSha256,
    snapshotHeldInMemory: true,
    postSnapshotExternalReads: 0
  });
  const receiptBytes = artifactBytes(receipt);
  accessState.receipt = receipt;
  accessState.receiptRecordSha256 = await sha256(receiptBytes);
  await writeSemanticEvaluationArtifact(
    path.join(
      runDirectory(manifest.runId),
      "sealed-read-receipt.json",
    ),
    receipt,
  );
  accessState.receiptWritten = true;
  return {
    payloads: verified.payloads,
    receipt
  };
}

async function bindVerifiedSealedRegistration(input: {
  manifest: Manifest;
  cases: readonly Awaited<
    ReturnType<typeof verifyAndLoadRecoveryOnce>
  >["payloads"][number][];
}): Promise<Map<string, PreparedCase>> {
  const prepared = await Promise.all(input.cases.map(async (sealedCase) => ({
    preparedCase: await preparedPairedCase(
      sealedCase.payload,
      input.manifest.identities.callAPromptHash,
    ),
    payloadSha256: await sha256(sealedCase.payloadBytes)
  })
  ));
  const frozenById = new Map(
    input.manifest.registeredCallACases.map((item) => [item.caseId, item]),
  );
  const boundPrepared = prepared.map((item, index) => {
    const frozen = frozenById.get(item.preparedCase.caseId);
    if (
      frozen?.ordinal !== index + 1 ||
      frozen.inputDigest !== item.payloadSha256
    ) {
      throw new Error("M74_VERIFIED_SEALED_REGISTRATION_DRIFT");
    }
    return {
      preparedCase: {
        ...item.preparedCase,
        committedPayloadDigest: item.payloadSha256
      },
      safeRegistration: {
        caseId: item.preparedCase.caseId,
        ordinal: index + 1,
        payloadCommitmentSha256: item.payloadSha256,
        canonicalRegistrationDigest:
          item.preparedCase.inputDigest,
        providerSchemaHash: item.preparedCase.providerSchemaHash,
        preparedRequestDigest:
          item.preparedCase.prepared.requestDigest
      }
    };
  });
  await writeSemanticEvaluationArtifact(
    path.join(
      runDirectory(input.manifest.runId),
      "sealed-verified-registration.json",
    ),
    {
      schemaVersion:
        "sketchycut-m7-4-verified-sealed-registration@1.0.0",
      partitionId: input.manifest.commitment.partitionId,
      commitmentSha256: input.manifest.commitment.commitmentSha256,
      cases: boundPrepared.map((item) => item.safeRegistration)
    },
  );
  return new Map(boundPrepared.map((item) => [
    item.preparedCase.caseId,
    item.preparedCase
  ]));
}

async function claimVerifiedRecoveryOpening(
  manifest: Manifest,
  commitment: Awaited<
    ReturnType<typeof readSealedPartitionCommitment>
  >,
  accessState: RecoverySealedAccessState,
): Promise<RecoveryOpeningClaim> {
  if (
    commitment.partitionId !== manifest.commitment.partitionId ||
    commitment.commitmentSha256 !==
      manifest.commitment.commitmentSha256 ||
    JSON.stringify(commitment.caseIds) !==
      JSON.stringify(manifest.commitment.caseIds)
  ) {
    throw new Error("M74_SEALED_OPENING_COMMITMENT_DRIFT");
  }
  const opening = SealedPartitionOpeningSchema.parse({
    schemaVersion: SEALED_PARTITION_OPENING_VERSION,
    openingId: `sealed-opening-${randomUUID()}`,
    partitionId: commitment.partitionId,
    commitmentSha256: commitment.commitmentSha256,
    claimedAt: new Date().toISOString(),
    claimedBy: "builder-authorized-evaluation-runner",
    state: "claimed-before-first-dispatch",
    caseIds: commitment.caseIds
  });
  const bytes = artifactBytes(opening);
  const recordSha256 = await sha256(bytes);
  await writeFile(recoveryOpeningPath, bytes, {
    flag: "wx",
    mode: 0o600
  });
  accessState.opening = opening;
  accessState.openingRecordSha256 = recordSha256;
  return { value: opening, bytes, recordSha256 };
}

async function runAcceptance(input: {
  manifest: Manifest;
  store: GenerationStore;
  accounting: ExecutionAccounting;
  accessState: RecoverySealedAccessState;
  inputRoot: string;
  callBPrompt: string;
  commitment: Awaited<
    ReturnType<typeof readSealedPartitionCommitment>
  >;
}): Promise<{
  pairedResults: PairedSemanticReviewCaseResult[];
  hardStop: SemanticEvaluationHardAnomaly | null;
}> {
  let maximumRemainingCalls =
    input.manifest.maximumExposure.maximumCalls;
  const openingClaim = await claimVerifiedRecoveryOpening(
    input.manifest,
    input.commitment,
    input.accessState,
  );
  const verified = await verifyAndLoadRecoveryOnce(
    input.manifest,
    input.inputRoot,
    input.commitment,
    openingClaim,
    input.accessState,
  );
  const preparedById = await bindVerifiedSealedRegistration({
    manifest: input.manifest,
    cases: verified.payloads
  });
  const pairedResults: PairedSemanticReviewCaseResult[] = [];
  for (const sealedCase of verified.payloads) {
    const testCase = sealedCase.payload;
    const prepared = preparedById.get(testCase.caseId);
    if (prepared === undefined) {
      throw new Error("M74_SEALED_PREPARED_CASE_MISSING");
    }
    const callA = await executeCallA({
      manifest: input.manifest,
      store: input.store,
      preparedCase: prepared,
      maximumRemainingCalls
    });
    maximumRemainingCalls -= 1;
    if (callA.attempt !== null) {
      input.accounting.callAAttempts.push(callA.attempt);
      input.accounting.chronologicalAttempts.push(callA.attempt);
    }
    if (callA.replayCapsule !== null) {
      input.accounting.replayCapsules.push(callA.replayCapsule);
    }
    const callAHard = hardAnomaliesForCallA("acceptance", callA);
    if (callAHard.length > 0) {
      return { pairedResults, hardStop: callAHard[0]! };
    }
    const beforeCallBCount = input.accounting.callBAttempts.length;
    const paired = await evaluatePairedCase({
      manifest: input.manifest,
      store: input.store,
      testCase,
      callA,
      maximumRemainingCalls,
      accounting: input.accounting,
      callBPrompt: input.callBPrompt
    });
    maximumRemainingCalls -=
      input.accounting.callBAttempts.length - beforeCallBCount;
    pairedResults.push(paired.result);
    process.stdout.write(`${JSON.stringify({
      lane: "sealed-paired-review",
      caseId: testCase.caseId,
      reviewDispatched: paired.result.reviewDispatched,
      pass: paired.result.pass
    })}\n`);
    if (paired.hardAnomaly !== null) {
      return { pairedResults, hardStop: paired.hardAnomaly };
    }
    if (!paired.result.pass) {
      return { pairedResults, hardStop: null };
    }
  }
  return { pairedResults, hardStop: null };
}

function productionDecision(
  input: {
    mode: SemanticEvaluationMode;
    thresholdPass: boolean | null;
    pairedResults: readonly PairedSemanticReviewCaseResult[];
  },
): RunSummary["pairedReview"]["productionDecision"] {
  if (input.mode === "development") {
    return "rejected-for-production";
  }
  if (
    input.thresholdPass === false ||
    input.pairedResults.some((result) => !result.pass)
  ) {
    return "rejected-for-production";
  }
  return input.thresholdPass === null
    ? "not-evaluated"
    : "remain-evaluation-only-pending-builder-decision";
}

function emptyRecoveryExecutionTerminalContext():
RecoveryExecutionTerminalContext {
  return {
    accounting: {
      callAAttempts: [],
      callBAttempts: [],
      chronologicalAttempts: [],
      replayCapsules: []
    },
    accessState: {
      opening: null,
      openingRecordSha256: null,
      verifierInvoked: false,
      receipt: null,
      receiptRecordSha256: null,
      receiptWritten: false
    },
    authoritativeAccounting: {
      callAAttempts: null,
      callBAttempts: null,
      networkDispatches: null
    },
    reservedExposureBeforeMicrousd: null,
    reservedExposureAfterMicrousd: null
  };
}

function filesystemErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

async function writeRecoveryExecutionTerminalStop(input: {
  runId: string;
  hardStopReason: SemanticEvaluationHardAnomaly;
  context: RecoveryExecutionTerminalContext;
}): Promise<void> {
  const stop = RecoveryExecutionStopSchema.parse({
    schemaVersion:
      "sketchycut-m74-sealed-recovery-execution-stop@1.0.0",
    campaign: SEMANTIC_EVALUATION_CAMPAIGN_SLUG,
    runId: input.runId,
    stoppedAt: new Date().toISOString(),
    phase: "post-execution-claim",
    hardStopReason: input.hardStopReason,
    sealedAccess: {
      openingClaimed: input.context.accessState.opening !== null,
      openingRecordSha256:
        input.context.accessState.openingRecordSha256,
      verifierInvoked:
        input.context.accessState.verifierInvoked,
      readReceiptObserved:
        input.context.accessState.receipt !== null,
      readReceiptWritten:
        input.context.accessState.receiptWritten,
      readReceiptRecordSha256:
        input.context.accessState.receiptRecordSha256
    },
    runAccounting: {
      callAAttempts:
        input.context.authoritativeAccounting.callAAttempts,
      callBAttempts:
        input.context.authoritativeAccounting.callBAttempts,
      networkDispatches:
        input.context.authoritativeAccounting.networkDispatches,
      reservedExposureBeforeMicrousd:
        input.context.reservedExposureBeforeMicrousd,
      reservedExposureAfterMicrousd:
        input.context.reservedExposureAfterMicrousd
    },
    retryAuthorized: false,
    replacementAuthorized: false,
    furtherCampaignAuthorized: false
  });
  const stopPath = path.join(
    runDirectory(input.runId),
    "terminal-stop.json",
  );
  try {
    await writeFile(stopPath, artifactBytes(stop), { flag: "wx" });
  } catch (error) {
    if (filesystemErrorCode(error) !== "EEXIST") throw error;
    const existing = RecoveryExecutionStopSchema.parse(
      await readJson(stopPath),
    );
    if (existing.runId !== input.runId) {
      throw new Error(
        "M74_RECOVERY_TERMINAL_STOP_IDENTITY_DRIFT",
        { cause: error },
      );
    }
  }
}

async function recordRecoveryExecutionStop(
  runId: string,
  error: unknown,
  context: RecoveryExecutionTerminalContext,
): Promise<void> {
  await writeRecoveryExecutionTerminalStop({
    runId,
    hardStopReason: safeHardAnomaly(error),
    context
  });
}

async function executeRun(input: {
  mode: SemanticEvaluationMode;
  runIdCandidate: string;
  inputRoot?: string;
}): Promise<void> {
  if (input.mode !== "acceptance") {
    throw new Error("M74_CORRECTIVE_DEVELOPMENT_ALREADY_COMPLETE");
  }
  const runId = RunIdSchema.parse(input.runIdCandidate);
  if (input.inputRoot === undefined) {
    throw new Error("M74_ACCEPTANCE_INPUT_ROOT_REQUIRED");
  }
  const selectionBytes = await readFile(selectionPath(input.mode));
  const selection = SelectionSchema.parse(
    JSON.parse(selectionBytes.toString("utf8")) as unknown,
  );
  if (selection.runId !== runId) {
    throw new Error("M74_EVALUATION_ONE_SHOT_SELECTION_MISMATCH");
  }
  await claimRecoveryExecution(runId);
  const terminalContext = emptyRecoveryExecutionTerminalContext();
  try {
    await executeClaimedRecovery({
      mode: "acceptance",
      runIdCandidate: runId,
      inputRoot: input.inputRoot,
      selection,
      selectionBytes,
      terminalContext
    });
  } catch (error) {
    await recordRecoveryExecutionStop(
      runId,
      error,
      terminalContext,
    );
    throw error;
  }
}

async function executeClaimedRecovery(input: {
  mode: "acceptance";
  runIdCandidate: string;
  inputRoot: string;
  selection: z.infer<typeof SelectionSchema>;
  selectionBytes: Buffer;
  terminalContext: RecoveryExecutionTerminalContext;
}): Promise<void> {
  const runId = RunIdSchema.parse(input.runIdCandidate);
  if (existsSync(recoveryOpeningPath)) {
    throw new Error("M74_SEALED_RECOVERY_PARTITION_ALREADY_OPENED");
  }
  if (existsSync(summaryPath(runId))) {
    throw new Error("M74_EVALUATION_RUN_ALREADY_STARTED");
  }
  const { selection, selectionBytes } = input;
  await loadLocalEnvironment();
  const manifestBytes = await readFile(manifestPath(runId));
  const manifest = ManifestSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")) as unknown,
  );
  const [selectionHash, manifestHash, identityHash] =
    await Promise.all([
      sha256(selectionBytes),
      sha256(manifestBytes),
      hashCanonical(manifest.identities)
  ]);
  if (
    selection.runId !== manifest.runId ||
    selection.manifestHash !== manifestHash ||
    selection.identityHash !== identityHash ||
    selection.executionIdentityFreezeSha256 !==
      manifest.executionIdentityFreezeSha256 ||
    selection.builderAttestationSha256 !==
      manifest.builderAttestationSha256
  ) {
    throw new Error("M74_EVALUATION_MODE_RUN_MISMATCH");
  }
  const store = new UpstashGenerationStore(readUpstashConfig());
  if (manifest.developmentGate === null) {
    throw new Error("M74_ACCEPTANCE_DEVELOPMENT_GATE_MISSING");
  }
  const currentGate = await developmentGate(store);
  if (
    await hashCanonical(currentGate) !==
      await hashCanonical(manifest.developmentGate)
  ) {
    throw new Error("M74_ACCEPTANCE_DEVELOPMENT_GATE_DRIFT");
  }
  const before = await durableSnapshot(store);
  input.terminalContext.reservedExposureBeforeMicrousd =
    before.state.reservedExposureMicrousd;
  assertRecoveryFrozenDurablePrefix(before);
  const initialLineage = await assertDurableRunLineage(
    manifest,
    before,
  );
  if (
    initialLineage.attempts.length !== 0 ||
    before.record.snapshotHash !==
      manifest.exposureSnapshot.snapshotHash
  ) {
    throw new Error("M74_EVALUATION_DURABLE_BASELINE_DRIFT");
  }
  input.terminalContext.authoritativeAccounting = {
    callAAttempts: null,
    callBAttempts: null,
    networkDispatches: null
  };
  const preAccess = await preAccessChecks({
    manifest,
    store,
    maximumRemainingCalls:
      manifest.maximumExposure.maximumCalls,
    inputRoot: input.inputRoot
  });
  input.terminalContext.authoritativeAccounting = {
    callAAttempts: 0,
    callBAttempts: 0,
    networkDispatches: 0
  };
  const callBPrompt = await readFile(callBPromptPath, "utf8");
  if (
    await sha256(callBPrompt) !==
      manifest.identities.callBPromptHash
  ) {
    throw new Error("M74_CALL_B_PROMPT_PREACCESS_DRIFT");
  }
  const accounting = input.terminalContext.accounting;
  const accessState = input.terminalContext.accessState;
  const trackAStatus = null;
  const trackASummaryHash = null;
  let pairedResults: PairedSemanticReviewCaseResult[] = [];
  let hardStop: SemanticEvaluationHardAnomaly | null;
  input.terminalContext.authoritativeAccounting = {
    callAAttempts: null,
    callBAttempts: null,
    networkDispatches: null
  };
  try {
    const result = await runAcceptance({
      manifest,
      store,
      accounting,
      accessState,
      inputRoot: preAccess.boundInputRoot,
      callBPrompt,
      commitment: preAccess.commitment
    });
    pairedResults = result.pairedResults;
    hardStop = result.hardStop;
  } catch (error) {
    hardStop = safeHardAnomaly(error);
  }
  const after = await durableSnapshot(store, true);
  input.terminalContext.reservedExposureAfterMicrousd =
    after.state.reservedExposureMicrousd;
  let authoritativeLineage: Awaited<
    ReturnType<typeof assertDurableRunLineage>
  >;
  try {
    authoritativeLineage = await assertDurableRunLineage(
      manifest,
      after,
    );
  } catch (error) {
    hardStop = safeHardAnomaly(error);
    const attempts = after.attempts.slice(
      manifest.exposureSnapshot.attemptCount,
    );
    authoritativeLineage = {
      attempts,
      callAAttempts: attempts.filter((attempt) =>
        attempt.promptHash === manifest.identities.callAPromptHash
      ),
      callBAttempts: attempts.filter((attempt) =>
        attempt.promptHash === manifest.identities.callBPromptHash
      ),
      unattributedAttempts: attempts.filter((attempt) =>
        attempt.promptHash !== manifest.identities.callAPromptHash &&
        attempt.promptHash !== manifest.identities.callBPromptHash
      )
    };
  }
  input.terminalContext.authoritativeAccounting = {
    callAAttempts: authoritativeLineage.callAAttempts.length,
    callBAttempts: authoritativeLineage.callBAttempts.length,
    networkDispatches:
      authoritativeLineage.attempts.reduce(
        (total, attempt) =>
          total + attempt.networkDispatchCount,
        0,
      )
  };
  const localAttemptIds =
    accounting.chronologicalAttempts.map((attempt) =>
      attempt.attemptId
    );
  const authoritativeAttemptIds =
    authoritativeLineage.attempts.map((attempt) =>
      attempt.attemptId
    );
  if (
    JSON.stringify(localAttemptIds) !==
      JSON.stringify(authoritativeAttemptIds) &&
    hardStop === null
  ) {
    hardStop = {
      category: "ledger",
      code: "M74_LOCAL_DURABLE_ATTEMPT_ATTRIBUTION_MISMATCH"
    };
  }
  if (
    after.ledger.unresolvedPotentiallyBilledExposureMicrousd !== 0 &&
    hardStop === null
  ) {
    hardStop = {
      category: "billing",
      code: "M74_UNRESOLVED_POTENTIALLY_BILLED_EXPOSURE"
    };
  }
  let aggregate: ReturnType<
    typeof aggregatePairedSemanticReviewResults
  > | null = null;
  if (
    pairedResults.some((result) =>
      result.evaluationClass === "review-eligible-error"
    ) &&
    pairedResults.some((result) =>
      result.evaluationClass === "already-correct-control"
    )
  ) {
    aggregate = aggregatePairedSemanticReviewResults(pairedResults);
  }
  const thresholdPass = aggregate?.thresholdPass ?? null;
  const totals = accountingFromAttempts(
    authoritativeLineage.attempts,
    before.state.reservedExposureMicrousd,
    after.state.reservedExposureMicrousd,
  );
  const replacementCalls =
    M74_REPLACEMENT_DEVELOPMENT.observedCalls;
  const replacementReservedExposureMicrousd =
    M74_REPLACEMENT_DEVELOPMENT.observedReservedExposureMicrousd;
  const correctiveCalls =
    manifest.successfulCorrectiveDevelopment.observedCalls;
  const correctiveReservedExposureMicrousd =
    manifest.successfulCorrectiveDevelopment
      .observedReservedExposureMicrousd;
  const acceptanceCalls = totals.networkDispatches;
  const acceptanceReservedExposureMicrousd =
    totals.runOwnedReservedExposureMicrousd;
  const cumulativeCalls =
    M74_TERMINAL_DEVELOPMENT.observedCalls +
    replacementCalls +
    correctiveCalls +
    acceptanceCalls;
  const cumulativeReservedExposureMicrousd =
    M74_TERMINAL_DEVELOPMENT.observedReservedExposureMicrousd +
    replacementReservedExposureMicrousd +
    correctiveReservedExposureMicrousd +
    acceptanceReservedExposureMicrousd;
  const withinFrozenAuthority = !(
    cumulativeCalls >
      M74_CUMULATIVE_LIVE_AUTHORITY.maximumCalls ||
    cumulativeReservedExposureMicrousd >
      M74_CUMULATIVE_LIVE_AUTHORITY
        .maximumReservedExposureMicrousd ||
    acceptanceCalls >
      M74_LIVE_EXPOSURE_POLICY.acceptance.maximumCalls ||
    acceptanceReservedExposureMicrousd >
      M74_LIVE_EXPOSURE_POLICY.acceptance
        .maximumReservedExposureMicrousd ||
    authoritativeLineage.callAAttempts.length >
      manifest.maximumExposure.maximumCallA ||
    authoritativeLineage.callBAttempts.length >
      manifest.maximumExposure.maximumCallB ||
    authoritativeLineage.unattributedAttempts.length > 0 ||
    totals.networkDispatches >
      manifest.maximumExposure.maximumCalls ||
    totals.runOwnedReservedExposureMicrousd >
      manifest.maximumExposure.maximumReservedExposureMicrousd
  );
  if (!withinFrozenAuthority) {
    hardStop = authoritativeLineage.unattributedAttempts.length > 0
      ? {
          category: "ledger",
          code: "M74_DURABLE_RUN_ATTEMPT_UNATTRIBUTED"
        }
      : {
          category: "exposure",
          code: "M74_CUMULATIVE_AUTHORITY_EXCEEDED"
        };
  }
  const trackAShippingDecision = "not-applicable" as const;
  const executionStatus = hardStop === null
    ? pairedResults.length < manifest.commitment.caseIds.length
      ? "aborted" as const
      : "completed" as const
    : "aborted" as const;
  const qualityStatus = hardStop !== null
    ? "not-scored" as const
    : thresholdPass !== true
      ? "fail" as const
      : "pass" as const;
  if (hardStop !== null) {
    await writeRecoveryExecutionTerminalStop({
      runId,
      hardStopReason: hardStop,
      context: input.terminalContext
    });
  }
  const summary = RunSummarySchema.parse({
    schemaVersion:
      "sketchycut-m7-4-governed-semantic-evaluation-summary@7.0.0",
    campaign: SEMANTIC_EVALUATION_CAMPAIGN_SLUG,
    mode: "acceptance",
    runId,
    manifestHash,
    selectionHash,
    identityHash,
    priorTerminalDevelopment:
      manifest.priorTerminalDevelopment,
    priorReplacementDevelopment:
      manifest.priorReplacementDevelopment,
    priorBurnedCorrectivePreparation:
      manifest.priorBurnedCorrectivePreparation,
    successfulCorrectiveDevelopment:
      manifest.successfulCorrectiveDevelopment,
    priorBurnedAcceptancePreparation:
      manifest.priorBurnedAcceptancePreparation,
    priorConsumedSealedAcceptance:
      manifest.priorConsumedSealedAcceptance,
    recoveryIdentityDelta:
      manifest.recoveryIdentityDelta,
    completedAt: new Date().toISOString(),
    executionStatus,
    qualityStatus,
    trackA: {
      executed: false,
      qualityStatus: trackAStatus,
      summaryHash: trackASummaryHash,
      shippingDecision: trackAShippingDecision
    },
    pairedReview: {
      attemptedCaseIds: pairedResults.map((result) => result.caseId),
      aggregate,
      thresholdPass,
      productionDecision: productionDecision({
        mode: input.mode,
        thresholdPass,
        pairedResults
      })
    },
    replayCapsules: [...accounting.replayCapsules].sort((left, right) =>
      left.caseId < right.caseId
        ? -1
        : left.caseId > right.caseId
          ? 1
          : 0
    ),
    runAccounting: {
      callAAttempts:
        authoritativeLineage.callAAttempts.length,
      callBAttempts:
        authoritativeLineage.callBAttempts.length,
      unattributedAttempts:
        authoritativeLineage.unattributedAttempts.length,
      ...totals
    },
    durableLineage: {
      frozenAttemptCount:
        manifest.exposureSnapshot.attemptCount,
      finalAttemptCount: after.attempts.length,
      frozenAttemptsHash:
        manifest.exposureSnapshot.attemptsHash,
      runAttemptsHash:
        await hashCanonical(authoritativeLineage.attempts),
      billingReconciliationCount:
        after.billingReconciliations.length,
      billingReconciliationsHash:
        after.record.billingReconciliationsHash,
      authorizationCount: after.authorizations.length,
      authorizationsHash:
        after.record.authorizationsHash
    },
    cumulativeAccounting: {
      terminalCalls:
        M74_TERMINAL_DEVELOPMENT.observedCalls,
      terminalReservedExposureMicrousd:
        M74_TERMINAL_DEVELOPMENT
          .observedReservedExposureMicrousd,
      replacementCalls,
      replacementReservedExposureMicrousd,
      correctiveCalls,
      correctiveReservedExposureMicrousd,
      acceptanceCalls,
      acceptanceReservedExposureMicrousd,
      totalCalls: cumulativeCalls,
      totalReservedExposureMicrousd:
        cumulativeReservedExposureMicrousd,
      withinFrozenAuthority
    },
    hardStopReason: hardStop,
    stoppedWithoutRetry: true,
    durableCeilingIncrease: 0,
    broadGeneralizationClaimed: false
  });
  await writeSemanticEvaluationArtifact(summaryPath(runId), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = hardStop !== null
    ? 1
    : qualityStatus === "pass"
      ? 0
      : 2;
}

async function inspect(
  mode: SemanticEvaluationMode,
  runIdCandidate?: string,
): Promise<void> {
  const selection = existsSync(selectionPath(mode))
    ? SelectionSchema.parse(await readJson(selectionPath(mode)))
    : null;
  const runId = runIdCandidate ?? selection?.runId;
  process.stdout.write(`${JSON.stringify({
    mode,
    oneShotSelectionPresent: selection !== null,
    runId: runId ?? null,
    manifestPresent: runId === undefined
      ? false
      : existsSync(manifestPath(runId)),
    summaryPresent: runId === undefined
      ? false
      : existsSync(summaryPath(runId)),
    maximumCalls: M74_LIVE_EXPOSURE_POLICY[mode].maximumCalls,
    maximumReservedExposureUsd:
      M74_LIVE_EXPOSURE_POLICY[mode]
        .maximumReservedExposureMicrousd / 1_000_000,
    sealedOpeningClaimed: existsSync(recoveryOpeningPath)
  }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] !== "--mode") {
    throw new Error(
      "Usage: --mode development|acceptance --prepare | --execute <run-id> [--input-root <path>] | --inspect [run-id]",
    );
  }
  const mode = z.enum(["development", "acceptance"]).parse(arguments_[1]);
  const command = arguments_[2];
  if (command === "--prepare" && arguments_.length === 3) {
    await prepareRun(mode);
    return;
  }
  if (command === "--inspect" && arguments_.length <= 4) {
    await inspect(mode, arguments_[3]);
    return;
  }
  if (command === "--execute" && arguments_[3] !== undefined) {
    const inputRootIndex = arguments_.indexOf("--input-root");
    const inputRoot = inputRootIndex === -1
      ? undefined
      : arguments_[inputRootIndex + 1];
    const expectedLength = inputRoot === undefined ? 4 : 6;
    if (arguments_.length !== expectedLength) {
      throw new Error("M74_EVALUATION_COMMAND_ARGUMENTS_INVALID");
    }
    await executeRun({
      mode,
      runIdCandidate: arguments_[3],
      ...(inputRoot === undefined ? {} : { inputRoot })
    });
    return;
  }
  throw new Error(
    "Usage: --mode development|acceptance --prepare | --execute <run-id> [--input-root <path>] | --inspect [run-id]",
  );
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error
    ? error.message
    : "M74_EVALUATION_COMMAND_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
