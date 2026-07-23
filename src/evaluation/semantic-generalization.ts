import { z } from "zod";

import corpusDocument from "../../tests/fixtures/semantic-generalization/manifest.json" with { type: "json" };

export const SEMANTIC_GENERALIZATION_CORPUS_ID = "semantic-generalization-current" as const;

export const SEMANTIC_GENERALIZATION_CASE_IDS = [
  "unfamiliar-purpose-structure-dev",
  "familiar-noun-scale-dev",
  "paraphrase-open-access-dev",
  "functional-name-separation-dev",
  "bare-storage-name-nonorganization-dev",
  "implicit-open-separation-organization-dev",
  "implicit-covered-case-organization-dev",
  "noun-swap-relationship-dev",
  "relationship-swap-contained-dev",
  "typo-colloquial-dev",
  "irrelevant-image-object-dev",
  "reference-role-purpose-control-dev",
  "reference-role-both-dev",
  "measurement-ordinary-dev",
  "measurement-ambiguous-dev",
  "supported-unfamiliar-style-dev",
  "review-correctable-coverage-dev",
  "covered-access-context-control-a-dev",
  "covered-access-context-control-b-dev",
  "reference-role-purpose-control-a-dev",
  "reference-role-exclusion-control-b-dev",
  "organization-count-composite-control-dev",
  "organization-grid-composite-control-dev",
  "storage-purpose-nonorganization-control-dev",
  "storage-context-nonorganization-control-dev"
] as const;

export type SemanticGeneralizationCaseId =
  (typeof SEMANTIC_GENERALIZATION_CASE_IDS)[number];

export const SemanticGeneralizationMetricSchema = z.enum([
  "commitment-recall",
  "contextual-item-non-escalation",
  "evidence-grounding",
  "inventory-projection-coverage",
  "binding-accuracy",
  "prohibited-binding-rate",
  "correct-concept-only",
  "valid-simplification-precision",
  "tokens",
  "calls",
  "latency",
  "cost-exposure",
  "deterministic-artifact-stability"
]);

export const SEMANTIC_EVALUATION_OUTCOME_PREFERENCE = [
  "supported",
  "simplified",
  "modified",
  "concept-only"
] as const;

export const SemanticEvaluationOutcomeKindSchema = z.enum(
  SEMANTIC_EVALUATION_OUTCOME_PREFERENCE,
);

export const SemanticEvaluationOutcomePolicySchema = z.object({
  purpose: z.enum(["semantic-diagnostic", "svg-acceptance"]),
  allowedKinds: z.array(SemanticEvaluationOutcomeKindSchema).min(1).max(4)
    .superRefine((kinds, context) => {
      if (new Set(kinds).size !== kinds.length) {
        context.addIssue({
          code: "custom",
          message: "Allowed semantic-evaluation outcome kinds must be unique."
        });
      }
      const ranks = kinds.map((kind) =>
        SEMANTIC_EVALUATION_OUTCOME_PREFERENCE.indexOf(kind)
      );
      if (ranks.some((rank, index) =>
        index > 0 && rank <= ranks[index - 1]!
      )) {
        context.addIssue({
          code: "custom",
          message: "Allowed semantic-evaluation outcomes must preserve supported, simplified, modified, concept-only preference order."
        });
      }
    }),
  exportRequired: z.boolean()
}).strict().superRefine((policy, context) => {
  if (policy.purpose === "svg-acceptance" && !policy.exportRequired) {
    context.addIssue({
      code: "custom",
      path: ["exportRequired"],
      message: "SVG acceptance requires an export-authorized result."
    });
  }
  if (policy.exportRequired && policy.allowedKinds.includes("concept-only")) {
    context.addIssue({
      code: "custom",
      path: ["allowedKinds"],
      message: "Concept-only outcomes cannot satisfy an export-required policy."
    });
  }
});

export type SemanticEvaluationOutcomePolicy = z.infer<
  typeof SemanticEvaluationOutcomePolicySchema
>;

const ExpectedCaseSchema = z.object({
  essential: z.array(z.string().min(1)).optional(),
  context: z.array(z.string().min(1)).optional(),
  deferred: z.array(z.string().min(1)).optional(),
  forbidden: z.array(z.string().min(1)).optional(),
  preference: z.array(z.string().min(1)).optional(),
  measurementTarget: z.string().min(1).optional(),
  literal: z.string().min(1).optional(),
  valueUm: z.number().int().positive().optional(),
  hardConstraint: z.boolean().optional(),
  reviewEligible: z.boolean().optional(),
  reviewMayPatch: z.array(z.string().min(1)).optional(),
  outcomeAfterCorrectPatch: SemanticEvaluationOutcomeKindSchema.optional(),
  outcomePolicy: SemanticEvaluationOutcomePolicySchema
}).strict();

export const SemanticGeneralizationCaseSchema = z.object({
  id: z.enum(SEMANTIC_GENERALIZATION_CASE_IDS),
  partition: z.literal("development"),
  failureClass: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u),
  brief: z.string().min(1).max(8_000),
  referenceIds: z.array(z.string()).max(3).optional(),
  referenceRoles: z.array(z.array(z.enum(["structure", "surface"])).max(2)).max(3),
  advancedSizing: z.unknown().optional(),
  equivalenceGroup: z.string().optional(),
  contrastGroup: z.string().optional(),
  seededFinding: z.string().nullable().optional(),
  expected: ExpectedCaseSchema
}).strict();

export const SemanticGeneralizationCorpusSchema = z.object({
  schemaVersion: z.literal("4.0"),
  corpusId: z.literal(SEMANTIC_GENERALIZATION_CORPUS_ID),
  status: z.literal("open-development"),
  provenance: z.object({
    kind: z.literal("project-authored-semantic-cases"),
    externalAssets: z.boolean(),
    containsPrivateUserContent: z.literal(false),
    operatorFixturesSeparate: z.literal("tests/fixtures/anti-overfit/manifest.json")
  }).strict(),
  metrics: z.array(SemanticGeneralizationMetricSchema),
  cases: z.array(SemanticGeneralizationCaseSchema)
    .length(SEMANTIC_GENERALIZATION_CASE_IDS.length)
}).strict().superRefine((corpus, context) => {
  const caseIds = corpus.cases.map((item) => item.id);
  if (new Set(caseIds).size !== caseIds.length) {
    context.addIssue({ code: "custom", path: ["cases"], message: "Semantic generalization case IDs must be unique." });
  }
  const requiredFailureClasses = [
    "unfamiliar-noun-supported-relationships",
    "familiar-noun-role-separation",
    "functional-name-implies-organization",
    "bare-storage-name-non-escalation",
    "noun-swap-preserves-relationship",
    "relationship-change-preserves-nouns",
    "noisy-language",
    "irrelevant-reference-object",
    "generic-reference-role-enforcement",
    "ordinary-exact-measurement",
    "ambiguous-measurement",
    "supported-structure-unfamiliar-appearance",
    "bounded-review-coverage",
    "closure-access-completeness",
    "reference-role-aspect-decomposition",
    "construction-affecting-organization-undercoverage",
    "implicit-organization-without-layout",
    "purpose-context-storage-non-escalation"
  ];
  const actualFailureClasses = new Set(corpus.cases.map((item) => item.failureClass));
  for (const failureClass of requiredFailureClasses) {
    if (!actualFailureClasses.has(failureClass)) {
      context.addIssue({ code: "custom", path: ["cases"], message: `Required abstract failure class ${failureClass} is absent.` });
    }
  }
});

export const SemanticEvaluationObservationSchema = z.object({
  caseId: z.string().min(1),
  commitmentExpected: z.number().int().nonnegative(),
  commitmentRecalled: z.number().int().nonnegative(),
  contextualExpected: z.number().int().nonnegative(),
  contextualNotEscalated: z.number().int().nonnegative(),
  evidenceBindingExpected: z.number().int().nonnegative(),
  evidenceBindingGrounded: z.number().int().nonnegative(),
  inventoryItemsRequiringProjection: z.number().int().nonnegative(),
  inventoryItemsAccounted: z.number().int().nonnegative(),
  bindingDecisionsExpected: z.number().int().nonnegative(),
  bindingDecisionsCorrect: z.number().int().nonnegative(),
  prohibitedBindings: z.number().int().nonnegative(),
  outcomePolicy: SemanticEvaluationOutcomePolicySchema,
  observedOutcomeKind: z.enum([
    ...SemanticEvaluationOutcomeKindSchema.options,
    "failure"
  ]),
  simplificationValid: z.boolean().nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  calls: z.literal(1),
  latencyMs: z.number().int().nonnegative(),
  costExposureUsd: z.number().nonnegative(),
  artifactDigestBefore: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  artifactDigestAfter: z.string().regex(/^[a-f0-9]{64}$/u).nullable()
}).strict().superRefine((item, context) => {
  const boundedCounts: readonly (readonly [number, number])[] = [
    [item.commitmentRecalled, item.commitmentExpected],
    [item.contextualNotEscalated, item.contextualExpected],
    [item.evidenceBindingGrounded, item.evidenceBindingExpected],
    [item.inventoryItemsAccounted, item.inventoryItemsRequiringProjection],
    [item.bindingDecisionsCorrect, item.bindingDecisionsExpected]
  ];
  for (const [numerator, denominator] of boundedCounts) {
    if (numerator > denominator) context.addIssue({ code: "custom", message: "Metric numerator cannot exceed its denominator." });
  }
});

export type SemanticEvaluationObservation = z.infer<typeof SemanticEvaluationObservationSchema>;

type MetricResult = {
  status: "measured" | "not-run";
  numerator: number | null;
  denominator: number | null;
  value: number | null;
};

function rate(numerator: number, denominator: number): MetricResult {
  return { status: "measured", numerator, denominator, value: denominator === 0 ? 1 : numerator / denominator };
}

function total(observations: readonly SemanticEvaluationObservation[], select: (item: SemanticEvaluationObservation) => number): number {
  return observations.reduce((sum, item) => sum + select(item), 0);
}

export function scoreSemanticGeneralization(candidateObservations: readonly unknown[]): Record<z.infer<typeof SemanticGeneralizationMetricSchema>, MetricResult> {
  const observations = candidateObservations.map((item) => SemanticEvaluationObservationSchema.parse(item));
  if (observations.length === 0) {
    return Object.fromEntries(SemanticGeneralizationMetricSchema.options.map((metric) => [metric, {
      status: "not-run", numerator: null, denominator: null, value: null
    }])) as Record<z.infer<typeof SemanticGeneralizationMetricSchema>, MetricResult>;
  }
  const conceptCases = observations.filter((item) =>
    item.outcomePolicy.allowedKinds.length === 1 &&
    item.outcomePolicy.allowedKinds[0] === "concept-only"
  );
  const simplificationCases = observations.filter((item) =>
    item.outcomePolicy.allowedKinds.includes("simplified")
  );
  const stableArtifacts = observations.filter((item) => item.artifactDigestBefore !== null && item.artifactDigestAfter !== null);
  return {
    "commitment-recall": rate(total(observations, (item) => item.commitmentRecalled), total(observations, (item) => item.commitmentExpected)),
    "contextual-item-non-escalation": rate(total(observations, (item) => item.contextualNotEscalated), total(observations, (item) => item.contextualExpected)),
    "evidence-grounding": rate(total(observations, (item) => item.evidenceBindingGrounded), total(observations, (item) => item.evidenceBindingExpected)),
    "inventory-projection-coverage": rate(total(observations, (item) => item.inventoryItemsAccounted), total(observations, (item) => item.inventoryItemsRequiringProjection)),
    "binding-accuracy": rate(total(observations, (item) => item.bindingDecisionsCorrect), total(observations, (item) => item.bindingDecisionsExpected)),
    "prohibited-binding-rate": rate(total(observations, (item) => item.prohibitedBindings), total(observations, (item) => item.bindingDecisionsExpected)),
    "correct-concept-only": rate(conceptCases.filter((item) => item.observedOutcomeKind === "concept-only").length, conceptCases.length),
    "valid-simplification-precision": rate(simplificationCases.filter((item) => item.simplificationValid === true).length, simplificationCases.length),
    tokens: rate(total(observations, (item) => item.inputTokens + item.outputTokens), observations.length),
    calls: rate(total(observations, (item) => item.calls), observations.length),
    latency: rate(total(observations, (item) => item.latencyMs), observations.length),
    "cost-exposure": rate(total(observations, (item) => item.costExposureUsd), observations.length),
    "deterministic-artifact-stability": rate(stableArtifacts.filter((item) => item.artifactDigestBefore === item.artifactDigestAfter).length, stableArtifacts.length)
  };
}

export const SEMANTIC_GENERALIZATION_CORPUS = SemanticGeneralizationCorpusSchema.parse(corpusDocument);
