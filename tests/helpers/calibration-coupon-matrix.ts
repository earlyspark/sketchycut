import { canonicalDocumentHash } from "../../src/compiler/canonical.js";
import { compileCalibrationCoupon } from "../../src/operators/calibration-coupon.js";
import { buildProjectionBundle } from "../../src/projections/bundle.js";
import { nestParts } from "../../src/projections/fabrication/nesting.js";
import { boundsUm } from "../../src/kernel/geometry/metrics.js";
import { validateSheetProjection } from "../../src/validation/sheet.js";

export type CalibrationCouponGoldenCase = {
  caseId: string;
  measuredThicknessMm: number;
  kerfMm: number;
  documentHash: string;
  svgSha256: string;
  svgBytes: number;
  slotOpeningsUm: number[];
  baseManufacturingBoundsUm: {
    minXUm: number;
    minYUm: number;
    maxXUm: number;
    maxYUm: number;
  };
  placements: {
    partId: string;
    xUm: number;
    yUm: number;
    rotationDegrees: number;
  }[];
  partSourceHashes: {
    partId: string;
    sourcePartHash: string;
  }[];
  mesh: {
    partId: string;
    maxZMm: number;
    vertexCount: number;
    triangleCount: number;
  }[];
  pathCount: number;
  sheetValidationStatus: "pass" | "fail";
};

export async function buildCalibrationCouponGoldenCase(
  measuredThicknessMm: number,
  kerfMm: number,
): Promise<CalibrationCouponGoldenCase> {
  const document = await compileCalibrationCoupon({ measuredThicknessMm, kerfMm });
  const placements = nestParts(
    document.parts,
    document.resolvedInputs.machine,
    document.resolvedInputs.material,
    document.resolvedInputs.processRecipe,
    document.resolvedInputs.fabricationContext,
  );
  const artifacts = await buildProjectionBundle(document, placements);
  const sheet = artifacts.bundle.fabrication.sheets[0]!;
  const baseOuter = sheet.paths.find((path) => path.id === "coupon-base-cut-outer");
  if (baseOuter === undefined) {
    throw new Error("Golden matrix could not find the coupon base outer path.");
  }
  return {
    caseId: `t${String(Math.round(measuredThicknessMm * 1_000))}-k${String(Math.round(kerfMm * 1_000))}`,
    measuredThicknessMm,
    kerfMm,
    documentHash: await canonicalDocumentHash(document),
    svgSha256: artifacts.bundle.fabrication.svgSha256,
    svgBytes: new TextEncoder().encode(artifacts.svg).byteLength,
    slotOpeningsUm: document.parts[0]!.features
      .filter((feature) => feature.kind === "slot")
      .map((feature) => feature.parametersUm.opening!),
    baseManufacturingBoundsUm: boundsUm(baseOuter.contour.points),
    placements: placements.map((placement) => ({
      partId: placement.partId,
      xUm: placement.xUm,
      yUm: placement.yUm,
      rotationDegrees: placement.rotationDegrees
    })),
    partSourceHashes: artifacts.bundle.bom.entries.map((entry) => ({
      partId: entry.partId,
      sourcePartHash: entry.sourcePartHash
    })),
    mesh: artifacts.bundle.scene.meshes.map((mesh) => ({
      partId: mesh.partId,
      maxZMm: Math.max(...mesh.verticesMm.map((vertex) => vertex.zMm)),
      vertexCount: mesh.verticesMm.length,
      triangleCount: mesh.triangles.length
    })),
    pathCount: sheet.paths.length,
    sheetValidationStatus: validateSheetProjection(sheet, document.parts).status
  };
}

export async function buildCalibrationCouponGoldenMatrix(): Promise<{
  schemaVersion: "1.0";
  matrixId: "calibration-coupon-thickness-cut-width";
  cases: CalibrationCouponGoldenCase[];
}> {
  const cases: CalibrationCouponGoldenCase[] = [];
  for (const measuredThicknessMm of [2.7, 3, 3.3]) {
    for (const kerfMm of [0.1, 0.15, 0.2]) {
      cases.push(await buildCalibrationCouponGoldenCase(measuredThicknessMm, kerfMm));
    }
  }
  return {
    schemaVersion: "1.0",
    matrixId: "calibration-coupon-thickness-cut-width",
    cases
  };
}
