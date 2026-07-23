import { describe, expect, it } from "vitest";

import { compileCalibrationCoupon } from "../../src/operators/calibration-coupon.js";
import { nestParts } from "../../src/projections/fabrication/nesting.js";
import { buildSheetProjection } from "../../src/projections/fabrication/sheet.js";
import { validateSheetProjection } from "../../src/validation/sheet.js";

describe("sheet projection validation", () => {
  it("accepts the deterministic coupon nest", async () => {
    const document = await compileCalibrationCoupon({
      measuredThicknessMm: 3,
      kerfMm: 0.15
    });
    const placements = nestParts(
      document.parts,
      document.resolvedInputs.machine,
      document.resolvedInputs.material,
      document.resolvedInputs.processRecipe,
      document.resolvedInputs.fabricationContext,
    );
    const sheet = await buildSheetProjection(
      "sheet-1",
      document.parts,
      placements,
      document.resolvedInputs.machine,
      document.resolvedInputs.processRecipe,
      document.resolvedInputs.fabricationContext,
    );
    expect(validateSheetProjection(sheet, document.parts)).toEqual({
      schemaVersion: "2.0",
      status: "pass",
      findings: []
    });
  });

  it("rejects duplicate cut segments and paths outside the bed", async () => {
    const document = await compileCalibrationCoupon({
      measuredThicknessMm: 3,
      kerfMm: 0.15
    });
    const placements = nestParts(
      document.parts,
      document.resolvedInputs.machine,
      document.resolvedInputs.material,
      document.resolvedInputs.processRecipe,
      document.resolvedInputs.fabricationContext,
    );
    const sheet = await buildSheetProjection(
      "sheet-1",
      document.parts,
      placements,
      document.resolvedInputs.machine,
      document.resolvedInputs.processRecipe,
      document.resolvedInputs.fabricationContext,
    );
    const firstCut = sheet.paths.find((path) => path.operation === "cut")!;
    const invalid = {
      ...sheet,
      placements: sheet.placements.map((placement, index) =>
        index === 0 ? { ...placement, xUm: -500_000 } : placement,
      ),
      paths: [
        ...sheet.paths,
        {
          ...firstCut,
          id: "duplicated-cut-path"
        }
      ]
    };
    const codes = validateSheetProjection(invalid, document.parts).findings.map(
      (item) => item.code,
    );
    expect(codes).toContain("PATH_OUTSIDE_SHEET");
    expect(codes).toContain("DUPLICATE_CUT_SEGMENT");
  });
});
