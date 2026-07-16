import { performance } from "node:perf_hooks";

import type { Region2D } from "../../src/domain/contracts.js";
import {
  POLYGON_ADAPTER,
  TRIANGULATION_ADAPTER,
  booleanRegions,
  offsetRegion,
  regionAreaUm2,
  triangulateRegion
} from "../../src/kernel/geometry/index.js";

function fixture(index: number): Region2D {
  const inset = index % 17;
  return {
    outer: {
      id: `fixture-${String(index)}-outer`,
      closed: true,
      points: [
        { xUm: 0, yUm: 0 },
        { xUm: 50_000 + inset, yUm: 0 },
        { xUm: 50_000 + inset, yUm: 30_000 },
        { xUm: 30_000, yUm: 30_000 },
        { xUm: 30_000, yUm: 50_000 + inset },
        { xUm: 0, yUm: 50_000 + inset }
      ]
    },
    holes: [
      {
        id: `fixture-${String(index)}-hole`,
        closed: true,
        points: [
          { xUm: 5_000, yUm: 5_000 },
          { xUm: 5_000, yUm: 15_000 },
          { xUm: 15_000, yUm: 15_000 },
          { xUm: 15_000, yUm: 5_000 }
        ]
      }
    ]
  };
}

function measure(label: string, action: () => void): { label: string; elapsedMs: number } {
  const started = performance.now();
  action();
  return {
    label,
    elapsedMs: Number((performance.now() - started).toFixed(3))
  };
}

const iterations = 1_000;
const sample = fixture(0);
const clip = {
  outer: {
    id: "clip-outer",
    closed: true,
    points: [
      { xUm: 10_000, yUm: 10_000 },
      { xUm: 40_000, yUm: 10_000 },
      { xUm: 40_000, yUm: 40_000 },
      { xUm: 10_000, yUm: 40_000 }
    ]
  },
  holes: []
} satisfies Region2D;

const timings = [
  measure("clipper-boolean-union-1000", () => {
    for (let index = 0; index < iterations; index += 1) {
      booleanRegions("union", [fixture(index)], [clip], `union-${String(index)}`);
    }
  }),
  measure("clipper-offset-1000", () => {
    for (let index = 0; index < iterations; index += 1) {
      offsetRegion(fixture(index), 75, `offset-${String(index)}`);
    }
  }),
  measure("earcut-triangulate-1000", () => {
    for (let index = 0; index < iterations; index += 1) {
      triangulateRegion(fixture(index));
    }
  })
];

const report = {
  schemaVersion: "1.0",
  runKind: "m1-geometry-spike",
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch
  },
  selections: {
    polygon: POLYGON_ADAPTER,
    triangulation: TRIANGULATION_ADAPTER
  },
  correctness: {
    sampleNominalAreaUm2: regionAreaUm2(sample),
    sampleOffsetAreaUm2: regionAreaUm2(offsetRegion(sample, 75, "sample-offset")),
    sampleTriangulationDeviation: triangulateRegion(sample).relativeAreaDeviation,
    unionAreaUm2: booleanRegions("union", [sample], [clip], "sample-union").reduce(
      (sum, region) => sum + regionAreaUm2(region),
      0,
    )
  },
  iterations,
  timings
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
