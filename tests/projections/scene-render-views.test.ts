import { describe, expect, it } from "vitest";

import { createPublicFabricationSetup, createStarterPinSetup, resolveFabricationSetup } from "../../src/domain/fabrication-setup.js";
import { renderSceneSvg } from "../../src/projections/mesh/render-svg.js";
import { AVAILABLE_GUIDED_EXAMPLES, buildGuidedProductCompileRequest } from "../../src/ui/content/guided-examples.js";
import { compileProductRequest } from "../../src/workers/compile-service.js";

describe("review-only canonical scene viewpoints", () => {
  it("renders four deterministic, distinct viewpoints from one canonical scene", async () => {
    const setup = resolveFabricationSetup(createPublicFabricationSetup());
    const result = await compileProductRequest(buildGuidedProductCompileRequest(AVAILABLE_GUIDED_EXAMPLES[0]!, {
      requestId: "scene-view-proof",
      presetId: "medium",
      profiles: { material: setup.material, machine: setup.machine, processRecipe: setup.processRecipe, fabricationContext: setup.fabricationContext, fit: setup.fit },
      inputPolicyEvaluation: setup.inputPolicyEvaluation,
      retainedPin: createStarterPinSetup()
    }));
    const views = (["isometric", "opposed-isometric", "top", "front"] as const).map((view) =>
      renderSceneSvg(result.bundle.scene, "assembled", 800, 560, view));
    expect(new Set(views).size).toBe(4);
    for (const [index, view] of (["isometric", "opposed-isometric", "top", "front"] as const).entries()) {
      expect(views[index]).toContain(`data-view="${view}"`);
      expect(views[index]).toContain("interactive simulation, not a physical test");
    }
  });
});
