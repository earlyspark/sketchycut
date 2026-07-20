import { describe, expect, it } from "vitest";

import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
  GenerationSubmissionV2Schema
} from "../../src/interpretation/generation-submission-v2.js";

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
    schemaVersion: "2.0" as const,
    brief: "Make an open-front organizer.",
    references: [] as ReturnType<typeof reference>[],
    roleConstraints: [] as { referenceId: string; roles: ("structure" | "motif")[] }[],
    deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
    fabricationControls,
    retry: null
  };
}

describe("GenerationSubmissionV2", () => {
  it("starts in auto sizing without hidden default dimensions", () => {
    const parsed = GenerationSubmissionV2Schema.parse(submission());
    expect(parsed.references).toEqual([]);
    expect(parsed.roleConstraints).toEqual([]);
    expect(parsed.deterministicControls.advancedSizing).toEqual({ basis: "auto" });
    expect(JSON.stringify(parsed.deterministicControls)).not.toContain("120");
    expect(JSON.stringify(parsed.deterministicControls)).not.toContain("90");
    expect(JSON.stringify(parsed.deterministicControls)).not.toContain("58");
  });

  it("accepts exact external or internal partial axes at 0.01 mm resolution", () => {
    expect(GenerationSubmissionV2Schema.parse({
      ...submission(),
      deterministicControls: {
        ...DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
        advancedSizing: {
          basis: "exact-external",
          dimensions: { widthMm: 127.35, heightMm: 48.2 }
        }
      }
    }).deterministicControls.advancedSizing).toMatchObject({ basis: "exact-external" });
    expect(GenerationSubmissionV2Schema.safeParse({
      ...submission(),
      deterministicControls: {
        ...DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
        advancedSizing: { basis: "exact-internal", dimensions: {} }
      }
    }).success).toBe(false);
  });

  it("accepts zero through three references and enforces role ownership and order", () => {
    const references = [reference("reference-1"), reference("reference-2"), reference("reference-3")];
    expect(GenerationSubmissionV2Schema.safeParse({
      ...submission(),
      references,
      roleConstraints: [
        { referenceId: "reference-1", roles: ["structure"] },
        { referenceId: "reference-3", roles: ["motif"] }
      ]
    }).success).toBe(true);
    expect(GenerationSubmissionV2Schema.safeParse({
      ...submission(),
      references,
      roleConstraints: [
        { referenceId: "reference-3", roles: ["motif"] },
        { referenceId: "reference-1", roles: ["structure"] }
      ]
    }).success).toBe(false);
    expect(GenerationSubmissionV2Schema.safeParse({
      ...submission(),
      roleConstraints: [{ referenceId: "missing", roles: ["structure"] }]
    }).success).toBe(false);
    expect(GenerationSubmissionV2Schema.safeParse({
      ...submission(),
      references: [...references, reference("reference-4")]
    }).success).toBe(false);
  });
});
