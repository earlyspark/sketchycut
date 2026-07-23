import { describe, expect, it } from "vitest";

import {
  SEMANTIC_GENERALIZATION_CORPUS,
  SemanticEvaluationOutcomePolicySchema,
  SemanticGeneralizationMetricSchema,
  scoreSemanticGeneralization
} from "../../src/evaluation/semantic-generalization.js";

describe("open-development semantic-generalization evaluation contract", () => {
  it("keeps only the active open-development corpus in tracked evaluation code", () => {
    expect(SEMANTIC_GENERALIZATION_CORPUS.schemaVersion).toBe("3.0");
    expect(SEMANTIC_GENERALIZATION_CORPUS.status).toBe("open-development");
    expect(SEMANTIC_GENERALIZATION_CORPUS.provenance.operatorFixturesSeparate)
      .toBe("tests/fixtures/anti-overfit/manifest.json");
    expect(SEMANTIC_GENERALIZATION_CORPUS.cases).toHaveLength(25);
    expect(SEMANTIC_GENERALIZATION_CORPUS.cases.some((item) =>
      item.id.endsWith("-heldout")
    )).toBe(false);
    expect(SEMANTIC_GENERALIZATION_CORPUS.cases.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "implicit-open-separation-organization-dev",
        "implicit-covered-case-organization-dev",
        "functional-name-separation-dev",
        "bare-storage-name-nonorganization-dev",
        "organization-count-composite-control-dev",
        "organization-grid-composite-control-dev",
        "storage-purpose-nonorganization-control-dev",
        "storage-context-nonorganization-control-dev",
        "reference-role-purpose-control-dev"
      ])
    );
    expect(SEMANTIC_GENERALIZATION_CORPUS.cases.every((item) =>
      item.expected.outcomePolicy.purpose !== "svg-acceptance" ||
      item.expected.outcomePolicy.exportRequired
    )).toBe(true);
    expect(SEMANTIC_GENERALIZATION_CORPUS.cases.every((item) =>
      !item.expected.outcomePolicy.exportRequired ||
      !item.expected.outcomePolicy.allowedKinds.includes("concept-only")
    )).toBe(true);
    expect(Object.fromEntries(SEMANTIC_GENERALIZATION_CORPUS.cases
      .filter((item) => [
        "implicit-covered-case-organization-dev",
        "organization-count-composite-control-dev",
        "organization-grid-composite-control-dev"
      ].includes(item.id))
      .map((item) => [item.id, item.expected.outcomePolicy]))).toEqual({
      "implicit-covered-case-organization-dev": {
        purpose: "semantic-diagnostic",
        allowedKinds: ["supported", "simplified", "concept-only"],
        exportRequired: false
      },
      "organization-count-composite-control-dev": {
        purpose: "semantic-diagnostic",
        allowedKinds: ["supported", "simplified", "concept-only"],
        exportRequired: false
      },
      "organization-grid-composite-control-dev": {
        purpose: "semantic-diagnostic",
        allowedKinds: ["concept-only"],
        exportRequired: false
      }
    });
    expect(SemanticGeneralizationMetricSchema.options).not.toContain("reviewer-correction-rate");
    expect(SemanticGeneralizationMetricSchema.options).not.toContain("reviewer-zero-regression-rate");
    expect(SEMANTIC_GENERALIZATION_CORPUS.metrics).not.toContain("reviewer-correction-rate");
    expect(SEMANTIC_GENERALIZATION_CORPUS.metrics).not.toContain("reviewer-zero-regression-rate");
  });

  it("reports every current one-call metric as not run without authorized observations", () => {
    const report = scoreSemanticGeneralization([]);
    expect(Object.keys(report).sort()).toEqual([...SemanticGeneralizationMetricSchema.options].sort());
    expect(Object.values(report).every((metric) =>
      metric.status === "not-run" && metric.value === null
    )).toBe(true);
  });

  it("keeps diagnostic purpose independent from an explicit export requirement", () => {
    expect(SemanticEvaluationOutcomePolicySchema.parse({
      purpose: "semantic-diagnostic",
      allowedKinds: ["supported"],
      exportRequired: true
    })).toEqual({
      purpose: "semantic-diagnostic",
      allowedKinds: ["supported"],
      exportRequired: true
    });
    expect(() => SemanticEvaluationOutcomePolicySchema.parse({
      purpose: "svg-acceptance",
      allowedKinds: ["concept-only"],
      exportRequired: true
    })).toThrow();
  });

  it("scores a synthetic one-call observation without a review field or second-call lane", () => {
    const digest = "a".repeat(64);
    const report = scoreSemanticGeneralization([{
      caseId: "synthetic-one-call-case",
      commitmentExpected: 2,
      commitmentRecalled: 2,
      contextualExpected: 1,
      contextualNotEscalated: 1,
      evidenceBindingExpected: 3,
      evidenceBindingGrounded: 3,
      inventoryItemsRequiringProjection: 2,
      inventoryItemsAccounted: 2,
      bindingDecisionsExpected: 2,
      bindingDecisionsCorrect: 2,
      prohibitedBindings: 0,
      outcomePolicy: {
        purpose: "svg-acceptance",
        allowedKinds: ["supported", "simplified"],
        exportRequired: true
      },
      observedOutcomeKind: "supported",
      simplificationValid: null,
      inputTokens: 100,
      outputTokens: 50,
      calls: 1,
      latencyMs: 1_000,
      costExposureUsd: 0.2,
      artifactDigestBefore: digest,
      artifactDigestAfter: digest
    }]);
    expect(report["commitment-recall"].value).toBe(1);
    expect(report["prohibited-binding-rate"].value).toBe(0);
    expect(report.calls.value).toBe(1);
    expect(report["deterministic-artifact-stability"].value).toBe(1);
  });
});
