import type { SemanticEvaluationMode } from "../src/evaluation/semantic-live-evaluator.js";

export const SEMANTIC_EVALUATION_CAMPAIGN_SLUG =
  "m7-4-sealed-recovery" as const;

export const M74_TERMINAL_DEVELOPMENT = {
  campaignSlug: "m7-4-bounded-review-substitution",
  runId: "m07-4-development-20260723222309-d53a0e46d79c",
  selectionFileName:
    "semantic-evaluation-m7-4-bounded-review-substitution-development-selection.json",
  selectionSha256:
    "22f0460b4ae4d717f7ddbd1c3034bf19f6a2ace459cd0c92f9b3cd7a17499e95",
  manifestSha256:
    "95884b37c238c001de1857b358bd264d6d38f5531aa8b8713879e444871b7f7c",
  summarySha256:
    "3663474e406e1c30afce0b5e1944e1e933cc014c20a3bf12b6641577c5594a81",
  observedCalls: 7,
  observedReservedExposureMicrousd: 4_550_000
} as const;

export const M74_REPLACEMENT_DEVELOPMENT = {
  campaignSlug: "m7-4-retained-scope-replacement",
  runId: "m07-4-development-20260724025936-188235ebcfd5",
  selectionFileName:
    "semantic-evaluation-m7-4-retained-scope-replacement-development-selection.json",
  selectionSha256:
    "cf1142eb0b0fc07e31b795baa84d1b646d16553b09e0520d6fcac467f3085b57",
  manifestSha256:
    "fd5c6df1d5a1e39d59356a5e87f0e8399fee79ce8e8566be62bede76d449cc79",
  summarySha256:
    "6abd7702aa226778b3756347d427e76d06f57bc359d647f493d16f2889a4baff",
  observedCalls: 8,
  observedReservedExposureMicrousd: 5_200_000
} as const;

export const M74_BURNED_CORRECTIVE_PREPARATION = {
  campaignSlug: "m7-4-retained-scope-corrective",
  runId: "m07-4-development-20260724035719-b5747aa3feeb",
  selectionFileName:
    "semantic-evaluation-m7-4-retained-scope-corrective-development-selection.json",
  selectionSha256:
    "cd53416d43d07160b6a5e7e273e99d6272b966bcec01f3741bd7d6d0f0c10693",
  manifestSha256:
    "dff771733d6280b6e10b8f9c3db4eeb617ad6c2e94aafd469141dc69c8512377",
  reportFileName:
    "reports/corrective-predispatch-replay-audit-drift.json",
  reportSha256:
    "bcd06a7ea242bc69e96c074ef4b695244ff98e752a4ab65fbfd21d9cba37f905",
  stopCode: "M74_PRIOR_CAPSULE_REPLAY_AUDIT_DRIFT",
  frozenAttemptCount: 102,
  frozenReservedExposureMicrousd: 66_300_000,
  observedCalls: 0,
  observedReservedExposureMicrousd: 0
} as const;

export const M74_CORRECTIVE_DEVELOPMENT = {
  campaignSlug: "m7-4-retained-scope-corrective-stable-replay",
  runId: "m07-4-development-20260724040826-d80531bbbfe6",
  selectionFileName:
    "semantic-evaluation-m7-4-retained-scope-corrective-stable-replay-development-selection.json",
  selectionSha256:
    "efcfb95738c0ae489f3029174ca8d1dab473187e3ef7b675bfcf49f499ffc220",
  manifestSha256:
    "210bcddf98607a3bbf68e73037bff7bae5db5821a73c7d341810f0b3d28a7a18",
  summarySha256:
    "8f7ea8dd7cc684e1f061517c5db7350b670a18aa16a9e5c5a9f248a96618d89d",
  identityHash:
    "0d75be57348cda0173b8cfcbab096e020d66d9f5f9fcdf71c974658d16894824",
  observedCalls: 4,
  observedReservedExposureMicrousd: 2_600_000
} as const;

export const M74_BURNED_ACCEPTANCE_PREPARATION = {
  campaignSlug: "m7-4-retained-scope-corrective-stable-replay",
  runId: "m07-4-acceptance-20260724041135-57316266dc4d",
  selectionFileName:
    "semantic-evaluation-m7-4-retained-scope-corrective-stable-replay-acceptance-selection.json",
  selectionSha256:
    "6e8594eb8cbc464f40d8df482c02e626cc44a565ca6cab47f748df27b7d82a0b",
  manifestSha256:
    "0b564b7f8b5c5d36bc95ce00a2dd63c9e6738dad45340cb60c3beca3010f436a",
  reportFileName:
    "reports/acceptance-predispatch-opening-order-audit-stop.json",
  reportSha256:
    "3fc11e05a68503492cda4aedcae1dc459e55c2829e4c4a8fc8e4d2a05cc95fe0",
  stopCode: "M74_SEALED_OPENING_ORDER_SOURCE_AUDIT_FAILURE",
  frozenAttemptCount: 106,
  frozenReservedExposureMicrousd: 68_900_000,
  observedCalls: 0,
  observedReservedExposureMicrousd: 0
} as const;

export const M74_CONSUMED_SEALED_ACCEPTANCE = {
  campaignSlug: "m7-4-sealed-acceptance-claim-first",
  runId: "m07-4-acceptance-20260724043114-9a5e091bc173",
  partitionId: "m74-sealed-partition-20260723",
  caseIds: [
    "m74-hinged-keepsake-box",
    "m74-two-space-tray"
  ],
  commitmentFileName: "sealed-partition-commitment.json",
  commitmentSha256:
    "e4cea176fc75c697ad55cbefffe41dac17e0cb914499b1e12f036708001883ae",
  openingFileName: "sealed-partition-opening.json",
  openingSha256:
    "4c0bde44be2989673406c11dc8882ba749ccb6bc49adb7e822e62a4b4d674d9b",
  selectionFileName:
    "semantic-evaluation-m7-4-sealed-acceptance-claim-first-acceptance-selection.json",
  selectionSha256:
    "44a3682a4880364484d66e1b4011244ec9281d62040f6c7ac2e0fc94fe74fb3d",
  manifestSha256:
    "c3cead2d88ab799b49f0a5e78fb2cce0b9fc36a69d9fbaad8d2478e4e49a3354",
  verifiedRegistrationFileName: "sealed-verified-registration.json",
  verifiedRegistrationSha256:
    "810c3f73e1b5f41eb17a8c2194dd8f3134a62555a0642d073f968aedafee549d",
  hardStopFileName:
    "reports/sealed-opening-consumed-predispatch-hard-stop.json",
  hardStopSha256:
    "94cef768735ff6e748fa4cc223b00e94e949f274a7d9668be2e1c0cd229d92bf",
  finalAuditFileName: "reports/final-completion-audit.json",
  finalAuditSha256:
    "e833671a1eff908c6c995c27c77f07ee6a41b41747d099bbc827d720c9f6b16e",
  observedCalls: 0,
  observedReservedExposureMicrousd: 0,
  openingClaims: 1,
  partitionLoadPasses: 2,
  payloadFileReads: 4
} as const;

export const M74_ACCEPTANCE_CLAIM_FIRST_IDENTITY_DELTA = {
  policyVersion:
    "m74-sealed-acceptance-claim-first-identity-delta@1.0.0",
  correctiveIdentityHash:
    M74_CORRECTIVE_DEVELOPMENT.identityHash,
  invariantFileCount: 340,
  invariantSourceStateHash:
    "7be63e298ede8fa672ac07f3e808f0aa4b4e1a6b6f87c7b9281888d610a591fc",
  allowedChangedSourcePaths: [
    "tests/evaluation/semantic-live-evaluator.test.ts",
    "tools/run-live-semantic-evaluation.ts",
    "tools/semantic-evaluation-profile.ts"
  ]
} as const;

export const M74_SEALED_RECOVERY_IDENTITY_DELTA = {
  policyVersion: "m74-sealed-recovery-identity-delta@1.0.0",
  authorizationId: "m74-sealed-recovery-authorization-20260724",
  authorizationFreezeSha256:
    "455e9562bd6a7031ef88b287675b4fad4a6eafc37b73247c1e7415d131356463",
  authorizationBaselineSupplementSha256:
    "0375372eff02a0d339e5869fff577d7a1359fde0259fbcfc523f820cdbae1452",
  preimplementationInvariantFileCount: 347,
  preimplementationInvariantSourceStateHash:
    "90909a145d999247187b7c1e8b5d038d4ba97c4f4bc4d38b43a414819825dffa",
  sealedPartitionSourceSha256:
    "d0369b058c3e371ce6d2d00605cecdb53e666a8e34b014dcdb843ef20b52d249",
  recoveryInfrastructurePaths: [
    "tests/evaluation/sealed-partition.test.ts",
    "tests/evaluation/semantic-live-evaluator.test.ts",
    "tools/SEALED_SEMANTIC_EVALUATION.md",
    "tools/run-live-semantic-evaluation.ts",
    "tools/semantic-evaluation-profile.ts"
  ],
  recoveryCaseIds: [
    "m74-recovery-case-a",
    "m74-recovery-case-b"
  ],
  consumedCaseIds: M74_CONSUMED_SEALED_ACCEPTANCE.caseIds,
  frozenSemanticAndFabricationIdentity: {
    gitHead: "aebb6b2edf7a78fcdd4bb8dc825bcf7f9f94e38e",
    callAPromptHash:
      "d0cf8436a88070b9eb584938284b2de0b2df1ed9a757b8c0b6462e38d1c6795a",
    callBPromptHash:
      "f970dfbe1872d7fb300ceb044041b3a61bc0bb287ac90a6c54387f47c0cd4b39",
    callAProviderContractSourceHash:
      "3a2dc68f0240d914224f11bb387c97bdd5214d0bee095d2b047e7f1db083c96d",
    callBProviderContractSourceHash:
      "669c10160a6713a2bdfb28013af5a8745a980d0266574cc32862a3303dae7d44",
    semanticAtomTemplateRegistryHash:
      "ccf6c5174c30822c83284f5910cfc14b6c742948b1a5b1d8fa548e3c62cb2482",
    capabilityCatalogHash:
      "5f0957d58b969419dc349144e48685d8f9db97ff628d9d79414561027c829dcf",
    unsupportedSignatureRegistryHash:
      "1a7fe22005c6e7d5983673579bb602b3540bfe61439a660be4690c6fe79cf3e2",
    substitutionGraphRegistryHash:
      "97830b564dd987e2b952fe9ecc73f6452eaf84a53ee40a24da6376ea3184b7e9",
    corpusHash:
      "8043ba5d780dc5e1376b6ee75d42e8e421ed3542b10a0ad4b5d09a01f00a6bc6",
    modelConfigurationHash:
      "1c701bbb897217a2e2856cb69583c70ec768b16f1b0c61e502357616fd665bda",
    packageJsonHash:
      "f2d93334196ea6bc769a6abc7ed165eb182cb621d77908c48d51cfcfb6eedfbf",
    packageLockHash:
      "c6ccc8617a4a39bb057a11f5f923a0b42858d924931ad4a0c74412023a076395",
    privateReplayCapsuleSchemaVersion:
      "sketchycut-private-semantic-replay-capsule@1.0.0",
    privateReplayImplementationHash:
      "9b02c4d35c3b5ca866709c1cc00491d055ae8eb2b3ee94d200419039ad664e55",
    durableStoreIdentityHash:
      "9633be245ca5ff639211aafec557143cacc7ed4121eb38a353ac1ff2eed0fb85"
  },
  permittedInfrastructureIdentityFields: [
    "sourceStateHash",
    "sealedCommitmentRecordHash",
    "canonicalPlanHash",
    "evaluatorHash"
  ],
  semanticOrFabricationAuthorityChanged: false,
  recoveryCommitmentMayDifferFromCorrectiveCommitment: true
} as const;

export const M74_SEALED_RECOVERY_ROOT_BINDING_DOMAIN =
  "sketchycut-m74-sealed-recovery-canonical-root@1.0.0" as const;

export const M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX = {
  authorizedCeilingMicrousd: 72_550_000,
  reservedExposureMicrousd: 68_900_000,
  authorizationVersion: 13,
  authorizationCount: 13,
  authorizationsHash:
    "9d64e8bb0f5f448853777eb6fb85bfb121fed389cad66f19681b7dff1d83b3bc",
  attemptCount: 106,
  attemptsHash:
    "46714cc561113f7eff7a185826c3ab8466f2d677ddeeeb58f0b5e9aa1c423b0e",
  billingReconciliationCount: 1,
  billingReconciliationsHash:
    "a8941648554e1e888e319f1270acd95ed92f1b7364003eb887beeb8dec85c0bc",
  globalExposureStateHash:
    "53214a4d698ffabfc726c0cf994d4145dea6967221be28c92938d33c0ddd4ecc",
  ledgerSummaryHash:
    "ae277bd55dea1b3e5eb7cab071335646cf40bb0e75c74ce4c2b6443976f9f9cc",
  unresolvedPotentiallyBilledExposureMicrousd: 0,
  confirmedEstimatedCostMicrousd: 7_575_302
} as const;

export const M74_GIT_OBJECT_ID_PATTERN =
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export function semanticEvaluationSelectionFileName(
  mode: SemanticEvaluationMode,
): string {
  return `semantic-evaluation-${SEMANTIC_EVALUATION_CAMPAIGN_SLUG}-${mode}-selection.json`;
}

export const SEMANTIC_EVALUATION_CASE_PROFILES = {
  development: [
    "substitution-lossy-flexure-positive-dev",
    "substitution-partitioned-flexure-positive-dev",
    "measurement-ambiguous-dev",
    "substitution-direct-support-wins-dev"
  ],
  acceptance: [
    "m74-recovery-case-a",
    "m74-recovery-case-b"
  ]
} as const satisfies Record<SemanticEvaluationMode, readonly string[]>;

export const M74_OPEN_PAIRED_REVIEW_CASE_IDS = [
] as const;

export const M74_LIVE_EXPOSURE_POLICY = {
  development: {
    maximumCallA: 4,
    maximumCallB: 0,
    maximumCalls: 4,
    maximumReservedExposureMicrousd: 2_600_000
  },
  acceptance: {
    maximumCallA: 2,
    maximumCallB: 1,
    maximumCalls: 3,
    maximumReservedExposureMicrousd: 1_950_000
  }
} as const satisfies Record<SemanticEvaluationMode, {
  maximumCallA: number;
  maximumCallB: number;
  maximumCalls: number;
  maximumReservedExposureMicrousd: number;
}>;

export const M74_CUMULATIVE_LIVE_AUTHORITY = {
  terminalObservedCalls: M74_TERMINAL_DEVELOPMENT.observedCalls,
  replacementObservedCalls:
    M74_REPLACEMENT_DEVELOPMENT.observedCalls,
  correctiveMaximumCalls:
    M74_LIVE_EXPOSURE_POLICY.development.maximumCalls,
  acceptanceMaximumCalls: M74_LIVE_EXPOSURE_POLICY.acceptance.maximumCalls,
  maximumCalls: 22,
  terminalObservedReservedExposureMicrousd:
    M74_TERMINAL_DEVELOPMENT.observedReservedExposureMicrousd,
  replacementObservedReservedExposureMicrousd:
    M74_REPLACEMENT_DEVELOPMENT.observedReservedExposureMicrousd,
  correctiveMaximumReservedExposureMicrousd:
    M74_LIVE_EXPOSURE_POLICY.development.maximumReservedExposureMicrousd,
  acceptanceMaximumReservedExposureMicrousd:
    M74_LIVE_EXPOSURE_POLICY.acceptance.maximumReservedExposureMicrousd,
  maximumReservedExposureMicrousd: 14_300_000
} as const;

export function requiredM74HeadroomMicrousd(input: {
  mode: SemanticEvaluationMode;
  maximumRemainingCalls: number;
}): number {
  if (
    !Number.isInteger(input.maximumRemainingCalls) ||
    input.maximumRemainingCalls < 0
  ) {
    throw new Error("M74_REMAINING_BATCH_CALL_CEILING_INVALID");
  }
  return (
    input.maximumRemainingCalls *
      M74_LIVE_EXPOSURE_POLICY.development.maximumReservedExposureMicrousd /
      M74_LIVE_EXPOSURE_POLICY.development.maximumCalls +
    (
      input.mode === "development"
        ? M74_LIVE_EXPOSURE_POLICY.acceptance
            .maximumReservedExposureMicrousd
        : 0
    )
  );
}

export function assertM74HeadroomAvailable(input: {
  mode: SemanticEvaluationMode;
  maximumRemainingCalls: number;
  availableHeadroomMicrousd: number;
}): number {
  if (
    !Number.isInteger(input.availableHeadroomMicrousd) ||
    input.availableHeadroomMicrousd < 0
  ) {
    throw new Error("M74_AVAILABLE_HEADROOM_INVALID");
  }
  const required = requiredM74HeadroomMicrousd(input);
  if (input.availableHeadroomMicrousd < required) {
    throw new Error("M74_REQUIRED_HEADROOM_INSUFFICIENT");
  }
  return required;
}

export function assertM74PaidDispatchAuthority(
  maximumRemainingCalls: number,
): void {
  if (
    !Number.isInteger(maximumRemainingCalls) ||
    maximumRemainingCalls < 1
  ) {
    throw new Error("M74_REMAINING_BATCH_CALL_CEILING_EXHAUSTED");
  }
}

export function assertM74CallBDispatchAuthority(input: {
  maximumRemainingCalls: number;
  callBAttemptCount: number;
  maximumCallB: number;
}): void {
  assertM74PaidDispatchAuthority(input.maximumRemainingCalls);
  if (
    !Number.isInteger(input.callBAttemptCount) ||
    input.callBAttemptCount < 0 ||
    !Number.isInteger(input.maximumCallB) ||
    input.maximumCallB < 1 ||
    input.callBAttemptCount >= input.maximumCallB
  ) {
    throw new Error("M74_CALL_B_ATTEMPT_CEILING_EXHAUSTED");
  }
}
