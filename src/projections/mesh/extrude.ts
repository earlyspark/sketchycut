import {
  PartMeshSchema,
  type PartMesh,
  type SheetPart
} from "../../domain/contracts.js";
import { canonicalPartHash } from "../../compiler/canonical.js";
import { umToMm } from "../../domain/units.js";
import { triangulateRegion } from "../../kernel/geometry/triangulate.js";

function sideTriangles(
  ringStart: number,
  ringLength: number,
  topOffset: number,
  reverse: boolean,
): [number, number, number][] {
  const triangles: [number, number, number][] = [];
  for (let index = 0; index < ringLength; index += 1) {
    const current = ringStart + index;
    const next = ringStart + ((index + 1) % ringLength);
    const currentTop = current + topOffset;
    const nextTop = next + topOffset;
    triangles.push(
      reverse ? [current, nextTop, next] : [current, next, nextTop],
      reverse ? [current, currentTop, nextTop] : [current, nextTop, currentTop],
    );
  }
  return triangles;
}

export async function extrudePartMesh(part: SheetPart, sourceDocumentHash: string): Promise<PartMesh> {
  const triangulation = triangulateRegion(part.nominalRegion);
  const thicknessMm = umToMm(part.thicknessUm);
  const bottom = triangulation.vertices.map((point) => ({
    xMm: umToMm(point.xUm),
    yMm: umToMm(point.yUm),
    zMm: 0
  }));
  const top = bottom.map((point) => ({
    ...point,
    zMm: thicknessMm
  }));
  const topOffset = bottom.length;
  const triangles: [number, number, number][] = [];
  for (const [a, b, c] of triangulation.triangles) {
    triangles.push([c, b, a], [a + topOffset, b + topOffset, c + topOffset]);
  }

  let ringStart = 0;
  triangles.push(...sideTriangles(ringStart, part.nominalRegion.outer.points.length, topOffset, false));
  ringStart += part.nominalRegion.outer.points.length;
  for (const hole of part.nominalRegion.holes) {
    triangles.push(...sideTriangles(ringStart, hole.points.length, topOffset, true));
    ringStart += hole.points.length;
  }

  return PartMeshSchema.parse({
    schemaVersion: "2.0",
    id: `${part.id}-mesh`,
    partId: part.id,
    sourcePartHash: await canonicalPartHash(part),
    sourceDocumentHash,
    verticesMm: [...bottom, ...top],
    triangles
  });
}
