import {
  PartMeshSchema,
  type ExternalStockItem,
  type PartMesh
} from "../../domain/contracts.js";
import { canonicalStockHash } from "../../compiler/canonical.js";
import { umToMm } from "../../domain/units.js";

export async function buildStockMesh(
  item: ExternalStockItem,
  sourceDocumentHash: string,
  segments = 20,
): Promise<PartMesh> {
  const lengthMm = umToMm(item.cutLengthUm);
  const radiusMm = umToMm(item.stockProfile.measuredDiameterUm) / 2;
  const verticesMm = [
    { xMm: 0, yMm: 0, zMm: 0 },
    { xMm: lengthMm, yMm: 0, zMm: 0 },
    ...Array.from({ length: segments }, (_, index) => {
      const radians = 2 * Math.PI * index / segments;
      return {
        xMm: 0,
        yMm: Math.cos(radians) * radiusMm,
        zMm: Math.sin(radians) * radiusMm
      };
    }),
    ...Array.from({ length: segments }, (_, index) => {
      const radians = 2 * Math.PI * index / segments;
      return {
        xMm: lengthMm,
        yMm: Math.cos(radians) * radiusMm,
        zMm: Math.sin(radians) * radiusMm
      };
    })
  ];
  const firstRing = 2;
  const secondRing = 2 + segments;
  const triangles: [number, number, number][] = [];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const left = firstRing + index;
    const leftNext = firstRing + next;
    const right = secondRing + index;
    const rightNext = secondRing + next;
    triangles.push(
      [0, leftNext, left],
      [1, right, rightNext],
      [left, leftNext, rightNext],
      [left, rightNext, right],
    );
  }
  return PartMeshSchema.parse({
    schemaVersion: "1.0",
    id: `${item.id}-mesh`,
    partId: item.id,
    sourcePartHash: await canonicalStockHash(item),
    sourceDocumentHash,
    itemKind: "external-stock",
    stockItemId: item.id,
    verticesMm,
    triangles
  });
}
