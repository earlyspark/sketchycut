import { describe, expect, it } from "vitest";

import type { Region2D, SheetPart } from "../../src/index.js";
import { validateParts } from "../../src/index.js";

function contour(
  id: string,
  points: { xUm: number; yUm: number }[],
  orientation: "ccw" | "cw" = "ccw",
): Region2D["outer"] {
  return {
    id,
    closed: true,
    points: orientation === "ccw" ? points : [...points].reverse()
  };
}

function part(region: Region2D): SheetPart {
  return {
    schemaVersion: "2.0",
    id: "seeded-panel",
    name: "Seeded panel",
    role: "generic-panel",
    materialProfileId: "material-proof",
    thicknessUm: 3_000,
    grainVector: { x: 1, y: 0 },
    nominalRegion: region,
    features: [
      {
        id: "seeded-boundary",
        kind: "outer-boundary",
        operation: "cut",
        fitClass: null,
        jointId: null,
        region,
        path: null,
        parametersUm: {}
      }
    ],
    assembledFrame: {
      origin: { xUm: 0, yUm: 0, zUm: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 }
    },
    explodedOffset: { xUm: 0, yUm: 0, zUm: 0 },
    assemblyDependencyPartIds: [],
    sourceOperator: { id: "calibration-coupon", version: "1.0.0" }
  };
}

const rectangle = (id: string, x: number, y: number, width: number, height: number, orientation: "ccw" | "cw" = "ccw") =>
  contour(
    id,
    [
      { xUm: x, yUm: y },
      { xUm: x + width, yUm: y },
      { xUm: x + width, yUm: y + height },
      { xUm: x, yUm: y + height }
    ],
    orientation,
  );

describe("shape-agnostic common geometry validation", () => {
  it("rejects a hole whose edge escapes a concave outer even when a vertex remains inside", () => {
    const outer = contour("concave-outer", [
      { xUm: 0, yUm: 0 },
      { xUm: 20_000, yUm: 0 },
      { xUm: 20_000, yUm: 20_000 },
      { xUm: 12_000, yUm: 20_000 },
      { xUm: 12_000, yUm: 8_000 },
      { xUm: 8_000, yUm: 8_000 },
      { xUm: 8_000, yUm: 20_000 },
      { xUm: 0, yUm: 20_000 }
    ]);
    const crossingHole = rectangle("crossing-hole", 6_000, 10_000, 8_000, 3_000, "cw");
    const report = validateParts([part({ outer, holes: [crossingHole] })]);
    expect(report.findings.map((finding) => finding.code)).toContain("HOLE_OUTSIDE_OUTER_CONTOUR");
  });

  it("rejects overlapping holes", () => {
    const report = validateParts([
      part({
        outer: rectangle("outer", 0, 0, 30_000, 30_000),
        holes: [
          rectangle("hole-a", 5_000, 5_000, 10_000, 10_000, "cw"),
          rectangle("hole-b", 10_000, 10_000, 10_000, 10_000, "cw")
        ]
      })
    ]);
    expect(report.findings.map((finding) => finding.code)).toContain("HOLE_OVERLAP");
  });

  it("rejects insufficient webs between supported arbitrary holes", () => {
    const report = validateParts([
      part({
        outer: rectangle("outer", 0, 0, 30_000, 30_000),
        holes: [
          rectangle("hole-a", 5_000, 5_000, 5_000, 5_000, "cw"),
          rectangle("hole-b", 10_300, 5_000, 5_000, 5_000, "cw")
        ]
      })
    ], { minimumWebUm: 500 });
    expect(report.findings.map((finding) => finding.code)).toContain("MINIMUM_WEB_VIOLATION");
  });

  it("rejects features that disappear under compensated manufacturing projection", () => {
    const report = validateParts([
      part({
        outer: rectangle("outer", 0, 0, 30_000, 30_000),
        holes: [rectangle("thin-hole", 5_000, 5_000, 100, 5_000, "cw")]
      })
    ], { compensationXUm: 75, compensationYUm: 75 });
    expect(report.findings.map((finding) => finding.code)).toContain("COMPENSATED_FEATURE_SURVIVAL");
  });
});
