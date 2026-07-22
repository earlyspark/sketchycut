import {
  PartsLegendProjectionSchema,
  type PartsLegendProjection,
  type SheetPart
} from "../domain/contracts.js";

export function buildPartsLegendProjection(
  parts: readonly SheetPart[],
  sourceDocumentHash: string,
  sheetByPartId: ReadonlyMap<string, string>,
): PartsLegendProjection {
  return PartsLegendProjectionSchema.parse({
    schemaVersion: "1.0",
    sourceDocumentHash,
    entries: parts.map((part) => {
      const sheetId = sheetByPartId.get(part.id);
      if (sheetId === undefined || part.markingCode === undefined) {
        throw new Error(`Part ${part.id} is missing linked sheet or marking metadata.`);
      }
      const cutThroughFeatures = part.features.filter((feature) => feature.cutThrough !== undefined);
      return {
        id: `${part.id}-legend`,
        partId: part.id,
        markingCode: part.markingCode,
        name: part.name,
        sheetId,
        ...(cutThroughFeatures.length === 0 ? {} : {
          cutThroughFeatureIds: cutThroughFeatures.map((feature) => feature.id).sort(),
          cutThroughPurposes: [...new Set(cutThroughFeatures.map((feature) => feature.cutThrough!.purpose))].sort()
        })
      };
    })
  });
}
