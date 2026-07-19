import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildCalibrationCouponGoldenMatrix,
  type CalibrationCouponGoldenCase
} from "../helpers/calibration-coupon-matrix.js";

const goldenUrl = new URL("../golden/calibration-coupon-matrix.json", import.meta.url);

describe("calibration coupon thickness and cut-width golden matrix", () => {
  it("matches all nine pinned deterministic projections", async () => {
    const expected = JSON.parse(await readFile(goldenUrl, "utf8")) as {
      schemaVersion: "1.0";
      matrixId: string;
      cases: CalibrationCouponGoldenCase[];
    };
    const observed = await buildCalibrationCouponGoldenMatrix();
    expect(observed).toEqual(expected);
    expect(observed.cases).toHaveLength(9);
    expect(new Set(observed.cases.map((item) => item.documentHash)).size).toBe(9);
    expect(new Set(observed.cases.map((item) => item.svgSha256)).size).toBe(9);
    expect(observed.cases.every((item) => item.sheetValidationStatus === "pass")).toBe(
      true,
    );
  });

  it("recomputes thickness-driven mating openings and kerf-driven outer toolpaths", async () => {
    const matrix = await buildCalibrationCouponGoldenMatrix();
    for (const item of matrix.cases) {
      expect(item.slotOpeningsUm).toEqual([
        Math.round((item.measuredThicknessMm - 0.1) * 1_000),
        Math.round(item.measuredThicknessMm * 1_000),
        Math.round((item.measuredThicknessMm + 0.15) * 1_000),
        Math.round((item.measuredThicknessMm + 0.2) * 1_000),
        Math.round((item.measuredThicknessMm + 0.1) * 1_000)
      ]);
      const halfKerfUm = Math.round((item.kerfMm * 1_000) / 2);
      expect(item.baseManufacturingBoundsUm).toEqual({
        minXUm: -halfKerfUm,
        minYUm: -halfKerfUm,
        maxXUm: 180_000 + halfKerfUm,
        maxYUm: 90_000 + halfKerfUm
      });
      expect(item.mesh.every((mesh) => mesh.maxZMm === item.measuredThicknessMm)).toBe(
        true,
      );
    }
  });
});
