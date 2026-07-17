import { describe, expect, it } from "vitest";

import {
  MaterialProfileSchema,
  NOMINAL_STOCK_PRESETS,
  measuredMaterialProfileFromStock,
  nominalMaterialProfileFromStock,
  resolveNominalStockPreset
} from "../../src/index.js";

describe("registered nominal stock catalog", () => {
  it("maps every visible stock to one versioned policy and honest starter profile", () => {
    expect(NOMINAL_STOCK_PRESETS).toHaveLength(2);
    for (const stock of NOMINAL_STOCK_PRESETS) {
      expect(stock).toMatchObject({
        version: "1.0.0",
        nominalThicknessMm: 3,
        inputPolicyId: "nominal-three-millimetre-laser-plywood",
        inputPolicyVersion: "1.1.0",
        confidence: "provisional-preset"
      });
      const profile = nominalMaterialProfileFromStock(stock.id);
      expect(profile).toMatchObject({
        materialKind: stock.materialKind,
        measuredThicknessMm: 3,
        thicknessBasis: "nominal-preset",
        nominalStock: {
          presetId: stock.id,
          presetVersion: stock.version,
          policyId: stock.inputPolicyId,
          policyVersion: stock.inputPolicyVersion
        }
      });
      expect(profile.thicknessMeasurement).toBeUndefined();
    }
  });

  it("rejects arbitrary stock IDs and public two-reading profiles", () => {
    expect(() => resolveNominalStockPreset("stock-custom-2.7mm")).toThrow(
      "Unknown registered nominal stock preset",
    );
    expect(() => measuredMaterialProfileFromStock(
      "stock-3mm-basswood-laser-plywood",
      [2.98, 3.01],
    )).toThrow("exactly one or three readings");
  });

  it("retains one or three readings and preserves birch material identity", () => {
    const one = measuredMaterialProfileFromStock(
      "stock-3mm-basswood-laser-plywood",
      [2.99],
    );
    const three = measuredMaterialProfileFromStock(
      "stock-3mm-birch-laser-plywood",
      [3.01, 2.98, 2.99],
    );
    expect(one.thicknessMeasurement?.samplesMm).toEqual([2.99]);
    expect(one.measuredThicknessMm).toBe(2.99);
    expect(three.materialKind).toBe("birch-plywood");
    expect(three.nominalThicknessMm).toBe(3);
    expect(three.measuredThicknessMm).toBe(2.99);
    expect(three.thicknessMeasurement?.samplesMm).toEqual([2.98, 2.99, 3.01]);
  });

  it("rejects contradictory source and measurement provenance", () => {
    const nominal = nominalMaterialProfileFromStock("stock-3mm-basswood-laser-plywood");
    const measured = measuredMaterialProfileFromStock(
      "stock-3mm-basswood-laser-plywood",
      [2.99],
    );
    expect(MaterialProfileSchema.safeParse({
      ...nominal,
      thicknessMeasurement: measured.thicknessMeasurement
    }).success).toBe(false);
    expect(MaterialProfileSchema.safeParse({
      ...measured,
      thicknessMeasurement: undefined
    }).success).toBe(false);
  });
});
