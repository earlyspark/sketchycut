import type {
  DesignDocumentV1,
  Finding,
  PartFeature,
  PointUm,
  SheetPart,
  ValidationReport
} from "../domain/contracts.js";
import {
  localToWorld,
  worldToLocal,
  type Vector3Um
} from "../operators/orthogonal-model.js";

import {
  pointInsidePolyline,
  pointInsideRegion,
  segmentsIntersect
} from "./geometry.js";

function finding(code: string, relatedIds: string[], message: string): Finding {
  return {
    code,
    severity: "error",
    owner: "assembly-validation",
    relatedIds,
    message,
    blocksExport: true
  };
}

function featureById(part: SheetPart, featureId: string): PartFeature {
  const feature = part.features.find((candidate) => candidate.id === featureId);
  if (feature === undefined) {
    throw new Error(`Part ${part.id} has no feature ${featureId}.`);
  }
  return feature;
}

function bounds2d(points: readonly PointUm[]): {
  minXUm: number;
  minYUm: number;
  maxXUm: number;
  maxYUm: number;
} {
  return {
    minXUm: Math.min(...points.map((point) => point.xUm)),
    minYUm: Math.min(...points.map((point) => point.yUm)),
    maxXUm: Math.max(...points.map((point) => point.xUm)),
    maxYUm: Math.max(...points.map((point) => point.yUm))
  };
}

function tabSlotFindings(
  document: DesignDocumentV1,
  partById: ReadonlyMap<string, SheetPart>,
): Finding[] {
  const findings: Finding[] = [];
  for (const joint of document.joints) {
    if (joint.realization?.kind !== "tab-slot") {
      continue;
    }
    const insert = partById.get(joint.realization.insertPartId);
    const opening = partById.get(joint.realization.openingPartId);
    if (insert === undefined || opening === undefined) {
      findings.push(finding("MATE_PART_MISSING", [joint.id], "A realized tab-slot mate references a missing part."));
      continue;
    }
    if (
      joint.realization.insertFeatureIds.length !== joint.realization.openingFeatureIds.length ||
      joint.realization.insertFeatureIds.length !== joint.realization.mateBoundsWorldUm.length
    ) {
      findings.push(
        finding(
          "TAB_SLOT_CARDINALITY_MISMATCH",
          [joint.id],
          "Every realized tab must have exactly one opening and one world-space proof bound.",
        ),
      );
      continue;
    }
    if (
      joint.nominalClearanceUm !== joint.realization.openingMinusInsertUm ||
      (
        joint.realization.secondaryOpeningMinusInsertUm !== undefined &&
        joint.nominalClearanceUm !==
          joint.realization.secondaryOpeningMinusInsertUm
      )
    ) {
      findings.push(
        finding(
          "FIT_SEMANTICS_MISMATCH",
          [joint.id],
          "The joint clearance must be recorded once as opening size minus insert size.",
        ),
      );
    }
    const explicitSeatPoint = joint.realization.insertBodySeatPointWorldUm;
    if (explicitSeatPoint !== undefined) {
      const seatPoint = worldToLocal(opening, explicitSeatPoint);
      const insertionDot =
        joint.insertionDirection.x * opening.assembledFrame.zAxis.x +
        joint.insertionDirection.y * opening.assembledFrame.zAxis.y +
        joint.insertionDirection.z * opening.assembledFrame.zAxis.z;
      const expectedSeatZUm = insertionDot < 0 ? opening.thicknessUm : 0;
      if (
        Math.abs(Math.abs(insertionDot) - 1) > 1e-9 ||
        Math.abs(seatPoint.zUm - expectedSeatZUm) > 1
      ) {
        findings.push(
          finding(
            "INSERTION_SWEEP_COLLISION",
            [joint.id, insert.id, opening.id],
            "The declared insert-body seat must approach along an opening normal and stop exactly at the approached opening surface.",
          ),
        );
      }
    } else {
      const insertBoundary = insert.features.find((feature) => feature.kind === "outer-boundary");
      const bodyInsetBottomUm = insertBoundary?.parametersUm.bodyInsetBottom;
      if (bodyInsetBottomUm === undefined) {
        findings.push(
          finding(
            "INSERTION_SWEEP_PROOF_MISSING",
            [joint.id, insert.id],
            "Tab-slot insertion requires a canonical body-seat plane.",
          ),
        );
        continue;
      }
      const seatPoint = worldToLocal(
        opening,
        localToWorld(insert, {
          xUm: Math.round(
            (Math.min(...insert.nominalRegion.outer.points.map((point) => point.xUm)) +
              Math.max(...insert.nominalRegion.outer.points.map((point) => point.xUm))) /
              2,
          ),
          yUm: bodyInsetBottomUm,
          zUm: 0
        }),
      );
      const insertionDot =
        joint.insertionDirection.x * opening.assembledFrame.zAxis.x +
        joint.insertionDirection.y * opening.assembledFrame.zAxis.y +
        joint.insertionDirection.z * opening.assembledFrame.zAxis.z;
      if (
        Math.abs(seatPoint.zUm - opening.thicknessUm) > 1 ||
        Math.abs(insertionDot + 1) > 1e-9
      ) {
        findings.push(
          finding(
            "INSERTION_SWEEP_COLLISION",
            [joint.id, insert.id, opening.id],
            "The insert body must approach along the negative opening normal and stop at the opening surface while only tabs enter through-slots.",
          ),
        );
      }
    }
    for (const [index, insertFeatureId] of joint.realization.insertFeatureIds.entries()) {
      const openingFeatureId = joint.realization.openingFeatureIds[index]!;
      const insertFeature = featureById(insert, insertFeatureId);
      const openingFeature = featureById(opening, openingFeatureId);
      if (insertFeature.region === null || openingFeature.region === null) {
        findings.push(
          finding(
            "MATE_GEOMETRY_MISSING",
            [joint.id, insertFeatureId, openingFeatureId],
            "Tab-slot realization requires region geometry on both features.",
          ),
        );
        continue;
      }
      const tabWorldPoints = insertFeature.region.outer.points.flatMap((point) => [
        localToWorld(insert, { xUm: point.xUm, yUm: point.yUm, zUm: 0 }),
        localToWorld(insert, { xUm: point.xUm, yUm: point.yUm, zUm: insert.thicknessUm })
      ]);
      const tabInOpening = tabWorldPoints.map((point) => worldToLocal(opening, point));
      const projected = bounds2d(tabInOpening.map((point) => ({ xUm: point.xUm, yUm: point.yUm })));
      const openingBounds = bounds2d(openingFeature.region.outer.points);
      const xDeltaUm = openingBounds.maxXUm - openingBounds.minXUm -
        (projected.maxXUm - projected.minXUm);
      const yDeltaUm = openingBounds.maxYUm - openingBounds.minYUm -
        (projected.maxYUm - projected.minYUm);
      const secondaryClearance =
        joint.realization.secondaryOpeningMinusInsertUm;
      const dimensionsInvalid = secondaryClearance === undefined
        ? (() => {
            const dimensionDeltas = [xDeltaUm, yDeltaUm].sort(
              (left, right) => Math.abs(right) - Math.abs(left),
            );
            return Math.abs(dimensionDeltas[0]! - joint.nominalClearanceUm) > 1 ||
              Math.abs(dimensionDeltas[1]!) > 1;
          })()
        : Math.abs(xDeltaUm - joint.nominalClearanceUm) > 1 ||
          Math.abs(yDeltaUm - secondaryClearance) > 1;
      if (dimensionsInvalid) {
        findings.push(
          finding(
            "TAB_SLOT_DIMENSION_MISMATCH",
            [joint.id, insertFeatureId, openingFeatureId],
            "Realized opening geometry does not apply the recorded physical clearance exactly once.",
          ),
        );
      }
      const projectedXSpanUm = projected.maxXUm - projected.minXUm;
      const projectedYSpanUm = projected.maxYUm - projected.minYUm;
      const expectedClearanceAxis =
        Math.abs(projectedXSpanUm - insert.thicknessUm) <=
        Math.abs(projectedYSpanUm - insert.thicknessUm)
          ? opening.assembledFrame.xAxis
          : opening.assembledFrame.yAxis;
      const clearanceAxisDot =
        expectedClearanceAxis.x * joint.realization.clearanceAxis.x +
        expectedClearanceAxis.y * joint.realization.clearanceAxis.y +
        expectedClearanceAxis.z * joint.realization.clearanceAxis.z;
      if (Math.abs(clearanceAxisDot - 1) > 1e-9) {
        findings.push(
          finding(
            "FIT_CLEARANCE_AXIS_MISMATCH",
            [joint.id, openingFeatureId],
            "The recorded fit dimension axis does not match the realized opening-minus-insert dimension.",
          ),
        );
      }
      if (joint.realization.secondaryClearanceAxis !== undefined) {
        const expectedSecondaryAxis =
          expectedClearanceAxis === opening.assembledFrame.xAxis
            ? opening.assembledFrame.yAxis
            : opening.assembledFrame.xAxis;
        const secondaryAxisDot =
          expectedSecondaryAxis.x * joint.realization.secondaryClearanceAxis.x +
          expectedSecondaryAxis.y * joint.realization.secondaryClearanceAxis.y +
          expectedSecondaryAxis.z * joint.realization.secondaryClearanceAxis.z;
        if (Math.abs(secondaryAxisDot - 1) > 1e-9) {
          findings.push(
            finding(
              "FIT_CLEARANCE_AXIS_MISMATCH",
              [joint.id, openingFeatureId],
              "The recorded secondary fit dimension axis does not match the realized opening-minus-insert dimension.",
            ),
          );
        }
      }
      if (
        Math.min(...tabInOpening.map((point) => point.zUm)) < -1 ||
        Math.max(...tabInOpening.map((point) => point.zUm)) > opening.thicknessUm + 1
      ) {
        findings.push(
          finding(
            "TAB_SLOT_PLANE_MISMATCH",
            [joint.id, insertFeatureId, openingFeatureId],
            "Mating tab geometry does not pass through the opening panel thickness.",
          ),
        );
      }
    }
  }
  return findings;
}

function materialAtWorldPoint(part: SheetPart, point: Vector3Um): boolean {
  const local = worldToLocal(part, point);
  return (
    local.zUm >= 0 &&
    local.zUm <= part.thicknessUm &&
    pointInsideRegion({ xUm: local.xUm, yUm: local.yUm }, part.nominalRegion)
  );
}

function edgeMateFindings(
  document: DesignDocumentV1,
  partById: ReadonlyMap<string, SheetPart>,
): Finding[] {
  const findings: Finding[] = [];
  for (const joint of document.joints) {
    if (joint.realization?.kind !== "edge-finger") {
      continue;
    }
    const first = partById.get(joint.realization.firstPartId);
    const second = partById.get(joint.realization.secondPartId);
    if (first === undefined || second === undefined) {
      findings.push(finding("MATE_PART_MISSING", [joint.id], "A realized edge mate references a missing part."));
      continue;
    }
    let cursorUm = joint.realization.spanStartUm;
    for (const interval of joint.realization.intervals) {
      if (interval.startUm !== cursorUm || interval.endUm <= interval.startUm) {
        findings.push(
          finding(
            "EDGE_INTERVAL_COVERAGE",
            [joint.id, interval.id],
            "Finger intervals must cover the mating span without gaps, overlaps, or inversions.",
          ),
        );
      }
      cursorUm = interval.endUm;
      const center = joint.realization.overlapBoundsWorldUm;
      const firstCenterLocal = worldToLocal(first, {
        xUm: Math.round((center.minimum.xUm + center.maximum.xUm) / 2),
        yUm: Math.round((center.minimum.yUm + center.maximum.yUm) / 2),
        zUm: Math.round((center.minimum.zUm + center.maximum.zUm) / 2)
      });
      const sampleWorld = localToWorld(first, {
        xUm: firstCenterLocal.xUm,
        yUm: Math.round((interval.startUm + interval.endUm) / 2),
        zUm: firstCenterLocal.zUm
      });
      const firstOccupied = materialAtWorldPoint(first, sampleWorld);
      const secondOccupied = materialAtWorldPoint(second, sampleWorld);
      if (firstOccupied === secondOccupied) {
        findings.push(
          finding(
            "EDGE_MATE_NOT_COMPLEMENTARY",
            [joint.id, interval.id],
            "Realized finger contours must leave exactly one panel occupying each overlap interval.",
          ),
        );
      } else if (
        (firstOccupied ? first.id : second.id) !== interval.occupiedByPartId
      ) {
        findings.push(
          finding(
            "EDGE_MATE_REALIZATION_DRIFT",
            [joint.id, interval.id],
            "Realized contour occupancy does not match the canonical interval proof.",
          ),
        );
      }
    }
    if (cursorUm !== joint.realization.spanEndUm) {
      findings.push(
        finding(
          "EDGE_INTERVAL_COVERAGE",
          [joint.id],
          "Finger intervals do not terminate at the canonical mating-span end.",
        ),
      );
    }
  }
  return findings;
}

function pointOnPathSegment(point: PointUm, start: PointUm, end: PointUm): boolean {
  const cross = (end.xUm - start.xUm) * (point.yUm - start.yUm) -
    (end.yUm - start.yUm) * (point.xUm - start.xUm);
  return cross === 0 &&
    point.xUm >= Math.min(start.xUm, end.xUm) &&
    point.xUm <= Math.max(start.xUm, end.xUm) &&
    point.yUm >= Math.min(start.yUm, end.yUm) &&
    point.yUm <= Math.max(start.yUm, end.yUm);
}

function pathIntersectsRegion(feature: PartFeature, regionFeature: PartFeature): boolean {
  if (feature.path === null || regionFeature.region === null) {
    return false;
  }
  const pathPoints = feature.path.points;
  const segmentCount = feature.path.closed ? pathPoints.length : pathPoints.length - 1;
  if (pathPoints.some((point) => pointInsidePolyline(point, regionFeature.region!.outer))) {
    return true;
  }
  for (let pathIndex = 0; pathIndex < segmentCount; pathIndex += 1) {
    const start = pathPoints[pathIndex]!;
    const end = pathPoints[(pathIndex + 1) % pathPoints.length]!;
    const regionPoints = regionFeature.region.outer.points;
    for (let regionIndex = 0; regionIndex < regionPoints.length; regionIndex += 1) {
      if (
        segmentsIntersect(
          start,
          end,
          regionPoints[regionIndex]!,
          regionPoints[(regionIndex + 1) % regionPoints.length]!,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function treatmentIntersectsRegion(
  treatment: PartFeature,
  regionFeature: PartFeature,
): boolean {
  if (treatment.path !== null) return pathIntersectsRegion(treatment, regionFeature);
  if (treatment.region === null || regionFeature.region === null) return false;
  const treatmentPoints = treatment.region.outer.points;
  const regionPoints = regionFeature.region.outer.points;
  if (
    treatmentPoints.some((point) => pointInsidePolyline(point, regionFeature.region!.outer)) ||
    regionPoints.some((point) => pointInsidePolyline(point, treatment.region!.outer))
  ) return true;
  for (let treatmentIndex = 0; treatmentIndex < treatmentPoints.length; treatmentIndex += 1) {
    for (let regionIndex = 0; regionIndex < regionPoints.length; regionIndex += 1) {
      if (segmentsIntersect(
        treatmentPoints[treatmentIndex]!,
        treatmentPoints[(treatmentIndex + 1) % treatmentPoints.length]!,
        regionPoints[regionIndex]!,
        regionPoints[(regionIndex + 1) % regionPoints.length]!,
      )) return true;
    }
  }
  return false;
}

function treatmentSamples(treatment: PartFeature): PointUm[] {
  const points = treatment.path?.points ?? treatment.region?.outer.points ?? [];
  const closed = treatment.path?.closed ?? treatment.region !== null;
  const segmentCount = closed ? points.length : Math.max(0, points.length - 1);
  return [
    ...points,
    ...Array.from({ length: segmentCount }, (_, index) => {
      const current = points[index]!;
      const next = points[(index + 1) % points.length]!;
      return {
        xUm: Math.round((current.xUm + next.xUm) / 2),
        yUm: Math.round((current.yUm + next.yUm) / 2)
      };
    })
  ];
}

function treatmentFindings(document: DesignDocumentV1): Finding[] {
  const findings: Finding[] = [];
  for (const part of document.parts) {
    const safeRegions = part.features.filter((feature) => feature.kind === "safe-treatment-region");
    const keepouts = part.features.filter((feature) =>
      feature.kind === "joint-keepout" || feature.kind === "keepout");
    const labels = part.features.filter((feature) => feature.kind === "part-label");
    for (const treatment of part.features.filter((feature) => feature.kind === "treatment")) {
      if (
        (treatment.operation === "score" && treatment.path === null) ||
        (treatment.operation === "engrave" && treatment.region === null)
      ) {
        findings.push(
          finding(
            "TREATMENT_GEOMETRY_MISSING",
            [part.id, treatment.id],
            "Surface treatment requires operation-appropriate centerline or filled-region geometry.",
          ),
        );
        continue;
      }
      const samples = treatmentSamples(treatment);
      if (
        safeRegions.length === 0 ||
        !samples.every((sample) =>
          safeRegions.some((safeRegion) =>
            safeRegion.region !== null && pointInsideRegion(sample, safeRegion.region),
          ),
        )
      ) {
        findings.push(
          finding(
            "TREATMENT_OUTSIDE_SAFE_REGION",
            [part.id, treatment.id],
            "Treatment geometry must remain inside a compiler-owned safe region.",
          ),
        );
      }
      if ([...keepouts, ...labels].some((keepout) => treatmentIntersectsRegion(treatment, keepout))) {
        findings.push(
          finding(
            "TREATMENT_KEEPOUT_INTERSECTION",
            [part.id, treatment.id],
            "Treatment geometry intersects a joint, label, or structural keepout.",
          ),
        );
      }
      if (
        labels.some((label) => treatment.region !== null
          ? pathIntersectsRegion(label, treatment)
          : label.path?.points.some((point) =>
              treatment.path!.points.some((candidate, index) => {
                const next = treatment.path!.points[index + 1];
                return next !== undefined && pointOnPathSegment(point, candidate, next);
              }),
            ) === true
        )
      ) {
        findings.push(
          finding(
            "TREATMENT_LABEL_INTERSECTION",
            [part.id, treatment.id],
            "Treatment geometry intersects the deterministic part mark.",
          ),
        );
      }
    }
  }
  return findings;
}

function graphFindings(document: DesignDocumentV1): Finding[] {
  const adjacency = new Map(document.parts.map((part) => [part.id, new Set<string>()]));
  for (const joint of document.joints) {
    const [first, second] = joint.between;
    adjacency.get(first.partId)?.add(second.partId);
    adjacency.get(second.partId)?.add(first.partId);
  }
  const firstPart = document.parts[0];
  if (firstPart === undefined) {
    return [];
  }
  const visited = new Set<string>();
  const pending = [firstPart.id];
  while (pending.length > 0) {
    const partId = pending.pop()!;
    if (visited.has(partId)) {
      continue;
    }
    visited.add(partId);
    pending.push(...(adjacency.get(partId) ?? []));
  }
  return visited.size === document.parts.length
    ? []
    : [
        finding(
          "DISCONNECTED_ASSEMBLY_GRAPH",
          document.parts.filter((part) => !visited.has(part.id)).map((part) => part.id),
          "Every canonical panel must be connected into one deterministic assembly graph.",
        )
      ];
}

function insertionFindings(document: DesignDocumentV1): Finding[] {
  const findings: Finding[] = [];
  const actionJointIds = new Set(document.assemblyPlan.flatMap((action) => action.jointIds));
  for (const joint of document.joints) {
    if (!actionJointIds.has(joint.id)) {
      findings.push(
        finding(
          "JOINT_MISSING_ASSEMBLY_ACTION",
          [joint.id],
          "Every joint must participate in the deterministic assembly plan.",
        ),
      );
    }
  }
  for (const action of document.assemblyPlan) {
    if (action.action !== "insert" || action.direction === null) {
      continue;
    }
    for (const jointId of action.jointIds) {
      const joint = document.joints.find((candidate) => candidate.id === jointId);
      if (joint === undefined) {
        continue;
      }
      const dot = action.direction.x * joint.insertionDirection.x +
        action.direction.y * joint.insertionDirection.y +
        action.direction.z * joint.insertionDirection.z;
      if (dot < 1 - 1e-9) {
        findings.push(
          finding(
            "INCOMPATIBLE_INSERTION_DIRECTION",
            [action.id, joint.id],
            "Simultaneously inserted joints must share one compatible direction.",
          ),
        );
      }
    }
  }
  return findings;
}

export function validateOrthogonalAssembly(document: DesignDocumentV1): ValidationReport {
  const partById = new Map(document.parts.map((part) => [part.id, part]));
  const findings = [
    ...tabSlotFindings(document, partById),
    ...edgeMateFindings(document, partById),
    ...treatmentFindings(document),
    ...graphFindings(document),
    ...insertionFindings(document)
  ];
  return {
    schemaVersion: "2.0",
    status: findings.length === 0 ? "pass" : "fail",
    findings
  };
}
