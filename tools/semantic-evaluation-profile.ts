import type { SemanticEvaluationMode } from "../src/evaluation/semantic-live-evaluator.js";

export const SEMANTIC_EVALUATION_CAMPAIGN_SLUG =
  "functional-name-correction" as const;

export function semanticEvaluationSelectionFileName(
  mode: SemanticEvaluationMode,
): string {
  return `semantic-evaluation-${SEMANTIC_EVALUATION_CAMPAIGN_SLUG}-${mode}-selection.json`;
}

export const SEMANTIC_EVALUATION_CASE_PROFILES = {
  development: [
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
  ],
  acceptance: [
    "paraphrase-open-access-dev",
    "functional-name-separation-dev",
    "bare-storage-name-nonorganization-dev",
    "reference-role-purpose-control-dev",
    "measurement-ordinary-dev"
  ]
} as const satisfies Record<SemanticEvaluationMode, readonly string[]>;
