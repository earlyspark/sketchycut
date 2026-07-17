import { describe, expect, it } from "vitest";

import {
  ACCUMULATED_KERF_GAUGE_PACKED_X_UM,
  ACCUMULATED_KERF_GAUGE_PACKED_Y_UM,
  accumulatedKerfFromPackedSpanMm,
  buildMultiSheetProjectionBundle,
  compileAccumulatedKerfGauge,
  measuredBasswoodProfile,
  nestPartsAcrossSheets,
  provisionalFabricationProfiles
} from "../../src/index.js";

function profiles(kerfXmm: number, kerfYmm = kerfXmm) {
  return provisionalFabricationProfiles(
    measuredBasswoodProfile([2.98, 3, 3.02]),
    kerfXmm,
    kerfYmm,
  );
}

describe("accumulated full-kerf measurement fixture", () => {
  it("projects ten separately linked, uncompensated, orientation-marked pieces", async () => {
    const resolved = profiles(0.15, 0.16);
    const document = await compileAccumulatedKerfGauge(resolved);
    const nests = nestPartsAcrossSheets(document.parts, resolved.machine, resolved.material, resolved.processRecipe, resolved.fabricationContext);
    const artifacts = await buildMultiSheetProjectionBundle(document, nests);
    expect(document.parts).toHaveLength(10);
    expect(document.parts.every((part) => part.features[0]?.toolpathCompensation === "none")).toBe(true);
    expect(document.parts.every((part) => part.features.some((feature) => feature.id.endsWith("orientation-marker")))).toBe(true);
    expect(document.calibrationMeasurements).toEqual([
      expect.objectContaining({
        pieceCount: 10,
        nominalPackedSpanUm: {
          x: ACCUMULATED_KERF_GAUGE_PACKED_X_UM,
          y: ACCUMULATED_KERF_GAUGE_PACKED_Y_UM
        },
        semantics: "full-cut-width",
        resultResolutionUm: 10
      })
    ]);
    expect(artifacts.bundle.scene.meshes).toHaveLength(10);
    expect(artifacts.bundle.bom.entries).toHaveLength(10);
    expect(artifacts.bundle.legend?.entries).toHaveLength(10);
    expect(artifacts.bundle.instructions?.steps).toHaveLength(2);
    expect(nests.flatMap((nest) => nest.placements).every((placement) => placement.rotationDegrees === 0)).toBe(true);
  });

  it("keeps fixture manufacturing SVG byte-identical across provisional kerf inputs", async () => {
    const low = profiles(0.05, 0.06);
    const high = profiles(0.39, 0.4);
    const project = async (resolved: ReturnType<typeof profiles>) => {
      const document = await compileAccumulatedKerfGauge(resolved);
      return buildMultiSheetProjectionBundle(
        document,
        nestPartsAcrossSheets(document.parts, resolved.machine, resolved.material, resolved.processRecipe, resolved.fabricationContext),
      );
    };
    const [lowArtifacts, highArtifacts] = await Promise.all([project(low), project(high)]);
    expect(lowArtifacts.svgs).toEqual(highArtifacts.svgs);
  });

  it("recovers known accumulated X and Y full kerfs before 0.01 mm quantization", () => {
    expect(accumulatedKerfFromPackedSpanMm(120, 118.5)).toBe(0.15);
    expect(accumulatedKerfFromPackedSpanMm(100, 98.4)).toBe(0.16);
    expect(accumulatedKerfFromPackedSpanMm(120, 118.46)).toBe(0.15);
  });
});
