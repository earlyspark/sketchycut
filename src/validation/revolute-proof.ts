import type { MotionConstraint, PointUm } from "../domain/contracts.js";

type RevoluteDetails = NonNullable<MotionConstraint["revolute"]>;
type SectionPrimitive = RevoluteDetails["proofModel"]["sectionPrimitives"][number];

export type RevoluteProofReport = {
  schemaVersion: "1.0";
  method: "axis-partition-conservative-angle-interval";
  rotationSign: -1;
  constraintId: string;
  status: "pass" | "fail";
  axisIntervalCount: number;
  angleIntervalsTested: number;
  certifiedPairIntervals: number;
  maximumRecursionDepth: number;
  animationSampleMaximumDegrees: number;
  animationSampleCount: number;
  endpointContacts: {
    id: string;
    movingPrimitiveId: string;
    stationaryPrimitiveId: string;
    angleDegrees: number;
    nominalGapUm: number;
    minimumInteriorGapUm: number;
    positiveAwayFromEndpoint: boolean;
    monotoneSeparation: boolean;
    conservativeInteriorStatus: "certified" | "collision" | "indeterminate";
    status: "certified" | "failed";
  }[];
  collisions: {
    axialIntervalId: string;
    movingPrimitiveId: string;
    stationaryPrimitiveId: string;
    angleDegrees: number;
  }[];
  indeterminatePairs: {
    axialIntervalId: string;
    movingPrimitiveId: string;
    stationaryPrimitiveId: string;
  }[];
};

type PairResult =
  | { status: "certified"; tested: number; depth: number; certified: number }
  | { status: "collision"; tested: number; depth: number; angleDegrees: number }
  | { status: "indeterminate"; tested: number; depth: number };

type EndpointContact = RevoluteDetails["proofModel"]["allowedEndpointContacts"][number];

function rotatePolygon(points: readonly PointUm[], degrees: number): PointUm[] {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return points.map((point) => ({
    xUm: Math.round(point.xUm * cosine - point.yUm * sine),
    yUm: Math.round(point.xUm * sine + point.yUm * cosine)
  }));
}

function cross(a: PointUm, b: PointUm, c: PointUm): number {
  return (b.xUm - a.xUm) * (c.yUm - a.yUm) -
    (b.yUm - a.yUm) * (c.xUm - a.xUm);
}

function pointOnSegment(point: PointUm, start: PointUm, end: PointUm): boolean {
  return cross(start, end, point) === 0 &&
    point.xUm >= Math.min(start.xUm, end.xUm) &&
    point.xUm <= Math.max(start.xUm, end.xUm) &&
    point.yUm >= Math.min(start.yUm, end.yUm) &&
    point.yUm <= Math.max(start.yUm, end.yUm);
}

function segmentsIntersect(a: PointUm, b: PointUm, c: PointUm, d: PointUm): boolean {
  const abC = Math.sign(cross(a, b, c));
  const abD = Math.sign(cross(a, b, d));
  const cdA = Math.sign(cross(c, d, a));
  const cdB = Math.sign(cross(c, d, b));
  return (abC !== abD && cdA !== cdB) ||
    (abC === 0 && pointOnSegment(c, a, b)) ||
    (abD === 0 && pointOnSegment(d, a, b)) ||
    (cdA === 0 && pointOnSegment(a, c, d)) ||
    (cdB === 0 && pointOnSegment(b, c, d));
}

function pointInside(point: PointUm, polygon: readonly PointUm[]): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index, index += 1
  ) {
    const currentPoint = polygon[index]!;
    const previousPoint = polygon[previous]!;
    if (pointOnSegment(point, previousPoint, currentPoint)) {
      return true;
    }
    if (
      currentPoint.yUm > point.yUm !== previousPoint.yUm > point.yUm &&
      point.xUm <
        ((previousPoint.xUm - currentPoint.xUm) *
          (point.yUm - currentPoint.yUm)) /
          (previousPoint.yUm - currentPoint.yUm) +
          currentPoint.xUm
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonsIntersect(left: readonly PointUm[], right: readonly PointUm[]): boolean {
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftStart = left[leftIndex]!;
    const leftEnd = left[(leftIndex + 1) % left.length]!;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      if (
        segmentsIntersect(
          leftStart,
          leftEnd,
          right[rightIndex]!,
          right[(rightIndex + 1) % right.length]!,
        )
      ) {
        return true;
      }
    }
  }
  return pointInside(left[0]!, right) || pointInside(right[0]!, left);
}

function pointSegmentDistance(point: PointUm, start: PointUm, end: PointUm): number {
  const dx = end.xUm - start.xUm;
  const dy = end.yUm - start.yUm;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.xUm - start.xUm, point.yUm - start.yUm);
  }
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.xUm - start.xUm) * dx + (point.yUm - start.yUm) * dy) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    point.xUm - (start.xUm + projection * dx),
    point.yUm - (start.yUm + projection * dy),
  );
}

function polygonDistance(left: readonly PointUm[], right: readonly PointUm[]): number {
  if (polygonsIntersect(left, right)) {
    return 0;
  }
  let minimum = Number.POSITIVE_INFINITY;
  const visit = (vertices: readonly PointUm[], edges: readonly PointUm[]): void => {
    for (const vertex of vertices) {
      for (let index = 0; index < edges.length; index += 1) {
        minimum = Math.min(
          minimum,
          pointSegmentDistance(vertex, edges[index]!, edges[(index + 1) % edges.length]!),
        );
      }
    }
  };
  visit(left, right);
  visit(right, left);
  return minimum;
}

function certifyPair(
  moving: SectionPrimitive,
  stationary: SectionPrimitive,
  minimumDegrees: number,
  maximumDegrees: number,
  inflationUm: number,
  depth = 0,
): PairResult {
  const middleDegrees = (minimumDegrees + maximumDegrees) / 2;
  const samples = [minimumDegrees, middleDegrees, maximumDegrees];
  const distances = samples.map((angle) =>
    polygonDistance(rotatePolygon(moving.polygon, angle), stationary.polygon),
  );
  const collisionIndex = distances.findIndex((distance) => distance <= inflationUm * 2);
  if (collisionIndex >= 0) {
    return {
      status: "collision",
      tested: 1,
      depth,
      angleDegrees: samples[collisionIndex]!
    };
  }

  const maximumRadiusUm = Math.max(
    ...moving.polygon.map((point) => Math.hypot(point.xUm, point.yUm)),
  );
  const nearestSampleDeltaRadians =
    ((maximumDegrees - minimumDegrees) / 4) * Math.PI / 180;
  const conservativeMotionBoundUm =
    2 * maximumRadiusUm * Math.sin(nearestSampleDeltaRadians / 2);
  if (Math.min(...distances) > conservativeMotionBoundUm + inflationUm * 2) {
    return { status: "certified", tested: 1, depth, certified: 1 };
  }
  if (depth >= 8 || maximumDegrees - minimumDegrees <= 0.02) {
    return { status: "indeterminate", tested: 1, depth };
  }
  const left = certifyPair(
    moving,
    stationary,
    minimumDegrees,
    middleDegrees,
    inflationUm,
    depth + 1,
  );
  if (left.status !== "certified") {
    return { ...left, tested: left.tested + 1 };
  }
  const right = certifyPair(
    moving,
    stationary,
    middleDegrees,
    maximumDegrees,
    inflationUm,
    depth + 1,
  );
  if (right.status !== "certified") {
    return { ...right, tested: left.tested + right.tested + 1 };
  }
  return {
    status: "certified",
    tested: left.tested + right.tested + 1,
    depth: Math.max(left.depth, right.depth),
    certified: left.certified + right.certified
  };
}

function certifyPairRange(
  moving: SectionPrimitive,
  stationary: SectionPrimitive,
  minimumDegrees: number,
  maximumDegrees: number,
  inflationUm: number,
  maximumIntervalDegrees: number,
): PairResult {
  let tested = 0;
  let depth = 0;
  let certified = 0;
  for (
    let start = minimumDegrees;
    start < maximumDegrees - 1e-9;
    start += maximumIntervalDegrees
  ) {
    const result = certifyPair(
      moving,
      stationary,
      start,
      Math.min(maximumDegrees, start + maximumIntervalDegrees),
      inflationUm,
    );
    tested += result.tested;
    depth = Math.max(depth, result.depth);
    if (result.status !== "certified") {
      return { ...result, tested, depth };
    }
    certified += result.certified;
  }
  return { status: "certified", tested, depth, certified };
}

function certifyEndpointContact(
  moving: SectionPrimitive,
  stationary: SectionPrimitive,
  contact: EndpointContact,
  range: MotionConstraint["range"],
  inflationUm: number,
  maximumIntervalDegrees: number,
): {
  status: "certified" | "failed";
  nominalGapUm: number;
  tested: number;
  depth: number;
  certified: number;
  minimumInteriorGapUm: number;
  positiveAwayFromEndpoint: boolean;
  monotoneSeparation: boolean;
  conservativeInteriorStatus: "certified" | "collision" | "indeterminate";
} {
  const atMinimum = Math.abs(contact.angleDegrees - range.minimum) <= 1e-9;
  const atMaximum = Math.abs(contact.angleDegrees - range.maximum) <= 1e-9;
  if (!atMinimum && !atMaximum) {
    return {
      status: "failed",
      nominalGapUm: Number.POSITIVE_INFINITY,
      tested: 0,
      depth: 0,
      certified: 0,
      minimumInteriorGapUm: 0,
      positiveAwayFromEndpoint: false,
      monotoneSeparation: false,
      conservativeInteriorStatus: "indeterminate"
    };
  }
  const nominalGapUm = polygonDistance(
    rotatePolygon(moving.polygon, contact.angleDegrees),
    stationary.polygon,
  );
  const transitionBoundary = atMinimum
    ? Math.min(range.maximum, range.minimum + contact.transitionDegrees)
    : Math.max(range.minimum, range.maximum - contact.transitionDegrees);
  const interior = atMinimum
    ? certifyPairRange(
        moving,
        stationary,
        transitionBoundary,
        range.maximum,
        inflationUm,
        maximumIntervalDegrees,
      )
    : certifyPairRange(
        moving,
        stationary,
        range.minimum,
        transitionBoundary,
        inflationUm,
        maximumIntervalDegrees,
      );
  const approachAngles = Array.from({ length: 26 }, (_, index) =>
    atMinimum
      ? range.minimum + contact.transitionDegrees * index / 25
      : range.maximum - contact.transitionDegrees + contact.transitionDegrees * index / 25,
  );
  const approachDistances = approachAngles.map((angle) =>
    polygonDistance(rotatePolygon(moving.polygon, angle), stationary.polygon),
  );
  const endpointIndex = atMinimum ? 0 : approachDistances.length - 1;
  const positiveAwayFromEndpoint = approachDistances.every((distance, index) =>
    index === endpointIndex || distance > 0,
  );
  const monotoneSeparation = atMinimum
    ? approachDistances.every(
        (distance, index) => index === 0 || distance + 1 >= approachDistances[index - 1]!,
      )
    : approachDistances.every(
        (distance, index) => index === 0 || distance <= approachDistances[index - 1]! + 1,
      );
  const status = nominalGapUm <= contact.maximumContactGapUm &&
    interior.status === "certified" &&
    positiveAwayFromEndpoint &&
    monotoneSeparation
    ? "certified"
    : "failed";
  return {
    status,
    nominalGapUm,
    tested: interior.tested + approachAngles.length,
    depth: interior.depth,
    certified: interior.status === "certified" ? interior.certified : 0,
    minimumInteriorGapUm: Math.min(
      ...approachDistances.filter((_, index) => index !== endpointIndex),
    ),
    positiveAwayFromEndpoint,
    monotoneSeparation,
    conservativeInteriorStatus: interior.status
  };
}

export function certifyRevoluteTravel(constraint: MotionConstraint): RevoluteProofReport {
  if (constraint.kind !== "revolute" || constraint.revolute === undefined) {
    throw new Error("Revolute travel proof requires a canonical revolute constraint.");
  }
  const details = constraint.revolute;
  const primitiveById = new Map(
    details.proofModel.sectionPrimitives.map((primitive) => [primitive.id, primitive]),
  );
  const report: RevoluteProofReport = {
    schemaVersion: "1.0",
    method: details.proofModel.method,
    rotationSign: details.rotationSign,
    constraintId: constraint.id,
    status: "pass",
    axisIntervalCount: details.proofModel.sectionIntervals.length,
    angleIntervalsTested: 0,
    certifiedPairIntervals: 0,
    maximumRecursionDepth: 0,
    animationSampleMaximumDegrees:
      details.proofModel.animationSampleMaximumDegrees,
    animationSampleCount:
      Math.ceil(
        (constraint.range.maximum - constraint.range.minimum) /
          details.proofModel.animationSampleMaximumDegrees,
      ) + 1,
    endpointContacts: [],
    collisions: [],
    indeterminatePairs: []
  };
  const baseSpan = details.proofModel.maximumAngleIntervalDegrees;
  const allowedByPair = new Map(
    details.proofModel.allowedEndpointContacts.map((contact) => [
      `${contact.movingPrimitiveId}:${contact.stationaryPrimitiveId}`,
      contact
    ]),
  );
  for (const interval of details.proofModel.sectionIntervals) {
    for (const movingId of interval.movingPrimitiveIds) {
      const moving = primitiveById.get(movingId)!;
      for (const stationaryId of interval.stationaryPrimitiveIds) {
        const stationary = primitiveById.get(stationaryId)!;
        const allowedContact = allowedByPair.get(`${moving.id}:${stationary.id}`);
        if (allowedContact !== undefined) {
          if (!report.endpointContacts.some((item) => item.id === allowedContact.id)) {
            const result = certifyEndpointContact(
              moving,
              stationary,
              allowedContact,
              constraint.range,
              details.proofModel.inflationUm,
              details.proofModel.maximumAngleIntervalDegrees,
            );
            report.angleIntervalsTested += result.tested;
            report.certifiedPairIntervals += result.certified;
            report.maximumRecursionDepth = Math.max(
              report.maximumRecursionDepth,
              result.depth,
            );
            report.endpointContacts.push({
              id: allowedContact.id,
              movingPrimitiveId: moving.id,
              stationaryPrimitiveId: stationary.id,
              angleDegrees: allowedContact.angleDegrees,
              nominalGapUm: result.nominalGapUm,
              minimumInteriorGapUm: result.minimumInteriorGapUm,
              positiveAwayFromEndpoint: result.positiveAwayFromEndpoint,
              monotoneSeparation: result.monotoneSeparation,
              conservativeInteriorStatus: result.conservativeInteriorStatus,
              status: result.status
            });
          }
          continue;
        }
        for (
          let start = constraint.range.minimum;
          start < constraint.range.maximum - 1e-9;
          start += baseSpan
        ) {
          const end = Math.min(constraint.range.maximum, start + baseSpan);
          const result = certifyPair(
            moving,
            stationary,
            start,
            end,
            details.proofModel.inflationUm,
          );
          report.angleIntervalsTested += result.tested;
          report.maximumRecursionDepth = Math.max(
            report.maximumRecursionDepth,
            result.depth,
          );
          if (result.status === "certified") {
            report.certifiedPairIntervals += result.certified;
          } else if (result.status === "collision") {
            report.collisions.push({
              axialIntervalId: interval.id,
              movingPrimitiveId: moving.id,
              stationaryPrimitiveId: stationary.id,
              angleDegrees: result.angleDegrees
            });
            break;
          } else {
            report.indeterminatePairs.push({
              axialIntervalId: interval.id,
              movingPrimitiveId: moving.id,
              stationaryPrimitiveId: stationary.id
            });
            break;
          }
        }
      }
    }
  }
  report.status = report.collisions.length === 0 &&
    report.indeterminatePairs.length === 0 &&
    report.endpointContacts.length === details.proofModel.allowedEndpointContacts.length &&
    report.endpointContacts.every((contact) => contact.status === "certified")
    ? "pass"
    : "fail";
  return report;
}
