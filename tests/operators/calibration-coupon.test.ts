import { describe, expect, it } from "vitest";

import { DesignDocumentV1Schema } from "../../src/domain/contracts.js";
import { compileCalibrationCoupon } from "../../src/operators/calibration-coupon.js";
import { buildProjectionBundle } from "../../src/projections/bundle.js";
import { nestParts } from "../../src/projections/fabrication/nesting.js";

describe("calibration coupon operator", () => {
  it("builds one strict canonical document with explicit assembly and zero runtime API calls", async () => {
    const document = await compileCalibrationCoupon({ measuredThicknessMm: 3, kerfMm: 0.15 });
    expect(DesignDocumentV1Schema.parse(document)).toEqual(document);
    expect(document.parts.map((part) => part.id)).toEqual(["coupon-base", "coupon-insert"]);
    expect(document.joints).toHaveLength(1);
    expect(document.assemblyPlan.map((action) => action.order)).toEqual([0, 1, 2]);
    expect(document.provenance.runtimeApplicationApiCalls).toBe(0);
    expect(document.validation.status).toBe("pass");
  });

  it("recomputes every thickness-driven slot, insert thickness, scene mesh, and manufacturing path", async () => {
    const low = await compileCalibrationCoupon({ measuredThicknessMm: 2.7, kerfMm: 0.1 });
    const high = await compileCalibrationCoupon({ measuredThicknessMm: 3.3, kerfMm: 0.2 });
    const lowSlots = low.parts[0]!.features
      .filter((feature) => feature.kind === "slot")
      .map((feature) => feature.parametersUm.opening);
    const highSlots = high.parts[0]!.features
      .filter((feature) => feature.kind === "slot")
      .map((feature) => feature.parametersUm.opening);
    expect(
      highSlots.every((opening, index) => {
        const lowOpening = lowSlots[index];
        return opening !== undefined && lowOpening !== undefined && opening - lowOpening === 600;
      }),
    ).toBe(true);
    expect(low.parts.every((part) => part.thicknessUm === 2_700)).toBe(true);
    expect(high.parts.every((part) => part.thicknessUm === 3_300)).toBe(true);

    const lowPlacements = nestParts(low.parts, low.resolvedInputs.machine, low.resolvedInputs.material, low.resolvedInputs.processRecipe, low.resolvedInputs.fabricationContext);
    const highPlacements = nestParts(high.parts, high.resolvedInputs.machine, high.resolvedInputs.material, high.resolvedInputs.processRecipe, high.resolvedInputs.fabricationContext);
    const lowProjection = await buildProjectionBundle(low, lowPlacements);
    const highProjection = await buildProjectionBundle(high, highPlacements);
    expect(lowProjection.bundle.sourceDocumentHash).not.toBe(highProjection.bundle.sourceDocumentHash);
    expect(lowProjection.bundle.scene.meshes.map((mesh) => Math.max(...mesh.verticesMm.map((vertex) => vertex.zMm)))).toEqual([
      2.7,
      2.7
    ]);
    expect(highProjection.bundle.scene.meshes.map((mesh) => Math.max(...mesh.verticesMm.map((vertex) => vertex.zMm)))).toEqual([
      3.3,
      3.3
    ]);
    expect(lowProjection.svg).not.toBe(highProjection.svg);
  });

  it("nests deterministically within the machine bed while preserving plywood grain", async () => {
    const document = await compileCalibrationCoupon({ measuredThicknessMm: 3, kerfMm: 0.15 });
    const first = nestParts(document.parts, document.resolvedInputs.machine, document.resolvedInputs.material, document.resolvedInputs.processRecipe, document.resolvedInputs.fabricationContext);
    const second = nestParts(document.parts, document.resolvedInputs.machine, document.resolvedInputs.material, document.resolvedInputs.processRecipe, document.resolvedInputs.fabricationContext);
    expect(first).toEqual(second);
    expect(first.every((placement) => placement.rotationDegrees === 0)).toBe(true);
    expect(first.every((placement) => placement.xUm >= 5_000 && placement.yUm >= 5_000)).toBe(true);
  });
});
