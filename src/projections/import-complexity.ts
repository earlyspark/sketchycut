import type { ProjectionBundle } from "../domain/contracts.js";

export const GENERATION_IMPORT_COMPLEXITY_BUDGET = {
  policy: "current-product-svg-complexity-limit",
  studioDesktopVersion: "1.7.30",
  maximumPathCount: 66,
  maximumSegmentCount: 599,
  maximumVertexCount: 614,
  maximumSvgByteSize: 30_358
} as const;

export type SheetImportComplexity = {
  pathCount: number;
  segmentCount: number;
  vertexCount: number;
  svgByteSize: number;
};

export function measureSheetImportComplexity(
  sheet: ProjectionBundle["fabrication"]["sheets"][number],
  svg: string,
): SheetImportComplexity {
  return {
    pathCount: sheet.paths.length,
    segmentCount: sheet.paths.reduce(
      (sum, path) => sum + Math.max(0, path.contour.points.length - (path.closed ? 0 : 1)),
      0,
    ),
    vertexCount: sheet.paths.reduce((sum, path) => sum + path.contour.points.length, 0),
    svgByteSize: new TextEncoder().encode(svg).byteLength
  };
}

export function importComplexityWithinCurrentLimit(complexity: SheetImportComplexity): boolean {
  return complexity.pathCount <= GENERATION_IMPORT_COMPLEXITY_BUDGET.maximumPathCount &&
    complexity.segmentCount <= GENERATION_IMPORT_COMPLEXITY_BUDGET.maximumSegmentCount &&
    complexity.vertexCount <= GENERATION_IMPORT_COMPLEXITY_BUDGET.maximumVertexCount &&
    complexity.svgByteSize <= GENERATION_IMPORT_COMPLEXITY_BUDGET.maximumSvgByteSize;
}
