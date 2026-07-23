import {
  SheetProjectionSchema,
  type FabricationContext,
  type MachineProfile,
  type ManufacturingPath,
  type PointUm,
  type ProcessRecipe,
  type SheetPart,
  type SheetPlacement,
  type SheetProjection
} from "../../domain/contracts.js";
import { mmToUm, umToMm } from "../../domain/units.js";
import { boundsUm } from "../../kernel/geometry/metrics.js";
import { projectManufacturingPaths } from "./manufacturing.js";
import { effectiveNestingConstraintMm } from "./nesting.js";

function rotate(point: PointUm, degrees: SheetPlacement["rotationDegrees"]): PointUm {
  switch (degrees) {
    case 0: return point;
    case 90: return { xUm: -point.yUm, yUm: point.xUm };
    case 180: return { xUm: -point.xUm, yUm: -point.yUm };
    case 270: return { xUm: point.yUm, yUm: -point.xUm };
  }
}

function place(point: PointUm, placement: SheetPlacement): PointUm {
  const rotated = rotate(point, placement.rotationDegrees);
  return { xUm: rotated.xUm + placement.xUm, yUm: rotated.yUm + placement.yUm };
}

function placedPoints(
  paths: readonly ManufacturingPath[],
  placements: readonly SheetPlacement[],
): PointUm[] {
  const placementByPart = new Map(placements.map((placement) => [placement.partId, placement]));
  return paths.flatMap((path) => {
    const placement = placementByPart.get(path.partId);
    if (placement === undefined) {
      throw new Error(`Manufacturing path references unplaced part ${path.partId}.`);
    }
    return path.contour.points.map((point) => place(point, placement));
  });
}

export async function buildSheetProjection(
  id: string,
  parts: readonly SheetPart[],
  placements: readonly SheetPlacement[],
  machine: MachineProfile,
  processRecipe: ProcessRecipe,
  fabricationContext: FabricationContext,
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
    await Promise.all(
      placedParts.map(async (part) => projectManufacturingPaths(part, processRecipe)),
    )
  ).flat();
  if (paths.length === 0) throw new Error(`Sheet ${id} has no manufacturing paths.`);
  const originalBounds = boundsUm(placedPoints(paths, placements));
  const paddingUm = mmToUm(fabricationContext.layoutPolicy.symmetricPaddingMm);
  const rebaseDeltaUm = {
    xUm: paddingUm - originalBounds.minXUm,
    yUm: paddingUm - originalBounds.minYUm
  };
  const rebasedPlacements = placements.map((placement) => ({
    ...placement,
    xUm: placement.xUm + rebaseDeltaUm.xUm,
    yUm: placement.yUm + rebaseDeltaUm.yUm
  }));
  const occupiedBoundsUm = boundsUm(placedPoints(paths, rebasedPlacements));
  const occupiedWidthUm = occupiedBoundsUm.maxXUm - occupiedBoundsUm.minXUm;
  const occupiedHeightUm = occupiedBoundsUm.maxYUm - occupiedBoundsUm.minYUm;
  const widthMm = umToMm(occupiedWidthUm + paddingUm * 2);
  const heightMm = umToMm(occupiedHeightUm + paddingUm * 2);
  const effectiveConstraint = effectiveNestingConstraintMm(machine, fabricationContext);
  const rootWidthUm = mmToUm(widthMm);
  const rootHeightUm = mmToUm(heightMm);
  for (const point of placedPoints(paths, rebasedPlacements)) {
    if (point.xUm < 0 || point.yUm < 0 || point.xUm > rootWidthUm || point.yUm > rootHeightUm) {
      throw new Error(`Sheet ${id} contains a compensated path outside its compact root.`);
    }
  }
  return SheetProjectionSchema.parse({
    schemaVersion: "2.0",
    id,
    widthMm,
    heightMm,
    rootPolicy: {
      id: fabricationContext.layoutPolicy.id,
      version: fabricationContext.layoutPolicy.version,
      symmetricPaddingMm: fabricationContext.layoutPolicy.symmetricPaddingMm
    },
    occupiedBoundsUm,
    rebaseDeltaUm,
    requiredMaterialFootprintMm: { width: widthMm, height: heightMm },
    effectiveNestingConstraintMm: effectiveConstraint,
    placements: rebasedPlacements,
    paths
  });
}
