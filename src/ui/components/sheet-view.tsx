"use client";

import type {
  ManufacturingPath,
  PointUm,
  SheetPlacement,
  SheetProjection
} from "../../domain/contracts";

type SheetViewProps = {
  sheet: SheetProjection;
  markingCodeByPartId: ReadonlyMap<string, string>;
  stockFootprintMm: { width: number; height: number } | null;
  selectedPartId: string | null;
  onSelectPart: (partId: string) => void;
};

function pathData(path: ManufacturingPath): string {
  const [first, ...rest] = path.contour.points;
  if (first === undefined) {
    return "";
  }
  const commands = [
    `M ${String(first.xUm / 1_000)} ${String(first.yUm / 1_000)}`,
    ...rest.map((point) => `L ${String(point.xUm / 1_000)} ${String(point.yUm / 1_000)}`)
  ];
  if (path.closed) {
    commands.push("Z");
  }
  return commands.join(" ");
}

function placementTransform(placement: SheetPlacement): string {
  const xMm = placement.xUm / 1_000;
  const yMm = placement.yUm / 1_000;
  return `translate(${String(xMm)} ${String(yMm)}) rotate(${String(placement.rotationDegrees)})`;
}

function rotate(point: PointUm, degrees: SheetPlacement["rotationDegrees"]): PointUm {
  switch (degrees) {
    case 0: return point;
    case 90: return { xUm: -point.yUm, yUm: point.xUm };
    case 180: return { xUm: -point.xUm, yUm: -point.yUm };
    case 270: return { xUm: point.yUm, yUm: -point.xUm };
  }
}

function labelAnchor(
  paths: readonly ManufacturingPath[],
  placement: SheetPlacement,
): { xMm: number; yMm: number } | null {
  const preferred = paths.filter((path) => path.operation === "cut" && path.closed);
  const points = (preferred.length === 0 ? paths : preferred).flatMap(
    (path) => path.contour.points,
  );
  if (points.length === 0) return null;
  const local = {
    xUm: Math.round(
      (Math.min(...points.map((point) => point.xUm)) +
        Math.max(...points.map((point) => point.xUm))) / 2,
    ),
    yUm: Math.round(
      (Math.min(...points.map((point) => point.yUm)) +
        Math.max(...points.map((point) => point.yUm))) / 2,
    )
  };
  const rotated = rotate(local, placement.rotationDegrees);
  return {
    xMm: (rotated.xUm + placement.xUm) / 1_000,
    yMm: (rotated.yUm + placement.yUm) / 1_000
  };
}

type SheetLabel = {
  partId: string;
  markingCode: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
};

function labelsOverlap(left: SheetLabel, right: SheetLabel): boolean {
  const gapMm = 1;
  return !(
    left.xMm + left.widthMm / 2 + gapMm <= right.xMm - right.widthMm / 2 ||
    right.xMm + right.widthMm / 2 + gapMm <= left.xMm - left.widthMm / 2 ||
    left.yMm + left.heightMm / 2 + gapMm <= right.yMm - right.heightMm / 2 ||
    right.yMm + right.heightMm / 2 + gapMm <= left.yMm - left.heightMm / 2
  );
}

function resolveLabelCollisions(labels: readonly SheetLabel[]): SheetLabel[] {
  const resolved: SheetLabel[] = [];
  for (const label of labels) {
    const strideMm = label.widthMm + 3;
    const offsets = [0, -strideMm, strideMm, -strideMm * 2, strideMm * 2];
    const candidate = offsets
      .map((offset) => ({ ...label, xMm: label.xMm + offset }))
      .find((option) => resolved.every((placed) => !labelsOverlap(option, placed))) ?? label;
    resolved.push(candidate);
  }
  return resolved;
}

export function SheetView({
  sheet,
  markingCodeByPartId,
  stockFootprintMm,
  selectedPartId,
  onSelectPart
}: SheetViewProps) {
  const placementByPartId = new Map(
    sheet.placements.map((placement) => [placement.partId, placement]),
  );
  const canvasWidthMm = stockFootprintMm?.width ?? sheet.widthMm;
  const canvasHeightMm = stockFootprintMm?.height ?? sheet.heightMm;
  const labels = resolveLabelCollisions(sheet.placements.flatMap((placement) => {
    const markingCode = markingCodeByPartId.get(placement.partId);
    const anchor = labelAnchor(
      sheet.paths.filter((path) => path.partId === placement.partId),
      placement,
    );
    return markingCode === undefined || anchor === null
      ? []
      : [{
          partId: placement.partId,
          markingCode,
          ...anchor,
          widthMm: Math.max(12, markingCode.length * 4 + 3),
          heightMm: 8
        }];
  }));
  return (
    <svg
      className="sheet-svg"
      viewBox={`0 0 ${String(canvasWidthMm)} ${String(canvasHeightMm)}`}
      role="img"
      aria-label={`${sheet.id} fabrication paths with part marks`}
    >
      <rect
        x="0.75"
        y="0.75"
        width={canvasWidthMm - 1.5}
        height={canvasHeightMm - 1.5}
        rx="3"
        className="sheet-bed"
      />
      {sheet.paths.map((path) => {
        const placement = placementByPartId.get(path.partId);
        if (placement === undefined) {
          return null;
        }
        const selected = selectedPartId === path.partId;
        return (
          <path
            key={path.id}
            d={pathData(path)}
            transform={placementTransform(placement)}
            className={`sheet-path operation-${path.operation}${selected ? " selected" : ""}`}
            vectorEffect="non-scaling-stroke"
            data-part-id={path.partId}
            onClick={() => onSelectPart(path.partId)}
          />
        );
      })}
      {labels.map((label) => {
        const selected = selectedPartId === label.partId;
        return (
          <g
            key={`${label.partId}-mark`}
            className={`sheet-mark${selected ? " selected" : ""}`}
            data-part-id={label.partId}
            data-marking-code={label.markingCode}
            role="button"
            tabIndex={0}
            aria-label={`Select part ${label.markingCode}`}
            onClick={() => onSelectPart(label.partId)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectPart(label.partId);
              }
            }}
          >
            <rect
              x={label.xMm - label.widthMm / 2}
              y={label.yMm - label.heightMm / 2}
              width={label.widthMm}
              height={label.heightMm}
              rx="1.5"
            />
            <text
              className="sheet-mark-label"
              x={label.xMm}
              y={label.yMm}
              textAnchor="middle"
              dominantBaseline="central"
            >{label.markingCode}</text>
          </g>
        );
      })}
    </svg>
  );
}
