import type {
  Finding,
  PointUm,
  PolylineUm,
  SheetPart,
  SheetPlacement,
  SheetProjection,
  ValidationReport
} from "../domain/contracts.js";
import { mmToUm } from "../domain/units.js";
import { contoursOverlap } from "../kernel/geometry/clipper-adapter.js";
import { signedAreaUm2 } from "../kernel/geometry/metrics.js";

function finding(
  code: string,
  relatedIds: string[],
  message: string,
): Finding {
  return {
    code,
    severity: "error",
    owner: "sheet-projection",
    relatedIds,
    message,
    blocksExport: true
  };
}

function rotate(point: PointUm, rotation: SheetPlacement["rotationDegrees"]): PointUm {
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

function placePoint(point: PointUm, placement: SheetPlacement): PointUm {
  const rotated = rotate(point, placement.rotationDegrees);
  return {
    xUm: rotated.xUm + placement.xUm,
    yUm: rotated.yUm + placement.yUm
  };
}

function placePolyline(polyline: PolylineUm, placement: SheetPlacement): PolylineUm {
  return {
    ...polyline,
    points: polyline.points.map((point) => placePoint(point, placement))
  };
}

function pointKey(point: PointUm): string {
  return `${String(point.xUm)},${String(point.yUm)}`;
}

function segmentKey(start: PointUm, end: PointUm): string {
  return [pointKey(start), pointKey(end)].sort().join("~");
}

export function validateSheetProjection(
  sheet: SheetProjection,
  parts: readonly SheetPart[],
): ValidationReport {
  const findings: Finding[] = [];
  const partById = new Map(parts.map((part) => [part.id, part]));
  const placementIds = sheet.placements.map((placement) => placement.id);
  const placedPartIds = sheet.placements.map((placement) => placement.partId);
  const placementByPartId = new Map(
    sheet.placements.map((placement) => [placement.partId, placement]),
  );
  const widthUm = mmToUm(sheet.widthMm);
  const heightUm = mmToUm(sheet.heightMm);

  if (new Set(placementIds).size !== placementIds.length) {
    findings.push(
      finding(
        "DUPLICATE_PLACEMENT_ID",
        placementIds,
        "Sheet placement IDs must be unique.",
      ),
    );
  }
  if (new Set(placedPartIds).size !== placedPartIds.length) {
    findings.push(
      finding(
        "DUPLICATE_PART_PLACEMENT",
        placedPartIds,
        "Each part may appear only once on an M1 sheet.",
      ),
    );
  }

  for (const part of parts) {
    if (!placementByPartId.has(part.id)) {
      findings.push(
        finding(
          "MISSING_PART_PLACEMENT",
          [part.id],
          "Every canonical part must have a sheet placement.",
        ),
      );
    }
  }

  const pathIds = sheet.paths.map((path) => path.id);
  if (new Set(pathIds).size !== pathIds.length) {
    findings.push(
      finding("DUPLICATE_PATH_ID", pathIds, "Manufacturing path IDs must be unique."),
    );
  }

  const cutSegments = new Map<string, string>();
  for (const path of sheet.paths) {
    const placement = placementByPartId.get(path.partId);
    if (placement === undefined || !partById.has(path.partId)) {
      findings.push(
        finding(
          "DANGLING_PATH_PART",
          [path.id, path.partId],
          "Manufacturing paths must reference a placed canonical part.",
        ),
      );
      continue;
    }
    if (path.closed !== path.contour.closed) {
      findings.push(
        finding(
          "PATH_CLOSURE_MISMATCH",
          [path.id, path.contour.id],
          "Manufacturing path closure must match its contour.",
        ),
      );
    }
    const placed = placePolyline(path.contour, placement);
    for (const point of placed.points) {
      if (point.xUm < 0 || point.yUm < 0 || point.xUm > widthUm || point.yUm > heightUm) {
        findings.push(
          finding(
            "PATH_OUTSIDE_SHEET",
            [path.id, path.partId],
            "Manufacturing geometry must remain inside the machine bed.",
          ),
        );
        break;
      }
    }
    if (path.closed) {
      const area = signedAreaUm2(placed.points);
      if (area === 0) {
        findings.push(
          finding(
            "DEGENERATE_MANUFACTURING_CONTOUR",
            [path.id],
            "Closed manufacturing contours must have nonzero area.",
          ),
        );
      }
      if (path.id.includes("-cut-hole-") && area >= 0) {
        findings.push(
          finding(
            "INCONSISTENT_MANUFACTURING_ORIENTATION",
            [path.id],
            "Manufacturing holes must be clockwise.",
          ),
        );
      }
      if (path.id.endsWith("-cut-outer") && area <= 0) {
        findings.push(
          finding(
            "INCONSISTENT_MANUFACTURING_ORIENTATION",
            [path.id],
            "Manufacturing outer contours must be counter-clockwise.",
          ),
        );
      }
    }
    if (path.operation !== "cut") {
      continue;
    }
    const segmentCount = placed.closed ? placed.points.length : placed.points.length - 1;
    for (let index = 0; index < segmentCount; index += 1) {
      const start = placed.points[index]!;
      const end = placed.points[(index + 1) % placed.points.length]!;
      const key = segmentKey(start, end);
      const priorPathId = cutSegments.get(key);
      if (priorPathId !== undefined) {
        findings.push(
          finding(
            "DUPLICATE_CUT_SEGMENT",
            [priorPathId, path.id],
            "The sheet contains a duplicate physical cut segment.",
          ),
        );
      } else {
        cutSegments.set(key, path.id);
      }
    }
  }

  const placedOuters = parts.flatMap((part) => {
    const placement = placementByPartId.get(part.id);
    return placement === undefined
      ? []
      : [{ partId: part.id, contour: placePolyline(part.nominalRegion.outer, placement) }];
  });
  for (let leftIndex = 0; leftIndex < placedOuters.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < placedOuters.length; rightIndex += 1) {
      const left = placedOuters[leftIndex]!;
      const right = placedOuters[rightIndex]!;
      if (contoursOverlap(left.contour, right.contour)) {
        findings.push(
          finding(
            "PART_PLACEMENT_OVERLAP",
            [left.partId, right.partId],
            "Nested part outer contours must not overlap.",
          ),
        );
      }
    }
  }

  return {
    schemaVersion: "1.0",
    status: findings.length === 0 ? "pass" : "fail",
    findings
  };
}
