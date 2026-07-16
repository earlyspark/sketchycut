import type {
  Finding,
  PointUm,
  PolylineUm,
  SheetPart,
  ValidationReport
} from "../domain/contracts.js";
import { KERNEL_TOLERANCE_UM } from "../version.js";
import { isCounterClockwise, signedAreaUm2 } from "../kernel/geometry/metrics.js";

function orientation(a: PointUm, b: PointUm, c: PointUm): number {
  const cross = (b.xUm - a.xUm) * (c.yUm - a.yUm) - (b.yUm - a.yUm) * (c.xUm - a.xUm);
  return Math.sign(cross);
}

function pointOnSegment(point: PointUm, start: PointUm, end: PointUm): boolean {
  if (orientation(start, end, point) !== 0) {
    return false;
  }
  return (
    point.xUm >= Math.min(start.xUm, end.xUm) &&
    point.xUm <= Math.max(start.xUm, end.xUm) &&
    point.yUm >= Math.min(start.yUm, end.yUm) &&
    point.yUm <= Math.max(start.yUm, end.yUm)
  );
}

function segmentsIntersect(a1: PointUm, a2: PointUm, b1: PointUm, b2: PointUm): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) {
    return true;
  }
  return (
    (o1 === 0 && pointOnSegment(b1, a1, a2)) ||
    (o2 === 0 && pointOnSegment(b2, a1, a2)) ||
    (o3 === 0 && pointOnSegment(a1, b1, b2)) ||
    (o4 === 0 && pointOnSegment(a2, b1, b2))
  );
}

function isSimple(polyline: PolylineUm): boolean {
  const points = polyline.points;
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    const leftStart = points[leftIndex]!;
    const leftEnd = points[(leftIndex + 1) % points.length]!;
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      const areAdjacent =
        rightIndex === leftIndex ||
        rightIndex === leftIndex + 1 ||
        (leftIndex === 0 && rightIndex === points.length - 1);
      if (areAdjacent) {
        continue;
      }
      const rightStart = points[rightIndex]!;
      const rightEnd = points[(rightIndex + 1) % points.length]!;
      if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) {
        return false;
      }
    }
  }
  return true;
}

function pointInside(point: PointUm, polygon: PolylineUm): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.points.length - 1; index < polygon.points.length; previous = index, index += 1) {
    const currentPoint = polygon.points[index]!;
    const previousPoint = polygon.points[previous]!;
    if (pointOnSegment(point, previousPoint, currentPoint)) {
      return true;
    }
    const crosses =
      currentPoint.yUm > point.yUm !== previousPoint.yUm > point.yUm &&
      point.xUm <
        ((previousPoint.xUm - currentPoint.xUm) * (point.yUm - currentPoint.yUm)) /
          (previousPoint.yUm - currentPoint.yUm) +
          currentPoint.xUm;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

function pointKey(point: PointUm): string {
  return `${String(point.xUm)},${String(point.yUm)}`;
}

function segmentKey(start: PointUm, end: PointUm): string {
  return [pointKey(start), pointKey(end)].sort().join("~");
}

function finding(
  code: string,
  owner: string,
  relatedIds: string[],
  message: string,
  severity: Finding["severity"] = "error",
): Finding {
  return {
    code,
    severity,
    owner,
    relatedIds,
    message,
    blocksExport: severity === "error"
  };
}

function validateContour(
  part: SheetPart,
  contour: PolylineUm,
  expectedOrientation: "ccw" | "cw",
): Finding[] {
  const findings: Finding[] = [];
  if (Math.abs(signedAreaUm2(contour.points)) <= KERNEL_TOLERANCE_UM) {
    findings.push(
      finding("DEGENERATE_CONTOUR", "geometry", [part.id, contour.id], "Contour area is degenerate."),
    );
  }
  if (isCounterClockwise(contour) !== (expectedOrientation === "ccw")) {
    findings.push(
      finding(
        "INCONSISTENT_CONTOUR_ORIENTATION",
        "geometry",
        [part.id, contour.id],
        `Contour must be ${expectedOrientation.toUpperCase()}.`,
      ),
    );
  }
  const pointKeys = contour.points.map(pointKey);
  if (new Set(pointKeys).size !== pointKeys.length) {
    findings.push(
      finding("DUPLICATE_CONTOUR_VERTEX", "geometry", [part.id, contour.id], "Contour repeats a vertex."),
    );
  }
  if (!isSimple(contour)) {
    findings.push(
      finding("SELF_INTERSECTING_CONTOUR", "geometry", [part.id, contour.id], "Contour is not simple."),
    );
  }
  return findings;
}

export function validateParts(parts: readonly SheetPart[]): ValidationReport {
  const findings: Finding[] = [];
  const partIds = parts.map((part) => part.id);
  if (new Set(partIds).size !== partIds.length) {
    findings.push(finding("DUPLICATE_PART_ID", "canonical-document", partIds, "Part IDs must be unique."));
  }

  for (const part of parts) {
    findings.push(...validateContour(part, part.nominalRegion.outer, "ccw"));
    for (const hole of part.nominalRegion.holes) {
      findings.push(...validateContour(part, hole, "cw"));
      if (!pointInside(hole.points[0]!, part.nominalRegion.outer)) {
        findings.push(
          finding(
            "HOLE_OUTSIDE_OUTER_CONTOUR",
            "geometry",
            [part.id, hole.id],
            "Hole must remain inside the part outer contour.",
          ),
        );
      }
    }

    const featureIds = part.features.map((feature) => feature.id);
    if (new Set(featureIds).size !== featureIds.length) {
      findings.push(
        finding("DUPLICATE_FEATURE_ID", "canonical-document", [part.id], "Feature IDs must be unique within a part."),
      );
    }

    const segments = new Set<string>();
    for (const contour of [part.nominalRegion.outer, ...part.nominalRegion.holes]) {
      for (let index = 0; index < contour.points.length; index += 1) {
        const key = segmentKey(contour.points[index]!, contour.points[(index + 1) % contour.points.length]!);
        if (segments.has(key)) {
          findings.push(
            finding(
              "DUPLICATE_CUT_SEGMENT",
              "geometry",
              [part.id, contour.id],
              "Nominal part geometry contains a duplicate cut segment.",
            ),
          );
        }
        segments.add(key);
      }
    }
  }

  findings.push(
    finding(
      "CALIBRATION_REQUIRED",
      "evidence",
      parts.map((part) => part.id),
      "Fit and kerf remain provisional until a same-sheet coupon is selected.",
      "warning",
    ),
    finding(
      "PHYSICAL_VERIFICATION_REQUIRED",
      "evidence",
      parts.map((part) => part.id),
      "Software validation does not establish physical fit, strength, or machine compatibility.",
      "warning",
    ),
  );

  return {
    schemaVersion: "1.0",
    status: findings.some((item) => item.severity === "error") ? "fail" : "pass",
    findings
  };
}
