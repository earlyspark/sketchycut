import { describe, expect, it } from "vitest";

import { sha256 } from "../../src/domain/hash.js";
import {
  SemanticGenerationRequestV2Schema,
  prepareSemanticGenerationRequestV2,
  semanticRequestDigestV2
} from "../../src/interpretation/semantic-request-v2.js";

const modelConfiguration = {
  modelId: "fixture-model",
  reasoningEffort: "low" as const,
  imageDetailPolicy: "low" as const,
  promptLayoutVersion: "stable-prefix-v2" as const,
  maxOutputTokens: 6_000,
  serviceTier: "default" as const,
  store: false as const
};

async function prepare(brief: string) {
  return prepareSemanticGenerationRequestV2({
    brief,
    references: [],
    roleConstraints: [],
    promptIdentity: "current-neutral-prompt",
    promptHash: await sha256("fixture-prompt"),
    modelConfiguration
  });
}

describe("SemanticGenerationRequestV2", () => {
  it("supports text-only requests and excludes exact values from the semantic digest lane", async () => {
    const first = await prepare("Make a narrow case. Project external width is 120 mm.");
    const second = await prepare("Make a narrow case. Project external width is 130 mm.");

    expect(first.request.references).toEqual([]);
    expect(first.request.roleConstraints).toEqual([]);
    expect(first.request.semanticBrief).toContain("<EXACT:project.external.width>");
    expect(first.requestDigest).toBe(second.requestDigest);
    expect(first.parsedConstraints[0]?.valueUm).toBe(120_000);
    expect(second.parsedConstraints[0]?.valueUm).toBe(130_000);
    const serialized = JSON.stringify(first.request);
    expect(serialized).not.toContain("120 mm");
    expect(serialized).not.toContain("120000");
  });

  it("keeps approximate and ranged values in the semantic lane", async () => {
    const first = await prepare("Make it about 120 mm wide.");
    const second = await prepare("Make it about 130 mm wide.");
    expect(first.request.semanticBrief).toContain("120 mm");
    expect(first.parsedConstraints).toEqual([]);
    expect(first.requestDigest).not.toBe(second.requestDigest);
  });

  it("binds normalized references, roles, and the server-authored evidence index", async () => {
    const imageHash = await sha256("normalized-image-bytes");
    const prepared = await prepareSemanticGenerationRequestV2({
      brief: "Use the reference for visual treatment.",
      references: [{
        referenceId: "reference-one",
        sha256: imageHash,
        mediaType: "image/png",
        width: 1280,
        height: 720
      }],
      roleConstraints: [{ referenceId: "reference-one", roles: ["motif"] }],
      promptIdentity: "current-neutral-prompt",
      promptHash: await sha256("fixture-prompt"),
      modelConfiguration
    });
    expect(prepared.sourceEvidenceIndex.references[0]).toMatchObject({
      referenceId: "reference-one",
      contentDigest: imageHash,
      declaredRoles: ["motif"]
    });
    await expect(semanticRequestDigestV2({
      ...prepared.request,
      semanticBrief: `${prepared.request.semanticBrief} changed`
    })).rejects.toThrow("SEMANTIC_REQUEST_SOURCE_BRIEF_DIGEST_MISMATCH");
    await expect(semanticRequestDigestV2({
      ...prepared.request,
      sourceEvidenceIndex: {
        ...prepared.request.sourceEvidenceIndex,
        references: prepared.request.sourceEvidenceIndex.references.map((item) => ({
          ...item,
          contentDigest: "a".repeat(64)
        }))
      }
    })).rejects.toThrow("SEMANTIC_REQUEST_SOURCE_INDEX_DIGEST_MISMATCH");
  });

  it("rejects role constraints on an empty reference set and unknown fields", async () => {
    const valid = (await prepare("A text-only catchall.")).request;
    expect(valid.modelConfiguration.maxOutputTokens).toBe(6_000);
    expect(SemanticGenerationRequestV2Schema.safeParse({
      ...valid,
      modelConfiguration: { ...valid.modelConfiguration, maxOutputTokens: 6_001 }
    }).success).toBe(false);
    expect(SemanticGenerationRequestV2Schema.safeParse({
      ...valid,
      roleConstraints: [{ referenceId: "missing-reference", roles: ["structure"] }]
    }).success).toBe(false);
    expect(SemanticGenerationRequestV2Schema.safeParse({
      ...valid,
      exactWidthMm: 120
    }).success).toBe(false);
  });
});
