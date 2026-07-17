import { describe, expect, it } from "vitest";

import type { ProcessRecipe, SheetPart } from "../../src/domain/contracts.js";
import {
  basswoodProfile,
  provisionalProcessRecipe,
  xtoolM2Profile
} from "../../src/domain/profiles.js";
import { projectManufacturingPaths } from "../../src/projections/fabrication/manufacturing.js";
import { validateParts } from "../../src/validation/geometry.js";

function part(): SheetPart {
  const hole = {
    id: "slot-contour",
    closed: true as const,
    points: [
      { xUm: 8_000, yUm: 8_000 },
      { xUm: 8_000, yUm: 12_000 },
      { xUm: 12_000, yUm: 12_000 },
      { xUm: 12_000, yUm: 8_000 }
    ]
  };
  return {
    schemaVersion: "1.0",
    id: "test-panel",
    name: "Test panel",
    role: "generic-panel",
    materialProfileId: "test-material",
    thicknessUm: 3_000,
    grainVector: { x: 1, y: 0 },
    nominalRegion: {
      outer: {
        id: "test-panel-outer",
        closed: true,
        points: [
          { xUm: 0, yUm: 0 },
          { xUm: 20_000, yUm: 0 },
          { xUm: 20_000, yUm: 20_000 },
          { xUm: 0, yUm: 20_000 }
        ]
      },
      holes: [hole]
    },
    features: [
      {
        id: "outer-feature",
        kind: "outer-boundary",
        operation: "cut",
        fitClass: null,
        jointId: null,
        region: {
          outer: {
            id: "test-panel-outer",
            closed: true,
            points: [
              { xUm: 0, yUm: 0 },
              { xUm: 20_000, yUm: 0 },
              { xUm: 20_000, yUm: 20_000 },
              { xUm: 0, yUm: 20_000 }
            ]
          },
          holes: []
        },
        path: null,
        parametersUm: {}
      },
      {
        id: "slot-feature",
        kind: "slot",
        operation: "cut",
        fitClass: "snug",
        jointId: null,
        region: {
          outer: hole,
          holes: []
        },
        path: null,
        parametersUm: {
          width: 4_000
        }
      },
      {
        id: "score-feature",
        kind: "score-label",
        operation: "score",
        fitClass: null,
        jointId: null,
        region: null,
        path: {
          id: "score-line",
          closed: false,
          points: [
            { xUm: 2_000, yUm: 2_000 },
            { xUm: 6_000, yUm: 2_000 }
          ]
        },
        parametersUm: {}
      }
    ],
    assembledFrame: {
      origin: { xUm: 0, yUm: 0, zUm: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 }
    },
    explodedOffset: { xUm: 0, yUm: 0, zUm: 20_000 },
    assemblyDependencyPartIds: [],
    sourceOperator: {
      id: "test-operator",
      version: "1.0.0"
    }
  };
}

function recipe(kerfX: number, kerfY = kerfX): ProcessRecipe {
  const machine = xtoolM2Profile();
  return provisionalProcessRecipe(basswoodProfile(3), machine, kerfX, kerfY);
}

describe("nominal geometry and manufacturing projection", () => {
  it("keeps canonical nominal geometry unchanged while kerf changes every cut path", async () => {
    const nominal = part();
    const snapshot = structuredClone(nominal);
    const lowKerf = await projectManufacturingPaths(nominal, recipe(0.1));
    const highKerf = await projectManufacturingPaths(nominal, recipe(0.2));

    expect(nominal).toEqual(snapshot);
    expect(lowKerf.filter((path) => path.operation === "cut").map((path) => path.contour.points)).not.toEqual(
      highKerf.filter((path) => path.operation === "cut").map((path) => path.contour.points),
    );
    expect(lowKerf.find((path) => path.operation === "score")?.contour).toEqual(
      highKerf.find((path) => path.operation === "score")?.contour,
    );
    expect(new Set(lowKerf.map((path) => path.sourceNominalHash)).size).toBe(1);
  });

  it("supports directional kerf without altering score geometry", async () => {
    const paths = await projectManufacturingPaths(part(), recipe(0.1, 0.2));
    const outer = paths.find((path) => path.id === "test-panel-cut-outer")!;
    expect(outer.contour.points).toContainEqual({ xUm: -50, yUm: -100 });
    expect(paths[0]?.operation).toBe("score");
  });

  it("reports geometry orientation and simplicity errors with stable finding codes", () => {
    const invalid = part();
    invalid.nominalRegion.outer.points.reverse();
    const report = validateParts([invalid]);
    expect(report.status).toBe("fail");
    expect(report.findings.map((finding) => finding.code)).toContain("INCONSISTENT_CONTOUR_ORIENTATION");
    expect(report.findings.map((finding) => finding.code)).toContain("PHYSICAL_VERIFICATION_REQUIRED");
  });

  it("rejects self-intersections, repeated vertices, and duplicate nominal cut segments", () => {
    const invalid = part();
    invalid.nominalRegion.outer.points = [
      { xUm: 0, yUm: 0 },
      { xUm: 20_000, yUm: 20_000 },
      { xUm: 0, yUm: 20_000 },
      { xUm: 20_000, yUm: 0 },
      { xUm: 0, yUm: 0 }
    ];
    invalid.nominalRegion.holes.push(structuredClone(invalid.nominalRegion.holes[0]!));
    invalid.nominalRegion.holes[1]!.id = "duplicate-slot-contour";
    const codes = validateParts([invalid]).findings.map((finding) => finding.code);
    expect(codes).toContain("SELF_INTERSECTING_CONTOUR");
    expect(codes).toContain("DUPLICATE_CONTOUR_VERTEX");
    expect(codes).toContain("DUPLICATE_CUT_SEGMENT");
  });
});
