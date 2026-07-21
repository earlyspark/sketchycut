import { describe, expect, it } from "vitest";

import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
  GenerationSubmissionV2Schema
} from "../../src/interpretation/generation-submission-v2.js";
import {
  GENERATION_COST_ENVELOPE_POLICY,
  GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT,
  GENERATION_OPENAI_PRICE,
  attributeGenerationInputBytes,
  estimateGenerationCostUsd,
  evaluateGenerationCostEnvelope,
  generationSubmissionFitsRequestCeiling,
  generationSubmissionRequestBytes
} from "../../src/server/generation/cost-envelope.js";
import { GENERATION_POLICY } from "../../src/server/generation/policy.js";

const fabricationControls = {
  stockPresetId: "stock-3mm-basswood-laser-plywood" as const,
  thickness: { basis: "nominal-preset" as const },
  fullCutWidthMm: 0.15,
  fitBiasMm: 0 as const,
  stockFootprintMm: { width: 304.8, height: 304.8 }
};

function maximalSubmission(referenceCount: number) {
  const base64 = Buffer.alloc(GENERATION_POLICY.image.maximumNormalizedBytes).toString("base64");
  return GenerationSubmissionV2Schema.parse({
    schemaVersion: "2.0",
    brief: "😀".repeat(1_000),
    references: Array.from({ length: referenceCount }, (_, index) => ({
      descriptor: {
        referenceId: `reference-${String(index + 1)}`,
        sha256: String(index + 1).repeat(64),
        mediaType: "image/png",
        width: 1_280,
        height: 1_280
      },
      dataUrl: `data:image/png;base64,${base64}`
    })),
    roleConstraints: [],
    deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
    fabricationControls,
    retry: null
  });
}

describe("current generation request and cost envelope", () => {
  it("pins the verified Sol price inputs and uses one runtime estimator", () => {
    expect(GENERATION_OPENAI_PRICE).toMatchObject({
      uncachedInputUsdPerMillion: 5,
      cachedInputUsdPerMillion: 0.5,
      cacheWriteInputUsdPerMillion: 6.25,
      outputUsdPerMillion: 30,
      requestBudgetUpperBoundUsd: 0.5
    });
    expect(estimateGenerationCostUsd({
      inputTokens: 75_000,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT
    })).toBe(0.495);
    expect(() => estimateGenerationCostUsd({
      inputTokens: 1,
      cachedInputTokens: 2,
      cacheWriteInputTokens: 0,
      outputTokens: 0
    })).toThrow();
  });

  it("keeps both zero-reference and three-reference HTTP extremes below 4.25 MB", () => {
    const zero = maximalSubmission(0);
    const three = maximalSubmission(3);
    expect(generationSubmissionFitsRequestCeiling(zero)).toBe(true);
    expect(generationSubmissionFitsRequestCeiling(three)).toBe(true);
    expect(generationSubmissionRequestBytes(three)).toBeLessThanOrEqual(
      GENERATION_POLICY.image.maximumGenerationRequestBytes
    );
    expect(generationSubmissionRequestBytes(three)).toBeGreaterThan(
      generationSubmissionRequestBytes(zero)
    );
  });

  it("proves the text, low-detail image, output, and reservation bounds together", () => {
    const zero = evaluateGenerationCostEnvelope({
      modelTextInput: "a".repeat(GENERATION_COST_ENVELOPE_POLICY.maximumModelTextInputUtf8Bytes),
      referenceCount: 0,
      imageDetailPolicy: "low"
    });
    const three = evaluateGenerationCostEnvelope({
      modelTextInput: "a".repeat(GENERATION_COST_ENVELOPE_POLICY.maximumModelTextInputUtf8Bytes),
      referenceCount: 3,
      imageDetailPolicy: "low"
    });
    expect(zero.withinDeclaredEnvelope).toBe(true);
    expect(three).toMatchObject({
      totalInputTokenUpperBound: 75_000,
      outputTokenUpperBound: 4_000,
      estimatedUpperBoundUsd: 0.495,
      reservedUpperBoundUsd: 0.5,
      reservedUpperBoundMicrousd: 500_000,
      withinDeclaredEnvelope: true
    });
    expect(GENERATION_COST_ENVELOPE_POLICY.maximumFiveCaseRoundExposureMicrousd).toBe(2_500_000);
    expect(evaluateGenerationCostEnvelope({
      modelTextInput: "a".repeat(GENERATION_COST_ENVELOPE_POLICY.maximumModelTextInputUtf8Bytes + 1),
      referenceCount: 3,
      imageDetailPolicy: "low"
    }).withinDeclaredEnvelope).toBe(false);
  });

  it("prices every predeclared higher-fidelity image policy without hiding its larger bound", () => {
    const high = evaluateGenerationCostEnvelope({
      modelTextInput: "stable semantic prefix",
      referenceCount: 3,
      imageDetailPolicy: "high"
    });
    const mixed = evaluateGenerationCostEnvelope({
      modelTextInput: "stable semantic prefix",
      referenceCount: 3,
      imageDetailPolicy: "mixed-first-high"
    });
    expect(high).toMatchObject({ imageInputTokenUpperBound: 24_000, withinDeclaredEnvelope: true });
    expect(mixed).toMatchObject({ imageInputTokenUpperBound: 10_000, withinDeclaredEnvelope: true });
    expect(high.estimatedUpperBoundUsd).toBeGreaterThan(mixed.estimatedUpperBoundUsd);
    expect(evaluateGenerationCostEnvelope({
      modelTextInput: "a".repeat(GENERATION_COST_ENVELOPE_POLICY.maximumModelTextInputUtf8Bytes),
      referenceCount: 3,
      imageDetailPolicy: "high"
    }).withinDeclaredEnvelope).toBe(false);
  });

  it("attributes static and variable input bytes before prompt-size changes", () => {
    const attribution = attributeGenerationInputBytes({
      prompt: "stable instructions",
      briefs: ["case one", "case two"],
      referenceDescriptors: [{ referenceId: "reference-one" }]
    });
    expect(attribution.staticUtf8Bytes).toBe(
      attribution.promptUtf8Bytes +
      attribution.capabilityCatalogUtf8Bytes +
      attribution.intentSchemaUtf8Bytes
    );
    expect(attribution.variableUtf8Bytes).toBe(
      attribution.variableBriefUtf8Bytes + attribution.variableReferenceDescriptorUtf8Bytes
    );
    expect(attribution.staticUtf8Bytes).toBeGreaterThan(attribution.variableUtf8Bytes);
  });
});
