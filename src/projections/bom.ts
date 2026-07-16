import {
  BomProjectionSchema,
  type BomProjection,
  type SheetPart
} from "../domain/contracts.js";
import { canonicalPartHash } from "../compiler/canonical.js";

export async function buildBomProjection(
  parts: readonly SheetPart[],
  sourceDocumentHash: string,
  sheetByPartId?: ReadonlyMap<string, string>,
): Promise<BomProjection> {
  return BomProjectionSchema.parse({
    schemaVersion: "1.0",
    sourceDocumentHash,
    entries: await Promise.all(
      parts.map(async (part) => {
        const sheetId = sheetByPartId?.get(part.id);
        return {
          id: `${part.id}-bom`,
          partId: part.id,
          name: part.name,
          quantity: 1,
          materialProfileId: part.materialProfileId,
          sourcePartHash: await canonicalPartHash(part),
          ...(sheetId === undefined ? {} : { sheetId }),
          ...(part.markingCode === undefined ? {} : { markingCode: part.markingCode })
        };
      }),
    )
  });
}
