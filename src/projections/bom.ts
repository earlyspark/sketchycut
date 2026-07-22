import {
  BomProjectionSchema,
  type BomProjection,
  type DesignDocumentV1
} from "../domain/contracts.js";
import { canonicalPartHash, canonicalStockHash } from "../compiler/canonical.js";
import { umToMm } from "../domain/units.js";

export async function buildBomProjection(
  document: DesignDocumentV1,
  sourceDocumentHash: string,
  sheetByPartId?: ReadonlyMap<string, string>,
): Promise<BomProjection> {
  const partEntries = await Promise.all(
    document.parts.map(async (part) => {
      const sheetId = sheetByPartId?.get(part.id);
      const cutThroughFeatures = part.features.filter((feature) => feature.cutThrough !== undefined);
      return {
        id: `${part.id}-bom`,
        partId: part.id,
        name: part.name,
        quantity: 1,
        materialProfileId: part.materialProfileId,
        sourcePartHash: await canonicalPartHash(part),
        ...(sheetId === undefined ? {} : { sheetId }),
        ...(part.markingCode === undefined ? {} : { markingCode: part.markingCode }),
        ...(cutThroughFeatures.length === 0 ? {} : {
          cutThroughFeatureIds: cutThroughFeatures.map((feature) => feature.id).sort(),
          cutThroughPurposes: [...new Set(cutThroughFeatures.map((feature) => feature.cutThrough!.purpose))].sort()
        })
      };
    }),
  );
  const stockEntries = await Promise.all(
    (document.externalStock ?? []).map(async (item) => ({
      id: `${item.id}-bom`,
      partId: item.id,
      name: item.name,
      quantity: item.quantity,
      materialProfileId: item.stockProfile.id,
      sourcePartHash: await canonicalStockHash(item),
      entryKind: "external-stock" as const,
      stockItemId: item.id,
      cutLengthMm: umToMm(item.cutLengthUm),
      measuredDiameterMm: umToMm(item.stockProfile.measuredDiameterUm),
      evidenceState: item.evidenceState
    })),
  );
  return BomProjectionSchema.parse({
    schemaVersion: "1.0",
    sourceDocumentHash,
    entries: [...partEntries, ...stockEntries]
  });
}
