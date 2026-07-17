import type {
  DesignDocumentV1,
  Finding,
  MotionConstraint,
  ValidationReport
} from "../domain/contracts.js";
import {
  certifyRevoluteTravel,
  type RevoluteProofReport
} from "./revolute-proof.js";

export { certifyRevoluteTravel, type RevoluteProofReport } from "./revolute-proof.js";

function finding(
  code: string,
  relatedIds: string[],
  message: string,
  severity: Finding["severity"] = "error",
): Finding {
  return {
    code,
    severity,
    owner: "retained-pin-revolute",
    relatedIds,
    message,
    blocksExport: severity === "error"
  };
}

function perpendicularDistanceToAxisUm(
  axis: MotionConstraint["axis"],
  point: { xUm: number; yUm: number; zUm: number },
): number {
  const dx = point.xUm - axis.origin.xUm;
  const dy = point.yUm - axis.origin.yUm;
  const dz = point.zUm - axis.origin.zUm;
  const projection = dx * axis.direction.x + dy * axis.direction.y + dz * axis.direction.z;
  return Math.hypot(
    dx - projection * axis.direction.x,
    dy - projection * axis.direction.y,
    dz - projection * axis.direction.z,
  );
}

export function validateRetainedPinMechanism(document: DesignDocumentV1): {
  validation: ValidationReport;
  proofReports: RevoluteProofReport[];
} {
  const findings: Finding[] = [];
  const revoluteConstraints = document.motionConstraints.filter(
    (constraint) => constraint.kind === "revolute",
  );
  if (
    revoluteConstraints.length !== 1 ||
    document.motionConstraints.some((constraint) => constraint.kind === "prismatic")
  ) {
    findings.push(
      finding(
        "REVOLUTE_DEGREE_OF_FREEDOM_INVALID",
        document.motionConstraints.map((constraint) => constraint.id),
        "The retained-pin assembly must expose exactly one intended rotational degree of freedom.",
      ),
    );
  }

  const proofReports: RevoluteProofReport[] = [];
  for (const constraint of revoluteConstraints) {
    const details = constraint.revolute!;
    if (
      Math.abs(constraint.axis.direction.x - 1) > 1e-9 ||
      Math.abs(constraint.axis.direction.y) > 1e-9 ||
      Math.abs(constraint.axis.direction.z) > 1e-9
    ) {
      findings.push(
        finding(
          "REVOLUTE_ASSUMPTION_UNSUPPORTED",
          [constraint.id],
          "This geometry is outside the registered positive-X axis/section assumption and is concept-only.",
        ),
      );
      continue;
    }
    const movingPanel = document.parts.find(
      (part) => part.role === "moving-panel" && constraint.bodyPartIds.includes(part.id),
    );
    const movingPanelSection = details.proofModel.sectionPrimitives.find(
      (primitive) => primitive.ownerId === movingPanel?.id && primitive.behavior === "moving",
    );
    const sectionMinimumRadialUm = movingPanelSection === undefined
      ? Number.NaN
      : Math.min(...movingPanelSection.polygon.map((point) => point.xUm));
    const sectionMaximumVerticalUm = movingPanelSection === undefined
      ? Number.NaN
      : Math.max(...movingPanelSection.polygon.map((point) => point.yUm));
    if (
      movingPanel === undefined ||
      movingPanelSection === undefined ||
      movingPanel.assembledFrame.origin.xUm !== constraint.axis.origin.xUm ||
      movingPanel.assembledFrame.origin.yUm !==
        constraint.axis.origin.yUm - sectionMinimumRadialUm ||
      movingPanel.assembledFrame.origin.zUm !==
        constraint.axis.origin.zUm + sectionMaximumVerticalUm ||
      movingPanel.assembledFrame.xAxis.x !== 1 ||
      movingPanel.assembledFrame.yAxis.y !== -1 ||
      movingPanel.assembledFrame.zAxis.z !== -1
    ) {
      findings.push(
        finding(
          "REVOLUTE_CANONICAL_FRAME_PROOF_MISMATCH",
          [constraint.id, ...(movingPanel === undefined ? [] : [movingPanel.id])],
          "The moving panel closed frame, opening sense, and conservative section proof must share one canonical axis-relative transform.",
        ),
      );
    }
    const stock = (document.externalStock ?? []).find(
      (item) => item.id === details.pinStockItemId,
    );
    if (stock === undefined) {
      findings.push(
        finding(
          "HINGE_PIN_STOCK_MISSING",
          [constraint.id, details.pinStockItemId],
          "The revolute interface requires one canonical measured wooden pin stock item.",
        ),
      );
      continue;
    }
    if (
      details.boreDiameterUm - stock.stockProfile.measuredDiameterUm !==
      details.totalDiametralClearanceUm ||
      details.totalDiametralClearanceUm <= 0
    ) {
      findings.push(
        finding(
          "ROTATING_CLEARANCE_INVALID",
          [constraint.id, stock.id],
          "The bore must apply exactly one positive total diametral rotating clearance to the measured pin.",
        ),
      );
    }
    for (const station of details.stations) {
      const alignmentErrorUm = perpendicularDistanceToAxisUm(
        constraint.axis,
        station.axisPoint,
      );
      const directionDot =
        station.axisDirection.x * constraint.axis.direction.x +
        station.axisDirection.y * constraint.axis.direction.y +
        station.axisDirection.z * constraint.axis.direction.z;
      if (
        alignmentErrorUm > details.coaxialToleranceUm ||
        Math.abs(Math.abs(directionDot) - 1) > 1e-9
      ) {
        findings.push(
          finding(
            "HINGE_STATION_NONCOAXIAL",
            [constraint.id, station.id, station.partId, station.featureId],
            `Hinge station exceeds the declared ${String(details.coaxialToleranceUm)} micrometre coaxial tolerance.`,
          ),
        );
      }
      if (station.boreDiameterUm !== details.boreDiameterUm) {
        findings.push(
          finding(
            "HINGE_BORE_DIAMETER_MISMATCH",
            [constraint.id, station.id],
            "Every coaxial station must use the canonical bore diameter.",
          ),
        );
      }
      if (station.boreLigamentUm < details.minimumBoreLigamentUm) {
        findings.push(
          finding(
            "HINGE_BORE_LIGAMENT_FAILURE",
            [constraint.id, station.id, station.partId],
            "A hinge bore leaves less than the required minimum plywood ligament.",
          ),
        );
      }
    }
    const maximumKerfUm = Math.round(
      Math.max(
        document.resolvedInputs.machine.kerfMm.x,
        document.resolvedInputs.machine.kerfMm.y,
      ) * 1_000,
    );
    const compensatedToolpathDiameterUm = details.boreDiameterUm - maximumKerfUm;
    const projectedMinimumFinishedBoreUm = compensatedToolpathDiameterUm + maximumKerfUm;
    if (
      compensatedToolpathDiameterUm <= 0 ||
      projectedMinimumFinishedBoreUm - stock.stockProfile.measuredDiameterUm <= 0
    ) {
      findings.push(
        finding(
          "ROTATING_COMPENSATED_CLEARANCE_FAILURE",
          [constraint.id, stock.id],
          "The kerf-compensated internal toolpath must preserve a positive projected finished-bore clearance around the measured pin.",
        ),
      );
    }
    if (
      compensatedToolpathDiameterUm <=
      document.resolvedInputs.machine.minimumFeatureMm * 1_000
    ) {
      findings.push(
        finding(
          "HINGE_COMPENSATED_HOLE_SURVIVAL_FAILURE",
          [constraint.id, ...details.stations.map((station) => station.featureId)],
          "The compensated hinge-bore toolpath does not retain the required positive internal feature.",
        ),
      );
    }
    if (
      stock.retention.axialEndplayUm !== details.axialEndplayUm ||
      details.axialEndplayUm <= 0 ||
      details.retention.retainerPartIds.some(
        (partId) => !document.parts.some((part) => part.id === partId),
      ) ||
      details.retention.retainedTravel.minimumDegrees > constraint.range.minimum ||
      details.retention.retainedTravel.maximumDegrees < constraint.range.maximum
    ) {
      findings.push(
        finding(
          "HINGE_AXIAL_RETENTION_INVALID",
          [constraint.id, stock.id, ...details.retention.retainerPartIds],
          "Opposed geometric guards, positive endplay, and full-travel axial retention must all be explicit.",
        ),
      );
    }
    const pinInsertAction = document.assemblyPlan.find(
      (action) => action.action === "insert" && action.stockItemIds?.includes(stock.id) === true,
    );
    const retainerAction = document.assemblyPlan.find(
      (action) => details.retention.retainerPartIds.every((partId) => action.partIds.includes(partId)),
    );
    const withdrawalAction = document.assemblyPlan.find(
      (action) => action.action === "remove" && action.stockItemIds?.includes(stock.id) === true,
    );
    if (
      pinInsertAction === undefined ||
      retainerAction === undefined ||
      withdrawalAction === undefined ||
      retainerAction.order <= pinInsertAction.order ||
      withdrawalAction.phase !== "disassembly" ||
      stock.retention.installationClearanceUm !== details.retention.installationClearanceUm
    ) {
      findings.push(
        finding(
          "HINGE_INSTALLATION_ACCESS_INVALID",
          [constraint.id, stock.id],
          "The pin needs an explicit clear insertion path before guard installation and a deterministic reverse disassembly path.",
        ),
      );
    }
    if (
      details.stops.closed.angleDegrees !== constraint.range.minimum ||
      details.stops.open.angleDegrees !== constraint.range.maximum ||
      details.stops.open.angleDegrees < 80 ||
      details.stops.closed.contactGapUm !== 0 ||
      details.stops.open.contactGapUm !== 0 ||
      details.stops.closed.fixedPartIds.some((partId, index) =>
        !document.parts.find((part) => part.id === partId)?.features.some(
          (feature) =>
            feature.id === details.stops.closed.fixedFeatureIds[index] &&
            feature.kind === "stop-face",
        ),
      ) ||
      !document.parts.find(
        (part) => part.id === details.stops.closed.movingPartId,
      )?.features.some(
        (feature) =>
          feature.id === details.stops.closed.movingFeatureId &&
          feature.kind === "stop-face",
      ) ||
      !document.parts.find(
        (part) => part.id === details.stops.open.fixedPartId,
      )?.features.some(
        (feature) =>
          feature.id === details.stops.open.fixedFeatureId &&
          feature.kind === "stop-face",
      ) ||
      !document.parts.find(
        (part) => part.id === details.stops.open.movingPartId,
      )?.features.some(
        (feature) =>
          feature.id === details.stops.open.movingFeatureId &&
          feature.kind === "stop-face",
      )
    ) {
      findings.push(
        finding(
          "HINGE_STOP_INVALID",
          [
            constraint.id,
            ...details.stops.closed.fixedPartIds,
            details.stops.open.fixedPartId
          ],
          "Closed and useful-open travel limits must each terminate at explicit canonical zero-gap stop faces.",
        ),
      );
    }
    const report = certifyRevoluteTravel(constraint);
    proofReports.push(report);
    for (const collision of report.collisions) {
      findings.push(
        finding(
          "REVOLUTE_TRAVEL_COLLISION",
          [
            constraint.id,
            collision.axialIntervalId,
            collision.movingPrimitiveId,
            collision.stationaryPrimitiveId
          ],
          `Conservative 2.5D proof found interference near ${collision.angleDegrees.toFixed(3)} degrees in ${collision.axialIntervalId}.`,
        ),
      );
    }
    for (const pair of report.indeterminatePairs) {
      findings.push(
        finding(
          "REVOLUTE_TRAVEL_PROOF_INDETERMINATE",
          [constraint.id, pair.axialIntervalId, pair.movingPrimitiveId, pair.stationaryPrimitiveId],
          "Conservative angle-interval bounds could not certify this axis section within the bounded proof budget.",
        ),
      );
    }
    for (const contact of report.endpointContacts.filter(
      (candidate) => candidate.status === "failed",
    )) {
      findings.push(
        finding(
          "REVOLUTE_STOP_CONTACT_INVALID",
          [
            constraint.id,
            contact.id,
            contact.movingPrimitiveId,
            contact.stationaryPrimitiveId
          ],
          "A declared endpoint stop did not provide zero-gap tangent contact with certified separation through the remaining travel.",
        ),
      );
    }
    if (
      report.endpointContacts.length !==
      details.proofModel.allowedEndpointContacts.length
    ) {
      findings.push(
        finding(
          "REVOLUTE_STOP_CONTACT_MISSING",
          [constraint.id],
          "Every declared closed/open stop contact must occur in a represented axial interval.",
        ),
      );
    }
  }
  return {
    validation: {
      schemaVersion: "1.0",
      status: findings.some((item) => item.severity === "error") ? "fail" : "pass",
      findings
    },
    proofReports
  };
}
