import type {
  ManufacturingPath,
  PointUm,
  SheetPlacement,
  SheetProjection
} from "../../domain/contracts.js";
import { sha256 } from "../../domain/hash.js";
import { umToMm } from "../../domain/units.js";

export const OPERATION_COLORS = {
  cut: "#ff0000",
  score: "#0066ff",
  engrave: "#111111"
} as const;

export const ENGRAVE_SVG_REPRESENTATION = "fill-only-no-stroke" as const;

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatMm(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function rotate(point: PointUm, degrees: SheetPlacement["rotationDegrees"]): PointUm {
  switch (degrees) {
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

function place(point: PointUm, placement: SheetPlacement): PointUm {
  const rotated = rotate(point, placement.rotationDegrees);
  return {
    xUm: rotated.xUm + placement.xUm,
    yUm: rotated.yUm + placement.yUm
  };
}

function pathData(
  path: ManufacturingPath,
  placement: SheetPlacement,
  sheetHeightMm: number,
): string {
  const points = path.contour.points.map((point) => place(point, placement));
  return points
    .map((point, index) => {
      const x = formatMm(umToMm(point.xUm));
      const y = formatMm(sheetHeightMm - umToMm(point.yUm));
      return `${index === 0 ? "M" : "L"}${x} ${y}`;
    })
    .concat(path.closed ? ["Z"] : [])
    .join(" ");
}

function serializePath(
  path: ManufacturingPath,
  placement: SheetPlacement,
  sheetHeightMm: number,
): string {
  const featureAttribute = path.featureId === null ? "" : ` data-feature-id="${xmlEscape(path.featureId)}"`;
  if (path.operation === "engrave" && !path.closed) {
    throw new Error(`ENGRAVE_REQUIRES_SIMPLE_CLOSED_AREA: ${path.id} is open.`);
  }
  const paint = path.operation === "engrave"
    ? ` fill="${OPERATION_COLORS.engrave}" stroke="none"`
    : ` fill="none" stroke="${OPERATION_COLORS[path.operation]}" stroke-width="0.1" vector-effect="non-scaling-stroke"`;
  return [
    `<path id="${xmlEscape(path.id)}"`,
    ` data-part-id="${xmlEscape(path.partId)}"`,
    featureAttribute,
    ` data-source-nominal-hash="${path.sourceNominalHash}"`,
    ` d="${pathData(path, placement, sheetHeightMm)}"`,
    paint,
    "/>"
  ].join("");
}

export function serializeSheetSvg(sheet: SheetProjection): string {
  const placementByPart = new Map(sheet.placements.map((placement) => [placement.partId, placement]));
  const groups = (["engrave", "score", "cut"] as const).map((operation) => {
    const operationPaths = sheet.paths
      .filter((path) => path.operation === operation)
      .sort((left, right) => left.partId.localeCompare(right.partId) ||
        left.cuttingOrder - right.cuttingOrder || left.id.localeCompare(right.id));
    const partIds = [...new Set(operationPaths.map((path) => path.partId))].sort();
    const partGroups = partIds.map((partId) => {
      const placement = placementByPart.get(partId);
      if (placement === undefined) {
        throw new Error(`Manufacturing path references unplaced part ${partId}.`);
      }
      const paths = operationPaths
        .filter((path) => path.partId === partId)
        .map((path) => serializePath(path, placement, sheet.heightMm))
        .join("");
      return `<g id="operation-${operation}--part-${xmlEscape(partId)}" data-part-id="${xmlEscape(partId)}">${paths}</g>`;
    });
    const label = operation === "cut" ? "Cut contours" : operation === "score" ? "Score centerlines" : "Engrave filled areas";
    return `<g id="operation-${operation}" data-operation="${operation}" data-operation-label="${label}" stroke-linejoin="miter">${partGroups.join("")}</g>`;
  });

  const width = formatMm(sheet.widthMm);
  const height = formatMm(sheet.heightMm);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`,
    `<metadata>{"schemaVersion":"1.0","sheetId":"${xmlEscape(sheet.id)}","units":"mm"}</metadata>`,
    ...groups,
    "</svg>",
    ""
  ].join("\n");
}

export async function svgHash(svg: string): Promise<string> {
  return sha256(svg);
}
