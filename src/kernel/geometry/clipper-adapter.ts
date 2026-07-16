import {
  EndType,
  FillRule,
  JoinType,
  area,
  difference,
  inflatePaths,
  intersect,
  stripDuplicates,
  trimCollinear,
  union,
  type Path64,
  type Paths64
} from "clipper2-ts";

import type { PointUm, PolylineUm, Region2D } from "../../domain/contracts.js";
import { StableIdSchema } from "../../domain/contracts.js";

import { signedAreaUm2 } from "./metrics.js";

export const POLYGON_ADAPTER = {
  id: "clipper2-ts",
  version: "2.0.1-18",
  coordinateModel: "integer-micrometre",
  roles: ["boolean", "offset", "cleanup"] as const,
  triangulationAllowed: false
} as const;

export type BooleanOperation = "difference" | "intersection" | "union";
type ClosedPolylineUm = Region2D["outer"];

function toClipperPath(points: readonly PointUm[]): Path64 {
  return points.map((point) => ({ x: point.xUm, y: point.yUm }));
}

function fromClipperPath(id: string, path: Path64): ClosedPolylineUm {
  const stableId = StableIdSchema.parse(id);
  const stripped = stripDuplicates(path, true);
  const trimmed = trimCollinear(stripped, true);
  return {
    id: stableId,
    closed: true as const,
    points: trimmed.map((point) => ({ xUm: point.x, yUm: point.y }))
  };
}

function reversePolyline(polyline: ClosedPolylineUm): ClosedPolylineUm {
  return {
    ...polyline,
    points: [...polyline.points].reverse()
  };
}

export function orientPolyline(polyline: ClosedPolylineUm, orientation: "ccw" | "cw"): ClosedPolylineUm {
  const isCcw = signedAreaUm2(polyline.points) > 0;
  return isCcw === (orientation === "ccw") ? polyline : reversePolyline(polyline);
}

export function normalizeRegion(region: Region2D): Region2D {
  return {
    outer: orientPolyline(region.outer, "ccw"),
    holes: region.holes.map((hole) => orientPolyline(hole, "cw"))
  };
}

function runBoolean(operation: BooleanOperation, subject: Paths64, clip: Paths64): Paths64 {
  switch (operation) {
    case "difference":
      return difference(subject, clip, FillRule.NonZero);
    case "intersection":
      return intersect(subject, clip, FillRule.NonZero);
    case "union":
      return union(subject, clip, FillRule.NonZero);
  }
}

function pathsToRegions(idPrefix: string, paths: Paths64): Region2D[] {
  const cleaned = paths
    .filter((path) => path.length >= 3 && Math.abs(area(path)) > 0)
    .map((path, index) => fromClipperPath(`${idPrefix}-${String(index)}`, path));
  const outers = cleaned.filter((path) => signedAreaUm2(path.points) > 0);
  const holes = cleaned.filter((path) => signedAreaUm2(path.points) < 0);

  return outers.map((outer, outerIndex) => {
    const outerPath = toClipperPath(outer.points);
    const ownedHoles = holes.filter((hole) => {
      const result = intersect([outerPath], [toClipperPath(hole.points)], FillRule.NonZero);
      return result.length > 0;
    });
    return normalizeRegion({
      outer: {
        ...outer,
        id: StableIdSchema.parse(`${idPrefix}-outer-${String(outerIndex)}`)
      },
      holes: ownedHoles.map((hole, holeIndex) => ({
        ...hole,
        id: StableIdSchema.parse(
          `${idPrefix}-outer-${String(outerIndex)}-hole-${String(holeIndex)}`,
        )
      }))
    });
  });
}

function regionPaths(region: Region2D): Paths64 {
  const normalized = normalizeRegion(region);
  return [
    toClipperPath(normalized.outer.points),
    ...normalized.holes.map((hole) => toClipperPath(hole.points))
  ];
}

export function booleanRegions(
  operation: BooleanOperation,
  subject: readonly Region2D[],
  clip: readonly Region2D[],
  idPrefix: string,
): Region2D[] {
  const subjectPaths = subject.flatMap((region) => regionPaths(region));
  const clipPaths = clip.flatMap((region) => regionPaths(region));
  return pathsToRegions(idPrefix, runBoolean(operation, subjectPaths, clipPaths));
}

function offsetPolyline(polyline: ClosedPolylineUm, deltaUm: number, id: string): ClosedPolylineUm {
  if (!Number.isSafeInteger(deltaUm)) {
    throw new RangeError("Offset delta must be an integer number of micrometres.");
  }
  const result = inflatePaths(
    [toClipperPath(polyline.points)],
    deltaUm,
    JoinType.Miter,
    EndType.Polygon,
    2,
    0,
  );
  if (result.length !== 1) {
    throw new Error(`Offset ${polyline.id} produced ${String(result.length)} contours; expected one.`);
  }
  return fromClipperPath(id, result[0]!);
}

export function offsetRegion(region: Region2D, deltaUm: number, idPrefix: string): Region2D {
  const normalized = normalizeRegion(region);
  const outer = orientPolyline(offsetPolyline(normalized.outer, deltaUm, `${idPrefix}-outer`), "ccw");
  const holes = normalized.holes.map((hole, index) =>
    orientPolyline(offsetPolyline(hole, -deltaUm, `${idPrefix}-hole-${String(index)}`), "cw"),
  );
  return { outer, holes };
}

export function offsetRegionAnisotropic(
  region: Region2D,
  deltaXUm: number,
  deltaYUm: number,
  idPrefix: string,
): Region2D {
  if (!Number.isSafeInteger(deltaXUm) || !Number.isSafeInteger(deltaYUm)) {
    throw new RangeError("Directional offsets must be integer micrometres.");
  }
  if (deltaXUm === 0 || deltaYUm === 0 || Math.sign(deltaXUm) !== Math.sign(deltaYUm)) {
    throw new RangeError("Directional offsets must be nonzero and share a sign.");
  }
  if (deltaXUm === deltaYUm) {
    return offsetRegion(region, deltaXUm, idPrefix);
  }

  const referenceDelta = 10_000;
  const sign = Math.sign(deltaXUm);
  const scalePoint = (point: PointUm): PointUm => ({
    xUm: Math.round((point.xUm * referenceDelta) / Math.abs(deltaXUm)),
    yUm: Math.round((point.yUm * referenceDelta) / Math.abs(deltaYUm))
  });
  const restorePoint = (point: PointUm): PointUm => ({
    xUm: Math.round((point.xUm * Math.abs(deltaXUm)) / referenceDelta),
    yUm: Math.round((point.yUm * Math.abs(deltaYUm)) / referenceDelta)
  });
  const scaled: Region2D = {
    outer: {
      ...region.outer,
      points: region.outer.points.map(scalePoint)
    },
    holes: region.holes.map((hole) => ({
      ...hole,
      points: hole.points.map(scalePoint)
    }))
  };
  const offset = offsetRegion(scaled, sign * referenceDelta, `${idPrefix}-scaled`);
  return normalizeRegion({
    outer: {
      ...offset.outer,
      id: StableIdSchema.parse(`${idPrefix}-outer`),
      points: offset.outer.points.map(restorePoint)
    },
    holes: offset.holes.map((hole, index) => ({
      ...hole,
      id: StableIdSchema.parse(`${idPrefix}-hole-${String(index)}`),
      points: hole.points.map(restorePoint)
    }))
  });
}

export function contoursOverlap(left: PolylineUm, right: PolylineUm): boolean {
  return intersect([toClipperPath(left.points)], [toClipperPath(right.points)], FillRule.NonZero).some(
    (path) => Math.abs(area(path)) > 0,
  );
}
