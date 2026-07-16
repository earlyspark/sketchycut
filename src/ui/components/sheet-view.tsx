"use client";

import type {
  ManufacturingPath,
  SheetPlacement,
  SheetProjection
} from "../../domain/contracts";

type SheetViewProps = {
  sheet: SheetProjection;
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

export function SheetView({ sheet, selectedPartId, onSelectPart }: SheetViewProps) {
  const placementByPartId = new Map(
    sheet.placements.map((placement) => [placement.partId, placement]),
  );
  return (
    <svg
      className="sheet-svg"
      viewBox={`0 0 ${String(sheet.widthMm)} ${String(sheet.heightMm)}`}
      role="img"
      aria-label={`${sheet.id} fabrication paths`}
    >
      <rect
        x="0.75"
        y="0.75"
        width={sheet.widthMm - 1.5}
        height={sheet.heightMm - 1.5}
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
    </svg>
  );
}
