import { describe, expect, it } from "vitest";

import {
  MachineProfileSchema,
  ProcessRecipeSchema,
  StockFootprintSchema,
  basswoodProfile,
  buildSheetProjection,
  buildMultiSheetProjectionBundle,
  canonicalDocumentHash,
  canonicalGeometryHash,
  compileOrthogonalPanelProgram,
  defaultFabricationContext,
  nestParts,
  nestPartsAcrossSheets,
  provisionalFabricationProfiles,
  recordedProcessRecipe,
  serializeSheetSvg,
  xtoolM2Profile
} from "../../src/index.js";
import { boundsUm } from "../../src/kernel/geometry/metrics.js";
import { createPrimaryPreset } from "../../src/ui/content/presets.js";

function footprint(widthMm: number, heightMm: number) {
  return StockFootprintSchema.parse({
    schemaVersion: "2.0",
    widthMm,
    heightMm,
    orientation: "machine-x-y",
    materialProfileId: "basswood-3000",
    sheetId: "test-sheet",
    source: "user-reported",
    confidence: "user-reported-unreviewed",
    evidenceId: null
  });
}

describe("machine, stock-footprint, layout, and process-recipe boundaries", () => {
  it("models the M2 target structurally without inventing a stock footprint", () => {
    const machine = xtoolM2Profile();
    expect(machine).toMatchObject({
      manufacturer: "xTool",
      model: "M2",
      module: "20W blue-light laser",
      processingMode: "flat-surface-lasering",
      processingEnvelopeMm: { width: 426, height: 320 },
      downstreamApplication: "xTool Studio",
      minimumStudioDesktopVersion: "1.7.30"
    });
    expect(machine).not.toHaveProperty("bedMm");
    expect(defaultFabricationContext()).toMatchObject({
      stockFootprint: null,
      layoutPolicy: {
        symmetricPaddingMm: 5,
        purpose: "project-layout-padding-not-fixture-clearance"
      },
      placementConstraints: {
        fixtureKeepoutsModeled: false,
        magneticFixtureClearanceSource: "manual-handoff-check"
      }
    });
  });

  it("requires coherent provenance for an optional oriented stock footprint", () => {
    expect(() => StockFootprintSchema.parse({
      ...footprint(300, 200),
      source: "reviewed",
      confidence: "user-reported-unreviewed",
      evidenceId: null
    })).toThrow(/Reviewed stock footprint/);
    expect(() => StockFootprintSchema.parse({
      ...footprint(300, 200),
      source: "user-reported",
      confidence: "reviewed-evidence"
    })).toThrow(/must remain unreviewed/);
    expect(StockFootprintSchema.parse({
      ...footprint(300, 200),
      source: "reviewed",
      confidence: "reviewed-evidence",
      evidenceId: "reviewed-sheet-measurement"
    }).orientation).toBe("machine-x-y");
    expect(() => StockFootprintSchema.parse({
      ...footprint(300, 200),
      widthMm: 300.001
    })).toThrow();
  });

  it("keeps unrecorded recipes provisional and binds recorded cut width to one recipe hash", async () => {
    const material = basswoodProfile(3);
    const provisional = provisionalFabricationProfiles(material, 0.15).processRecipe;
    expect(provisional).toMatchObject({
      evidenceStatus: "unrecorded",
      recipeHash: null,
      studioKerfOffsetMm: null,
      cutWidth: { recipeHash: null, source: "provisional-preset" }
    });
    expect(() => ProcessRecipeSchema.parse({
      ...provisional,
      recipeHash: "a".repeat(64),
      cutWidth: { ...provisional.cutWidth, recipeHash: "a".repeat(64) }
    })).toThrow(/Unrecorded recipe state/);

    const recorded = await recordedProcessRecipe({
      ...provisional,
      id: "recorded-m2-basswood-recipe",
      materialBatchOrSheetId: "sheet-a",
      studioDesktopVersion: "1.7.30",
      firmwareVersion: "m2-test-firmware",
      materialPresetSource: "user-defined",
      powerPercent: 50,
      speedMmPerSecond: 10,
      passCount: 1,
      focusMode: "manual",
      focusDescentMm: null,
      builtInAirPump: "medium",
      sheetOrientation: "machine-x-grain-x",
      supportArrangement: "clean level baseplate",
      studioKerfOffsetMm: 0,
      evidenceStatus: "user-reported",
      cutWidth: { ...provisional.cutWidth, source: "reviewed-measurement" }
    });
    expect(recorded.recipeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(recorded.cutWidth.recipeHash).toBe(recorded.recipeHash);
    expect(() => ProcessRecipeSchema.parse({
      ...recorded,
      cutWidth: { ...recorded.cutWidth, recipeHash: "b".repeat(64) }
    })).toThrow(/matching process-recipe hash/);
    expect(() => ProcessRecipeSchema.parse({
      ...recorded,
      studioKerfOffsetMm: 0.1
    })).toThrow(/Kerf Offset off\/0/);
    expect(() => ProcessRecipeSchema.parse({
      ...recorded,
      focusMode: "recorded-focus-descent",
      focusDescentMm: null
    })).toThrow(/focus-descent distance/);
  });

  it("derives compact roots from compensated paths and keeps larger constraints out of SVG identity", async () => {
    const material = basswoodProfile(3);
    const baselineProfiles = provisionalFabricationProfiles(material, 0.15, 0.15, {
      fabricationContext: defaultFabricationContext(footprint(400, 300))
    });
    const baselineDocument = await compileOrthogonalPanelProgram(
      createPrimaryPreset("medium", baselineProfiles),
      baselineProfiles,
    );
    const baselineNests = nestPartsAcrossSheets(
      baselineDocument.parts,
      baselineProfiles.machine,
      material,
      baselineProfiles.processRecipe,
      baselineProfiles.fabricationContext,
    );
    const baseline = await buildMultiSheetProjectionBundle(baselineDocument, baselineNests);

    for (const sheet of baseline.bundle.fabrication.sheets) {
      const paddingUm = Math.round(sheet.rootPolicy.symmetricPaddingMm * 1_000);
      const occupiedWidthUm = sheet.occupiedBoundsUm.maxXUm - sheet.occupiedBoundsUm.minXUm;
      const occupiedHeightUm = sheet.occupiedBoundsUm.maxYUm - sheet.occupiedBoundsUm.minYUm;
      expect(sheet.occupiedBoundsUm.minXUm).toBe(paddingUm);
      expect(sheet.occupiedBoundsUm.minYUm).toBe(paddingUm);
      expect(Math.round(sheet.widthMm * 1_000)).toBe(occupiedWidthUm + paddingUm * 2);
      expect(Math.round(sheet.heightMm * 1_000)).toBe(occupiedHeightUm + paddingUm * 2);
      expect(sheet.requiredMaterialFootprintMm).toEqual({
        width: sheet.widthMm,
        height: sheet.heightMm
      });
      expect(sheet.widthMm).toBeLessThanOrEqual(sheet.effectiveNestingConstraintMm.width);
      expect(sheet.heightMm).toBeLessThanOrEqual(sheet.effectiveNestingConstraintMm.height);
    }

    const largerProfiles = provisionalFabricationProfiles(material, 0.15, 0.15, {
      machine: baselineProfiles.machine,
      fabricationContext: defaultFabricationContext(footprint(425, 319))
    });
    const largerDocument = await compileOrthogonalPanelProgram(
      createPrimaryPreset("medium", largerProfiles),
      largerProfiles,
    );
    const largerNests = nestPartsAcrossSheets(
      largerDocument.parts,
      largerProfiles.machine,
      material,
      largerProfiles.processRecipe,
      largerProfiles.fabricationContext,
    );
    const larger = await buildMultiSheetProjectionBundle(largerDocument, largerNests);
    expect(largerNests).toEqual(baselineNests);
    expect(larger.svgs).toEqual(baseline.svgs);
    expect(await canonicalGeometryHash(largerDocument)).toBe(
      await canonicalGeometryHash(baselineDocument),
    );
    expect(await canonicalDocumentHash(largerDocument)).not.toBe(
      await canonicalDocumentHash(baselineDocument),
    );

    const part = baselineDocument.parts[0]!;
    const largerMachine = MachineProfileSchema.parse({
      ...baselineProfiles.machine,
      id: "xtool-m2-larger-unconstraining-test-envelope",
      processingEnvelopeMm: { width: 500, height: 400 }
    });
    const largerMachineProfiles = provisionalFabricationProfiles(material, 0.15, 0.15, {
      machine: largerMachine
    });
    const baselineSinglePlacements = nestParts(
      [part],
      baselineProfiles.machine,
      material,
      baselineProfiles.processRecipe,
      defaultFabricationContext(),
    );
    const largerSinglePlacements = nestParts(
      [part],
      largerMachine,
      material,
      largerMachineProfiles.processRecipe,
      defaultFabricationContext(),
    );
    const baselineSheet = await buildSheetProjection(
      "machine-envelope-invariance",
      [part],
      baselineSinglePlacements,
      baselineProfiles.machine,
      baselineProfiles.processRecipe,
      defaultFabricationContext(),
    );
    const largerSheet = await buildSheetProjection(
      "machine-envelope-invariance",
      [part],
      largerSinglePlacements,
      largerMachine,
      largerMachineProfiles.processRecipe,
      defaultFabricationContext(),
    );
    expect(largerSinglePlacements).toEqual(baselineSinglePlacements);
    expect(serializeSheetSvg(largerSheet)).toBe(serializeSheetSvg(baselineSheet));
  });

  it("uses stock/envelope intersection and compensated—not nominal—bounds", async () => {
    const material = basswoodProfile(3);
    const baseline = provisionalFabricationProfiles(material, 0.15);
    const document = await compileOrthogonalPanelProgram(
      createPrimaryPreset("medium", baseline),
      baseline,
    );
    const smallContext = defaultFabricationContext(footprint(132, 102));
    const sheets = nestPartsAcrossSheets(
      document.parts,
      baseline.machine,
      material,
      baseline.processRecipe,
      smallContext,
    );
    expect(sheets.length).toBeGreaterThan(1);

    const part = document.parts[0]!;
    const nominal = boundsUm(part.nominalRegion.outer.points);
    const nominalWidthMm = (nominal.maxXUm - nominal.minXUm) / 1_000;
    const nominalHeightMm = (nominal.maxYUm - nominal.minYUm) / 1_000;
    const exactNominalEnvelope = MachineProfileSchema.parse({
      ...baseline.machine,
      id: "xtool-m2-nominal-only-test-envelope",
      processingEnvelopeMm: {
        width: nominalWidthMm + 10,
        height: nominalHeightMm + 10
      }
    });
    expect(() => nestParts(
      [part],
      exactNominalEnvelope,
      material,
      baseline.processRecipe,
      defaultFabricationContext(),
    )).toThrow(expect.objectContaining({
      code: "PART_EXCEEDS_EFFECTIVE_NESTING_CONSTRAINT",
      partId: part.id
    }));
  });
});
