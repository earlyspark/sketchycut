import { describe, expect, it } from "vitest";

import {
  assertIntentExcludesRawBrief,
  intentContainsRawBrief,
  removeRawBriefCopiesFromIntent
} from "../../src/interpretation/intent-privacy.js";
import { buildFixtureIntent, FIXTURE_SCENARIOS } from "../../src/interpretation/fixture-corpus.js";
import { IntentGraphV1Schema } from "../../src/interpretation/intent-graph.js";
import { normalizeSemanticGenerationRequest } from "../../src/interpretation/semantic-request.js";

const scenario = FIXTURE_SCENARIOS[0]!;
const request = normalizeSemanticGenerationRequest({
  brief: scenario.brief,
  references: [{
    referenceId: "privacy-reference",
    sha256: "a".repeat(64),
    mediaType: "image/png",
    width: 320,
    height: 240
  }],
  roleConstraints: [],
  modelConfiguration: {
    modelId: "gpt-5.6-terra",
    reasoningEffort: "low",
    maxOutputTokens: 4_000,
    serviceTier: "default",
    store: false
  }
});

describe("semantic intent privacy", () => {
  it("removes exact full-brief copies only from semantic text fields", () => {
    const candidate = buildFixtureIntent(request, scenario);
    const sanitized = removeRawBriefCopiesFromIntent(candidate, request.normalizedBrief);
    expect(intentContainsRawBrief(sanitized, request.normalizedBrief)).toBe(false);
    expect(sanitized.coreIntent).not.toContain(request.normalizedBrief);
    expect(sanitized.requirements).toHaveLength(1);
    expect(() => assertIntentExcludesRawBrief(sanitized, request.normalizedBrief)).not.toThrow();
  });

  it("fails closed when an unsanitized intent reaches persistence's guard", () => {
    expect(() => assertIntentExcludesRawBrief(candidate(), request.normalizedBrief))
      .toThrow("SEMANTIC_INTENT_RAW_BRIEF_PRESENT");
  });

  it("finds a raw brief hidden in a non-prose identifier field", () => {
    const hiddenBrief = request.references[0]!.referenceId;
    const intent = IntentGraphV1Schema.parse(candidate());
    expect(intentContainsRawBrief(intent, hiddenBrief)).toBe(true);
    expect(() => assertIntentExcludesRawBrief(intent, hiddenBrief))
      .toThrow("SEMANTIC_INTENT_RAW_BRIEF_PRESENT");
  });

  it("fails closed when semantic sanitization cannot safely rewrite a non-prose field", () => {
    const hiddenBrief = request.references[0]!.referenceId;
    expect(() => removeRawBriefCopiesFromIntent(candidate(), hiddenBrief))
      .toThrow("SEMANTIC_INTENT_RAW_BRIEF_PRESENT");
  });
});

function candidate() {
  return buildFixtureIntent(request, scenario);
}
