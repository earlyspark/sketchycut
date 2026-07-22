import type { PointUm, Region2D } from "../../domain/contracts.js";

export const REGISTERED_ARC_POLYGON_POLICY = {
  id: "registered-arc-polygon",
  version: "1.0.0",
  chordToleranceUm: 50,
  minimumSegments: 8,
  maximumSegments: 256
} as const;

type ClosedPolylineUm = Region2D["outer"];

function roundedPoint(
  center: PointUm,
  radiusUm: number,
  angleRadians: number,
): PointUm {
  return {
    xUm: Math.round(center.xUm + Math.cos(angleRadians) * radiusUm),
    yUm: Math.round(center.yUm + Math.sin(angleRadians) * radiusUm)
  };
}

function pointKey(point: PointUm): string {
  return `${String(point.xUm)},${String(point.yUm)}`;
}

function postRoundingChordErrorUm(
  points: readonly PointUm[],
  center: PointUm,
  radiusUm: number,
): number {
  let maximum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const vertexRadius = Math.hypot(current.xUm - center.xUm, current.yUm - center.yUm);
    const midpointRadius = Math.hypot(
      (current.xUm + next.xUm) / 2 - center.xUm,
      (current.yUm + next.yUm) / 2 - center.yUm,
    );
    maximum = Math.max(
      maximum,
      Math.abs(radiusUm - vertexRadius),
      Math.max(0, radiusUm - midpointRadius),
    );
  }
  return maximum;
}

function initialSegmentCount(radiusUm: number, toleranceUm: number): number {
  const bounded = Math.min(toleranceUm, radiusUm);
  const maximumAngle = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - bounded / radiusUm)));
  if (!Number.isFinite(maximumAngle) || maximumAngle <= 0) {
    return REGISTERED_ARC_POLYGON_POLICY.maximumSegments;
  }
  return Math.max(
    REGISTERED_ARC_POLYGON_POLICY.minimumSegments,
    Math.ceil((Math.PI * 2) / maximumAngle),
  );
}

export function approximateCircularContour(input: {
  id: string;
  center: PointUm;
  radiusUm: number;
  phaseMicroradians?: number;
  orientation?: "ccw" | "cw";
  chordToleranceUm?: number;
}): ClosedPolylineUm {
  if (!Number.isSafeInteger(input.center.xUm) || !Number.isSafeInteger(input.center.yUm)) {
    throw new RangeError("Arc centre must use integer micrometres.");
  }
  if (!Number.isSafeInteger(input.radiusUm) || input.radiusUm <= 0) {
    throw new RangeError("Arc radius must be a positive integer number of micrometres.");
  }
  const toleranceUm = input.chordToleranceUm ?? REGISTERED_ARC_POLYGON_POLICY.chordToleranceUm;
  if (toleranceUm !== REGISTERED_ARC_POLYGON_POLICY.chordToleranceUm) {
    throw new RangeError("Arc approximation must use the registered fixed chord tolerance.");
  }
  const phase = (input.phaseMicroradians ?? 0) / 1_000_000;
  let segmentCount = initialSegmentCount(input.radiusUm, toleranceUm);
  while (segmentCount <= REGISTERED_ARC_POLYGON_POLICY.maximumSegments) {
    const points = Array.from({ length: segmentCount }, (_, index) =>
      roundedPoint(
        input.center,
        input.radiusUm,
        phase + (index * Math.PI * 2) / segmentCount,
      )
    );
    if (
      new Set(points.map(pointKey)).size === points.length &&
      postRoundingChordErrorUm(points, input.center, input.radiusUm) <= toleranceUm
    ) {
      return {
        id: input.id,
        closed: true,
        points: input.orientation === "cw" ? points.reverse() : points
      };
    }
    segmentCount += 1;
  }
  throw new Error("ARC_APPROXIMATION_BUDGET_EXHAUSTED");
}

export function measuredCircularChordErrorUm(
  contour: ClosedPolylineUm,
  center: PointUm,
  radiusUm: number,
): number {
  return postRoundingChordErrorUm(contour.points, center, radiusUm);
}
