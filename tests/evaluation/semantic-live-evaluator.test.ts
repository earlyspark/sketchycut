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
        accountingReason: null
      }],
      requirementKinds: [],
      bodyRoles: [],
      interfaceBehaviors: [],
      accessKinds: [],
      organization: [],
      measurements: [],
      blockedRequirementIds: [],
      blockedInventoryItemIds: []
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
  it("pins the exact development and acceptance profiles and conservative ceilings", () => {
    expect(SEMANTIC_EVALUATION_CASE_PROFILES.development).toEqual([
      "paraphrase-open-access-dev",
      "functional-name-separation-dev",
      "bare-storage-name-nonorganization-dev",
      "implicit-open-separation-organization-dev",
      "organization-count-composite-control-dev",
      "organization-grid-composite-control-dev",
      "storage-purpose-nonorganization-control-dev",
      "storage-context-nonorganization-control-dev",
      "reference-role-purpose-control-dev",
      "measurement-ordinary-dev"
    ]);
    expect(SEMANTIC_EVALUATION_CASE_PROFILES.acceptance).toEqual([
      "paraphrase-open-access-dev",
      "functional-name-separation-dev",
      "bare-storage-name-nonorganization-dev",
      "reference-role-purpose-control-dev",
      "measurement-ordinary-dev"
    ]);
    expect(SEMANTIC_EVALUATION_POLICIES.development).toMatchObject({
      maximumCalls: 10,
      maximumReservedExposureMicrousd: 6_500_000,
      failFastOnQualityFailure: false,
      automaticRetry: false,
      candidateFanOut: false,
      secondModelCall: false,
      fallbackModel: false
    });
    expect(SEMANTIC_EVALUATION_POLICIES.acceptance).toMatchObject({
      maximumCalls: 5,
      maximumReservedExposureMicrousd: 3_250_000,
      failFastOnQualityFailure: true
    });
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

    expect(dispatched).toHaveLength(10);
    expect(summary.executionStatus).toBe("completed");
    expect(summary.qualityStatus).toBe("fail");
    expect(summary.counts).toMatchObject({
      selected: 10,
      attempted: 10,
      dispatched: 10,
      scored: 10,
      passed: 8,
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
        attempted: 10,
        dispatched: 10,
        scored: 9,
        passed: 9,
        failed: 1,
        unscored: 0,
        remaining: 0
      }
    });
  });

  it("uses the typed diagnostic outcome policy without a contradictory concept-only check", () => {
    const caseId = SEMANTIC_EVALUATION_CASE_PROFILES.development[4];
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
        index: 4,
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
      counts: { attempted: 1, remaining: 4 }
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
        remaining: 4
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
        selected: 10,
        attempted: 1,
        remaining: 9
      },
      hardStopReason: {
        category: "ledger",
        code: "EVALUATION_TEST_LEDGER"
      }
    });
    expect(JSON.parse(await readFile(path.join(directory, "summary.json"), "utf8")))
      .toMatchObject({ executionStatus: "aborted", counts: { remaining: 9 } });
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
    expect(summary.counts.remaining).toBe(4);
    expect(await readFile(path.join(directory, "summary.json"), "utf8"))
      .toContain(`"category": "${category}"`);
  });

  it("refuses a profile that exceeds or undershoots its fixed call ceiling", async () => {
    await expect(runSemanticEvaluationBatch({
      mode: "development",
      runId: "invalid-profile-test-run",
      runDirectory: await temporaryRunDirectory(),
      caseIds: SEMANTIC_EVALUATION_CASE_PROFILES.development.slice(0, 9),
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
    const privateClaim = "private model-authored organizer description";
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
      inputTokens: 500,
      outputTokens: 250,
      reasoningTokens: 100,
      latencyMs: 500,
      confirmedEstimatedCostMicrousd: 10_000,
      runOwnedReservedExposureMicrousd: 3_250_000
    });
    expect(summary.counts.dispatched).toBe(5);
  });

  it("keeps the functional-name-correction lane distinct, one-shot, full-verify-gated, and acceptance-gated by 10/10 development", async () => {
    const source = await readFile(
      path.resolve("tools/run-live-semantic-evaluation.ts"),
      "utf8",
    );
    expect(semanticEvaluationSelectionFileName("development")).toBe(
      "semantic-evaluation-functional-name-correction-development-selection.json",
    );
    expect(semanticEvaluationSelectionFileName("acceptance")).toBe(
      "semantic-evaluation-functional-name-correction-acceptance-selection.json",
    );
    expect(semanticEvaluationSelectionFileName("development")).not.toBe(
      "semantic-evaluation-development-selection.json",
    );
    expect(source).toContain(
      "sketchycut-semantic-evaluation-functional-name-correction-selection@1.0.0",
    );
    expect(source).toContain("existsSync(selectionPath(mode))");
    expect(source).toContain('command: "npm run verify"');
    expect(source).toContain('spawnSync("npm", ["run", "verify"]');
    expect(source).toContain("acceptanceDevelopmentGate");
    expect(source).toContain("summary.counts.passed !== 10");
    expect(source).toContain("EVALUATION_ACCEPTANCE_DIAGNOSTIC_IDENTITY_MISMATCH");
    expect(source).toContain("durableStoreIdentityHash");
    expect(source).toContain("packageLockHash");
    expect(source).toContain("EVALUATION_EXISTING_HEADROOM_INSUFFICIENT");
    expect(source).not.toContain("authorizeGlobalExposure(");
    expect(source).not.toContain("automaticRetry: true");
  });
});
