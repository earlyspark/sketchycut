import {
  CutThroughApplicationSchema,
  CutThroughTreatmentRequestSchema,
  SheetPartSchema,
  PartFeatureSchema,
  type CutThroughApplication,
  type CutThroughTreatmentRequest,
  type PointUm,
  type Region2D,
  type SheetPart
} from "../domain/contracts.js";
import { approximateCircularContour, REGISTERED_ARC_POLYGON_POLICY } from "../kernel/geometry/arc-polygon.js";
import { boundsUm } from "../kernel/geometry/metrics.js";
import { rectangleContour } from "./orthogonal-model.js";

export const CUT_THROUGH_TREATMENT_OPERATOR = {
  id: "cut-through-treatment",
  version: "1.0.0"
} as const;

type Bounds = ReturnType<typeof boundsUm>;

function expandedBounds(bounds: Bounds, deltaUm: number): Bounds {
  return {
    minXUm: bounds.minXUm - deltaUm,
    minYUm: bounds.minYUm - deltaUm,
    maxXUm: bounds.maxXUm + deltaUm,
    maxYUm: bounds.maxYUm + deltaUm
  };
}

function boundsOverlap(left: Bounds, right: Bounds): boolean {
  return left.minXUm < right.maxXUm && left.maxXUm > right.minXUm &&
    left.minYUm < right.maxYUm && left.maxYUm > right.minYUm;
}

function featureBounds(part: SheetPart): Bounds[] {
  return part.features.flatMap((feature) => {
    if (
      feature.kind === "outer-boundary" ||
      feature.kind === "safe-treatment-region" ||
      feature.kind === "decorative-cut-through" ||
      feature.kind === "functional-aperture"
    ) {
      return [];
    }
    if (feature.region !== null) return [boundsUm(feature.region.outer.points)];
    if (feature.path !== null) return [boundsUm(feature.path.points)];
    return [];
  });
}

function gridCount(density: CutThroughTreatmentRequest["density"]): number {
  return density === "sparse" ? 1 : density === "balanced" ? 2 : 3;
}

function rectangularGrid(input: {
  idPrefix: string;
  safe: Bounds;
  density: CutThroughTreatmentRequest["density"];
  bridgeWidthUm: number;
}): Region2D["outer"][] {
  const rows = gridCount(input.density);
  const columns = rows + 1;
  const safeWidth = input.safe.maxXUm - input.safe.minXUm;
  const safeHeight = input.safe.maxYUm - input.safe.minYUm;
  const cellWidth = Math.min(
    12_000,
    Math.floor((safeWidth - input.bridgeWidthUm * (columns - 1)) / columns),
  );
  const cellHeight = Math.min(
    14_000,
    Math.floor((safeHeight - input.bridgeWidthUm * (rows - 1)) / rows),
  );
  if (cellWidth <= 0 || cellHeight <= 0) throw new Error("CUT_THROUGH_SAFE_REGION_UNAVAILABLE");
  const occupiedWidth = columns * cellWidth + (columns - 1) * input.bridgeWidthUm;
  const occupiedHeight = rows * cellHeight + (rows - 1) * input.bridgeWidthUm;
  const startX = input.safe.minXUm + Math.floor((safeWidth - occupiedWidth) / 2);
  const startY = input.safe.minYUm + Math.floor((safeHeight - occupiedHeight) / 2);
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => rectangleContour(
      `${input.idPrefix}-${String(row + 1)}-${String(column + 1)}`,
      startX + column * (cellWidth + input.bridgeWidthUm),
      startY + row * (cellHeight + input.bridgeWidthUm),
      cellWidth,
      cellHeight,
      "cw",
    )),
  ).flat();
}

function circleField(input: {
  idPrefix: string;
  safe: Bounds;
  density: CutThroughTreatmentRequest["density"];
  bridgeWidthUm: number;
}): Region2D["outer"][] {
  const rows = gridCount(input.density);
  const columns = rows + 1;
  const safeWidth = input.safe.maxXUm - input.safe.minXUm;
  const safeHeight = input.safe.maxYUm - input.safe.minYUm;
  const radius = Math.min(
    4_000,
    Math.floor((safeWidth - input.bridgeWidthUm * (columns - 1)) / (columns * 2)),
    Math.floor((safeHeight - input.bridgeWidthUm * (rows - 1)) / (rows * 2)),
  );
  if (radius < 1_000) throw new Error("CUT_THROUGH_SAFE_REGION_UNAVAILABLE");
  const pitchX = radius * 2 + input.bridgeWidthUm;
  const pitchY = radius * 2 + input.bridgeWidthUm;
  const occupiedWidth = columns * radius * 2 + (columns - 1) * input.bridgeWidthUm;
  const occupiedHeight = rows * radius * 2 + (rows - 1) * input.bridgeWidthUm;
  const startX = input.safe.minXUm + Math.floor((safeWidth - occupiedWidth) / 2) + radius;
  const startY = input.safe.minYUm + Math.floor((safeHeight - occupiedHeight) / 2) + radius;
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => approximateCircularContour({
      id: `${input.idPrefix}-${String(row + 1)}-${String(column + 1)}`,
      center: { xUm: startX + column * pitchX, yUm: startY + row * pitchY },
      radiusUm: radius,
      orientation: "cw"
    })),
  ).flat();
}

function radialRosette(input: {
  idPrefix: string;
  safe: Bounds;
  density: CutThroughTreatmentRequest["density"];
  symmetryOrder: number;
  bridgeWidthUm: number;
}): Region2D["outer"][] {
  const safeWidth = input.safe.maxXUm - input.safe.minXUm;
  const safeHeight = input.safe.maxYUm - input.safe.minYUm;
  const center = {
    xUm: Math.round((input.safe.minXUm + input.safe.maxXUm) / 2),
    yUm: Math.round((input.safe.minYUm + input.safe.maxYUm) / 2)
  };
  const rings = gridCount(input.density);
  const maximumRadius = Math.floor(Math.min(safeWidth, safeHeight) / 2);
  let petalRadius = Math.min(3_000, Math.floor(maximumRadius / (rings * 3 + 1)));
  const geometricSpacingUm = input.bridgeWidthUm + REGISTERED_ARC_POLYGON_POLICY.chordToleranceUm * 2;
  const requiredOuterRadius = (radiusUm: number): number => {
    const adjacentCenterDistanceUm = radiusUm * 2 + geometricSpacingUm;
    const firstOrbitUm = Math.ceil(
      adjacentCenterDistanceUm / (2 * Math.sin(Math.PI / input.symmetryOrder)),
    );
    return firstOrbitUm + (rings - 1) * adjacentCenterDistanceUm + radiusUm;
  };
  while (petalRadius >= 900 && requiredOuterRadius(petalRadius) > maximumRadius) {
    petalRadius -= 10;
  }
  if (petalRadius < 900) throw new Error("CUT_THROUGH_SAFE_REGION_UNAVAILABLE");
  const firstOrbitUm = Math.ceil(
    (petalRadius * 2 + geometricSpacingUm) /
      (2 * Math.sin(Math.PI / input.symmetryOrder)),
  );
  const contours: Region2D["outer"][] = [];
  for (let ring = 1; ring <= rings; ring += 1) {
    const orbitRadius = firstOrbitUm + (ring - 1) * (petalRadius * 2 + geometricSpacingUm);
    for (let index = 0; index < input.symmetryOrder; index += 1) {
      const angle = (index * Math.PI * 2) / input.symmetryOrder;
      contours.push(approximateCircularContour({
        id: `${input.idPrefix}-${String(ring)}-${String(index + 1)}`,
        center: {
          xUm: Math.round(center.xUm + Math.cos(angle) * orbitRadius),
          yUm: Math.round(center.yUm + Math.sin(angle) * orbitRadius)
        },
        radiusUm: petalRadius,
        orientation: "cw"
      }));
    }
  }
  return contours;
}

function ringAperture(input: {
  idPrefix: string;
  safe: Bounds;
  bridgeWidthUm: number;
}): Region2D["outer"][] {
  const safeWidth = input.safe.maxXUm - input.safe.minXUm;
  const safeHeight = input.safe.maxYUm - input.safe.minYUm;
  const radius = Math.floor(Math.min(safeWidth, safeHeight) / 2) - input.bridgeWidthUm;
  if (radius < 2_000) throw new Error("CUT_THROUGH_SAFE_REGION_UNAVAILABLE");
  return [approximateCircularContour({
    id: `${input.idPrefix}-1`,
    center: {
      xUm: Math.round((input.safe.minXUm + input.safe.maxXUm) / 2),
      yUm: Math.round((input.safe.minYUm + input.safe.maxYUm) / 2)
    },
    radiusUm: radius,
    orientation: "cw"
  })];
}

function generateContours(
  part: SheetPart,
  request: CutThroughTreatmentRequest,
): Region2D["outer"][] {
  const outerBounds = boundsUm(part.nominalRegion.outer.points);
  const safe = {
    minXUm: outerBounds.minXUm + request.edgeMarginUm,
    minYUm: outerBounds.minYUm + request.edgeMarginUm,
    maxXUm: outerBounds.maxXUm - request.edgeMarginUm,
    maxYUm: outerBounds.maxYUm - request.edgeMarginUm
  };
  if (safe.maxXUm <= safe.minXUm || safe.maxYUm <= safe.minYUm) {
    throw new Error("CUT_THROUGH_SAFE_REGION_UNAVAILABLE");
  }
  const idPrefix = `${request.applicationId}-${part.id}-opening`;
  const contours = request.patternFamily === "lattice-grid"
    ? rectangularGrid({ idPrefix, safe, density: request.density, bridgeWidthUm: request.bridgeWidthUm })
    : request.patternFamily === "circle-field"
      ? circleField({ idPrefix, safe, density: request.density, bridgeWidthUm: request.bridgeWidthUm })
      : request.patternFamily === "radial-rosette"
        ? radialRosette({
            idPrefix,
            safe,
            density: request.density,
            symmetryOrder: request.symmetryOrder,
            bridgeWidthUm: request.bridgeWidthUm
          })
        : ringAperture({ idPrefix, safe, bridgeWidthUm: request.bridgeWidthUm });
  const keepouts = featureBounds(part).map((value) => expandedBounds(value, request.bridgeWidthUm));
  for (const contour of contours) {
    const contourBounds = boundsUm(contour.points);
    if (keepouts.some((keepout) => boundsOverlap(contourBounds, keepout))) {
      throw new Error(`CUT_THROUGH_KEEPOUT_INTRUSION:${part.id}:${contour.id}`);
    }
  }
  return contours;
}

export function applyCutThroughTreatment(input: {
  parts: readonly SheetPart[];
  request: CutThroughTreatmentRequest;
  requestedDensity?: CutThroughTreatmentRequest["density"];
  simplificationDisclosure?: string | null;
}): { parts: SheetPart[]; application: CutThroughApplication } {
  const request = CutThroughTreatmentRequestSchema.parse(input.request);
  const targetIds = new Set(request.targetPartIds);
  const knownIds = new Set(input.parts.map((part) => part.id));
  for (const partId of targetIds) {
    if (!knownIds.has(partId)) throw new Error(`CUT_THROUGH_TARGET_PART_MISSING:${partId}`);
  }
  const featureIds: string[] = [];
  const parts = input.parts.map((part) => {
    if (!targetIds.has(part.id)) return SheetPartSchema.parse(part);
    const contours = generateContours(part, request);
    const features = contours.map((contour, index) => {
      const id = `${request.applicationId}-${part.id}-feature-${String(index + 1)}`;
      featureIds.push(id);
      return PartFeatureSchema.parse({
        id,
        kind: request.purpose === "ornament" ? "decorative-cut-through" : "functional-aperture",
        operation: "cut",
        fitClass: null,
        jointId: null,
        region: { outer: contour, holes: [] },
        path: null,
        parametersUm: {
          openingIndex: index,
          symmetryOrder: request.symmetryOrder,
          edgeMargin: request.edgeMarginUm,
          bridgeWidth: request.bridgeWidthUm
        },
        cutThrough: {
          applicationId: request.applicationId,
          patternFamily: request.patternFamily,
          purpose: request.purpose,
          requestedDensity: input.requestedDensity ?? request.requestedDensity ?? request.density,
          realizedDensity: request.density,
          symmetryOrder: request.symmetryOrder,
          edgeMarginUm: request.edgeMarginUm,
          bridgeWidthUm: request.bridgeWidthUm,
          arcPolicyId: REGISTERED_ARC_POLYGON_POLICY.id,
          arcPolicyVersion: REGISTERED_ARC_POLYGON_POLICY.version,
          arcChordToleranceUm: REGISTERED_ARC_POLYGON_POLICY.chordToleranceUm,
          repeatedGroupId: request.repeatedGroupId,
          sourceRequirementIds: request.sourceRequirementIds
        }
      });
    });
    const nominalRegion = {
      ...part.nominalRegion,
      holes: [...part.nominalRegion.holes, ...contours]
    };
    return SheetPartSchema.parse({
      ...part,
      nominalRegion,
      features: part.features.map((feature) =>
        feature.kind === "outer-boundary" && feature.region !== null
          ? { ...feature, region: nominalRegion }
          : feature
      ).concat(features)
    });
  });
  const requestedDensity = input.requestedDensity ?? request.requestedDensity ?? request.density;
  const changed = requestedDensity !== request.density;
  return {
    parts,
    application: CutThroughApplicationSchema.parse({
      schemaVersion: "2.0",
      id: request.applicationId,
      patternFamily: request.patternFamily,
      purpose: request.purpose,
      requestedDensity,
      realizedDensity: request.density,
      symmetryOrder: request.symmetryOrder,
      edgeMarginUm: request.edgeMarginUm,
      bridgeWidthUm: request.bridgeWidthUm,
      arcPolicyId: REGISTERED_ARC_POLYGON_POLICY.id,
      arcPolicyVersion: REGISTERED_ARC_POLYGON_POLICY.version,
      arcChordToleranceUm: REGISTERED_ARC_POLYGON_POLICY.chordToleranceUm,
      targetPartIds: [...request.targetPartIds],
      featureIds,
      repeatedGroupId: request.repeatedGroupId,
      sourceRequirementIds: request.sourceRequirementIds,
      simplificationDisclosure: changed
        ? input.simplificationDisclosure ?? "Pattern density was reduced by deterministic import-complexity policy."
        : null
    })
  };
}

export function cutThroughContourCenters(part: SheetPart): PointUm[] {
  return part.features.flatMap((feature) => {
    if (feature.cutThrough === undefined || feature.region === null) return [];
    const bounds = boundsUm(feature.region.outer.points);
    return [{
      xUm: Math.round((bounds.minXUm + bounds.maxXUm) / 2),
      yUm: Math.round((bounds.minYUm + bounds.maxYUm) / 2)
    }];
  });
}
