import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";
import type { GenerationOutcome } from "../interpretation/generation-outcome.js";
import {
  SemanticInterpretationCandidateSchema,
  type SemanticInterpretationCandidate
} from "../interpretation/semantic-model-contract.js";
import {
  classifySemanticReviewTriggers,
  type SemanticReviewPatchApplicationResult,
  SemanticReviewTriggerDecisionSchema
} from "./bounded-semantic-review.js";
import {
  SealedSemanticCasePayloadSchema,
  type SealedSemanticCasePayload
} from "./sealed-partition.js";
import { interpretationFromOutcome } from "./semantic-generalization-oracle.js";

export const CURRENT_PAIRED_SEMANTIC_REVIEW_EVALUATOR_VERSION =
  "1.0.0" as const;

const PredicateResultSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/u),
  pass: z.boolean()
}).strict();

const OutcomeKindSchema = z.enum([
  "supported",
  "simplified",
  "modified",
  "concept-only",
  "failure"
]);

export const SealedSemanticOracleScoreSchema = z.object({
  schemaVersion: z.literal(CURRENT_PAIRED_SEMANTIC_REVIEW_EVALUATOR_VERSION),
  outcomeKind: OutcomeKindSchema,
  outcomePolicyAccepted: z.boolean(),
  predicates: z.array(PredicateResultSchema),
  pass: z.boolean()
}).strict().superRefine((score, context) => {
  if (
    score.pass !== (
      score.outcomePolicyAccepted &&
      score.predicates.every((predicate) => predicate.pass)
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Sealed semantic score must derive exactly from its typed predicates."
    });
  }
});

export type SealedSemanticOracleScore = z.infer<
  typeof SealedSemanticOracleScoreSchema
>;

function outcomeAccepted(
  policy: SealedSemanticCasePayload["expected"]["baselineOutcomePolicy"],
  outcome: GenerationOutcome,
): boolean {
  if (
    outcome.kind === "failure" ||
    !policy.allowedKinds.includes(outcome.kind)
  ) {
    return false;
  }
  if (!policy.exportRequired) return true;
  return (
    outcome.kind === "supported" ||
    outcome.kind === "simplified" ||
    outcome.kind === "modified"
  ) && outcome.exportAllowed;
}

function predicateCode(
  prefix: string,
  index: number,
  detail?: string,
): string {
  const suffix = detail === undefined
    ? ""
    : `_${detail.toUpperCase().replaceAll(/[^A-Z0-9]+/gu, "_")}`;
  return `${prefix}_${String(index + 1)}${suffix}`;
}

export function scoreSealedSemanticOracle(input: {
  testCase: SealedSemanticCasePayload;
  candidate: SemanticInterpretationCandidate;
  outcome: GenerationOutcome;
  phase: "baseline" | "reviewed";
}): SealedSemanticOracleScore {
  const testCase = SealedSemanticCasePayloadSchema.parse(input.testCase);
  const candidate = SemanticInterpretationCandidateSchema.parse(
    input.candidate,
  );
  const interpretation = interpretationFromOutcome(input.outcome);
  const policy = input.phase === "baseline"
    ? testCase.expected.baselineOutcomePolicy
    : testCase.expected.reviewedOutcomePolicy;
  if (interpretation === null) {
    return SealedSemanticOracleScoreSchema.parse({
      schemaVersion: CURRENT_PAIRED_SEMANTIC_REVIEW_EVALUATOR_VERSION,
      outcomeKind: input.outcome.kind,
      outcomePolicyAccepted: false,
      predicates: [{
        code: "STRICT_INTERPRETATION_AVAILABLE",
        pass: false
      }],
      pass: false
    });
  }
  const oracle = testCase.expected.semanticOracle;
  const projection = interpretation.projection;
  const itemById = new Map(
    interpretation.inventory.items.map((item) => [item.id, item]),
  );
  const atomKinds = candidate.items.flatMap((item) =>
    item.state === "bound"
      ? item.atoms.map((atom) => atom.kind)
      : []
  );
  const unsupportedSignatureIds = new Set([
    ...candidate.items.flatMap((item) =>
      item.state === "unbound" || item.state === "uncertain"
        ? item.unsupportedSignatureIds
        : []
    ),
    ...projection.accounting.flatMap((record) =>
      record.unsupportedSignatureIds
    )
  ]);
  const matchesRequirement = (
    predicate: (typeof oracle.requiredRequirements)[number],
  ) => projection.requirements.some((requirement) =>
    requirement.kind === predicate.kind &&
    (predicate.priority === null || requirement.priority === predicate.priority)
  );
  const matchesBody = (
    predicate: (typeof oracle.requiredBodies)[number],
  ) => projection.constructionBodies.some((body) =>
    body.role === predicate.role &&
    (predicate.shapeClass === null || body.shapeClass === predicate.shapeClass)
  );
  const matchesAccess = (
    predicate: (typeof oracle.requiredAccess)[number],
  ) => projection.access.some((access) =>
    access.kind === predicate.kind &&
    (predicate.direction === null || access.direction === predicate.direction) &&
    (predicate.priority === null || access.priority === predicate.priority)
  );
  const matchesInterface = (
    predicate: (typeof oracle.requiredInterfaces)[number],
  ) => projection.interfaces.some((semanticInterface) =>
    semanticInterface.behavior === predicate.behavior &&
    (predicate.axis === null || semanticInterface.axis === predicate.axis)
  );
  const matchesOrganization = (
    predicate: (typeof oracle.requiredOrganization)[number],
  ) => projection.organization.some((organization) =>
    organization.desiredSpaceCount === predicate.desiredSpaceCount &&
    (predicate.rows === null || organization.rows === predicate.rows) &&
    (predicate.columns === null ||
      organization.columns === predicate.columns) &&
    (predicate.priority === null ||
      organization.priority === predicate.priority)
  );
  const predicates: { code: string; pass: boolean }[] = [];
  oracle.requiredRequirements.forEach((predicate, index) => {
    predicates.push({
      code: predicateCode("REQUIRED_REQUIREMENT", index, predicate.kind),
      pass: matchesRequirement(predicate)
    });
  });
  oracle.prohibitedRequirements.forEach((predicate, index) => {
    predicates.push({
      code: predicateCode("PROHIBITED_REQUIREMENT", index, predicate.kind),
      pass: !matchesRequirement(predicate)
    });
  });
  oracle.requiredBodies.forEach((predicate, index) => {
    predicates.push({
      code: predicateCode("REQUIRED_BODY", index, predicate.role),
      pass: matchesBody(predicate)
    });
  });
  oracle.prohibitedBodies.forEach((predicate, index) => {
    predicates.push({
      code: predicateCode("PROHIBITED_BODY", index, predicate.role),
      pass: !matchesBody(predicate)
    });
  });
  oracle.requiredAccess.forEach((predicate, index) => {
    predicates.push({
      code: predicateCode("REQUIRED_ACCESS", index, predicate.kind),
      pass: matchesAccess(predicate)
    });
  });
  oracle.prohibitedAccess.forEach((predicate, index) => {
    predicates.push({
      code: predicateCode("PROHIBITED_ACCESS", index, predicate.kind),
      pass: !matchesAccess(predicate)
    });
  });
  oracle.requiredInterfaces.forEach((predicate, index) => {
    predicates.push({
      code: predicateCode(
        "REQUIRED_INTERFACE",
        index,
        predicate.behavior,
      ),
      pass: matchesInterface(predicate)
    });
  });
  oracle.prohibitedInterfaces.forEach((predicate, index) => {
    predicates.push({
      code: predicateCode(
        "PROHIBITED_INTERFACE",
        index,
        predicate.behavior,
      ),
      pass: !matchesInterface(predicate)
    });
  });
  oracle.requiredOrganization.forEach((predicate, index) => {
    predicates.push({
      code: predicateCode(
        "REQUIRED_ORGANIZATION",
        index,
        String(predicate.desiredSpaceCount),
      ),
      pass: matchesOrganization(predicate)
    });
  });
  oracle.prohibitedOrganization.forEach((predicate, index) => {
    predicates.push({
      code: predicateCode(
        "PROHIBITED_ORGANIZATION",
        index,
        String(predicate.desiredSpaceCount),
      ),
      pass: !matchesOrganization(predicate)
    });
  });
  oracle.accounting.forEach((predicate, index) => {
    const count = projection.accounting.filter((record) =>
      record.state === predicate.state &&
      itemById.get(record.itemId)?.importance === predicate.importance
    ).length;
    predicates.push({
      code: predicateCode(
        "ACCOUNTING_RANGE",
        index,
        `${predicate.importance}_${predicate.state}`,
      ),
      pass: count >= predicate.minimumCount &&
        count <= predicate.maximumCount
    });
  });
  oracle.requiredAtomKinds.forEach((kind, index) => {
    predicates.push({
      code: predicateCode("REQUIRED_ATOM_KIND", index, kind),
      pass: atomKinds.includes(kind)
    });
  });
  oracle.prohibitedAtomKinds.forEach((kind, index) => {
    predicates.push({
      code: predicateCode("PROHIBITED_ATOM_KIND", index, kind),
      pass: !atomKinds.includes(kind)
    });
  });
  oracle.requiredUnsupportedSignatureIds.forEach((signatureId, index) => {
    predicates.push({
      code: predicateCode(
        "REQUIRED_UNSUPPORTED_SIGNATURE",
        index,
        signatureId,
      ),
      pass: unsupportedSignatureIds.has(
        signatureId as "kerf-flexure-corner-construction",
      )
    });
  });
  oracle.prohibitedUnsupportedSignatureIds.forEach((signatureId, index) => {
    predicates.push({
      code: predicateCode(
        "PROHIBITED_UNSUPPORTED_SIGNATURE",
        index,
        signatureId,
      ),
      pass: !unsupportedSignatureIds.has(
        signatureId as "kerf-flexure-corner-construction",
      )
    });
  });
  const outcomePolicyAccepted = outcomeAccepted(policy, input.outcome);
  return SealedSemanticOracleScoreSchema.parse({
    schemaVersion: CURRENT_PAIRED_SEMANTIC_REVIEW_EVALUATOR_VERSION,
    outcomeKind: input.outcome.kind,
    outcomePolicyAccepted,
    predicates,
    pass: outcomePolicyAccepted &&
      predicates.every((predicate) => predicate.pass)
  });
}

export const SemanticReviewPatchEvaluationSummarySchema =
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("applied"),
      patchDigest: z.string().regex(/^[a-f0-9]{64}$/u),
      candidateDigestBefore: z.string().regex(/^[a-f0-9]{64}$/u),
      candidateDigestAfter: z.string().regex(/^[a-f0-9]{64}$/u),
      changedItemIds: z.array(z.string().min(1))
    }).strict(),
    z.object({
      kind: z.literal("rejected"),
      code: z.enum([
        "PATCH_SCHEMA_INVALID",
        "CALL_A_CANDIDATE_DIGEST_MISMATCH",
        "TRIGGER_IDENTITY_MISMATCH",
        "ITEM_PRECONDITION_DIGEST_MISMATCH",
        "PATCHED_CANDIDATE_INVALID",
        "PATCHED_CANDIDATE_UNAUTHORIZED"
      ])
    }).strict()
  ]);

export const PairedSemanticReviewCaseResultSchema = z.object({
  schemaVersion: z.literal(CURRENT_PAIRED_SEMANTIC_REVIEW_EVALUATOR_VERSION),
  caseId: z.string().min(1),
  evaluationClass: z.enum([
    "review-eligible-error",
    "already-correct-control"
  ]),
  callACandidateDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  baselineOutcomeDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  baselineScore: SealedSemanticOracleScoreSchema,
  triggerDecision: SemanticReviewTriggerDecisionSchema,
  triggerIdentityPass: z.boolean(),
  reviewDispositionPass: z.boolean(),
  reviewDispatched: z.boolean(),
  reviewPatch: SemanticReviewPatchEvaluationSummarySchema.nullable(),
  reviewedCandidateDigest: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  reviewedOutcomeDigest: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  reviewedScore: SealedSemanticOracleScoreSchema.nullable(),
  correctionObserved: z.boolean(),
  zeroRegressionObserved: z.boolean(),
  pass: z.boolean()
}).strict().superRefine((result, context) => {
  if (
    result.evaluationClass === "review-eligible-error" &&
    result.zeroRegressionObserved
  ) {
    context.addIssue({
      code: "custom",
      message: "Review-eligible case accounting is inconsistent."
    });
  }
  if (
    result.evaluationClass === "already-correct-control" &&
    result.correctionObserved
  ) {
    context.addIssue({
      code: "custom",
      message: "Already-correct control accounting is inconsistent."
    });
  }
  const expectedCorrection =
    result.evaluationClass === "review-eligible-error" &&
    result.reviewDispatched &&
    result.triggerIdentityPass &&
    result.reviewDispositionPass &&
    result.reviewPatch?.kind === "applied" &&
    result.reviewedScore !== null &&
    !result.baselineScore.pass &&
    result.reviewedScore.pass;
  const expectedZeroRegression =
    result.evaluationClass === "already-correct-control" &&
    !result.reviewDispatched &&
    result.triggerIdentityPass &&
    result.reviewDispositionPass &&
    !result.triggerDecision.eligible &&
    result.reviewPatch === null &&
    result.reviewedCandidateDigest === null &&
    result.reviewedOutcomeDigest === null &&
    result.reviewedScore === null &&
    result.baselineScore.pass;
  if (
    result.correctionObserved !== expectedCorrection ||
    result.zeroRegressionObserved !== expectedZeroRegression
  ) {
    context.addIssue({
      code: "custom",
      message: "Paired correction and regression observations must derive exactly."
    });
  }
  const expectedPass = result.evaluationClass === "review-eligible-error"
    ? result.correctionObserved
    : result.zeroRegressionObserved;
  if (result.pass !== expectedPass) {
    context.addIssue({
      code: "custom",
      message: "Paired case pass must derive from correction or zero regression."
    });
  }
});

export type PairedSemanticReviewCaseResult = z.infer<
  typeof PairedSemanticReviewCaseResultSchema
>;

export async function buildPairedSemanticReviewCaseResult(input: {
  testCase: SealedSemanticCasePayload;
  callACandidate: SemanticInterpretationCandidate;
  baselineOutcome: GenerationOutcome;
  reviewDispatched: boolean;
  reviewPatch: SemanticReviewPatchApplicationResult | null;
  reviewedCandidate: SemanticInterpretationCandidate | null;
  reviewedOutcome: GenerationOutcome | null;
  triggerDecision?: z.infer<typeof SemanticReviewTriggerDecisionSchema>;
}): Promise<PairedSemanticReviewCaseResult> {
  const testCase = SealedSemanticCasePayloadSchema.parse(input.testCase);
  const callACandidate = SemanticInterpretationCandidateSchema.parse(
    input.callACandidate,
  );
  const triggerDecision = input.triggerDecision === undefined
    ? classifySemanticReviewTriggers({ candidate: callACandidate })
    : SemanticReviewTriggerDecisionSchema.parse(input.triggerDecision);
  const triggerIdentityPass =
    JSON.stringify(triggerDecision.triggerCodes) ===
      JSON.stringify(testCase.expected.requiredTriggerCodes);
  const reviewDispositionPass =
    input.reviewDispatched === (
      testCase.expected.reviewDisposition ===
        "dispatch-on-registered-trigger"
    );
  const baselineScore = scoreSealedSemanticOracle({
    testCase,
    candidate: callACandidate,
    outcome: input.baselineOutcome,
    phase: "baseline"
  });
  const reviewedCandidate = input.reviewedCandidate === null
    ? null
    : SemanticInterpretationCandidateSchema.parse(input.reviewedCandidate);
  const reviewedScore = reviewedCandidate === null ||
    input.reviewedOutcome === null
    ? null
    : scoreSealedSemanticOracle({
        testCase,
        candidate: reviewedCandidate,
        outcome: input.reviewedOutcome,
        phase: "reviewed"
      });
  const correctionObserved =
    testCase.evaluationClass === "review-eligible-error" &&
    input.reviewDispatched &&
    triggerIdentityPass &&
    reviewDispositionPass &&
    input.reviewPatch?.kind === "applied" &&
    reviewedScore !== null &&
    !baselineScore.pass &&
    reviewedScore.pass;
  const zeroRegressionObserved =
    testCase.evaluationClass === "already-correct-control" &&
    !input.reviewDispatched &&
    triggerIdentityPass &&
    reviewDispositionPass &&
    !triggerDecision.eligible &&
    baselineScore.pass;
  const reviewPatch = input.reviewPatch === null
    ? null
    : input.reviewPatch.kind === "applied"
      ? {
          kind: input.reviewPatch.kind,
          patchDigest: input.reviewPatch.patchDigest,
          candidateDigestBefore: input.reviewPatch.candidateDigestBefore,
          candidateDigestAfter: input.reviewPatch.candidateDigestAfter,
          changedItemIds: input.reviewPatch.changedItemIds
        }
      : {
          kind: input.reviewPatch.kind,
          code: input.reviewPatch.code
        };
  return PairedSemanticReviewCaseResultSchema.parse({
    schemaVersion: CURRENT_PAIRED_SEMANTIC_REVIEW_EVALUATOR_VERSION,
    caseId: testCase.caseId,
    evaluationClass: testCase.evaluationClass,
    callACandidateDigest: await hashCanonical(callACandidate),
    baselineOutcomeDigest: await hashCanonical(input.baselineOutcome),
    baselineScore,
    triggerDecision,
    triggerIdentityPass,
    reviewDispositionPass,
    reviewDispatched: input.reviewDispatched,
    reviewPatch,
    reviewedCandidateDigest: reviewedCandidate === null
      ? null
      : await hashCanonical(reviewedCandidate),
    reviewedOutcomeDigest: input.reviewedOutcome === null
      ? null
      : await hashCanonical(input.reviewedOutcome),
    reviewedScore,
    correctionObserved,
    zeroRegressionObserved,
    pass: testCase.evaluationClass === "review-eligible-error"
      ? correctionObserved
      : zeroRegressionObserved
  });
}

export const PAIRED_SEMANTIC_REVIEW_THRESHOLDS = {
  minimumCorrectionRate: 1,
  minimumZeroRegressionRate: 1
} as const;

export const PairedSemanticReviewAggregateSchema = z.object({
  schemaVersion: z.literal(CURRENT_PAIRED_SEMANTIC_REVIEW_EVALUATOR_VERSION),
  caseCount: z.number().int().positive(),
  reviewEligibleCaseCount: z.number().int().positive(),
  alreadyCorrectControlCount: z.number().int().positive(),
  correctionCount: z.number().int().nonnegative(),
  zeroRegressionCount: z.number().int().nonnegative(),
  correctionRate: z.number().min(0).max(1),
  zeroRegressionRate: z.number().min(0).max(1),
  thresholdPass: z.boolean(),
  productionRecommendation: z.literal("remain-evaluation-only-pending-builder-decision")
}).strict().superRefine((aggregate, context) => {
  const expectedCorrectionRate =
    aggregate.correctionCount /
    aggregate.reviewEligibleCaseCount;
  const expectedZeroRegressionRate =
    aggregate.zeroRegressionCount /
    aggregate.alreadyCorrectControlCount;
  const expectedThresholdPass =
    expectedCorrectionRate >=
      PAIRED_SEMANTIC_REVIEW_THRESHOLDS.minimumCorrectionRate &&
    expectedZeroRegressionRate >=
      PAIRED_SEMANTIC_REVIEW_THRESHOLDS.minimumZeroRegressionRate;
  if (
    aggregate.caseCount !==
      aggregate.reviewEligibleCaseCount +
        aggregate.alreadyCorrectControlCount ||
    aggregate.correctionCount >
      aggregate.reviewEligibleCaseCount ||
    aggregate.zeroRegressionCount >
      aggregate.alreadyCorrectControlCount ||
    aggregate.correctionRate !== expectedCorrectionRate ||
    aggregate.zeroRegressionRate !== expectedZeroRegressionRate ||
    aggregate.thresholdPass !== expectedThresholdPass
  ) {
    context.addIssue({
      code: "custom",
      message: "Paired semantic-review aggregate must derive exactly from its class counts and frozen thresholds."
    });
  }
});

export function aggregatePairedSemanticReviewResults(
  values: readonly PairedSemanticReviewCaseResult[],
): z.infer<typeof PairedSemanticReviewAggregateSchema> {
  const results = values.map((value) =>
    PairedSemanticReviewCaseResultSchema.parse(value)
  );
  const eligible = results.filter((result) =>
    result.evaluationClass === "review-eligible-error"
  );
  const controls = results.filter((result) =>
    result.evaluationClass === "already-correct-control"
  );
  if (eligible.length === 0 || controls.length === 0) {
    throw new Error("PAIRED_REVIEW_BOTH_EVALUATION_CLASSES_REQUIRED");
  }
  const correctionCount = eligible.filter((result) =>
    result.correctionObserved
  ).length;
  const zeroRegressionCount = controls.filter((result) =>
    result.zeroRegressionObserved
  ).length;
  const correctionRate = correctionCount / eligible.length;
  const zeroRegressionRate = zeroRegressionCount / controls.length;
  return PairedSemanticReviewAggregateSchema.parse({
    schemaVersion: CURRENT_PAIRED_SEMANTIC_REVIEW_EVALUATOR_VERSION,
    caseCount: results.length,
    reviewEligibleCaseCount: eligible.length,
    alreadyCorrectControlCount: controls.length,
    correctionCount,
    zeroRegressionCount,
    correctionRate,
    zeroRegressionRate,
    thresholdPass:
      correctionRate >=
        PAIRED_SEMANTIC_REVIEW_THRESHOLDS.minimumCorrectionRate &&
      zeroRegressionRate >=
        PAIRED_SEMANTIC_REVIEW_THRESHOLDS.minimumZeroRegressionRate,
    productionRecommendation:
      "remain-evaluation-only-pending-builder-decision"
  });
}
