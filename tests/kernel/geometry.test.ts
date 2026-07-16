import { describe, expect, it } from "vitest";

import type { Region2D } from "../../src/domain/contracts.js";
import {
  booleanRegions,
  isCounterClockwise,
  offsetRegion,
  regionAreaUm2,
  triangulateRegion
} from "../../src/kernel/geometry/index.js";

function rectangle(id: string, xUm: number, yUm: number, widthUm: number, heightUm: number): Region2D {
  return {
    outer: {
      id: `${id}-outer`,
      closed: true,
      points: [
        { xUm, yUm },
        { xUm: xUm + widthUm, yUm },
        { xUm: xUm + widthUm, yUm: yUm + heightUm },
        { xUm, yUm: yUm + heightUm }
      ]
    },
    holes: []
  };
}

describe("Clipper2 integer polygon adapter", () => {
  it("computes stable union, intersection, and difference areas", () => {
    const left = rectangle("left", 0, 0, 10_000, 10_000);
    const right = rectangle("right", 5_000, 5_000, 10_000, 10_000);

    const union = booleanRegions("union", [left], [right], "union");
    const intersection = booleanRegions("intersection", [left], [right], "intersection");
    const difference = booleanRegions("difference", [left], [right], "difference");

    expect(union.reduce((sum, region) => sum + regionAreaUm2(region), 0)).toBe(175_000_000);
    expect(intersection.reduce((sum, region) => sum + regionAreaUm2(region), 0)).toBe(25_000_000);
    expect(difference.reduce((sum, region) => sum + regionAreaUm2(region), 0)).toBe(75_000_000);
    expect(union.every((region) => isCounterClockwise(region.outer))).toBe(true);
  });

  it("offsets outer contours outward and hole contours inward without mutating nominal geometry", () => {
    const nominal = rectangle("panel", 0, 0, 20_000, 20_000);
    nominal.holes.push({
      id: "panel-hole",
      closed: true,
      points: [
        { xUm: 5_000, yUm: 5_000 },
        { xUm: 5_000, yUm: 15_000 },
        { xUm: 15_000, yUm: 15_000 },
        { xUm: 15_000, yUm: 5_000 }
      ]
    });
    const snapshot = structuredClone(nominal);
    const compensated = offsetRegion(nominal, 100, "compensated");

    expect(nominal).toEqual(snapshot);
    expect(Math.abs(regionAreaUm2(compensated))).toBeGreaterThan(regionAreaUm2(nominal));
    expect(isCounterClockwise(compensated.outer)).toBe(true);
    expect(compensated.holes.every((hole) => !isCounterClockwise(hole))).toBe(true);
  });

  it("rejects non-integer offsets at the kernel boundary", () => {
    expect(() => offsetRegion(rectangle("panel", 0, 0, 20_000, 20_000), 0.5, "invalid")).toThrow(
      /integer/,
    );
  });
});

describe("Earcut mesh triangulation adapter", () => {
  it("triangulates a concave region with a hole and verifies area deviation", () => {
    const region: Region2D = {
      outer: {
        id: "concave-outer",
        closed: true,
        points: [
          { xUm: 0, yUm: 0 },
          { xUm: 20_000, yUm: 0 },
          { xUm: 20_000, yUm: 8_000 },
          { xUm: 12_000, yUm: 8_000 },
          { xUm: 12_000, yUm: 20_000 },
          { xUm: 0, yUm: 20_000 }
        ]
      },
      holes: [
        {
          id: "concave-hole",
          closed: true,
          points: [
            { xUm: 3_000, yUm: 3_000 },
            { xUm: 3_000, yUm: 6_000 },
            { xUm: 6_000, yUm: 6_000 },
            { xUm: 6_000, yUm: 3_000 }
          ]
        }
      ]
    };

    const result = triangulateRegion(region);
    expect(result.triangles.length).toBeGreaterThan(0);
    expect(result.relativeAreaDeviation).toBeLessThanOrEqual(1e-12);
    expect(result.triangles.flat().every((index) => index < result.vertices.length)).toBe(true);
  });
});
