import { describe, expect, it } from "vitest";

import {
  createStarterFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/index.js";
import {
  AVAILABLE_GUIDED_EXAMPLES,
  buildGuidedProductCompileRequest
} from "../../src/ui/content/guided-examples.js";
import { resolveMotionPresentation } from "../../src/ui/motion-presentation.js";
import { compileProductRequest } from "../../src/workers/compile-service.js";

async function compileAt(index: number) {
  const resolved = resolveFabricationSetup(createStarterFabricationSetup());
  const profiles = {
    material: resolved.material,
    machine: resolved.machine,
    processRecipe: resolved.processRecipe,
    fabricationContext: resolved.fabricationContext,
    fit: resolved.fit
  };
  const entry = AVAILABLE_GUIDED_EXAMPLES[index]!;
  const result = await compileProductRequest(buildGuidedProductCompileRequest(entry, {
    requestId: `motion-${String(index)}`,
    presetId: "medium",
    profiles,
    inputPolicyEvaluation: resolved.inputPolicyEvaluation,
    retainedPin: createStarterPinSetup()
  }));
  return { entry, result };
}

describe("capability-driven motion presentation", () => {
  it("derives a rigid Basic scene with no movable control", async () => {
    const { entry, result } = await compileAt(0);
    expect(resolveMotionPresentation(
      result.document,
      result.bundle.scene,
      entry.motionPresentation,
    )).toEqual({
      kind: "rigid",
      restStateLabel: "Assembled",
      validationSummary: "No moving joint · rigid assembly"
    });
    expect(result.bundle.scene.states.map((state) => state.kind)).toEqual([
      "assembled",
      "exploded"
    ]);
  });

  it("joins the Hinged scene motion to its canonical constraint and stop", async () => {
    const { entry, result } = await compileAt(1);
    const resolved = resolveMotionPresentation(
      result.document,
      result.bundle.scene,
      entry.motionPresentation,
    );
    expect(resolved).toMatchObject({
      kind: "revolute",
      constraintId: "retained-pin-axis",
      minimumDegrees: 0,
      maximumDegrees: 105,
      openStopDegrees: 105,
      restStateLabel: "Closed",
      endpointStateLabel: "Open",
      validationSummary: "One rotating joint · 0–105°"
    });
  });

  it("rejects a scene motion whose canonical constraint cannot be resolved", async () => {
    const { entry, result } = await compileAt(1);
    const scene = structuredClone(result.bundle.scene);
    scene.motions![0]!.constraintId = "missing-constraint";
    expect(() => resolveMotionPresentation(
      result.document,
      scene,
      entry.motionPresentation,
    )).toThrow(/unknown constraint/);
  });
});
