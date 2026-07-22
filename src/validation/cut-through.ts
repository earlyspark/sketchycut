import type {
  DesignDocumentV1,
  Finding,
  PartFeature,
  PointUm,
  PolylineUm,
  SheetPart,
  ValidationReport
} from "../domain/contracts.js";
import { booleanRegions } from "../kernel/geometry/clipper-adapter.js";
import { boundsUm, signedAreaUm2 } from "../kernel/geometry/metrics.js";

export const CUT_THROUGH_STRUCTURAL_POLICY = {
  id: "cut-through-structural-candidate",
  version: "1.0.0",
  fullCutWidthMultiplier: 4,
  maximumRemovedAreaRatio: 0.45
} as const;

type Segment = { start: PointUm; end: PointUm };

function segments(polyline: PolylineUm): Segment[] {
  const result = polyline.points.slice(0, -1).map((start, index) => ({
    start,
    end: polyline.points[index + 1]!
  }));
  if (polyline.closed) {
    result.push({ start: polyline.points.at(-1)!, end: polyline.points[0]! });
  }
  return result;
}

function orientation(a: PointUm, b: PointUm, c: PointUm): number {
  return Math.sign((b.xUm - a.xUm) * (c.yUm - a.yUm) - (b.yUm - a.yUm) * (c.xUm - a.xUm));
}

function onSegment(point: PointUm, start: PointUm, end: PointUm): boolean {
  return orientation(start, end, point) === 0 &&
    point.xUm >= Math.min(start.xUm, end.xUm) &&
    point.xUm <= Math.max(start.xUm, end.xUm) &&
    point.yUm >= Math.min(start.yUm, end.yUm) &&
    point.yUm <= Math.max(start.yUm, end.yUm);
}

function intersects(left: Segment, right: Segment): boolean {
  const o1 = orientation(left.start, left.end, right.start);
  const o2 = orientation(left.start, left.end, right.end);
  const o3 = orientation(right.start, right.end, left.start);
  const o4 = orientation(right.start, right.end, left.end);
  return (o1 !== o2 && o3 !== o4) ||
    (o1 === 0 && onSegment(right.start, left.start, left.end)) ||
    (o2 === 0 && onSegment(right.end, left.start, left.end)) ||
    (o3 === 0 && onSegment(left.start, right.start, right.end)) ||
    (o4 === 0 && onSegment(left.end, right.start, right.end));
}

function pointSegmentDistanceUm(point: PointUm, segment: Segment): number {
  const dx = segment.end.xUm - segment.start.xUm;
  const dy = segment.end.yUm - segment.start.yUm;
  if (dx === 0 && dy === 0) return Math.hypot(point.xUm - segment.start.xUm, point.yUm - segment.start.yUm);
  const scale = Math.max(0, Math.min(1,
    ((point.xUm - segment.start.xUm) * dx + (point.yUm - segment.start.yUm) * dy) /
      (dx * dx + dy * dy),
  ));
  return Math.hypot(
    point.xUm - (segment.start.xUm + scale * dx),
    point.yUm - (segment.start.yUm + scale * dy),
  );
}

function segmentDistanceUm(left: Segment, right: Segment): number {
  if (intersects(left, right)) return 0;
  return Math.min(
    pointSegmentDistanceUm(left.start, right),
    pointSegmentDistanceUm(left.end, right),
    pointSegmentDistanceUm(right.start, left),
    pointSegmentDistanceUm(right.end, left),
  );
}

function polylineDistanceUm(left: PolylineUm, right: PolylineUm): number {
  return Math.min(...segments(left).flatMap((first) =>
    segments(right).map((second) => segmentDistanceUm(first, second))
  ));
}

function finding(code: string, relatedIds: string[], message: string): Finding {
  return {
    code,
    severity: "error",
    owner: "cut-through-validation",
    relatedIds,
    message,
    blocksExport: true
  };
}

function contourEqual(left: PolylineUm, right: PolylineUm): boolean {
  return left.id === right.id && left.closed === right.closed &&
    left.points.length === right.points.length &&
    left.points.every((point, index) => {
      const other = right.points[index];
      return other?.xUm === point.xUm && other.yUm === point.yUm;
    });
}

function cutThroughFeatures(part: SheetPart): PartFeature[] {
  return part.features.filter((feature) => feature.cutThrough !== undefined);
}

function structuralGeometry(part: SheetPart, cutContourIds: ReadonlySet<string>): PolylineUm[] {
  const featureGeometry = part.features.flatMap((feature) => {
    if (
      feature.kind === "outer-boundary" ||
      feature.cutThrough !== undefined ||
      feature.kind === "safe-treatment-region"
    ) return [];
    if (feature.path !== null) return [feature.path];
    if (feature.region !== null) return [feature.region.outer, ...feature.region.holes];
    return [];
  });
  const structuralHoles = part.nominalRegion.holes.filter((hole) => !cutContourIds.has(hole.id));
  return [...structuralHoles, ...featureGeometry];
}

export function minimumCutThroughBridgeUm(document: DesignDocumentV1): number {
  const fullCutWidthUm = Math.round(Math.max(
    document.resolvedInputs.processRecipe.cutWidth.xMm,
    document.resolvedInputs.processRecipe.cutWidth.yMm,
  ) * 1_000);
  return Math.max(
    Math.round(document.resolvedInputs.material.measuredThicknessMm * 1_000),
    CUT_THROUGH_STRUCTURAL_POLICY.fullCutWidthMultiplier * fullCutWidthUm,
    Math.round(document.resolvedInputs.machine.minimumFeatureMm * 1_000),
  );
}

export function validateCutThroughApplications(document: DesignDocumentV1): ValidationReport {
  const findings: Finding[] = [];
  const applications = document.cutThroughApplications ?? [];
  const partById = new Map(document.parts.map((part) => [part.id, part]));
  const featureOwner = new Map<string, { part: SheetPart; feature: PartFeature }>();
  for (const part of document.parts) {
    for (const feature of cutThroughFeatures(part)) featureOwner.set(feature.id, { part, feature });
  }
  const minimumBridgeUm = minimumCutThroughBridgeUm(document);

  for (const application of applications) {
    if (application.bridgeWidthUm < minimumBridgeUm) {
      findings.push(finding(
        "CUT_THROUGH_BRIDGE_POLICY_VIOLATION",
        [application.id],
        "The requested cut-through bridge is below the deterministic material, kerf, and machine-feature policy.",
      ));
    }
    if (application.edgeMarginUm < application.bridgeWidthUm) {
      findings.push(finding(
        "CUT_THROUGH_EDGE_MARGIN_POLICY_VIOLATION",
        [application.id],
        "Cut-through edge margin must be at least the registered bridge width.",
      ));
    }
    const applicationFeatureIds = new Set(application.featureIds);
    for (const featureId of application.featureIds) {
      const owner = featureOwner.get(featureId);
      if (
        owner === undefined ||
        owner.feature.cutThrough?.applicationId !== application.id ||
        !application.targetPartIds.includes(owner.part.id)
      ) {
        findings.push(finding(
          "CUT_THROUGH_APPLICATION_LINK_MISMATCH",
          [application.id, featureId],
          "Cut-through applications, targets, and canonical feature metadata must reference one another exactly.",
        ));
      }
    }

    for (const partId of application.targetPartIds) {
      const part = partById.get(partId);
      if (part === undefined) continue;
      const features = cutThroughFeatures(part).filter((feature) => applicationFeatureIds.has(feature.id));
      const contours = features.flatMap((feature) => feature.region === null ? [] : [feature.region.outer]);
      const contourIds = new Set(contours.map((contour) => contour.id));
      if (contours.length === 0) {
        findings.push(finding(
          "CUT_THROUGH_TARGET_EMPTY",
          [application.id, part.id],
          "Every registered target must contain at least one realized cut-through feature.",
        ));
        continue;
      }
      for (const [index, contour] of contours.entries()) {
        const feature = features[index]!;
        const canonicalHole = part.nominalRegion.holes.find((hole) => hole.id === contour.id);
        if (canonicalHole === undefined || !contourEqual(contour, canonicalHole)) {
          findings.push(finding(
            "CUT_THROUGH_CANONICAL_GEOMETRY_MISMATCH",
            [application.id, part.id, feature.id],
            "A cut-through feature must be byte-congruent with one canonical nominal hole.",
          ));
        }
        if (polylineDistanceUm(contour, part.nominalRegion.outer) < application.edgeMarginUm) {
          findings.push(finding(
            "CUT_THROUGH_EDGE_MARGIN_VIOLATION",
            [application.id, part.id, feature.id],
            "A cut-through contour enters the registered outer-edge margin.",
          ));
        }
        const bounds = boundsUm(contour.points);
        const cutWidthXUm = Math.round(document.resolvedInputs.processRecipe.cutWidth.xMm * 1_000);
        const cutWidthYUm = Math.round(document.resolvedInputs.processRecipe.cutWidth.yMm * 1_000);
        if (
          bounds.maxXUm - bounds.minXUm <= cutWidthXUm ||
          bounds.maxYUm - bounds.minYUm <= cutWidthYUm
        ) {
          findings.push(finding(
            "CUT_THROUGH_OFFSET_SURVIVAL_VIOLATION",
            [application.id, part.id, feature.id],
            "A cut-through contour cannot survive the registered directional full cut width.",
          ));
        }
      }
      for (let leftIndex = 0; leftIndex < contours.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < contours.length; rightIndex += 1) {
          if (polylineDistanceUm(contours[leftIndex]!, contours[rightIndex]!) < application.bridgeWidthUm) {
            findings.push(finding(
              "CUT_THROUGH_BRIDGE_VIOLATION",
              [application.id, part.id, features[leftIndex]!.id, features[rightIndex]!.id],
              "Adjacent cut-through contours leave less than the registered bridge width.",
            ));
          }
        }
      }
      for (const contour of contours) {
        for (const keepout of structuralGeometry(part, contourIds)) {
          if (polylineDistanceUm(contour, keepout) < application.bridgeWidthUm) {
            findings.push(finding(
              "CUT_THROUGH_STRUCTURAL_KEEPOUT_VIOLATION",
              [application.id, part.id, contour.id, keepout.id],
              "A cut-through contour enters a joint, label, treatment, bore, slot, or structural keep-out.",
            ));
          }
        }
      }
      const removedAreaUm2 = contours.reduce(
        (total, contour) => total + Math.abs(signedAreaUm2(contour.points)),
        0,
      );
      const outerAreaUm2 = Math.abs(signedAreaUm2(part.nominalRegion.outer.points));
      if (removedAreaUm2 / outerAreaUm2 > CUT_THROUGH_STRUCTURAL_POLICY.maximumRemovedAreaRatio) {
        findings.push(finding(
          "CUT_THROUGH_REMOVED_AREA_EXCEEDED",
          [application.id, part.id],
          "Cut-through removal exceeds the registered provisional rigidity-area bound.",
        ));
      }
      try {
        const structuralHoles = part.nominalRegion.holes.filter((hole) => !contourIds.has(hole.id));
        const residual = booleanRegions(
          "difference",
          [{ outer: part.nominalRegion.outer, holes: structuralHoles }],
          contours.map((outer) => ({ outer: { ...outer, points: [...outer.points].reverse() }, holes: [] })),
          `${part.id}-cut-through-residual`,
        );
        if (residual.length !== 1) {
          findings.push(finding(
            "CUT_THROUGH_RESIDUAL_DISCONNECTED",
            [application.id, part.id],
            "Cut-through geometry must leave one connected residual panel.",
          ));
        }
      } catch {
        findings.push(finding(
          "CUT_THROUGH_RESIDUAL_DISCONNECTED",
          [application.id, part.id],
          "Cut-through residual connectivity could not be established.",
        ));
      }
    }
  }

  for (const { part, feature } of featureOwner.values()) {
    const containingApplications = applications.filter((application) => application.featureIds.includes(feature.id));
    if (containingApplications.length === 0) {
      findings.push(finding(
        "CUT_THROUGH_APPLICATION_MISSING",
        [part.id, feature.id],
        "Every canonical cut-through feature must belong to exactly one application.",
      ));
    } else if (containingApplications.length > 1) {
      findings.push(finding(
        "CUT_THROUGH_APPLICATION_LINK_MISMATCH",
        [part.id, feature.id, ...containingApplications.map((application) => application.id)],
        "Every canonical cut-through feature must belong to exactly one application.",
      ));
    }
  }

  return {
    schemaVersion: "1.0",
    status: findings.length === 0 ? "pass" : "fail",
    findings
  };
}
