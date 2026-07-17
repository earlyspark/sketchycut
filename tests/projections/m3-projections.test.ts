import { describe, expect, it } from "vitest";

import {
  buildMultiSheetProjectionBundle,
  canonicalDocumentHash,
  canonicalStockHash,
  nestPartsAcrossSheets,
  validateFabricationProjection
} from "../../src/index.js";
import { compileM3Fixture } from "../helpers/m3-fixtures.js";

describe("M3 linked projections", () => {
  it("projects one canonical motion and external stock identity through scene, BOM, and instructions but never SVG", async () => {
    const value = await compileM3Fixture("hinged-lid-box");
    const artifacts = await buildMultiSheetProjectionBundle(
      value.document,
      nestPartsAcrossSheets(value.document.parts, value.profiles.machine, value.profiles.material),
    );
    const { bundle } = artifacts;
    const sourceHash = await canonicalDocumentHash(value.document);
    expect(new Set([
      sourceHash,
      bundle.sourceDocumentHash,
      bundle.fabrication.sourceDocumentHash,
      bundle.scene.sourceDocumentHash,
      bundle.bom.sourceDocumentHash,
      bundle.legend?.sourceDocumentHash,
      bundle.instructions?.sourceDocumentHash
    ])).toHaveLength(1);
    expect(bundle.scene.states.map((state) => state.kind)).toEqual([
      "assembled",
      "exploded",
      "open"
    ]);
    expect(bundle.scene.motions).toEqual([
      expect.objectContaining({
        constraintId: "retained-pin-axis",
        bodyPartIds: ["cover-panel", "hinge-station-2", "hinge-station-4"],
        rangeDegrees: { minimum: 0, maximum: 105 },
        rotationSign: -1,
        animationSampleMaximumDegrees: 2
      })
    ]);
    const stock = value.document.externalStock![0]!;
    const stockMesh = bundle.scene.meshes.find((mesh) => mesh.stockItemId === stock.id);
    const stockBom = bundle.bom.entries.find((entry) => entry.stockItemId === stock.id);
    expect(stockMesh).toMatchObject({
      partId: stock.id,
      itemKind: "external-stock",
      stockItemId: stock.id,
      sourcePartHash: await canonicalStockHash(stock)
    });
    expect(stockBom).toMatchObject({
      partId: stock.id,
      entryKind: "external-stock",
      stockItemId: stock.id,
      sourcePartHash: await canonicalStockHash(stock),
      cutLengthMm: 85.2,
      measuredDiameterMm: 3,
      evidenceState: "user-reported"
    });
    expect(
      bundle.fabrication.sheets.flatMap((sheet) => sheet.placements).some(
        (placement) => placement.partId === stock.id,
      ),
    ).toBe(false);
    expect(artifacts.svgs.some((item) => item.svg.includes(stock.id))).toBe(false);
    expect(
      bundle.instructions?.steps.filter((step) => step.stockItemIds?.includes(stock.id)).map(
        (step) => [step.instructionKey, step.phase],
      ),
    ).toEqual([
      ["insert-measured-pin", "assembly"],
      ["withdraw-measured-pin", "disassembly"]
    ]);
    expect(validateFabricationProjection(bundle.fabrication, value.document.parts).status).toBe("pass");
  });

  it("preserves every sheet-part ID exactly once across SVG, mesh, BOM, legend, and instructions", async () => {
    const value = await compileM3Fixture("hinged-flap");
    const artifacts = await buildMultiSheetProjectionBundle(
      value.document,
      nestPartsAcrossSheets(value.document.parts, value.profiles.machine, value.profiles.material),
    );
    const partIds = value.document.parts.map((part) => part.id).sort();
    expect(
      artifacts.bundle.fabrication.sheets.flatMap((sheet) =>
        sheet.placements.map((placement) => placement.partId),
      ).sort(),
    ).toEqual(partIds);
    expect(
      artifacts.bundle.scene.meshes
        .filter((mesh) => mesh.itemKind !== "external-stock")
        .map((mesh) => mesh.partId)
        .sort(),
    ).toEqual(partIds);
    expect(
      artifacts.bundle.bom.entries
        .filter((entry) => entry.entryKind !== "external-stock")
        .map((entry) => entry.partId)
        .sort(),
    ).toEqual(partIds);
    expect(artifacts.bundle.legend?.entries.map((entry) => entry.partId).sort()).toEqual(partIds);
    expect(
      new Set(artifacts.bundle.instructions?.steps.flatMap((step) => step.partIds)),
    ).toEqual(new Set(partIds));
  });
});
