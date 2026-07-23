import { describe, expect, it } from "vitest";

import { sha256 } from "../../src/domain/hash.js";
import { CURRENT_FIXTURE_SCENARIOS } from "../../src/interpretation/current-fixture-corpus.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
  GenerationSubmissionSchema
} from "../../src/interpretation/generation-submission.js";

const fabricationControls = {
  stockPresetId: "stock-3mm-basswood-laser-plywood" as const,
  thickness: { basis: "nominal-preset" as const },
  fullCutWidthMm: 0.15,
  fitBiasMm: 0 as const,
  stockFootprintMm: { width: 304.8, height: 304.8 }
};

const reference = (id: string) => ({
  descriptor: {
    referenceId: id,
    sha256: id.endsWith("1") ? "1".repeat(64) : id.endsWith("2") ? "2".repeat(64) : "3".repeat(64),
    mediaType: "image/png" as const,
    width: 16,
    height: 16
  },
  dataUrl: "data:image/png;base64,AA=="
});

function submission() {
  return {
    schemaVersion: "4.0" as const,
    brief: "Make an open-front organizer.",
    references: [] as ReturnType<typeof reference>[],
    roleConstraints: [] as { referenceId: string; roles: ("structure" | "surface")[] }[],
    deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
    fabricationControls,
    retry: null
  };
}

describe("GenerationSubmission", () => {
  it("keeps browser-safe fixture replay digests bound to the exact normalized brief", async () => {
    for (const scenario of CURRENT_FIXTURE_SCENARIOS) {
      expect(await sha256(scenario.brief)).toBe(scenario.briefDigest);
    }
  });

  it("starts in auto sizing without hidden default dimensions", () => {
    const parsed = GenerationSubmissionSchema.parse(submission());
    expect(parsed.references).toEqual([]);
    expect(parsed.roleConstraints).toEqual([]);
    expect(parsed.deterministicControls.advancedSizing).toEqual({ basis: "auto" });
    expect(JSON.stringify(parsed.deterministicControls)).not.toContain("120");
    expect(JSON.stringify(parsed.deterministicControls)).not.toContain("90");
    expect(JSON.stringify(parsed.deterministicControls)).not.toContain("58");
  });

  it("accepts exact external or internal partial axes at 0.01 mm resolution", () => {
    expect(GenerationSubmissionSchema.parse({
      ...submission(),
      deterministicControls: {
        ...DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
        advancedSizing: {
          basis: "exact-external",
          dimensions: { widthMm: 127.35, heightMm: 48.2 }
        }
      }
    }).deterministicControls.advancedSizing).toMatchObject({ basis: "exact-external" });
    expect(GenerationSubmissionSchema.safeParse({
      ...submission(),
      deterministicControls: {
        ...DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
        advancedSizing: { basis: "exact-internal", dimensions: {} }
      }
    }).success).toBe(false);
  });

  it("accepts zero through three references and enforces role ownership and order", () => {
    const references = [reference("reference-1"), reference("reference-2"), reference("reference-3")];
    expect(GenerationSubmissionSchema.safeParse({
      ...submission(),
      references,
      roleConstraints: [
        { referenceId: "reference-1", roles: ["structure"] },
        { referenceId: "reference-2", roles: ["structure", "surface"] },
        { referenceId: "reference-3", roles: ["surface"] }
      ]
    }).success).toBe(true);
    expect(GenerationSubmissionSchema.safeParse({
      ...submission(),
      references,
      roleConstraints: [
        { referenceId: "reference-3", roles: ["surface"] },
        { referenceId: "reference-2", roles: ["structure", "surface"] },
        { referenceId: "reference-1", roles: ["structure"] }
      ]
    }).success).toBe(false);
    expect(GenerationSubmissionSchema.safeParse({
      ...submission(),
      references,
      roleConstraints: [
        { referenceId: "reference-1", roles: ["structure"] },
        { referenceId: "reference-3", roles: ["surface"] }
      ]
    }).success).toBe(false);
    expect(GenerationSubmissionSchema.safeParse({
      ...submission(),
      roleConstraints: [{ referenceId: "missing", roles: ["structure"] }]
    }).success).toBe(false);
    expect(GenerationSubmissionSchema.safeParse({
      ...submission(),
      references: [...references, reference("reference-4")]
    }).success).toBe(false);
  });
});
