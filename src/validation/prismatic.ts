import type {
  DesignDocumentV1,
  Finding,
  MotionConstraint,
  SheetPart,
  ValidationReport
} from "../domain/contracts.js";
import { mmToUm } from "../domain/units.js";

import {
  certifyPrismaticTravel,
  type PrismaticProofReport
} from "./prismatic-proof.js";

function finding(code: string, relatedIds: string[], message: string): Finding {
  return {
    code,
    severity: "error",
    owner: "captured-panel-slide",
    relatedIds,
    message,
    blocksExport: true
  };
}

function partFeatureExists(
  partById: ReadonlyMap<string, SheetPart>,
  partId: string,
  featureId: string,
  kind: SheetPart["features"][number]["kind"],
): boolean {
  return partById.get(partId)?.features.some(
    (feature) => feature.id === featureId && feature.kind === kind,
  ) === true;
}

function intervalEngagementUm(
  movingStartUm: number,
  movingEndUm: number,
  guideStartUm: number,
  guideEndUm: number,
  travelUm: number,
): number {
  return Math.max(
    0,
    Math.min(movingEndUm + travelUm, guideEndUm) -
      Math.max(movingStartUm + travelUm, guideStartUm),
  );
}

function validateConstraint(
  document: DesignDocumentV1,
  constraint: MotionConstraint,
): { findings: Finding[]; proof: PrismaticProofReport } {
  if (constraint.kind !== "prismatic" || constraint.prismatic === undefined) {
    throw new Error("Captured-slide validation requires a canonical prismatic constraint.");
  }
  const findings: Finding[] = [];
  const details = constraint.prismatic;
  const partById = new Map(document.parts.map((part) => [part.id, part]));
  const direction = constraint.axis.direction;
  if (
    Math.abs(direction.x) > 1e-9 ||
    Math.abs(direction.y + 1) > 1e-9 ||
    Math.abs(direction.z) > 1e-9
  ) {
    findings.push(finding(
      "PRISMATIC_ASSUMPTION_UNSUPPORTED",
      [constraint.id],
      "This geometry is outside captured-panel-slide@1.0.0's registered negative-Y axis/transverse-section assumption.",
    ));
  }
  const rangeMinimumUm = mmToUm(constraint.range.minimum);
  const rangeMaximumUm = mmToUm(constraint.range.maximum);
  if (
    constraint.range.unit !== "mm" ||
    rangeMinimumUm !== details.normalTravelUm.minimum ||
    rangeMaximumUm !== details.normalTravelUm.maximum ||
    details.states.closedUm !== details.normalTravelUm.minimum ||
    details.states.fullyOpenUm !== details.normalTravelUm.maximum ||
    details.states.removal.positionUm <= details.states.fullyOpenUm ||
    details.states.removal.retainerPartIds.length !== 1
  ) {
    findings.push(finding(
      "PRISMATIC_STATE_CONTRACT_INVALID",
      [constraint.id, ...details.states.removal.retainerPartIds],
      "Closed, fully-open, and retainer-dependent removal states must be distinct and agree with the canonical millimetre travel range.",
    ));
  }

  const vertical = details.capture.vertical;
  const lateral = details.capture.lateral;
  if (
    vertical.panelMinimumZUm - vertical.lowerSupportMaximumZUm !==
      vertical.lowerClearanceUm ||
    vertical.upperRetainerMinimumZUm - vertical.panelMaximumZUm !==
      vertical.upperClearanceUm ||
    vertical.retainerOverlapUm <= 0 ||
    lateral.panelMinimumXUm - lateral.leftGuideInnerXUm !== lateral.leftClearanceUm ||
    lateral.rightGuideInnerXUm - lateral.panelMaximumXUm !== lateral.rightClearanceUm ||
    lateral.guideOverlapUm <= 0
  ) {
    findings.push(finding(
      "PRISMATIC_CAPTURE_INEQUALITY_INVALID",
      [constraint.id, ...details.retention.guidePartIds],
      "Vertical and lateral capture faces must retain positive exact clearances and positive guide overlap across the complete normal interval.",
    ));
  }
  if (
    details.runningClearance.verticalTotalUm !==
      vertical.lowerClearanceUm + vertical.upperClearanceUm ||
    details.runningClearance.lateralTotalUm !==
      lateral.leftClearanceUm + lateral.rightClearanceUm ||
    details.runningClearance.projectedFinishedVerticalUm !==
      details.runningClearance.verticalTotalUm ||
    details.runningClearance.projectedFinishedLateralUm !==
      details.runningClearance.lateralTotalUm ||
    details.runningClearance.projectedFinishedVerticalUm <= 0 ||
    details.runningClearance.projectedFinishedLateralUm <= 0
  ) {
    findings.push(finding(
      "PRISMATIC_COMPENSATED_CLEARANCE_INVALID",
      [constraint.id],
      "SketchyCut-owned profile compensation must reconstruct the nominal boundaries with positive finished vertical and lateral running clearance.",
    ));
  }

  for (const engagement of details.capture.railEngagement) {
    const atClosed = intervalEngagementUm(
      engagement.movingAxialStartUm,
      engagement.movingAxialEndUm,
      engagement.guideAxialStartUm,
      engagement.guideAxialEndUm,
      details.normalTravelUm.minimum,
    );
    const atOpen = intervalEngagementUm(
      engagement.movingAxialStartUm,
      engagement.movingAxialEndUm,
      engagement.guideAxialStartUm,
      engagement.guideAxialEndUm,
      details.normalTravelUm.maximum,
    );
    // Interval-overlap length is concave under one-axis translation, so its
    // minimum on the closed interval occurs at an endpoint.
    if (
      Math.min(atClosed, atOpen) < engagement.minimumRequiredUm ||
      !details.retention.guidePartIds.includes(engagement.guidePartId)
    ) {
      findings.push(finding(
        "PRISMATIC_RAIL_ENGAGEMENT_INVALID",
        [constraint.id, engagement.guidePartId],
        "Analytic interval overlap falls below the required guide engagement somewhere in normal travel.",
      ));
    }
  }

  const retainedPartIds = [
    ...details.retention.guidePartIds,
    ...details.retention.removableRetainerPartIds
  ];
  if (
    new Set(retainedPartIds).size !== retainedPartIds.length ||
    retainedPartIds.some((partId) => {
      const part = partById.get(partId);
      return part?.sourceOperator.id !== "captured-panel-slide";
    }) ||
    details.retention.mechanicalJointIds.some((jointId) =>
      !document.joints.some(
        (joint) => joint.id === jointId && joint.kind === "retainer-seat",
      ),
    )
  ) {
    findings.push(finding(
      "PRISMATIC_MECHANICAL_RETENTION_INVALID",
      [constraint.id, ...retainedPartIds, ...details.retention.mechanicalJointIds],
      "Every guide and removable stop must be integral or mechanically retained by canonical sheet joints without glue.",
    ));
  }

  const retainerId = details.retention.removableRetainerPartIds[0]!;
  const retainerParts = document.parts.filter((part) => part.id === retainerId);
  const dependencyNodes = document.parts.filter((part) =>
    part.assemblyDependencyPartIds.includes(retainerId),
  );
  const installsRetainer = document.assemblyPlan.filter(
    (action) => action.action === "insert" && action.partIds.includes(retainerId),
  );
  const removesRetainer = document.assemblyPlan.filter(
    (action) =>
      action.action === "remove" &&
      action.phase === "disassembly" &&
      action.partIds.includes(retainerId),
  );
  const removesPanel = document.assemblyPlan.some(
    (action) =>
      action.action === "remove" &&
      action.phase === "disassembly" &&
      constraint.bodyPartIds.every((partId) => action.partIds.includes(partId)) &&
      action.dependsOnActionIds.some((id) => removesRetainer.some((item) => item.id === id)),
  );
  if (
    retainerParts.length !== 1 ||
    dependencyNodes.length !== 1 ||
    installsRetainer.length !== 1 ||
    removesRetainer.length !== 1 ||
    !removesPanel
  ) {
    findings.push(finding(
      "PRISMATIC_REMOVAL_SEQUENCE_INVALID",
      [constraint.id, retainerId],
      "The single removable stop must have one canonical dependency node and deterministic install, removal, and panel-withdrawal actions.",
    ));
  }

  if (
    !partFeatureExists(
      partById,
      details.thumbAccess.partId,
      details.thumbAccess.featureId,
      "thumb-access",
    ) ||
    details.thumbAccess.widthUm <= 0 ||
    details.thumbAccess.depthUm <= 0
  ) {
    findings.push(finding(
      "PRISMATIC_THUMB_ACCESS_MISSING",
      [constraint.id, details.thumbAccess.partId, details.thumbAccess.featureId],
      "The moving panel requires one canonical positive-size thumb-access feature.",
    ));
  }

  const closed = details.stops.closed;
  const open = details.stops.open;
  if (
    closed.positionUm !== details.normalTravelUm.minimum ||
    open.positionUm !== details.normalTravelUm.maximum ||
    !partFeatureExists(partById, closed.fixedPartId, closed.fixedFeatureId, "stop-face") ||
    !partFeatureExists(partById, closed.movingPartId, closed.movingFeatureId, "stop-face") ||
    !partFeatureExists(partById, open.fixedPartId, open.fixedFeatureId, "stop-face") ||
    !partFeatureExists(partById, open.movingPartId, open.movingFeatureId, "stop-face")
  ) {
    findings.push(finding(
      "PRISMATIC_STOP_INVALID",
      [
        constraint.id,
        closed.fixedPartId,
        closed.movingPartId,
        open.fixedPartId,
        open.movingPartId
      ],
      "Closed and fully-open positions must terminate at explicit canonical zero-gap stop faces.",
    ));
  }

  const proof = certifyPrismaticTravel(constraint);
  const closedEndpointContact = details.proofModel.allowedEndpointContacts[0]!;
  const closedContact = proof.forbiddenIntervals.find(
    (interval) =>
      interval.movingPrimitiveId ===
        closedEndpointContact.movingPrimitiveId &&
      interval.stationaryPrimitiveId ===
        closedEndpointContact.stationaryPrimitiveId,
  );
  if (
    closedContact?.maximumExclusiveUm !== closed.positionUm ||
    closedContact.minimumExclusiveUm > closed.positionUm - closed.wallThicknessUm
  ) {
    findings.push(finding(
      "PRISMATIC_CLOSED_STOP_WALL_BYPASS",
      [constraint.id, closed.fixedPartId, closed.movingPartId],
      "The exact forbidden interval behind the closed endpoint must be at least the wall thickness, so the moving panel cannot pass through the wall.",
    ));
  }
  if (!proof.canonicalIntervalsMatch) {
    findings.push(finding(
      "PRISMATIC_FORBIDDEN_INTERVAL_DRIFT",
      [constraint.id],
      "Canonical forbidden intervals must exactly match those derived from every transverse-overlapping moving/stationary primitive pair.",
    ));
  }
  for (const conflict of proof.normalTravelConflicts) {
    findings.push(finding(
      "PRISMATIC_TRAVEL_COLLISION",
      [
        constraint.id,
        conflict.movingPrimitiveId,
        conflict.stationaryPrimitiveId,
        conflict.id
      ],
      `Exact axial interval proof found interference on (${String(conflict.minimumExclusiveUm)}, ${String(conflict.maximumExclusiveUm)}) micrometres of travel.`,
    ));
  }
  for (const contact of proof.endpointContacts.filter(
    (candidate) => candidate.status === "failed",
  )) {
    findings.push(finding(
      "PRISMATIC_ENDPOINT_CONTACT_INVALID",
      [constraint.id, contact.movingPrimitiveId, contact.stationaryPrimitiveId],
      "A declared closed or fully-open contact is not an exact boundary of its derived forbidden interval.",
    ));
  }
  return { findings, proof };
}

export function validateCapturedPanelSlide(document: DesignDocumentV1): {
  validation: ValidationReport;
  proofReports: PrismaticProofReport[];
} {
  const findings: Finding[] = [];
  const movable = document.motionConstraints.filter(
    (constraint) => constraint.kind !== "fixed",
  );
  const prismatic = movable.filter((constraint) => constraint.kind === "prismatic");
  if (movable.length !== 1 || prismatic.length !== 1) {
    findings.push(finding(
      "PRISMATIC_DEGREE_OF_FREEDOM_INVALID",
      document.motionConstraints.map((constraint) => constraint.id),
      "Normal use must expose exactly one intended translational degree of freedom and no other movable constraint.",
    ));
  }
  const proofReports: PrismaticProofReport[] = [];
  for (const constraint of prismatic) {
    const result = validateConstraint(document, constraint);
    findings.push(...result.findings);
    proofReports.push(result.proof);
  }
  return {
    validation: {
      schemaVersion: "1.0",
      status: findings.length === 0 ? "pass" : "fail",
      findings
    },
    proofReports
  };
}

export { certifyPrismaticTravel, type PrismaticProofReport } from "./prismatic-proof.js";
