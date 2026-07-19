import earcut, { deviation } from "earcut";

import type { PointUm, Region2D } from "../../domain/contracts.js";

export const TRIANGULATION_ADAPTER = {
  id: "earcut",
  version: "3.2.3",
  coordinateModel: "validated-integer-input-float-algorithm",
  role: "render-mesh-only",
  maximumAcceptedDeviation: 1e-12
} as const;

export type Triangulation2D = {
  vertices: PointUm[];
  triangles: [number, number, number][];
  relativeAreaDeviation: number;
};

export function triangulateRegion(region: Region2D): Triangulation2D {
  const rings = [region.outer.points, ...region.holes.map((hole) => hole.points)];
  const vertices = rings.flatMap((ring) => ring.map((point) => ({ ...point })));
  const coordinates = vertices.flatMap((point) => [point.xUm, point.yUm]);
  const holeIndices: number[] = [];
  let vertexOffset = region.outer.points.length;
  for (const hole of region.holes) {
    holeIndices.push(vertexOffset);
    vertexOffset += hole.points.length;
  }

  const indices = earcut(coordinates, holeIndices, 2);
  const relativeAreaDeviation = deviation(coordinates, holeIndices, 2, indices);
  if (!Number.isFinite(relativeAreaDeviation) || relativeAreaDeviation > TRIANGULATION_ADAPTER.maximumAcceptedDeviation) {
    throw new Error(
      `Triangulation area deviation ${String(relativeAreaDeviation)} exceeds the configured limit.`,
    );
  }
  if (indices.length % 3 !== 0) {
    throw new Error("Triangulation did not return complete triangle triplets.");
  }

  const triangles: [number, number, number][] = [];
  for (let index = 0; index < indices.length; index += 3) {
    triangles.push([indices[index]!, indices[index + 1]!, indices[index + 2]!]);
  }
  return { vertices, triangles, relativeAreaDeviation };
}
