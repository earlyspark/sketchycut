import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";

import {
  PartFeatureSchema,
  type PartFeature
} from "../../src/domain/contracts.js";
import { compileCalibrationCoupon } from "../../src/operators/calibration-coupon.js";
import { ENGRAVE_SVG_REPRESENTATION } from "../../src/projections/fabrication/svg.js";
import { buildProjectionBundle } from "../../src/projections/bundle.js";
import { nestParts } from "../../src/projections/fabrication/nesting.js";
import { projectManufacturingPaths } from "../../src/projections/fabrication/manufacturing.js";
import { validateParts } from "../../src/validation/geometry.js";

function openEngraveFeature(): PartFeature {
  return {
    id: "open-engrave",
    kind: "engrave-sample",
    operation: "engrave",
    fitClass: null,
    jointId: null,
    region: null,
    path: {
      id: "open-engrave-path",
      closed: false,
      points: [{ xUm: 0, yUm: 0 }, { xUm: 10_000, yUm: 0 }]
    },
    parametersUm: {}
  };
}

describe("Score and vector-Engrave manufacturing semantics", () => {
  it("rejects open and compound Engrave features at the canonical boundary", () => {
    expect(PartFeatureSchema.safeParse(openEngraveFeature()).success).toBe(false);
    const compound = {
      ...openEngraveFeature(),
      region: {
        outer: {
          id: "engrave-outer",
          closed: true as const,
          points: [
            { xUm: 0, yUm: 0 }, { xUm: 10_000, yUm: 0 },
            { xUm: 10_000, yUm: 10_000 }, { xUm: 0, yUm: 10_000 }
          ]
        },
        holes: [{
          id: "engrave-hole",
          closed: true as const,
          points: [
            { xUm: 2_000, yUm: 2_000 }, { xUm: 2_000, yUm: 4_000 },
            { xUm: 4_000, yUm: 4_000 }, { xUm: 4_000, yUm: 2_000 }
          ]
        }]
      },
      path: null
    };
    expect(PartFeatureSchema.safeParse(compound).success).toBe(false);
  });

  it("keeps the coupon's registered Engrave swatches closed, simple, disjoint, and validator-safe", async () => {
    const document = await compileCalibrationCoupon({ measuredThicknessMm: 3, kerfMm: 0.15 });
    const swatches = document.parts[0]!.features.filter((feature) => feature.operation === "engrave");
    expect(swatches).toHaveLength(5);
    expect(swatches.every((feature) => feature.region?.outer.closed === true)).toBe(true);
    expect(swatches.every((feature) => feature.region?.holes.length === 0)).toBe(true);
    expect(swatches.every((feature) => feature.path === null)).toBe(true);
    expect(document.validation.status).toBe("pass");
    expect(document.validation.findings.map((finding) => finding.code)).not.toContain(
      "ENGRAVE_REGION_OVERLAP",
    );
  });

  it("serializes Engrave as one exact-Z filled path and Score as unfilled centerlines", async () => {
    const document = await compileCalibrationCoupon({ measuredThicknessMm: 3, kerfMm: 0.15 });
    const placements = nestParts(
      document.parts,
      document.resolvedInputs.machine,
      document.resolvedInputs.material,
      document.resolvedInputs.processRecipe,
      document.resolvedInputs.fabricationContext,
    );
    const { svg } = await buildProjectionBundle(document, placements);
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const engraveGroup = parsed.getElementById("operation-engrave")!;
    const engravePaths = Array.from(engraveGroup.getElementsByTagName("path"));
    const scorePaths = Array.from(
      parsed.getElementById("operation-score")!.getElementsByTagName("path"),
    );
    expect(ENGRAVE_SVG_REPRESENTATION).toBe("fill-only-no-stroke");
    expect(engravePaths).toHaveLength(5);
    expect(engravePaths.every((path) => path.getAttribute("d")?.endsWith(" Z") === true)).toBe(true);
    expect(engravePaths.every((path) => path.getAttribute("fill") === "#111111")).toBe(true);
    expect(engravePaths.every((path) => path.getAttribute("stroke") === "none")).toBe(true);
    expect(scorePaths.every((path) => path.getAttribute("fill") === "none")).toBe(true);
  });

  it("changes only compensated Cut contours when cut width changes", async () => {
    const low = await compileCalibrationCoupon({ measuredThicknessMm: 3, kerfMm: 0.1 });
    const high = await compileCalibrationCoupon({ measuredThicknessMm: 3, kerfMm: 0.2 });
    const [lowPaths, highPaths] = await Promise.all([
      Promise.all(low.parts.map((part) => projectManufacturingPaths(part, low.resolvedInputs.processRecipe))).then((paths) => paths.flat()),
      Promise.all(high.parts.map((part) => projectManufacturingPaths(part, high.resolvedInputs.processRecipe))).then((paths) => paths.flat())
    ]);
    const contours = (operation: "cut" | "score" | "engrave", paths: typeof lowPaths) =>
      paths.filter((path) => path.operation === operation).map((path) => path.contour);
    expect(contours("cut", lowPaths)).not.toEqual(contours("cut", highPaths));
    expect(contours("score", lowPaths)).toEqual(contours("score", highPaths));
    expect(contours("engrave", lowPaths)).toEqual(contours("engrave", highPaths));
  });

  it("reports self-intersecting Engrave area geometry as a blocking finding", async () => {
    const document = await compileCalibrationCoupon({ measuredThicknessMm: 3, kerfMm: 0.15 });
    const parts = structuredClone(document.parts);
    const swatch = parts[0]!.features.find((feature) => feature.operation === "engrave")!;
    swatch.region!.outer.points = [
      { xUm: 125_000, yUm: 48_000 },
      { xUm: 155_000, yUm: 50_000 },
      { xUm: 125_000, yUm: 50_000 },
      { xUm: 155_000, yUm: 48_000 }
    ];
    const report = validateParts(parts);
    expect(report.status).toBe("fail");
    expect(report.findings.map((finding) => finding.code)).toContain("SELF_INTERSECTING_CONTOUR");
  });
});
