import { describe, expect, it } from "vitest";

import { hashCanonical, sha256 } from "../../src/domain/hash.js";
import {
  applySemanticReviewPatch,
  classifySemanticReviewTriggers,
  CURRENT_BOUNDED_SEMANTIC_REVIEW_PROMPT_IDENTITY,
  CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION
} from "../../src/evaluation/bounded-semantic-review.js";
import { DispatchOnlySemanticCache } from "../../src/evaluation/dispatch-only-semantic-cache.js";
import {
  aggregatePairedSemanticReviewResults,
  buildPairedSemanticReviewCaseResult,
  PAIRED_SEMANTIC_REVIEW_THRESHOLDS
} from "../../src/evaluation/paired-semantic-review-evaluator.js";
import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION
} from "../../src/interpretation/semantic-atom-registry.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  SemanticInterpretationCandidateSchema,
  type SemanticInterpretationCandidate
} from "../../src/interpretation/semantic-model-contract.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
  GenerationSubmissionSchema
} from "../../src/interpretation/generation-submission.js";
import {
  CURRENT_PROMPT_LAYOUT_VERSION
} from "../../src/interpretation/semantic-input-contracts.js";
import {
  CURRENT_PROMPT_IDENTITY,
  prepareSemanticGenerationRequest
} from "../../src/interpretation/semantic-request.js";
import type { SemanticTransportOutcome } from "../../src/interpretation/semantic-transport.js";
import type { RuntimeConfig } from "../../src/server/generation/config.js";
import { executeCurrentGeneration } from "../../src/server/generation/generation-service.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import {
  DEFAULT_GENERATED_FABRICATION_CONTROLS
} from "../../src/ui/content/generated-setup.js";

const BRIEF = "Make one rigid open enclosure for a small collection.";
const PROMPT_HASH = "a".repeat(64);
const MODEL_CONFIGURATION = {
  modelId: "gpt-5.6-sol",
  reasoningEffort: "medium" as const,
  imageDetailPolicy: "high" as const,
  promptLayoutVersion: CURRENT_PROMPT_LAYOUT_VERSION,
  maxOutputTokens: 6_000,
  serviceTier: "default" as const,
  store: false as const
};
const CONFIG: RuntimeConfig = {
  security: {
    accessCodeDigest: Buffer.alloc(32),
    signingSecret: Buffer.alloc(32),
    secureCookies: false
  },
  storeMode: "memory",
  upstash: null,
  generationEnabled: true,
  quotaUnlimited: true,
  generationMode: "live",
  generationExperience: "live",
  liveTransport: {
    apiKey: "offline-not-used",
    interpretationPrompt: "offline-not-used"
  }
};

function completed(
  candidate: SemanticInterpretationCandidate,
): SemanticTransportOutcome {
  return {
    kind: "completed",
    interpretationCandidate: candidate,
    providerRequestId: "offline-provider-request",
    providerModelId: "gpt-5.6-sol",
    responseId: "offline-response",
    finishState: "completed",
    latencyMs: 1,
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 0,
      outputTokens: 1,
      totalTokens: 2
    },
    estimatedCostUsd: 0,
    requestBudgetUpperBoundUsd: 0.65,
    priceSnapshotId: "offline-no-charge"
  };
}

async function setup() {
  const prepared = await prepareSemanticGenerationRequest({
    brief: BRIEF,
    references: [],
    roleConstraints: [],
    promptIdentity: CURRENT_PROMPT_IDENTITY,
    promptHash: PROMPT_HASH,
    modelConfiguration: MODEL_CONFIGURATION
  });
  const evidenceId = prepared.request.sourceEvidenceIndex.spans[0]!.evidenceId;
  const baseline = SemanticInterpretationCandidateSchema.parse({
    schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    items: [{
      claim: "One rigid open enclosure is required.",
      importance: "essential",
      evidenceBindings: [{
        evidenceId,
        aspect: "structure",
        support: "direct"
      }],
      relationships: [],
      measurements: [],
      state: "unbound",
      reason: "EVIDENCE_INSUFFICIENT",
      unsupportedSignatureIds: []
    }]
  });
  const triggerDecision = classifySemanticReviewTriggers({
    candidate: baseline
  });
  const patch = {
    schemaVersion: CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION,
    promptIdentity: CURRENT_BOUNDED_SEMANTIC_REVIEW_PROMPT_IDENTITY,
    callACandidateDigest: await hashCanonical(baseline),
    triggerCodes: triggerDecision.triggerCodes,
    operations: [{
      kind: "replace-item-resolution" as const,
      itemId: "inventory-item-1",
      expectedItemDigest: await hashCanonical(baseline.items[0]),
      resolution: {
        state: "bound" as const,
        atoms: [{
          kind: "primary-enclosure" as const,
          enclosure: {
            quantity: null,
            priority: "must" as const,
            evidenceIds: [evidenceId]
          },
          access: {
            kind: "open-top" as const,
            priority: "must" as const,
            evidenceIds: [evidenceId]
          },
          space: {
            layout: "explicit-single-space" as const,
            priority: "must" as const,
            evidenceIds: [evidenceId]
          }
        }]
      }
    }]
  };
  const patchResult = await applySemanticReviewPatch({
    candidate: baseline,
    sourceEvidenceIndex: prepared.request.sourceEvidenceIndex,
    triggerDecision,
    patch
  });
  if (patchResult.kind !== "applied") {
    throw new Error("expected offline patch to apply");
  }
  return {
    prepared,
    baseline,
    reviewed: patchResult.candidate,
    triggerDecision,
    patchResult
  };
}

async function run(
  candidate: SemanticInterpretationCandidate,
  suffix: string,
) {
  const store = new MemoryGenerationStore();
  const session = {
    schemaVersion: "1.0" as const,
    sessionId: `paired-review-${suffix}`,
    issuedAtMs: 1,
    expiresAtMs: 20_000,
    generationDispatches: 0,
    reservedExposureMicrousd: 0,
    lastDispatchAtMs: null,
    lastProjectId: null
  };
  await store.createSession(session, 60);
  return executeCurrentGeneration({
    config: CONFIG,
    authenticated: {
      session,
      clientIdentifier: `paired-review-client-${suffix}`
    },
    submission: GenerationSubmissionSchema.parse({
      schemaVersion: "4.0",
      brief: BRIEF,
      references: [],
      roleConstraints: [],
      deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
      fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
      retry: null
    }),
    store,
    runtimeOrigin: "test-recorded",
    interpretationTransport: {
      dispatch: () => Promise.resolve(completed(candidate))
    },
    semanticCache: new DispatchOnlySemanticCache(),
    initiatedBy: "live-eval",
    promptHash: PROMPT_HASH,
    evaluationModelConfiguration: MODEL_CONFIGURATION
  });
}

function oracle() {
  return {
    requiredRequirements: [{
      kind: "containment" as const,
      priority: "must" as const
    }],
    prohibitedRequirements: [],
    requiredBodies: [{
      role: "primary-enclosure" as const,
      shapeClass: "orthogonal-shell" as const
    }],
    prohibitedBodies: [],
    requiredAccess: [{
      kind: "open-top" as const,
      direction: "top" as const,
      priority: "must" as const
    }],
    prohibitedAccess: [],
    requiredInterfaces: [],
    prohibitedInterfaces: [],
    requiredOrganization: [{
      desiredSpaceCount: 1,
      rows: null,
      columns: null,
      priority: "must" as const
    }],
    prohibitedOrganization: [],
    accounting: [{
      importance: "essential" as const,
      state: "bound" as const,
      minimumCount: 1,
      maximumCount: 1
    }],
    requiredAtomKinds: ["primary-enclosure" as const],
    prohibitedAtomKinds: [],
    requiredUnsupportedSignatureIds: [],
    prohibitedUnsupportedSignatureIds: []
  };
}

describe("paired Call A and evaluation-only Call B scoring", () => {
  it("records a genuine correction and a skipped zero-regression control under frozen thresholds", async () => {
    const prepared = await setup();
    const baselineResponse = await run(prepared.baseline, "baseline");
    const reviewedResponse = await run(prepared.reviewed, "reviewed");
    expect(baselineResponse.outcome.kind).toBe("concept-only");
    expect(reviewedResponse.outcome.kind).toBe("supported");
    const eligibleCase = {
      schemaVersion: "sketchycut-sealed-semantic-case@1.0.0" as const,
      caseId: "paired-review-eligible",
      evaluationClass: "review-eligible-error" as const,
      submission: {
        brief: BRIEF,
        references: [],
        roleConstraints: []
      },
      expected: {
        semanticOracle: oracle(),
        baselineOutcomePolicy: {
          purpose: "semantic-diagnostic" as const,
          allowedKinds: ["concept-only" as const],
          exportRequired: false
        },
        reviewedOutcomePolicy: {
          purpose: "svg-acceptance" as const,
          allowedKinds: ["supported" as const, "simplified" as const],
          exportRequired: true
        },
        reviewDisposition: "dispatch-on-registered-trigger" as const,
        requiredTriggerCodes: ["ESSENTIAL_UNBOUND" as const]
      }
    };
    const eligibleResult = await buildPairedSemanticReviewCaseResult({
      testCase: eligibleCase,
      callACandidate: prepared.baseline,
      baselineOutcome: baselineResponse.outcome,
      reviewDispatched: true,
      reviewPatch: prepared.patchResult,
      reviewedCandidate: prepared.reviewed,
      reviewedOutcome: reviewedResponse.outcome,
      triggerDecision: prepared.triggerDecision
    });
    expect(eligibleResult).toMatchObject({
      correctionObserved: true,
      zeroRegressionObserved: false,
      triggerIdentityPass: true,
      reviewDispositionPass: true,
      pass: true
    });
    expect(JSON.stringify(eligibleResult)).not.toContain('"candidate"');

    const controlCase = {
      ...eligibleCase,
      caseId: "paired-review-control",
      evaluationClass: "already-correct-control" as const,
      expected: {
        ...eligibleCase.expected,
        baselineOutcomePolicy:
          eligibleCase.expected.reviewedOutcomePolicy,
        reviewDisposition: "skip-not-triggered" as const,
        requiredTriggerCodes: []
      }
    };
    const controlResult = await buildPairedSemanticReviewCaseResult({
      testCase: controlCase,
      callACandidate: prepared.reviewed,
      baselineOutcome: reviewedResponse.outcome,
      reviewDispatched: false,
      reviewPatch: null,
      reviewedCandidate: null,
      reviewedOutcome: null
    });
    expect(controlResult).toMatchObject({
      correctionObserved: false,
      zeroRegressionObserved: true,
      pass: true
    });
    const aggregate = aggregatePairedSemanticReviewResults([
      eligibleResult,
      controlResult
    ]);
    expect(PAIRED_SEMANTIC_REVIEW_THRESHOLDS).toEqual({
      minimumCorrectionRate: 1,
      minimumZeroRegressionRate: 1
    });
    expect(aggregate).toMatchObject({
      correctionRate: 1,
      zeroRegressionRate: 1,
      thresholdPass: true,
      productionRecommendation:
        "remain-evaluation-only-pending-builder-decision"
    });
    expect(JSON.stringify(aggregate)).not.toContain(BRIEF);
    expect(await sha256(BRIEF)).toMatch(/^[a-f0-9]{64}$/u);

    const missedEligible = await buildPairedSemanticReviewCaseResult({
      testCase: eligibleCase,
      callACandidate: prepared.reviewed,
      baselineOutcome: reviewedResponse.outcome,
      reviewDispatched: false,
      reviewPatch: null,
      reviewedCandidate: null,
      reviewedOutcome: null
    });
    const regressedControl = await buildPairedSemanticReviewCaseResult({
      testCase: controlCase,
      callACandidate: prepared.baseline,
      baselineOutcome: baselineResponse.outcome,
      reviewDispatched: false,
      reviewPatch: null,
      reviewedCandidate: null,
      reviewedOutcome: null,
      triggerDecision: prepared.triggerDecision
    });
    expect(missedEligible).toMatchObject({
      reviewDispatched: false,
      correctionObserved: false,
      pass: false
    });
    expect(regressedControl).toMatchObject({
      zeroRegressionObserved: false,
      pass: false
    });
    expect(aggregatePairedSemanticReviewResults([
      missedEligible,
      regressedControl
    ])).toMatchObject({
      correctionRate: 0,
      zeroRegressionRate: 0,
      thresholdPass: false
    });
  });
});
