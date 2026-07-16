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
  const partById = new Map(parts.map((part) => [part.id, part]));
  const placementPartIds = new Set(placements.map((placement) => placement.partId));
  for (const placement of placements) {
    if (!partById.has(placement.partId)) {
      throw new Error(`Placement ${placement.id} references unknown part ${placement.partId}.`);
    }
  }
  const placedParts = parts.filter((part) => placementPartIds.has(part.id));
  const paths = (
    await Promise.all(placedParts.map(async (part) => projectManufacturingPaths(part, machine)))
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
