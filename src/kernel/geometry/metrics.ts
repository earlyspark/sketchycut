import type { PointUm, PolylineUm, Region2D } from "../../domain/contracts.js";

export function signedAreaUm2(points: readonly PointUm[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += current.xUm * next.yUm - next.xUm * current.yUm;
  }
  return twiceArea / 2;
}

export function regionAreaUm2(region: Region2D): number {
  return Math.abs(signedAreaUm2(region.outer.points)) - region.holes.reduce(
    (sum, hole) => sum + Math.abs(signedAreaUm2(hole.points)),
    0,
  );
}

export function isCounterClockwise(polyline: PolylineUm): boolean {
  return signedAreaUm2(polyline.points) > 0;
}

export function boundsUm(points: readonly PointUm[]): {
  minXUm: number;
  minYUm: number;
  maxXUm: number;
  maxYUm: number;
} {
  const xs = points.map((point) => point.xUm);
  const ys = points.map((point) => point.yUm);
  return {
    minXUm: Math.min(...xs),
    minYUm: Math.min(...ys),
    maxXUm: Math.max(...xs),
    maxYUm: Math.max(...ys)
  };
}
