import type {
  Finding,
  PointUm,
  PolylineUm,
  Region2D,
  SheetPart,
  ValidationReport
} from "../domain/contracts.js";
import { KERNEL_TOLERANCE_UM } from "../version.js";
import { contoursOverlap, orientPolyline } from "../kernel/geometry/clipper-adapter.js";
import { boundsUm, isCounterClockwise, signedAreaUm2 } from "../kernel/geometry/metrics.js";

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

export function segmentsIntersect(a1: PointUm, a2: PointUm, b1: PointUm, b2: PointUm): boolean {
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

export function pointInsidePolyline(point: PointUm, polygon: PolylineUm): boolean {
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

export function pointInsideRegion(point: PointUm, region: Region2D): boolean {
  return pointInsidePolyline(point, region.outer) &&
    !region.holes.some((hole) => pointInsidePolyline(point, hole));
}

function contourSegments(contour: PolylineUm): { start: PointUm; end: PointUm }[] {
  return contour.points.map((start, index) => ({
    start,
    end: contour.points[(index + 1) % contour.points.length]!
  }));
}

function pointSegmentDistanceUm(point: PointUm, start: PointUm, end: PointUm): number {
  const dx = end.xUm - start.xUm;
  const dy = end.yUm - start.yUm;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.xUm - start.xUm, point.yUm - start.yUm);
  }
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.xUm - start.xUm) * dx + (point.yUm - start.yUm) * dy) / (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(
    point.xUm - (start.xUm + projection * dx),
    point.yUm - (start.yUm + projection * dy),
  );
}

function segmentDistanceUm(
  firstStart: PointUm,
  firstEnd: PointUm,
  secondStart: PointUm,
  secondEnd: PointUm,
): number {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
    return 0;
  }
  return Math.min(
    pointSegmentDistanceUm(firstStart, secondStart, secondEnd),
    pointSegmentDistanceUm(firstEnd, secondStart, secondEnd),
    pointSegmentDistanceUm(secondStart, firstStart, firstEnd),
    pointSegmentDistanceUm(secondEnd, firstStart, firstEnd),
  );
}

function contourDistanceUm(left: PolylineUm, right: PolylineUm): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const first of contourSegments(left)) {
    for (const second of contourSegments(right)) {
      minimum = Math.min(
        minimum,
        segmentDistanceUm(first.start, first.end, second.start, second.end),
      );
    }
  }
  return minimum;
}

function holeContainedByOuter(hole: PolylineUm, outer: PolylineUm): boolean {
  if (!hole.points.every((point) => pointInsidePolyline(point, outer))) {
    return false;
  }
  for (const holeSegment of contourSegments(hole)) {
    for (const outerSegment of contourSegments(outer)) {
      if (
        segmentsIntersect(holeSegment.start, holeSegment.end, outerSegment.start, outerSegment.end) &&
        !pointOnSegment(holeSegment.start, outerSegment.start, outerSegment.end) &&
        !pointOnSegment(holeSegment.end, outerSegment.start, outerSegment.end)
      ) {
        return false;
      }
    }
  }
  const midpointChecks = contourSegments(hole).map(({ start, end }) => ({
    xUm: Math.round((start.xUm + end.xUm) / 2),
    yUm: Math.round((start.yUm + end.yUm) / 2)
  }));
  return midpointChecks.every((point) => pointInsidePolyline(point, outer));
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

export type GeometryValidationOptions = {
  minimumWebUm?: number;
  compensationXUm?: number;
  compensationYUm?: number;
};

export function validateParts(
  parts: readonly SheetPart[],
  options: GeometryValidationOptions = {},
): ValidationReport {
  const findings: Finding[] = [];
  const minimumWebUm = options.minimumWebUm ?? 500;
  const compensationXUm = options.compensationXUm ?? 0;
  const compensationYUm = options.compensationYUm ?? compensationXUm;
  const partIds = parts.map((part) => part.id);
  if (new Set(partIds).size !== partIds.length) {
    findings.push(finding("DUPLICATE_PART_ID", "canonical-document", partIds, "Part IDs must be unique."));
  }

  for (const part of parts) {
    findings.push(...validateContour(part, part.nominalRegion.outer, "ccw"));
    for (const hole of part.nominalRegion.holes) {
      findings.push(...validateContour(part, hole, "cw"));
      if (!holeContainedByOuter(hole, part.nominalRegion.outer)) {
        findings.push(
          finding(
            "HOLE_OUTSIDE_OUTER_CONTOUR",
            "geometry",
            [part.id, hole.id],
            "Hole must remain inside the part outer contour.",
          ),
        );
      }
      const holeBounds = boundsUm(hole.points);
      if (
        holeBounds.maxXUm - holeBounds.minXUm <= compensationXUm * 2 ||
        holeBounds.maxYUm - holeBounds.minYUm <= compensationYUm * 2
      ) {
        findings.push(
          finding(
            "COMPENSATED_FEATURE_SURVIVAL",
            "geometry",
            [part.id, hole.id],
            "A compensated internal feature would collapse or invert.",
          ),
        );
      }
    }

    for (let leftIndex = 0; leftIndex < part.nominalRegion.holes.length; leftIndex += 1) {
      const left = part.nominalRegion.holes[leftIndex]!;
      if (contourDistanceUm(left, part.nominalRegion.outer) < minimumWebUm) {
        findings.push(
          finding(
            "MINIMUM_WEB_VIOLATION",
            "geometry",
            [part.id, left.id],
            "Internal geometry leaves less than the required minimum web to the outer contour.",
          ),
        );
      }
      for (let rightIndex = leftIndex + 1; rightIndex < part.nominalRegion.holes.length; rightIndex += 1) {
        const right = part.nominalRegion.holes[rightIndex]!;
        if (
          contoursOverlap(orientPolyline(left, "ccw"), orientPolyline(right, "ccw")) ||
          left.points.some((point) => pointInsidePolyline(point, right)) ||
          right.points.some((point) => pointInsidePolyline(point, left))
        ) {
          findings.push(
            finding(
              "HOLE_OVERLAP",
              "geometry",
              [part.id, left.id, right.id],
              "Internal holes must not overlap or contain one another.",
            ),
          );
        } else if (contourDistanceUm(left, right) < minimumWebUm) {
          findings.push(
            finding(
              "MINIMUM_WEB_VIOLATION",
              "geometry",
              [part.id, left.id, right.id],
              "Internal holes leave less than the required minimum web.",
            ),
          );
        }
      }
    }

    const featureIds = part.features.map((feature) => feature.id);
    if (new Set(featureIds).size !== featureIds.length) {
      findings.push(
        finding("DUPLICATE_FEATURE_ID", "canonical-document", [part.id], "Feature IDs must be unique within a part."),
      );
    }

    const engraveRegions: { featureId: string; region: Region2D }[] = [];
    for (const feature of part.features) {
      if (feature.operation === "engrave") {
        if (feature.region === null || feature.path !== null) {
          findings.push(
            finding(
              "ENGRAVE_REQUIRES_SIMPLE_CLOSED_AREA",
              "manufacturing-semantics",
              [part.id, feature.id],
              "Vector Engrave requires one exactly closed filled region, not linework.",
            ),
          );
          continue;
        }
        if (feature.region.holes.length > 0) {
          findings.push(
            finding(
              "ENGRAVE_COMPOUND_REGION_UNSUPPORTED",
              "manufacturing-semantics",
              [part.id, feature.id],
              "Compound Engrave regions with holes are not supported by this serializer version.",
            ),
          );
          continue;
        }
        findings.push(...validateContour(part, feature.region.outer, "ccw"));
        if (!feature.region.outer.points.every((point) => pointInsideRegion(point, part.nominalRegion))) {
          findings.push(
            finding(
              "ENGRAVE_REGION_OUTSIDE_PART",
              "manufacturing-semantics",
              [part.id, feature.id],
              "Engrave area must remain inside the nominal sheet part.",
            ),
          );
        }
        engraveRegions.push({ featureId: feature.id, region: feature.region });
      } else if (feature.operation === "score" && (feature.path === null || feature.region !== null)) {
        findings.push(
          finding(
            "SCORE_REQUIRES_CENTERLINE",
            "manufacturing-semantics",
            [part.id, feature.id],
            "Score geometry must be a vector centerline path.",
          ),
        );
      }
    }
    for (let leftIndex = 0; leftIndex < engraveRegions.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < engraveRegions.length; rightIndex += 1) {
        const left = engraveRegions[leftIndex]!;
        const right = engraveRegions[rightIndex]!;
        if (contoursOverlap(left.region.outer, right.region.outer)) {
          findings.push(
            finding(
              "ENGRAVE_REGION_OVERLAP",
              "manufacturing-semantics",
              [part.id, left.featureId, right.featureId],
              "Engrave areas must not overlap.",
            ),
          );
        }
      }
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
