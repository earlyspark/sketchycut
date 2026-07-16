import {
  SheetPlacementSchema,
  type MachineProfile,
  type MaterialProfile,
  type PointUm,
  type SheetPart,
  type SheetPlacement
} from "../../domain/contracts.js";
import { mmToUm } from "../../domain/units.js";
import { boundsUm } from "../../kernel/geometry/metrics.js";

type Rotation = SheetPlacement["rotationDegrees"];
type Box = {
  minXUm: number;
  minYUm: number;
  maxXUm: number;
  maxYUm: number;
};

export type SheetNest = {
  id: string;
  placements: SheetPlacement[];
};

function rotate(point: PointUm, rotation: Rotation): PointUm {
  switch (rotation) {
    case 0:
      return point;
    case 90:
      return { xUm: -point.yUm, yUm: point.xUm };
    case 180:
      return { xUm: -point.xUm, yUm: -point.yUm };
    case 270:
      return { xUm: point.yUm, yUm: -point.xUm };
  }
}

function rotatedBounds(part: SheetPart, rotation: Rotation): Box {
  return boundsUm(part.nominalRegion.outer.points.map((point) => rotate(point, rotation)));
}

function rotatedGrain(part: SheetPart, rotation: Rotation): { x: number; y: number } {
  const point = rotate({ xUm: part.grainVector.x, yUm: part.grainVector.y }, rotation);
  return { x: point.xUm, y: point.yUm };
}

function allowedRotations(part: SheetPart, material: MaterialProfile): Rotation[] {
  const candidates: Rotation[] = [0, 90];
  if (material.grainAxis === "none") {
    return candidates;
  }
  return candidates.filter((rotation) => {
    const grain = rotatedGrain(part, rotation);
    return material.grainAxis === "x" ? Math.abs(grain.x) === 1 : Math.abs(grain.y) === 1;
  });
}

function boxesOverlap(left: Box, right: Box, spacingUm: number): boolean {
  return !(
    left.maxXUm + spacingUm <= right.minXUm ||
    right.maxXUm + spacingUm <= left.minXUm ||
    left.maxYUm + spacingUm <= right.minYUm ||
    right.maxYUm + spacingUm <= left.minYUm
  );
}

function placementCandidates(
  part: SheetPart,
  placed: readonly { placement: SheetPlacement; box: Box }[],
  machine: MachineProfile,
  material: MaterialProfile,
  spacingUm: number,
): { placement: SheetPlacement; box: Box }[] {
  const marginUm = mmToUm(machine.bedMm.margin);
  const bedWidthUm = mmToUm(machine.bedMm.width);
  const bedHeightUm = mmToUm(machine.bedMm.height);
  const xCandidates = [marginUm, ...placed.map((item) => item.box.maxXUm + spacingUm)];
  const yCandidates = [marginUm, ...placed.map((item) => item.box.maxYUm + spacingUm)];
  const candidates: { placement: SheetPlacement; box: Box }[] = [];
  for (const rotation of allowedRotations(part, material)) {
    const bounds = rotatedBounds(part, rotation);
    for (const minYUm of [...new Set(yCandidates)].sort((left, right) => left - right)) {
      for (const minXUm of [...new Set(xCandidates)].sort((left, right) => left - right)) {
        const box = {
          minXUm,
          minYUm,
          maxXUm: minXUm + bounds.maxXUm - bounds.minXUm,
          maxYUm: minYUm + bounds.maxYUm - bounds.minYUm
        };
        if (box.maxXUm > bedWidthUm - marginUm || box.maxYUm > bedHeightUm - marginUm) {
          continue;
        }
        if (placed.some((item) => boxesOverlap(box, item.box, spacingUm))) {
          continue;
        }
        candidates.push({
          placement: SheetPlacementSchema.parse({
            id: `${part.id}-placement`,
            partId: part.id,
            xUm: minXUm - bounds.minXUm,
            yUm: minYUm - bounds.minYUm,
            rotationDegrees: rotation
          }),
          box
        });
      }
    }
  }
  return candidates.sort(
    (left, right) =>
      left.box.minYUm - right.box.minYUm ||
      left.box.minXUm - right.box.minXUm ||
      left.placement.rotationDegrees - right.placement.rotationDegrees,
  );
}

function sortedPartsByArea(parts: readonly SheetPart[]): SheetPart[] {
  return [...parts].sort((left, right) => {
    const leftBounds = rotatedBounds(left, 0);
    const rightBounds = rotatedBounds(right, 0);
    const leftArea = (leftBounds.maxXUm - leftBounds.minXUm) * (leftBounds.maxYUm - leftBounds.minYUm);
    const rightArea = (rightBounds.maxXUm - rightBounds.minXUm) * (rightBounds.maxYUm - rightBounds.minYUm);
    return rightArea - leftArea || left.id.localeCompare(right.id);
  });
}

export function nestParts(
  parts: readonly SheetPart[],
  machine: MachineProfile,
  material: MaterialProfile,
  spacingMm = 2,
): SheetPlacement[] {
  const spacingUm = mmToUm(spacingMm);
  const sortedParts = sortedPartsByArea(parts);
  const placed: { placement: SheetPlacement; box: Box }[] = [];

  for (const part of sortedParts) {
    const selected = placementCandidates(part, placed, machine, material, spacingUm)[0];
    if (selected === undefined) {
      throw new Error(`Part ${part.id} does not fit on sheet ${machine.name}.`);
    }
    placed.push(selected);
  }

  return placed.map((item) => item.placement).sort((left, right) => left.partId.localeCompare(right.partId));
}

export function nestPartsAcrossSheets(
  parts: readonly SheetPart[],
  machine: MachineProfile,
  material: MaterialProfile,
  spacingMm = 2,
): SheetNest[] {
  const spacingUm = mmToUm(spacingMm);
  const sheets: { placed: { placement: SheetPlacement; box: Box }[] }[] = [];
  for (const part of sortedPartsByArea(parts)) {
    let selectedSheetIndex = -1;
    let selected: { placement: SheetPlacement; box: Box } | undefined;
    for (const [sheetIndex, sheet] of sheets.entries()) {
      const candidate = placementCandidates(part, sheet.placed, machine, material, spacingUm)[0];
      if (candidate !== undefined) {
        selectedSheetIndex = sheetIndex;
        selected = candidate;
        break;
      }
    }
    if (selected === undefined) {
      const candidate = placementCandidates(part, [], machine, material, spacingUm)[0];
      if (candidate === undefined) {
        throw new Error(`Part ${part.id} does not fit on an empty sheet ${machine.name}.`);
      }
      sheets.push({ placed: [candidate] });
    } else {
      sheets[selectedSheetIndex]!.placed.push(selected);
    }
  }
  return sheets.map((sheet, index) => ({
    id: `sheet-${String(index + 1)}`,
    placements: sheet.placed
      .map((item) => item.placement)
      .sort((left, right) => left.partId.localeCompare(right.partId))
  }));
}
