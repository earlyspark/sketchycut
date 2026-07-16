import {
  SheetProjectionSchema,
  type MachineProfile,
  type SheetPart,
  type SheetPlacement,
  type SheetProjection
} from "../../domain/contracts.js";
import { projectManufacturingPaths } from "./manufacturing.js";

export async function buildSheetProjection(
  id: string,
  parts: readonly SheetPart[],
  placements: readonly SheetPlacement[],
  machine: MachineProfile,
): Promise<SheetProjection> {
  const placementPartIds = new Set(placements.map((placement) => placement.partId));
  for (const part of parts) {
    if (!placementPartIds.has(part.id)) {
      throw new Error(`Part ${part.id} is missing from the sheet placement list.`);
    }
  }
  const paths = (
    await Promise.all(parts.map(async (part) => projectManufacturingPaths(part, machine)))
  ).flat();
  return SheetProjectionSchema.parse({
    schemaVersion: "1.0",
    id,
    widthMm: machine.bedMm.width,
    heightMm: machine.bedMm.height,
    placements,
    paths
  });
}
