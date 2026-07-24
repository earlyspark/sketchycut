import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  classifySemanticEvaluationCase,
  createRunOwnedGenerationStore,
  evaluationArtifactPrivacyIssues,
  runSemanticEvaluationBatch,
  semanticCandidateAtomKindsByItemId,
  semanticEvaluationExitCode,
  SEMANTIC_EVALUATION_POLICIES,
  writeSemanticEvaluationArtifact,
  type SemanticEvaluationHardAnomalyCategory,
  type SemanticEvaluationRawCaseResult
} from "../../src/evaluation/semantic-live-evaluator.js";
import {
  LiveCallAttemptSchema,
  type LiveCallAttempt
} from "../../src/interpretation/live-ledger.js";
import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION
} from "../../src/interpretation/semantic-atom-registry.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  type SemanticInterpretationCandidate
} from "../../src/interpretation/semantic-model-contract.js";
import {
  SemanticCaseOracleScoreSchema,
  type SemanticCaseOracleScore
} from "../../src/evaluation/semantic-generalization-oracle.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import {
  assertM74CallBDispatchAuthority,
  assertM74HeadroomAvailable,
  assertM74PaidDispatchAuthority,
  M74_ACCEPTANCE_CLAIM_FIRST_IDENTITY_DELTA,
  M74_BURNED_ACCEPTANCE_PREPARATION,
  M74_BURNED_CORRECTIVE_PREPARATION,
  M74_CONSUMED_SEALED_ACCEPTANCE,
  M74_CUMULATIVE_LIVE_AUTHORITY,
  M74_CORRECTIVE_DEVELOPMENT,
  M74_GIT_OBJECT_ID_PATTERN,
  M74_LIVE_EXPOSURE_POLICY,
  M74_REPLACEMENT_DEVELOPMENT,
  M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX,
  M74_SEALED_RECOVERY_IDENTITY_DELTA,
  M74_SEALED_RECOVERY_ROOT_BINDING_DOMAIN,
  M74_TERMINAL_DEVELOPMENT,
  requiredM74HeadroomMicrousd,
  SEMANTIC_EVALUATION_CAMPAIGN_SLUG,
  SEMANTIC_EVALUATION_CASE_PROFILES,
  semanticEvaluationSelectionFileName
} from "../../tools/semantic-evaluation-profile.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function temporaryRunDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "sketchycut-semantic-eval-"));
  temporaryDirectories.push(root);
  return path.join(root, "run");
}

function completedAttempt(
  suffix: string,
  overrides: Partial<LiveCallAttempt> = {},
): LiveCallAttempt {
  return LiveCallAttemptSchema.parse({
    schemaVersion: "1.0",
    attemptId: `attempt-${suffix}`,
    submissionId: `submission-${suffix}`,
    retryChainId: `retry-chain-${suffix}`,
    retryOfAttemptId: null,
    initiatedBy: "live-eval",
    runtimeOrigin: "test-recorded",
    attemptOrdinal: 1,
    semanticRequestDigest: "1".repeat(64),
    promptHash: "2".repeat(64),
    schemaHash: "3".repeat(64),
    capabilityCatalogHash: "4".repeat(64),
    modelConfigurationHash: "5".repeat(64),
    modelId: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    imageDetailPolicy: "mixed-first-high",
    promptLayoutVersion: "stable-prefix-current",
    clientRequestId: `client-request-${suffix}`,
    providerRequestId: `provider-request-${suffix}`,
    providerModelId: "gpt-5.6-sol",
    responseId: `response-${suffix}`,
    finishState: "completed",
    dispatchState: "response-observed",
    outcome: "completed",
    occurredAt: "2026-07-22T12:00:00.000Z",
    latencyMs: 100,
    cacheResult: "miss",
    errorCode: null,
    networkDispatchCount: 1,
    strictParse: "passed",
    supportStateCorrect: null,
    deterministicCompile: "passed",
    usage: {
      status: "reported",
      inputTokens: 100,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 20,
      outputTokens: 50,
      totalTokens: 150
    },
    billing: {
      state: "confirmed-billed",
      estimatedCostUsd: 0.002,
      requestBudgetUpperBoundUsd: 0.65,
      priceSnapshotId: "price-current"
    },
    ...overrides
  });
}

function semanticAuthorizationAttempt(suffix: string): LiveCallAttempt {
  return completedAttempt(suffix, {
    outcome: "semantic-authorization-failure",
    errorCode: "SEMANTIC_AUTHORIZATION_FAILED",
    deterministicCompile: "not-run",
    semanticAuthorizationFindings: [{
      code: "SEMANTIC_ITEM_UNACCOUNTED",
      path: "inventory.items.0"
    }]
  });
}

function passingScore(caseId: string): SemanticCaseOracleScore {
  return SemanticCaseOracleScoreSchema.parse({
    caseId,
    strictInterpretation: true,
    commitmentPredicates: [{ code: "COMMITMENT_TEST", pass: true }],
    contextPredicates: [{ code: "CONTEXT_TEST", pass: true }],
    prohibitedBindingPredicates: [{ code: "PROHIBITED_TEST", pass: false }],
    outcomePolicy: {
      purpose: "svg-acceptance",
      allowedKinds: ["supported", "simplified"],
      exportRequired: true
    },
    observedOutcomeKind: "supported",
    outcomeAccepted: true,
    primaryPass: true,
    evidenceGrounded: true,
    inventoryProjectionCoverage: true
  });
}

function failingScore(
  caseId: string,
  failure: "commitment" | "concept-only" = "commitment",
): SemanticCaseOracleScore {
  const base = passingScore(caseId);
  return SemanticCaseOracleScoreSchema.parse({
    ...base,
    commitmentPredicates: failure === "commitment"
      ? [{ code: "COMMITMENT_TEST", pass: false }]
      : base.commitmentPredicates,
    outcomeAccepted: failure === "concept-only" ? false : base.outcomeAccepted,
    primaryPass: false
  });
}

function rawCase(input: {
  caseId: string;
  index: number;
  score?: SemanticCaseOracleScore | null;
  attempt?: LiveCallAttempt;
  hardCategory?: SemanticEvaluationHardAnomalyCategory;
  outcome?: {
    kind: "supported" | "simplified" | "modified" | "concept-only";
    exportAllowed: boolean;
  };
}): SemanticEvaluationRawCaseResult {
  const outcome = input.outcome ?? { kind: "supported" as const, exportAllowed: true };
  return {
    caseId: input.caseId,
    attempts: [input.attempt ?? completedAttempt(String(input.index + 1))],
    score: input.score === undefined ? passingScore(input.caseId) : input.score,
    outcome: {
      kind: outcome.kind,
      exportAllowed: outcome.exportAllowed,
      findingCodes: [],
      failureStage: null,
      failureCode: null
    },
    semanticDiagnostics: {
      inventoryItems: [{
        itemId: "inventory-item-1",
        importance: "essential",
        aspects: ["structure"],
        atomKinds: ["primary-enclosure"],
        uncertaintyState: "certain",
        accountingState: "bound",
        accountingReason: null,
        candidateUnsupportedSignatureIds: [],
        normalizedUnsupportedSignatureIds: [],
        realizationState: "realized",
        coverageDisposition: "included",
        substitutionEdgeIds: [],
        hasDisclosure: false,
        dependsOnItemIds: []
      }],
      requirementKinds: [],
      bodyRoles: [],
      interfaceBehaviors: [],
      accessKinds: [],
      organization: [],
      measurements: [],
      blockedRequirementIds: [],
      blockedInventoryItemIds: [],
      includedSemanticIds: ["inventory-item-1"],
      changedSemanticIds: [],
      omittedSemanticIds: [],
      retainedScopeOmittedInventoryItemIds: [],
      retainedScopeOmittedRequirementIds: [],
      selectedUnsupportedSignatureIds: [],
      substitutionSearchEntered: false,
      substitutionSearchAttemptCount: 0,
      consideredSubstitutionEdgeIds: [],
      refusedSubstitutionEdgeIds: [],
      appliedSubstitutionEdgeIds: []
    },
    compiledDigest: "a".repeat(64),
    sessionDispatches: 1,
    sessionReservedExposureMicrousd: 650_000,
    globalReservedExposureBeforeMicrousd: input.index * 650_000,
    globalReservedExposureAfterMicrousd: (input.index + 1) * 650_000,
    additionalHardAnomalies: input.hardCategory === undefined ? [] : [{
      category: input.hardCategory,
      code: `EVALUATION_TEST_${input.hardCategory.replaceAll("-", "_").toUpperCase()}`
    }]
  };
}

function semanticAuthorizationRawCase(
  caseId: string,
  index: number,
): SemanticEvaluationRawCaseResult {
  return {
    ...rawCase({
      caseId,
      index,
      attempt: semanticAuthorizationAttempt(`semantic-auth-${String(index + 1)}`),
      score: null
    }),
    outcome: null,
    semanticDiagnostics: null,
    compiledDigest: null
  };
}

describe("semantic live evaluation policies", () => {
  it("accepts Git SHA-1 and SHA-256 object IDs without treating SHA-1 as a digest failure", () => {
    expect(M74_GIT_OBJECT_ID_PATTERN.test("a".repeat(40))).toBe(true);
    expect(M74_GIT_OBJECT_ID_PATTERN.test("b".repeat(64))).toBe(true);
    expect(M74_GIT_OBJECT_ID_PATTERN.test("c".repeat(39))).toBe(false);
    expect(M74_GIT_OBJECT_ID_PATTERN.test("g".repeat(40))).toBe(false);
  });

  it("pins the exact development and acceptance profiles and conservative ceilings", () => {
    expect(SEMANTIC_EVALUATION_CASE_PROFILES.development).toEqual([
      "substitution-lossy-flexure-positive-dev",
      "substitution-partitioned-flexure-positive-dev",
      "measurement-ambiguous-dev",
      "substitution-direct-support-wins-dev"
    ]);
    expect(SEMANTIC_EVALUATION_CASE_PROFILES.acceptance).toEqual([
      "m74-recovery-case-a",
      "m74-recovery-case-b"
    ]);
    expect(SEMANTIC_EVALUATION_POLICIES.development).toMatchObject({
      maximumCalls: 4,
      maximumReservedExposureMicrousd: 2_600_000,
      failFastOnQualityFailure: false,
      automaticRetry: false,
      candidateFanOut: false,
      secondModelCall: false,
      fallbackModel: false
    });
    expect(SEMANTIC_EVALUATION_POLICIES.acceptance).toMatchObject({
      maximumCalls: 2,
      maximumReservedExposureMicrousd: 1_300_000,
      failFastOnQualityFailure: true
    });
  });

  it("fails closed when the total or Call B campaign ceiling is exhausted", () => {
    expect(() => assertM74PaidDispatchAuthority(0)).toThrow(
      "M74_REMAINING_BATCH_CALL_CEILING_EXHAUSTED",
    );
    expect(() => assertM74CallBDispatchAuthority({
      maximumRemainingCalls: 1,
      callBAttemptCount: 1,
      maximumCallB: 1
    })).toThrow("M74_CALL_B_ATTEMPT_CEILING_EXHAUSTED");
    expect(() => assertM74CallBDispatchAuthority({
      maximumRemainingCalls: 1,
      callBAttemptCount: 0,
      maximumCallB: 1
    })).not.toThrow();
  });

  it("preserves sealed headroom throughout corrective development and pins cumulative authority", () => {
    expect(requiredM74HeadroomMicrousd({
      mode: "development",
      maximumRemainingCalls:
        M74_LIVE_EXPOSURE_POLICY.development.maximumCalls
    })).toBe(4_550_000);
    expect(() => assertM74HeadroomAvailable({
      mode: "development",
      maximumRemainingCalls:
        M74_LIVE_EXPOSURE_POLICY.development.maximumCalls,
      availableHeadroomMicrousd: 4_549_999
    })).toThrow("M74_REQUIRED_HEADROOM_INSUFFICIENT");
    expect(assertM74HeadroomAvailable({
      mode: "development",
      maximumRemainingCalls:
        M74_LIVE_EXPOSURE_POLICY.development.maximumCalls,
      availableHeadroomMicrousd: 4_550_000
    })).toBe(4_550_000);
    expect(requiredM74HeadroomMicrousd({
      mode: "development",
      maximumRemainingCalls: 0
    })).toBe(1_950_000);
    expect(requiredM74HeadroomMicrousd({
      mode: "acceptance",
      maximumRemainingCalls:
        M74_LIVE_EXPOSURE_POLICY.acceptance.maximumCalls
    })).toBe(1_950_000);
    expect(M74_LIVE_EXPOSURE_POLICY.acceptance).toEqual({
      maximumCallA: 2,
      maximumCallB: 1,
      maximumCalls: 3,
      maximumReservedExposureMicrousd: 1_950_000
    });
    expect(M74_CUMULATIVE_LIVE_AUTHORITY).toMatchObject({
      maximumCalls: 22,
      maximumReservedExposureMicrousd: 14_300_000
    });
    expect(
      M74_CUMULATIVE_LIVE_AUTHORITY.terminalObservedCalls +
      M74_CUMULATIVE_LIVE_AUTHORITY.replacementObservedCalls +
      M74_CUMULATIVE_LIVE_AUTHORITY.correctiveMaximumCalls +
      M74_CUMULATIVE_LIVE_AUTHORITY.acceptanceMaximumCalls,
    ).toBe(M74_CUMULATIVE_LIVE_AUTHORITY.maximumCalls);
  });

  it("preserves the consumed sealed lineage and authorizes one disjoint recovery partition", () => {
    expect(SEMANTIC_EVALUATION_CAMPAIGN_SLUG).toBe(
      "m7-4-sealed-recovery",
    );
    expect(M74_CONSUMED_SEALED_ACCEPTANCE).toMatchObject({
      campaignSlug: "m7-4-sealed-acceptance-claim-first",
      runId: "m07-4-acceptance-20260724043114-9a5e091bc173",
      caseIds: [
        "m74-hinged-keepsake-box",
        "m74-two-space-tray"
      ],
      commitmentSha256:
        "e4cea176fc75c697ad55cbefffe41dac17e0cb914499b1e12f036708001883ae",
      openingSha256:
        "4c0bde44be2989673406c11dc8882ba749ccb6bc49adb7e822e62a4b4d674d9b",
      selectionSha256:
        "44a3682a4880364484d66e1b4011244ec9281d62040f6c7ac2e0fc94fe74fb3d",
      manifestSha256:
        "c3cead2d88ab799b49f0a5e78fb2cce0b9fc36a69d9fbaad8d2478e4e49a3354",
      verifiedRegistrationSha256:
        "810c3f73e1b5f41eb17a8c2194dd8f3134a62555a0642d073f968aedafee549d",
      hardStopSha256:
        "94cef768735ff6e748fa4cc223b00e94e949f274a7d9668be2e1c0cd229d92bf",
      finalAuditSha256:
        "e833671a1eff908c6c995c27c77f07ee6a41b41747d099bbc827d720c9f6b16e",
      observedCalls: 0,
      observedReservedExposureMicrousd: 0,
      openingClaims: 1,
      partitionLoadPasses: 2,
      payloadFileReads: 4
    });
    expect(M74_SEALED_RECOVERY_IDENTITY_DELTA).toMatchObject({
      policyVersion: "m74-sealed-recovery-identity-delta@1.0.0",
      authorizationId:
        "m74-sealed-recovery-authorization-20260724",
      recoveryCaseIds: [
        "m74-recovery-case-a",
        "m74-recovery-case-b"
      ],
      semanticOrFabricationAuthorityChanged: false,
      recoveryCommitmentMayDifferFromCorrectiveCommitment: true
    });
    const consumed = new Set<string>(
      M74_SEALED_RECOVERY_IDENTITY_DELTA.consumedCaseIds,
    );
    expect(new Set(
      M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds,
    ).size).toBe(2);
    expect(
      M74_SEALED_RECOVERY_IDENTITY_DELTA.recoveryCaseIds.some(
        (caseId) => consumed.has(caseId),
      ),
    ).toBe(false);
  });

  it("continues a development batch through fail/pass/fail quality observations", async () => {
    const directory = await temporaryRunDirectory();
    const dispatched: string[] = [];
    const summary = await runSemanticEvaluationBatch({
      mode: "development",
      runId: "development-test-run",
      runDirectory: directory,
      caseIds: SEMANTIC_EVALUATION_CASE_PROFILES.development,
      executeCase: (caseId, index) => {
        dispatched.push(caseId);
        return Promise.resolve(rawCase({
          caseId,
          index,
          score: index === 0 || index === 2
            ? failingScore(caseId, index === 2 ? "concept-only" : "commitment")
            : passingScore(caseId)
        }));
      }
    });

    expect(dispatched).toHaveLength(4);
    expect(summary.executionStatus).toBe("completed");
    expect(summary.qualityStatus).toBe("fail");
    expect(summary.counts).toMatchObject({
      selected: 4,
      attempted: 4,
      dispatched: 4,
      scored: 4,
      passed: 2,
      failed: 2,
      unscored: 0,
      remaining: 0
    });
    expect(semanticEvaluationExitCode(summary)).toBe(2);
    expect(JSON.parse(await readFile(path.join(directory, "summary.json"), "utf8")))
      .toMatchObject({ executionStatus: "completed", qualityStatus: "fail" });
  });

  it("keeps scoreless semantic authorization failures in the development quality lane", () => {
    const caseId = SEMANTIC_EVALUATION_CASE_PROFILES.development[0];
    const classified = classifySemanticEvaluationCase({
      mode: "development",
      expectedCaseId: caseId,
      raw: semanticAuthorizationRawCase(caseId, 0)
    });
    expect(classified.hardAnomalies).toEqual([]);
    expect(classified.qualityFailures).toEqual([{
      category: "semantic-authorization",
      code: "EVALUATION_SEMANTIC_AUTHORIZATION_FAILURE"
    }]);
    expect(classified.qualityStatus).toBe("fail");
  });

  it("continues development after a scoreless semantic authorization failure", async () => {
    const directory = await temporaryRunDirectory();
    const dispatched: string[] = [];
    const summary = await runSemanticEvaluationBatch({
      mode: "development",
      runId: "development-semantic-authorization-run",
      runDirectory: directory,
      caseIds: SEMANTIC_EVALUATION_CASE_PROFILES.development,
      executeCase: (caseId, index) => {
        dispatched.push(caseId);
        return Promise.resolve(index === 0
          ? semanticAuthorizationRawCase(caseId, index)
          : rawCase({ caseId, index }));
      }
    });
    expect(dispatched).toEqual(SEMANTIC_EVALUATION_CASE_PROFILES.development);
    expect(summary).toMatchObject({
      executionStatus: "completed",
      qualityStatus: "fail",
      counts: {
        attempted: 4,
        dispatched: 4,
        scored: 3,
        passed: 3,
        failed: 1,
        unscored: 0,
        remaining: 0
      }
    });
  });

  it("uses the typed diagnostic outcome policy without a contradictory concept-only check", () => {
    const caseId = SEMANTIC_EVALUATION_CASE_PROFILES.development[2];
    const score = SemanticCaseOracleScoreSchema.parse({
      ...passingScore(caseId),
      outcomePolicy: {
        purpose: "semantic-diagnostic",
        allowedKinds: ["concept-only"],
        exportRequired: false
      },
      observedOutcomeKind: "concept-only"
    });
    const classified = classifySemanticEvaluationCase({
      mode: "development",
      expectedCaseId: caseId,
      raw: rawCase({
        caseId,
        index: 2,
        score,
        outcome: { kind: "concept-only", exportAllowed: false }
      })
    });
    expect(classified).toEqual({
      qualityStatus: "pass",
      qualityFailures: [],
      hardAnomalies: []
    });
  });

  it("requires export authorization for every acceptance result", () => {
    const caseId = SEMANTIC_EVALUATION_CASE_PROFILES.acceptance[0];
    const classified = classifySemanticEvaluationCase({
      mode: "acceptance",
      expectedCaseId: caseId,
      raw: rawCase({
        caseId,
        index: 0,
        outcome: { kind: "supported", exportAllowed: false }
      })
    });
    expect(classified.qualityStatus).toBe("fail");
    expect(classified.qualityFailures).toContainEqual({
      category: "outcome",
      code: "EVALUATION_ACCEPTANCE_EXPORT_REQUIRED"
    });
  });

  it.each([
    ["candidate-signature", (raw: SemanticEvaluationRawCaseResult) => {
      raw.semanticDiagnostics!.inventoryItems[0]!
        .candidateUnsupportedSignatureIds = [
          "kerf-flexure-corner-construction"
        ];
    }],
    ["normalized-signature", (raw: SemanticEvaluationRawCaseResult) => {
      raw.semanticDiagnostics!.inventoryItems[0]!
        .normalizedUnsupportedSignatureIds = [
          "kerf-flexure-corner-construction"
        ];
    }],
    ["search-entry", (raw: SemanticEvaluationRawCaseResult) => {
      raw.semanticDiagnostics!.substitutionSearchEntered = true;
    }],
    ["search-count", (raw: SemanticEvaluationRawCaseResult) => {
      raw.semanticDiagnostics!.substitutionSearchAttemptCount = 1;
    }],
    ["considered-edge", (raw: SemanticEvaluationRawCaseResult) => {
      raw.semanticDiagnostics!.consideredSubstitutionEdgeIds = [
        "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners"
      ];
    }],
    ["refused-edge", (raw: SemanticEvaluationRawCaseResult) => {
      raw.semanticDiagnostics!.refusedSubstitutionEdgeIds = [
        "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners"
      ];
    }],
    ["applied-edge", (raw: SemanticEvaluationRawCaseResult) => {
      raw.semanticDiagnostics!.appliedSubstitutionEdgeIds = [
        "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners"
      ];
    }]
  ] as const)(
    "independently fails aggregate negative-control classification for %s",
    (name, mutate) => {
      const caseId = "flexure-context-negative-control-dev";
      const score = SemanticCaseOracleScoreSchema.parse({
        ...passingScore(caseId),
        prohibitedBindingPredicates: [{
          code: "PROHIBITED_NONSTRUCTURAL_FLEXURE_SIGNATURE",
          pass: false
        }, {
          code: "PROHIBITED_NONSTRUCTURAL_SUBSTITUTION_ACTIVITY",
          pass: false
        }]
      });
      const raw = rawCase({ caseId, index: 0, score });
      mutate(raw);
      const classified = classifySemanticEvaluationCase({
        mode: "development",
        expectedCaseId: caseId,
        raw
      });
      expect(classified.qualityStatus).toBe("fail");
      expect(classified.qualityFailures).toContainEqual({
        category: "prohibited-binding",
        code: name.includes("signature")
          ? "PROHIBITED_NONSTRUCTURAL_FLEXURE_SIGNATURE"
          : "PROHIBITED_NONSTRUCTURAL_SUBSTITUTION_ACTIVITY"
      });
    },
  );

  it("keeps unrelated unsupported semantics and disclosed surface simplification out of the flexure-negative gate", () => {
    const caseId = "flexure-surface-negative-control-dev";
    const score = SemanticCaseOracleScoreSchema.parse({
      ...passingScore(caseId),
      prohibitedBindingPredicates: [{
        code: "PROHIBITED_NONSTRUCTURAL_FLEXURE_SIGNATURE",
        pass: false
      }, {
        code: "PROHIBITED_NONSTRUCTURAL_SUBSTITUTION_ACTIVITY",
        pass: false
      }]
    });
    const raw = rawCase({ caseId, index: 0, score });
    const item = raw.semanticDiagnostics!.inventoryItems[0]!;
    Object.assign(item, {
      aspects: ["surface"],
      accountingState: "unbound",
      accountingReason: "CAPABILITY_NOT_REGISTERED",
      candidateUnsupportedSignatureIds: ["future-surface-treatment"],
      normalizedUnsupportedSignatureIds: ["future-surface-treatment"],
      realizationState: "simplified",
      coverageDisposition: "changed",
      hasDisclosure: true
    });
    Object.assign(raw.semanticDiagnostics!, {
      includedSemanticIds: [],
      changedSemanticIds: ["inventory-item-1"],
      selectedUnsupportedSignatureIds: ["future-surface-treatment"]
    });

    expect(classifySemanticEvaluationCase({
      mode: "development",
      expectedCaseId: caseId,
      raw
    })).toMatchObject({
      qualityStatus: "pass",
      qualityFailures: []
    });
  });

  it("fails acceptance on the first semantic quality miss", async () => {
    const directory = await temporaryRunDirectory();
    const dispatched: string[] = [];
    const summary = await runSemanticEvaluationBatch({
      mode: "acceptance",
      runId: "acceptance-test-run",
      runDirectory: directory,
      caseIds: SEMANTIC_EVALUATION_CASE_PROFILES.acceptance,
      executeCase: (caseId, index) => {
        dispatched.push(caseId);
        return Promise.resolve(rawCase({
          caseId,
          index,
          score: failingScore(caseId)
        }));
      }
    });
    expect(dispatched).toEqual([SEMANTIC_EVALUATION_CASE_PROFILES.acceptance[0]]);
    expect(summary).toMatchObject({
      executionStatus: "aborted",
      qualityStatus: "fail",
      counts: { attempted: 1, remaining: 1 }
    });
    expect(semanticEvaluationExitCode(summary)).toBe(1);
  });

  it("fails acceptance after one scoreless semantic authorization failure", async () => {
    const directory = await temporaryRunDirectory();
    const dispatched: string[] = [];
    const summary = await runSemanticEvaluationBatch({
      mode: "acceptance",
      runId: "acceptance-semantic-authorization-run",
      runDirectory: directory,
      caseIds: SEMANTIC_EVALUATION_CASE_PROFILES.acceptance,
      executeCase: (caseId, index) => {
        dispatched.push(caseId);
        return Promise.resolve(semanticAuthorizationRawCase(caseId, index));
      }
    });
    expect(dispatched).toEqual([
      SEMANTIC_EVALUATION_CASE_PROFILES.acceptance[0]
    ]);
    expect(summary).toMatchObject({
      executionStatus: "aborted",
      qualityStatus: "fail",
      counts: {
        attempted: 1,
        dispatched: 1,
        scored: 0,
        passed: 0,
        failed: 1,
        unscored: 0,
        remaining: 1
      }
    });
    expect(summary.hardStopReason).toBeNull();
    expect(semanticEvaluationExitCode(summary)).toBe(1);
  });

  it("always writes a partial development summary after a hard stop", async () => {
    const directory = await temporaryRunDirectory();
    const summary = await runSemanticEvaluationBatch({
      mode: "development",
      runId: "development-hard-stop-run",
      runDirectory: directory,
      caseIds: SEMANTIC_EVALUATION_CASE_PROFILES.development,
      executeCase: (caseId, index) => Promise.resolve(rawCase({
        caseId,
        index,
        hardCategory: "ledger"
      }))
    });
    expect(summary).toMatchObject({
      executionStatus: "aborted",
      qualityStatus: "not-scored",
      counts: {
        selected: 4,
        attempted: 1,
        remaining: 3
      },
      hardStopReason: {
        category: "ledger",
        code: "EVALUATION_TEST_LEDGER"
      }
    });
    expect(JSON.parse(await readFile(path.join(directory, "summary.json"), "utf8")))
      .toMatchObject({ executionStatus: "aborted", counts: { remaining: 3 } });
  });

  it.each([
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
  ] as const)("hard-stops before a second case for a %s anomaly", async (category) => {
    const directory = await temporaryRunDirectory();
    let executions = 0;
    const summary = await runSemanticEvaluationBatch({
      mode: "acceptance",
      runId: `hard-${category}-test-run`,
      runDirectory: directory,
      caseIds: SEMANTIC_EVALUATION_CASE_PROFILES.acceptance,
      executeCase: (caseId, index) => {
        executions += 1;
        return Promise.resolve(rawCase({ caseId, index, hardCategory: category }));
      }
    });
    expect(executions).toBe(1);
    expect(summary.executionStatus).toBe("aborted");
    expect(summary.hardStopReason?.category).toBe(category);
    expect(summary.counts.remaining).toBe(1);
    expect(await readFile(path.join(directory, "summary.json"), "utf8"))
      .toContain(`"category": "${category}"`);
  });

  it("refuses a profile that exceeds or undershoots its fixed call ceiling", async () => {
    await expect(runSemanticEvaluationBatch({
      mode: "development",
      runId: "invalid-profile-test-run",
      runDirectory: await temporaryRunDirectory(),
      caseIds: SEMANTIC_EVALUATION_CASE_PROFILES.development.slice(0, 3),
      executeCase: (caseId, index) => Promise.resolve(rawCase({ caseId, index }))
    })).rejects.toThrow("EVALUATION_PROFILE_CALL_CEILING_MISMATCH");
  });

  it("does not resume or overwrite a run directory", async () => {
    const directory = await temporaryRunDirectory();
    const input = {
      mode: "acceptance" as const,
      runId: "exclusive-test-run",
      runDirectory: directory,
      caseIds: SEMANTIC_EVALUATION_CASE_PROFILES.acceptance,
      executeCase: (caseId: string, index: number) =>
        Promise.resolve(rawCase({ caseId, index }))
    };
    await runSemanticEvaluationBatch(input);
    await expect(runSemanticEvaluationBatch(input)).rejects.toMatchObject({
      code: "EEXIST"
    });
  });
});

describe("evaluation accounting and privacy seams", () => {
  it("attributes only attempts appended through the run-owned store wrapper", async () => {
    const store = new MemoryGenerationStore(() => Date.parse("2026-07-22T12:00:00.000Z"));
    const attributed: LiveCallAttempt[] = [];
    const owned = createRunOwnedGenerationStore(store, attributed);
    await Promise.all([
      owned.appendLedgerAttempt(completedAttempt("owned")),
      store.appendLedgerAttempt(completedAttempt("unrelated"))
    ]);
    expect(attributed.map((attempt) => attempt.attemptId)).toEqual(["attempt-owned"]);
    expect((await store.readLedgerAttempts()).map((attempt) => attempt.attemptId))
      .toEqual(expect.arrayContaining(["attempt-unrelated", "attempt-owned"]));
    expect(await store.readLedgerAttempts()).toHaveLength(2);
  });

  it("rejects raw prompts, briefs, reference bytes, and model content in evidence", async () => {
    expect(evaluationArtifactPrivacyIssues({
      promptHash: "a".repeat(64),
      nested: { brief: "private", dataUrl: "data:image/png;base64,private" }
    })).toEqual(["nested.brief", "nested.dataUrl"]);
    const file = path.join(await temporaryRunDirectory(), "private-content.json");
    await expect(writeSemanticEvaluationArtifact(file, {
      modelContent: "raw response"
    })).rejects.toThrow("EVALUATION_ARTIFACT_PRIVACY_VIOLATION:modelContent");
  });

  it("retains only item ids and atom kinds from the authorized semantic candidate", () => {
    const privateClaim = "private model-authored semantic description";
    const candidate: SemanticInterpretationCandidate = {
      schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
      atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
      items: [{
        claim: privateClaim,
        importance: "essential",
        evidenceBindings: [{
          evidenceId: "brief-main",
          aspect: "structure",
          support: "direct"
        }],
        relationships: [],
        measurements: [],
        state: "bound",
        atoms: [{
          kind: "primary-enclosure",
          enclosure: {
            priority: "must",
            quantity: null,
            evidenceIds: ["brief-main"]
          },
          access: {
            kind: "open-top",
            priority: "must",
            evidenceIds: ["brief-main"]
          },
          space: {
            layout: "minimum-separated",
            priority: "must",
            evidenceIds: ["brief-main"]
          }
        }]
      }]
    };
    const safeMap = semanticCandidateAtomKindsByItemId(candidate);
    expect([...safeMap.entries()]).toEqual([
      ["inventory-item-1", ["primary-enclosure"]]
    ]);
    expect(JSON.stringify([...safeMap.entries()])).not.toContain(privateClaim);
    const serializedResult = JSON.stringify(rawCase({
      caseId: "privacy-test-case",
      index: 0
    }));
    expect(serializedResult).toContain('"atomKinds":["primary-enclosure"]');
    expect(serializedResult).not.toMatch(/"(?:claim|prompt|modelContent)":/u);
  });

  it("records only run-owned usage, cost, and exposure in aggregate totals", async () => {
    const directory = await temporaryRunDirectory();
    const summary = await runSemanticEvaluationBatch({
      mode: "acceptance",
      runId: "aggregate-test-run",
      runDirectory: directory,
      caseIds: SEMANTIC_EVALUATION_CASE_PROFILES.acceptance,
      executeCase: (caseId, index) => Promise.resolve(rawCase({ caseId, index }))
    });
    expect(summary.aggregate).toMatchObject({
      inputTokens: 200,
      outputTokens: 100,
      reasoningTokens: 40,
      latencyMs: 200,
      confirmedEstimatedCostMicrousd: 4_000,
      runOwnedReservedExposureMicrousd: 1_300_000
    });
    expect(summary.counts.dispatched).toBe(2);
  });

  it("pins the final sealed-recovery namespace, identity boundary, and root execution configs", async () => {
    const source = await readFile(
      path.resolve("tools/run-live-semantic-evaluation.ts"),
      "utf8",
    );
    expect(semanticEvaluationSelectionFileName("development")).toBe(
      "semantic-evaluation-m7-4-sealed-recovery-development-selection.json",
    );
    expect(semanticEvaluationSelectionFileName("acceptance")).toBe(
      "semantic-evaluation-m7-4-sealed-recovery-acceptance-selection.json",
    );
    expect(semanticEvaluationSelectionFileName("development")).not.toBe(
      M74_TERMINAL_DEVELOPMENT.selectionFileName,
    );
    expect(semanticEvaluationSelectionFileName("development")).not.toBe(
      M74_REPLACEMENT_DEVELOPMENT.selectionFileName,
    );
    expect(semanticEvaluationSelectionFileName("development")).not.toBe(
      M74_BURNED_CORRECTIVE_PREPARATION.selectionFileName,
    );
    expect(semanticEvaluationSelectionFileName("development")).not.toBe(
      M74_CORRECTIVE_DEVELOPMENT.selectionFileName,
    );
    expect(semanticEvaluationSelectionFileName("acceptance")).not.toBe(
      M74_BURNED_ACCEPTANCE_PREPARATION.selectionFileName,
    );
    expect(semanticEvaluationSelectionFileName("acceptance")).not.toBe(
      M74_CONSUMED_SEALED_ACCEPTANCE.selectionFileName,
    );
    expect(source).toContain(
      "docs/evidence/m07-4/sealed-recovery-partition-commitment.json",
    );
    expect(source).toContain(
      "docs/evidence/m07-4/sealed-recovery-partition-opening.json",
    );
    expect(source).toContain(
      "docs/evidence/m07-4/sealed-recovery-preparation-claim.json",
    );
    expect(source).toContain('"execution-claim.json"');
    expect(source).toContain('command: "npm run verify"');
    expect(source).toContain('spawnSync("npm", ["run", "verify"]');
    expect(source).toContain("developmentGate");
    expect(source).toContain("M74_ACCEPTANCE_DEVELOPMENT_GATE_DRIFT");
    expect(source).toContain("durableStoreIdentityHash");
    expect(source).toContain("sealedCommitmentRecordHash");
    expect(source).toContain("billingReconciliationsHash");
    expect(source).toContain("M74_DURABLE_LEDGER_PREFIX_DRIFT");
    expect(source).toContain("M74_CUMULATIVE_AUTHORITY_EXCEEDED");
    expect(source).toContain("M74_RECOVERY_CASE_IDS_INVALID");
    expect(source).toContain(
      "M74_RECOVERY_EVALUATION_CLASS_PARTITION_INVALID",
    );
    expect(source).toContain("M74_CORRECTIVE_DEVELOPMENT_ALREADY_COMPLETE");
    expect(M74_ACCEPTANCE_CLAIM_FIRST_IDENTITY_DELTA)
      .toMatchObject({
        invariantFileCount: 340,
        allowedChangedSourcePaths: [
          "tests/evaluation/semantic-live-evaluator.test.ts",
          "tools/run-live-semantic-evaluation.ts",
          "tools/semantic-evaluation-profile.ts"
        ]
      });
    expect(M74_SEALED_RECOVERY_IDENTITY_DELTA).toMatchObject({
      authorizationBaselineSupplementSha256:
        "0375372eff02a0d339e5869fff577d7a1359fde0259fbcfc523f820cdbae1452",
      preimplementationInvariantFileCount: 347,
      preimplementationInvariantSourceStateHash:
        "90909a145d999247187b7c1e8b5d038d4ba97c4f4bc4d38b43a414819825dffa",
      sealedPartitionSourceSha256:
        "d0369b058c3e371ce6d2d00605cecdb53e666a8e34b014dcdb843ef20b52d249",
      semanticOrFabricationAuthorityChanged: false
    });
    expect(M74_SEALED_RECOVERY_ROOT_BINDING_DOMAIN).toBe(
      "sketchycut-m74-sealed-recovery-canonical-root@1.0.0",
    );
    expect(M74_SEALED_RECOVERY_FROZEN_DURABLE_PREFIX).toEqual({
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
    });
    for (const configFile of [
      "eslint.config.mjs",
      "next-env.d.ts",
      "next.config.ts",
      "playwright.config.ts",
      "playwright.deployment.config.ts",
      "playwright.live-probe.config.ts",
      "tsconfig.build.json",
      "tsconfig.json",
      "vitest.config.ts"
    ]) {
      expect(source).toContain(`"${configFile}"`);
    }
    expect(source).toContain("packageLockHash");
    expect(source).toContain("assertM74HeadroomAvailable");
    expect(source).toContain("durableExposureCeilingMicrousd = 72_550_000");
    expect(source).not.toContain("authorizeGlobalExposure(");
    expect(source).not.toContain("automaticRetry: true");
  });

  it("binds the final freeze, builder attestation, and opaque input root before opening", async () => {
    const source = await readFile(
      path.resolve("tools/run-live-semantic-evaluation.ts"),
      "utf8",
    );
    const functionSource = (name: string): string => {
      const start = source.indexOf(`async function ${name}(`);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = source.indexOf("\nasync function ", start + 1);
      return source.slice(start, next === -1 ? source.length : next);
    };
    const sourceRegion = (
      startMarker: string,
      endMarker: string,
    ): string => {
      const start = source.indexOf(startMarker);
      const end = source.indexOf(endMarker, start + 1);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end);
    };

    const freezeSchema = sourceRegion(
      "const RecoveryExecutionIdentityFreezeSchema",
      "const RecoveryBuilderAttestationSchema",
    );
    expect(freezeSchema).toContain(
      "sketchycut-m74-sealed-recovery-execution-identity-freeze@1.0.0",
    );
    expect(freezeSchema).toContain(
      "durablePrefix: RecoveryFrozenDurablePrefixSchema",
    );
    expect(freezeSchema).toContain(
      "consumedLineage: RecoveryConsumedLineageFreezeSchema",
    );
    expect(freezeSchema).toContain(
      "infrastructureFileSha256",
    );
    expect(freezeSchema).toContain(
      "executionAffectingSourceComplement",
    );
    expect(freezeSchema).toContain("authorizationFreezeSha256");

    const authorizationBaseline = functionSource(
      "assertRecoveryAuthorizationBaseline",
    );
    expect(source).toContain(
      "docs/evidence/m07-4/reports/sealed-recovery-authorization-freeze.json",
    );
    expect(authorizationBaseline).toContain(
      "recoveryAuthorizationFreezePath",
    );
    expect(authorizationBaseline).toContain(
      "M74_SEALED_RECOVERY_IDENTITY_DELTA.authorizationFreezeSha256",
    );
    expect(authorizationBaseline).toContain(
      "M74_RECOVERY_AUTHORIZATION_FREEZE_DRIFT",
    );

    const attestationSchema = sourceRegion(
      "const RecoveryBuilderAttestationSchema",
      "const RecoveryBuilderAttestationBindingSchema",
    );
    for (const field of [
      "validationCompletedAt",
      "ingestionCompletedAt",
      "independentAuthorRole",
      "independentlyAuthored",
      "validationPassed",
      "ingestionPassed",
      "createdAfterExecutionFreeze",
      "nonOverwritingCommitment",
      "nonOverwritingAttestation",
      "codexPayloadAccess",
      "retryAuthorized",
      "replacementAuthorized",
      "furtherCampaignAuthorized",
      "executionIdentityFreezeRecordSha256",
      "commitmentRecordSha256",
      "commitmentSha256",
      "externalRootBinding",
      "canonicalRealpathSha256"
    ]) {
      expect(attestationSchema).toContain(field);
    }
    expect(attestationSchema).toContain(
      "sketchycut-m74-sealed-recovery-builder-attestation@1.0.0",
    );
    expect(source).toContain(
      "docs/evidence/m07-4/sealed-recovery-builder-attestation.json",
    );

    const attestation = functionSource(
      "assertRecoveryBuilderAttestation",
    );
    expect(attestation).toContain(
      "attestation.executionIdentityFreezeRecordSha256",
    );
    expect(attestation).toContain(
      "attestation.commitmentRecordSha256",
    );
    expect(attestation).toContain(
      "attestation.commitmentSha256",
    );
    expect(attestation).toContain("validationTime <= freezeTime");
    expect(attestation).toContain("authorizationTime <= freezeTime");
    expect(attestation).toContain("ingestionTime < validationTime");
    expect(attestation).toContain("attestationTime < ingestionTime");

    const rootBinding = functionSource(
      "preflightAndBindRecoveryInputRoot",
    );
    expect(rootBinding).toContain("lstat(input.inputRoot)");
    expect(rootBinding).toContain("realpath(input.inputRoot)");
    expect(rootBinding).toContain(
      "M74_SEALED_RECOVERY_ROOT_BINDING_DOMAIN",
    );
    expect(rootBinding).toContain("\\u0000");
    expect(rootBinding).toContain(
      "M74_RECOVERY_EXTERNAL_ROOT_BINDING_MISMATCH",
    );
    expect(rootBinding).not.toContain("sealed-partition.json");
    expect(rootBinding).not.toContain("readFile(");
    expect(rootBinding).not.toContain(
      "verifySealedPartitionCommitment(",
    );
    expect(rootBinding).not.toContain(
      "readSealedPartitionCommitment(",
    );
    expect(rootBinding).not.toContain("claimSealedPartitionOpening(");

    const preaccess = functionSource("preAccessChecks");
    expect(preaccess.indexOf("await assertFrozenPreAccess("))
      .toBeLessThan(
        preaccess.indexOf("await preflightAndBindRecoveryInputRoot("),
      );
    expect(preaccess).toContain("boundInputRoot");

    const claimedExecution = functionSource(
      "executeClaimedRecovery",
    );
    expect(claimedExecution.indexOf("await preAccessChecks("))
      .toBeLessThan(claimedExecution.indexOf("await runAcceptance("));
    expect(claimedExecution).toContain(
      "inputRoot: preAccess.boundInputRoot",
    );
    expect(claimedExecution).toContain(
      "selection.executionIdentityFreezeSha256",
    );
    expect(claimedExecution).toContain(
      "manifest.executionIdentityFreezeSha256",
    );
    expect(claimedExecution).toContain(
      "selection.builderAttestationSha256",
    );
    expect(claimedExecution).toContain(
      "manifest.builderAttestationSha256",
    );

    const claimedPreparation = functionSource(
      "prepareClaimedRecovery",
    );
    expect(claimedPreparation).toContain(
      "executionIdentityFreezeSha256:",
    );
    expect(claimedPreparation).toContain(
      "executionFreeze.recordSha256",
    );
    expect(claimedPreparation).toContain(
      "builderAttestationSha256:",
    );
    expect(claimedPreparation).toContain(
      "builderAttestation.binding.recordSha256",
    );
    expect(claimedPreparation).toContain(
      "manifest.executionIdentityFreezeSha256",
    );
    expect(claimedPreparation).toContain(
      "manifest.builderAttestationSha256",
    );

    const consumedLineage = functionSource(
      "consumedSealedAcceptanceLineage",
    );
    expect(consumedLineage).not.toContain("inputRoot");
    expect(consumedLineage).not.toContain("loadSealedPartition(");
    expect(consumedLineage).not.toContain(
      "verifySealedPartitionCommitment(",
    );
    expect(consumedLineage).not.toContain("realpath(");

    const handoff = await readFile(
      path.resolve("tools/SEALED_SEMANTIC_EVALUATION.md"),
      "utf8",
    );
    const handoffStart = handoff.indexOf(
      "## Builder attestation and opaque root binding",
    );
    const handoffEnd = handoff.indexOf(
      "After successful ingestion, provide Codex",
      handoffStart,
    );
    const attestationHandoff = handoff.slice(
      handoffStart,
      handoffEnd,
    );
    expect(handoffStart).toBeGreaterThanOrEqual(0);
    expect(handoffEnd).toBeGreaterThan(handoffStart);
    expect(handoff).toContain(
      "RECOVERY_VALIDATION_COMPLETED_AT",
    );
    expect(attestationHandoff).toContain("randomBytes(32)");
    expect(attestationHandoff).toContain("realpath(rootInput)");
    expect(attestationHandoff).toContain(
      "executionIdentityFreezeRecordSha256: sha256(freezeBytes)",
    );
    expect(attestationHandoff).toContain(
      "commitmentRecordSha256: sha256(commitmentBytes)",
    );
    expect(attestationHandoff).toContain(
      "canonicalRealpathSha256",
    );
    expect(attestationHandoff).toContain('{ flag: "wx", mode: 0o600 }');
    expect(attestationHandoff).toContain(
      "SEALED_RECOVERY_BUILDER_ATTESTATION_FAILED",
    );
    expect(attestationHandoff.split("readFile(")).toHaveLength(3);
    expect(attestationHandoff).not.toContain("sealed-partition.json");
    expect(attestationHandoff).not.toContain("case-a.json");
    expect(attestationHandoff).not.toContain("case-b.json");
  });

  it("claims preparation and execution atomically, then opens and loads exactly once", async () => {
    const source = await readFile(
      path.resolve("tools/run-live-semantic-evaluation.ts"),
      "utf8",
    );
    const functionSource = (name: string): string => {
      const start = source.indexOf(`async function ${name}(`);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = source.indexOf("\nasync function ", start + 1);
      return source.slice(start, next === -1 ? source.length : next);
    };
    const sourceRegion = (
      startMarker: string,
      endMarker: string,
    ): string => {
      const start = source.indexOf(startMarker);
      const end = source.indexOf(endMarker, start + 1);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end);
    };
    const count = (value: string, needle: string): number =>
      value.split(needle).length - 1;

    const preparationClaim = functionSource("claimRecoveryPreparation");
    const executionClaim = functionSource("claimRecoveryExecution");
    expect(preparationClaim).toContain('flag: "wx"');
    expect(executionClaim).toContain('flag: "wx"');

    const prepare = functionSource("prepareRun");
    expect(prepare.indexOf("await claimRecoveryPreparation("))
      .toBeLessThan(prepare.indexOf("await prepareClaimedRecovery("));
    expect(prepare.indexOf("await claimRecoveryPreparation("))
      .toBeLessThan(
        prepare.indexOf("recordRecoveryPreparationTerminalStop("),
      );
    const claimedPreparation = functionSource(
      "prepareClaimedRecovery",
    );
    expect(claimedPreparation).toContain("runOfflineGate()");
    expect(claimedPreparation).toContain("loadLocalEnvironment()");

    const execute = functionSource("executeRun");
    expect(execute.indexOf("readFile(selectionPath("))
      .toBeLessThan(execute.indexOf("await claimRecoveryExecution("));
    expect(execute.indexOf("await claimRecoveryExecution("))
      .toBeLessThan(execute.indexOf("await executeClaimedRecovery("));
    expect(execute.indexOf("await claimRecoveryExecution("))
      .toBeLessThan(execute.indexOf("recordRecoveryExecutionStop("));
    const claimedExecution = functionSource(
      "executeClaimedRecovery",
    );
    expect(claimedExecution.indexOf("await preAccessChecks("))
      .toBeLessThan(claimedExecution.indexOf("await runAcceptance("));
    expect(claimedExecution.indexOf(
      'readFile(callBPromptPath, "utf8")',
    )).toBeLessThan(claimedExecution.indexOf("await runAcceptance("));
    expect(claimedExecution.indexOf(
      "manifest.identities.callBPromptHash",
    )).toBeLessThan(claimedExecution.indexOf("await runAcceptance("));
    expect(claimedExecution).toContain("await sha256(callBPrompt)");

    const acceptance = functionSource("runAcceptance");
    const openingIndex = acceptance.indexOf(
      "await claimVerifiedRecoveryOpening(",
    );
    const loadIndex = acceptance.indexOf(
      "await verifyAndLoadRecoveryOnce(",
    );
    expect(openingIndex).toBeGreaterThanOrEqual(0);
    expect(openingIndex).toBeLessThan(loadIndex);
    expect(count(acceptance, "verifyAndLoadRecoveryOnce(")).toBe(1);
    expect(count(acceptance, "input.inputRoot")).toBe(1);
    expect(acceptance).not.toContain("callBPromptPath");
    expect(acceptance.indexOf("await verifyAndLoadRecoveryOnce("))
      .toBeLessThan(
        acceptance.indexOf("await bindVerifiedSealedRegistration("),
      );
    expect(acceptance.indexOf("await bindVerifiedSealedRegistration("))
      .toBeLessThan(acceptance.indexOf("await executeCallA("));

    const receiptSchema = sourceRegion(
      "const SealedReadReceiptSchema",
      "const ManifestSchema",
    );
    expect(receiptSchema).toContain("verifierInvocations: z.literal(1)");
    expect(receiptSchema).toContain(
      "externalManifestByteReads: z.literal(1)",
    );
    expect(receiptSchema).toContain(
      "externalCasePayloadByteReads: z.literal(2)",
    );
    expect(receiptSchema).toContain(
      "totalExternalByteReads: z.literal(3)",
    );

    const verifier = functionSource("verifyAndLoadRecoveryOnce");
    expect(count(verifier, "verifySealedPartitionCommitment(")).toBe(1);
    expect(count(verifier, '"sealed-read-receipt.json"')).toBe(1);
    expect(verifier).toContain(
      "sketchycut-m74-sealed-recovery-read-receipt@1.0.0",
    );
    expect(verifier).toContain("SealedReadReceiptSchema.parse");
    expect(verifier).toContain("partitionId: commitment.partitionId");
    expect(verifier).toContain(
      "commitmentSha256: commitment.commitmentSha256",
    );
    expect(verifier).toContain(
      "commitmentRecordSha256:",
    );
    expect(verifier).toContain(
      "manifest.identities.sealedCommitmentRecordHash",
    );
    expect(verifier).toContain("caseIds: commitment.caseIds");
    expect(verifier).toContain("let verifierInvocations = 0");
    expect(verifier).toContain("verifierInvocations += 1");
    expect(verifier).toContain("accessState.verifierInvoked = true");
    expect(verifier).toContain(
      "externalManifestByteReads = verifierInvocations",
    );
    expect(verifier).toContain(
      "externalCasePayloadByteReads = observedPayloads.reduce",
    );
    expect(verifier).toContain(
      "totalExternalByteReads =",
    );
    expect(verifier).toContain("verifierInvocations,");
    expect(verifier).toContain("externalManifestByteReads,");
    expect(verifier).toContain("externalCasePayloadByteReads,");
    expect(verifier).toContain("totalExternalByteReads,");
    expect(verifier).toContain(
      'derivation: "single-frozen-helper-invocation"',
    );
    expect(verifier).toContain(
      "totalPayloadBytes: observedTotalPayloadBytes",
    );
    expect(verifier).toContain("value: opening");
    expect(verifier).toContain(
      "byteCount: openingClaim.bytes.byteLength",
    );
    expect(verifier).toContain(
      "sha256: openingClaim.recordSha256",
    );
    expect(verifier).toContain(
      "byteCount: verified.manifestBytes.byteLength",
    );
    expect(verifier).toContain(
      "sha256: observedManifestSha256",
    );
    expect(verifier).toContain(
      "externalCasePayloads: observedPayloads",
    );
    expect(verifier).toContain("partitionManifestVersion:");
    expect(verifier).toContain("semanticCaseVersion:");
    expect(verifier).toContain("commitmentVersion:");
    expect(verifier).toContain("openingVersion:");
    expect(verifier).toContain("callAProviderContractSourceHash:");
    expect(verifier).toContain("callBProviderContractSourceHash:");
    expect(verifier).toContain("modelConfigurationHash:");
    expect(verifier).toContain("recoveryIdentityHash:");
    expect(verifier).toContain("sealedPartitionSourceSha256:");
    expect(verifier).toContain("snapshotHeldInMemory: true");
    expect(verifier).toContain("postSnapshotExternalReads: 0");
    expect(verifier).toContain(
      "M74_RECOVERY_READ_RECEIPT_OBSERVATION_DRIFT",
    );
    expect(verifier).toContain("accessState.receipt = receipt");
    expect(verifier).toContain(
      "accessState.receiptRecordSha256 = await sha256(receiptBytes)",
    );
    expect(verifier).toContain("accessState.receiptWritten = true");
    expect(verifier.indexOf("verifySealedPartitionCommitment("))
      .toBeLessThan(verifier.indexOf("const receipt ="));
    expect(verifier.indexOf("const receipt ="))
      .toBeLessThan(verifier.indexOf('"sealed-read-receipt.json"'));

    const openingClaim = functionSource(
      "claimVerifiedRecoveryOpening",
    );
    expect(openingClaim).toContain("artifactBytes(opening)");
    expect(openingClaim).toContain("await sha256(bytes)");
    expect(openingClaim).toContain("recoveryOpeningPath");
    expect(openingClaim).toContain('flag: "wx"');
    expect(openingClaim).toContain(
      "accessState.openingRecordSha256 = recordSha256",
    );
    expect(openingClaim).not.toContain(
      "readSealedPartitionCommitment(",
    );
    expect(openingClaim).not.toContain(
      "readSealedPartitionOpening(",
    );

    const afterLoad = acceptance.slice(loadIndex);
    expect(afterLoad).not.toContain("readSealedPartitionCommitment(");
    expect(afterLoad).not.toContain("readSealedPartitionOpening(");
    expect(afterLoad).not.toContain("claimVerifiedRecoveryOpening(");
    expect(afterLoad).not.toContain("callBPromptPath");

    const postOpening = functionSource("postOpeningDispatchChecks");
    expect(postOpening).not.toContain("preAccessChecks(");
    expect(postOpening).not.toContain("assertFrozen(");
    expect(postOpening).not.toContain("readSealedPartitionCommitment(");
    expect(postOpening).not.toContain("readSealedPartitionOpening(");
    expect(postOpening).not.toContain("verifySealedPartitionCommitment(");
    expect(postOpening).not.toContain("inputRoot");

    const preparationStop = functionSource(
      "recordRecoveryPreparationTerminalStop",
    );
    const executionStopAdapter = functionSource(
      "recordRecoveryExecutionStop",
    );
    const executionStop = functionSource(
      "writeRecoveryExecutionTerminalStop",
    );
    expect(preparationStop).toContain("safeHardAnomaly(error)");
    expect(preparationStop).toContain("retryAuthorized: false");
    expect(preparationStop).toContain("replacementAuthorized: false");
    expect(preparationStop).toContain("furtherCampaignAuthorized: false");
    expect(preparationStop).toContain('flag: "wx"');
    expect(preparationStop).not.toContain("inputRoot");
    expect(preparationStop).not.toContain("String(error)");
    expect(preparationStop).toContain(
      "recoveryPreparationTerminalStopPath",
    );
    expect(executionStopAdapter).toContain("safeHardAnomaly(error)");
    expect(executionStopAdapter).toContain(
      "writeRecoveryExecutionTerminalStop(",
    );
    expect(executionStop).toContain(
      "sketchycut-m74-sealed-recovery-execution-stop@1.0.0",
    );
    expect(executionStop).toContain("sealedAccess:");
    expect(executionStop).toContain("openingClaimed:");
    expect(executionStop).toContain("verifierInvoked:");
    expect(executionStop).toContain("readReceiptObserved:");
    expect(executionStop).toContain("readReceiptWritten:");
    expect(executionStop).toContain("runAccounting:");
    expect(executionStop).toContain("retryAuthorized: false");
    expect(executionStop).toContain("replacementAuthorized: false");
    expect(executionStop).toContain("furtherCampaignAuthorized: false");
    expect(executionStop).toContain('flag: "wx"');
    expect(executionStop).not.toContain("inputRoot");
    expect(executionStop).not.toContain("String(error)");
    expect(executionStop).toContain('"terminal-stop.json"');

    const caughtAnomaly = claimedExecution.lastIndexOf(
      "hardStop = safeHardAnomaly(error)",
    );
    const terminalStop = claimedExecution.indexOf(
      "await writeRecoveryExecutionTerminalStop(",
    );
    const summary = claimedExecution.indexOf(
      "const summary = RunSummarySchema.parse(",
    );
    expect(caughtAnomaly).toBeGreaterThanOrEqual(0);
    expect(caughtAnomaly).toBeLessThan(terminalStop);
    expect(terminalStop).toBeLessThan(summary);
    expect(claimedExecution).toContain(
      "context: input.terminalContext",
    );
  });

  it("pins immutable lineage metadata without depending on ignored evidence", () => {
    const lineageHashes = [
      M74_TERMINAL_DEVELOPMENT.selectionSha256,
      M74_TERMINAL_DEVELOPMENT.manifestSha256,
      M74_TERMINAL_DEVELOPMENT.summarySha256,
      M74_REPLACEMENT_DEVELOPMENT.selectionSha256,
      M74_REPLACEMENT_DEVELOPMENT.manifestSha256,
      M74_REPLACEMENT_DEVELOPMENT.summarySha256,
      M74_BURNED_CORRECTIVE_PREPARATION.selectionSha256,
      M74_BURNED_CORRECTIVE_PREPARATION.manifestSha256,
      M74_BURNED_CORRECTIVE_PREPARATION.reportSha256,
      M74_CORRECTIVE_DEVELOPMENT.selectionSha256,
      M74_CORRECTIVE_DEVELOPMENT.manifestSha256,
      M74_CORRECTIVE_DEVELOPMENT.summarySha256,
      M74_BURNED_ACCEPTANCE_PREPARATION.selectionSha256,
      M74_BURNED_ACCEPTANCE_PREPARATION.manifestSha256,
      M74_BURNED_ACCEPTANCE_PREPARATION.reportSha256,
      M74_CONSUMED_SEALED_ACCEPTANCE.commitmentSha256,
      M74_CONSUMED_SEALED_ACCEPTANCE.openingSha256,
      M74_CONSUMED_SEALED_ACCEPTANCE.selectionSha256,
      M74_CONSUMED_SEALED_ACCEPTANCE.manifestSha256,
      M74_CONSUMED_SEALED_ACCEPTANCE.verifiedRegistrationSha256,
      M74_CONSUMED_SEALED_ACCEPTANCE.hardStopSha256,
      M74_CONSUMED_SEALED_ACCEPTANCE.finalAuditSha256
    ];
    expect(lineageHashes).toHaveLength(22);
    expect(lineageHashes.every((hash) => /^[a-f0-9]{64}$/u.test(hash)))
      .toBe(true);

    const runIds = [
      M74_TERMINAL_DEVELOPMENT.runId,
      M74_REPLACEMENT_DEVELOPMENT.runId,
      M74_BURNED_CORRECTIVE_PREPARATION.runId,
      M74_CORRECTIVE_DEVELOPMENT.runId,
      M74_BURNED_ACCEPTANCE_PREPARATION.runId,
      M74_CONSUMED_SEALED_ACCEPTANCE.runId
    ];
    expect(new Set(runIds).size).toBe(runIds.length);

    const recordPaths = [
      M74_TERMINAL_DEVELOPMENT.selectionFileName,
      M74_REPLACEMENT_DEVELOPMENT.selectionFileName,
      M74_BURNED_CORRECTIVE_PREPARATION.selectionFileName,
      M74_BURNED_CORRECTIVE_PREPARATION.reportFileName,
      M74_CORRECTIVE_DEVELOPMENT.selectionFileName,
      M74_BURNED_ACCEPTANCE_PREPARATION.selectionFileName,
      M74_BURNED_ACCEPTANCE_PREPARATION.reportFileName,
      M74_CONSUMED_SEALED_ACCEPTANCE.commitmentFileName,
      M74_CONSUMED_SEALED_ACCEPTANCE.openingFileName,
      M74_CONSUMED_SEALED_ACCEPTANCE.selectionFileName,
      M74_CONSUMED_SEALED_ACCEPTANCE.hardStopFileName,
      M74_CONSUMED_SEALED_ACCEPTANCE.finalAuditFileName,
      semanticEvaluationSelectionFileName("acceptance")
    ];
    expect(new Set(recordPaths).size).toBe(recordPaths.length);
  });
});
