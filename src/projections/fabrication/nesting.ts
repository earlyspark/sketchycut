import {
  SheetPlacementSchema,
  type FabricationContext,
  type MachineProfile,
  type MaterialProfile,
  type PointUm,
  type ProcessRecipe,
  type SheetPart,
  type SheetPlacement
} from "../../domain/contracts.js";
import { mmToUm } from "../../domain/units.js";
import { offsetRegionAnisotropic } from "../../kernel/geometry/clipper-adapter.js";
import { boundsUm } from "../../kernel/geometry/metrics.js";

type Rotation = SheetPlacement["rotationDegrees"];
export type Box = {
  minXUm: number;
  minYUm: number;
  maxXUm: number;
  maxYUm: number;
};

export type SheetNest = {
  id: string;
  placements: SheetPlacement[];
};

export class NestingConstraintError extends Error {
  readonly code = "PART_EXCEEDS_EFFECTIVE_NESTING_CONSTRAINT";
  readonly partId: string;

  constructor(part: SheetPart, machine: MachineProfile) {
    super(`Part ${part.id} does not fit within the effective ${machine.name} nesting constraint.`);
    this.name = "NestingConstraintError";
    this.partId = part.id;
  }
}

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

function nominalRotatedBounds(part: SheetPart, rotation: Rotation): Box {
  return boundsUm(part.nominalRegion.outer.points.map((point) => rotate(point, rotation)));
}

function manufacturingBounds(
  part: SheetPart,
  rotation: Rotation,
  processRecipe: ProcessRecipe,
): Box {
  const outerFeature = part.features.find(
    (feature) => feature.region?.outer.id === part.nominalRegion.outer.id,
  );
  const outer = outerFeature?.toolpathCompensation === "none"
    ? part.nominalRegion.outer
    : offsetRegionAnisotropic(
        part.nominalRegion,
        Math.round(mmToUm(processRecipe.cutWidth.xMm) / 2),
        Math.round(mmToUm(processRecipe.cutWidth.yMm) / 2),
        `${part.id}-nesting`,
      ).outer;
  const points = [
    ...outer.points,
    ...part.features.flatMap((feature) => {
      if (feature.operation === "none") return [];
      if (feature.path !== null) return feature.path.points;
      if (feature.operation === "engrave" && feature.region !== null) {
        return feature.region.outer.points;
      }
      return [];
    })
  ];
  return boundsUm(points.map((point) => rotate(point, rotation)));
}

function rotatedGrain(part: SheetPart, rotation: Rotation): { x: number; y: number } {
  const point = rotate({ xUm: part.grainVector.x, yUm: part.grainVector.y }, rotation);
  return { x: point.xUm, y: point.yUm };
}

function allowedRotations(part: SheetPart, material: MaterialProfile): Rotation[] {
  const candidates: Rotation[] = [0, 90];
  if (material.grainAxis === "none") return candidates;
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

export function effectiveNestingConstraintMm(
  machine: MachineProfile,
  context: FabricationContext,
): { width: number; height: number; source: "processing-envelope" | "stock-envelope-intersection" } {
  const stock = context.stockFootprint;
  return stock === null
    ? {
        ...machine.processingEnvelopeMm,
        source: "processing-envelope"
      }
    : {
        width: Math.min(machine.processingEnvelopeMm.width, stock.widthMm),
        height: Math.min(machine.processingEnvelopeMm.height, stock.heightMm),
        source: "stock-envelope-intersection"
      };
}

function placementCandidates(
  part: SheetPart,
  placed: readonly { placement: SheetPlacement; box: Box }[],
  machine: MachineProfile,
  material: MaterialProfile,
  processRecipe: ProcessRecipe,
  context: FabricationContext,
): { placement: SheetPlacement; box: Box }[] {
  const paddingUm = mmToUm(context.layoutPolicy.symmetricPaddingMm);
  const spacingUm = mmToUm(context.layoutPolicy.interPartSpacingMm);
  const constraint = effectiveNestingConstraintMm(machine, context);
  const constraintWidthUm = mmToUm(constraint.width);
  const constraintHeightUm = mmToUm(constraint.height);
  const xCandidates = [paddingUm, ...placed.map((item) => item.box.maxXUm + spacingUm)];
  const yCandidates = [paddingUm, ...placed.map((item) => item.box.maxYUm + spacingUm)];
  const candidates: { placement: SheetPlacement; box: Box }[] = [];
  for (const rotation of allowedRotations(part, material)) {
    const bounds = manufacturingBounds(part, rotation, processRecipe);
    for (const minYUm of [...new Set(yCandidates)].sort((left, right) => left - right)) {
      for (const minXUm of [...new Set(xCandidates)].sort((left, right) => left - right)) {
        const box = {
          minXUm,
          minYUm,
          maxXUm: minXUm + bounds.maxXUm - bounds.minXUm,
          maxYUm: minYUm + bounds.maxYUm - bounds.minYUm
        };
        if (
          box.maxXUm > constraintWidthUm - paddingUm ||
          box.maxYUm > constraintHeightUm - paddingUm
        ) continue;
        if (placed.some((item) => boxesOverlap(box, item.box, spacingUm))) continue;
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
  const score = (candidate: { placement: SheetPlacement; box: Box }) => {
    const boxes = [...placed.map((item) => item.box), candidate.box];
    const minXUm = Math.min(...boxes.map((box) => box.minXUm));
    const minYUm = Math.min(...boxes.map((box) => box.minYUm));
    const maxXUm = Math.max(...boxes.map((box) => box.maxXUm));
    const maxYUm = Math.max(...boxes.map((box) => box.maxYUm));
    return {
      areaUm2: (maxXUm - minXUm) * (maxYUm - minYUm),
      widthUm: maxXUm - minXUm,
      heightUm: maxYUm - minYUm
    };
  };
  return candidates.sort((left, right) => {
    const leftScore = score(left);
    const rightScore = score(right);
    return (
      leftScore.areaUm2 - rightScore.areaUm2 ||
      leftScore.heightUm - rightScore.heightUm ||
      leftScore.widthUm - rightScore.widthUm ||
      left.box.minYUm - right.box.minYUm ||
      left.box.minXUm - right.box.minXUm ||
      left.placement.rotationDegrees - right.placement.rotationDegrees
    );
  });
}

function sortedPartsByArea(parts: readonly SheetPart[]): SheetPart[] {
  return [...parts].sort((left, right) => {
    const leftBounds = nominalRotatedBounds(left, 0);
    const rightBounds = nominalRotatedBounds(right, 0);
    const leftArea = (leftBounds.maxXUm - leftBounds.minXUm) * (leftBounds.maxYUm - leftBounds.minYUm);
    const rightArea = (rightBounds.maxXUm - rightBounds.minXUm) * (rightBounds.maxYUm - rightBounds.minYUm);
    return rightArea - leftArea || left.id.localeCompare(right.id);
  });
}

export function nestParts(
  parts: readonly SheetPart[],
  machine: MachineProfile,
  material: MaterialProfile,
  processRecipe: ProcessRecipe,
  context: FabricationContext,
): SheetPlacement[] {
  const placed: { placement: SheetPlacement; box: Box }[] = [];
  for (const part of sortedPartsByArea(parts)) {
    const selected = placementCandidates(
      part,
      placed,
      machine,
      material,
      processRecipe,
      context,
    )[0];
    if (selected === undefined) throw new NestingConstraintError(part, machine);
    placed.push(selected);
  }
  return placed.map((item) => item.placement).sort((left, right) => left.partId.localeCompare(right.partId));
}

export function nestPartsAcrossSheets(
  parts: readonly SheetPart[],
  machine: MachineProfile,
  material: MaterialProfile,
  processRecipe: ProcessRecipe,
  context: FabricationContext,
): SheetNest[] {
  const sheets: { placed: { placement: SheetPlacement; box: Box }[] }[] = [];
  for (const part of sortedPartsByArea(parts)) {
    let selectedSheetIndex = -1;
    let selected: { placement: SheetPlacement; box: Box } | undefined;
    for (const [sheetIndex, sheet] of sheets.entries()) {
      const candidate = placementCandidates(
        part,
        sheet.placed,
        machine,
        material,
        processRecipe,
        context,
      )[0];
      if (candidate !== undefined) {
        selectedSheetIndex = sheetIndex;
        selected = candidate;
        break;
      }
    }
    if (selected === undefined) {
      const candidate = placementCandidates(
        part,
        [],
        machine,
        material,
        processRecipe,
        context,
      )[0];
      if (candidate === undefined) throw new NestingConstraintError(part, machine);
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
