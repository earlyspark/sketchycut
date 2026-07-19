import { describe, expect, it } from "vitest";

import { GenerationSubmissionV1Schema } from "../../src/interpretation/generation-protocol.js";
import { DEFAULT_GENERATED_CONTROLS } from "../../src/interpretation/generated-project-contracts.js";
import {
  DEFAULT_GENERATED_FABRICATION_CONTROLS,
  resolveGeneratedFabricationControls
} from "../../src/ui/content/generated-setup.js";

const submission = {
  schemaVersion: "1.0",
  brief: "A synthetic test brief.",
  references: [{
    descriptor: {
      referenceId: "reference-1",
      sha256: "a".repeat(64),
      mediaType: "image/png",
      width: 10,
      height: 10
    },
    dataUrl: "data:image/png;base64,AA=="
  }],
  roleConstraints: [],
  deterministicControls: DEFAULT_GENERATED_CONTROLS,
  fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
  retry: null
};

describe("current generation protocol and deterministic setup", () => {
  it("strictly rejects unknown fields and never accepts a filename field", () => {
    expect(GenerationSubmissionV1Schema.safeParse(submission).success).toBe(true);
    expect(GenerationSubmissionV1Schema.safeParse({ ...submission, filename: "private.png" }).success).toBe(false);
    expect(GenerationSubmissionV1Schema.safeParse({
      ...submission,
      references: [{ ...submission.references[0], filename: "private.png" }]
    }).success).toBe(false);
  });

  it("resolves 12-inch stock, material, fit, and nesting controls deterministically", () => {
    const baseline = resolveGeneratedFabricationControls(DEFAULT_GENERATED_FABRICATION_CONTROLS);
    const edited = resolveGeneratedFabricationControls({
      ...DEFAULT_GENERATED_FABRICATION_CONTROLS,
      stockPresetId: "stock-3mm-birch-laser-plywood",
      fullCutWidthMm: 0.18,
      fitBiasMm: 0.05,
      stockFootprintMm: { width: 304.8, height: 250 }
    });
    expect(baseline.profiles.fabricationContext.stockFootprint).toMatchObject({
      widthMm: 304.8,
      heightMm: 304.8
    });
    expect(edited.profiles.material.materialKind).toBe("birch-plywood");
    expect(edited.profiles.processRecipe.cutWidth).toMatchObject({ xMm: 0.18, yMm: 0.18 });
    expect(edited.profiles.fit.snug.totalDeltaMm - baseline.profiles.fit.snug.totalDeltaMm).toBeCloseTo(0.05);
    expect(edited.profiles.fabricationContext.stockFootprint?.heightMm).toBe(250);
  });
});
