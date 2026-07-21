import {
  DesignDocumentV1Schema,
  RetainedPinProgramV1Schema,
  type ConstructionSelection,
  type DesignDocumentV1,
  type ExternalStockItem,
  type FitProfile,
  type InputPolicyEvaluation,
  type Joint,
  type MachineProfile,
  type MaterialProfile,
  type MotionConstraint,
  type PartFeature,
  type Region2D,
  type RetainedPinProgramV1,
  type SheetPart,
  type ValidationReport
} from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import {
  retainedPinGeometryDimensions
} from "../domain/retained-pin-policy.js";
import { mmToUm, umToMm } from "../domain/units.js";
import { booleanRegions } from "../kernel/geometry/clipper-adapter.js";
import { boundsUm } from "../kernel/geometry/metrics.js";
import { validateOrthogonalAssembly } from "../validation/assembly.js";
import { validateParts } from "../validation/geometry.js";
import {
  validateRetainedPinMechanism,
  type RevoluteProofReport
} from "../validation/revolute.js";

import {
  compileOrthogonalPanelProgram,
  type OrthogonalCompileProfiles
} from "./orthogonal-compiler.js";
import { localToWorld, rectangleContour, worldToLocal } from "./orthogonal-model.js";

export const RETAINED_PIN_REVOLUTE_OPERATOR = {
  id: "retained-pin-revolute",
  version: "1.1.0"
} as const;

export const RETAINED_PIN_SEARCH_POLICY = {
  id: "retained-pin-construction-search",
  version: "1.1.0",
  candidates: [
    { id: "five-station", stationCount: 5 },
    { id: "three-station", stationCount: 3 }
  ]
} as const;

type Candidate = (typeof RETAINED_PIN_SEARCH_POLICY.candidates)[number];

function openStopAxialCenterUm(
  componentCentersUm: readonly number[],
  thicknessUm: number,
): number | null {
  const bounds = [...componentCentersUm]
    .sort((left, right) => left - right)
    .map((centerUm) => ({
      startUm: centerUm - Math.floor(thicknessUm / 2),
      endUm: centerUm + Math.ceil(thicknessUm / 2)
    }));
  const requiredGapUm = thicknessUm + 1_000;
  const selected = bounds.slice(0, -1)
    .map((bound, index) => ({
      startUm: bound.endUm,
      endUm: bounds[index + 1]!.startUm
    }))
    .filter((gap) => gap.endUm - gap.startUm >= requiredGapUm)
    .sort(
      (left, right) =>
        (right.endUm - right.startUm) - (left.endUm - left.startUm) ||
        left.startUm - right.startUm,
    )[0];
  return selected === undefined
    ? null
    : Math.round((selected.startUm + selected.endUm) / 2);
}

export class RetainedPinConstructionError extends Error {
  readonly code = "RETAINED_PIN_CONSTRUCTION_UNAVAILABLE";
  constructor(
    readonly attempts: ConstructionSelection["attempts"],
    readonly measuredInputs: {
      thicknessUm: number;
      snugClearanceUm: number;
      pinDiameterUm: number;
      kerfXUm: number;
      kerfYUm: number;
    },
  ) {
    super(
      "No registered retained-pin construction preserves the measured inputs and required minimum feature margins; export is withheld.",
    );
  }
}

export class RetainedPinAssumptionError extends Error {
  readonly code = "REVOLUTE_ASSUMPTION_UNSUPPORTED";
  readonly outcome = "concept-only" as const;
  constructor() {
    super(
      `The requested revolute geometry is outside retained-pin-revolute@${RETAINED_PIN_REVOLUTE_OPERATOR.version} positive-X axis/section assumptions; fabrication export is withheld and no general swept-mesh fallback is used.`,
    );
  }
}

export function assessRetainedPinProgram(value: unknown):
  | { status: "supported"; program: RetainedPinProgramV1 }
  | { status: "concept-only"; code: "REVOLUTE_ASSUMPTION_UNSUPPORTED"; message: string } {
  const result = RetainedPinProgramV1Schema.safeParse(value);
  if (result.success) {
    return { status: "supported", program: result.data };
  }
  if (
    result.error.issues.some((issue) =>
      issue.path.join(".") === "mechanism.axis.direction" &&
      issue.message.includes("positive-X axis/section"),
    )
  ) {
    const error = new RetainedPinAssumptionError();
    return { status: "concept-only", code: error.code, message: error.message };
  }
  throw result.error;
}

export type RetainedPinCompileResult = {
  document: DesignDocumentV1;
  proofReports: RevoluteProofReport[];
};

function mergeReports(...reports: readonly ValidationReport[]): ValidationReport {
  const findings = reports.flatMap((report) => report.findings);
  return {
    schemaVersion: "1.0",
    status: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    findings
  };
}

function circleContour(
  id: string,
  centerXUm: number,
  centerYUm: number,
  radiusUm: number,
  segments = 32,
): Region2D["outer"] {
  return {
    id,
    closed: true,
    points: Array.from({ length: segments }, (_, index) => {
      const radians = (-2 * Math.PI * index) / segments;
      return {
        xUm: Math.round(centerXUm + Math.cos(radians) * radiusUm),
        yUm: Math.round(centerYUm + Math.sin(radians) * radiusUm)
      };
    })
  };
}

function boundaryFeature(partId: string, region: Region2D): PartFeature {
  return {
    id: `${partId}-boundary`,
    kind: "outer-boundary",
    operation: "cut",
    fitClass: null,
    jointId: null,
    region,
    path: null,
    parametersUm: {}
  };
}

function slotFeature(
  id: string,
  contour: Region2D["outer"],
  jointId: string,
  openingUm: number,
): PartFeature {
  return {
    id,
    kind: "slot",
    operation: "cut",
    fitClass: "snug",
    jointId,
    region: { outer: contour, holes: [] },
    path: null,
    parametersUm: { opening: openingUm }
  };
}

function withSlots(
  part: SheetPart,
  slots: readonly { feature: PartFeature; contour: Region2D["outer"] }[],
): SheetPart {
  const region: Region2D = {
    outer: part.nominalRegion.outer,
    holes: [...part.nominalRegion.holes, ...slots.map((slot) => slot.contour)]
  };
  return {
    ...part,
    nominalRegion: region,
    features: [
      ...slots.map((slot) => slot.feature),
      ...part.features.map((feature) =>
        feature.kind === "outer-boundary"
          ? { ...feature, region }
          : feature,
      )
    ]
  };
}

function withClosedStopFeature(part: SheetPart): SheetPart {
  const bounds = boundsUm(part.nominalRegion.outer.points);
  const contour = rectangleContour(
    `${part.id}-closed-stop-contour`,
    bounds.minXUm,
    bounds.maxYUm - 1_000,
    bounds.maxXUm - bounds.minXUm,
    1_000,
  );
  return {
    ...part,
    features: [
      {
        id: `${part.id}-closed-stop`,
        kind: "stop-face",
        operation: "none",
        fitClass: null,
        jointId: null,
        region: { outer: contour, holes: [] },
        path: null,
        parametersUm: { angleMillidegrees: 0 }
      },
      ...part.features
    ]
  };
}

function withHingeClearanceNotches(
  part: SheetPart,
  centersUm: readonly number[],
  axisPoint: { xUm: number; yUm: number; zUm: number },
  sweptClearanceUm: number,
  panelAxisOffsetUm: number,
  thicknessUm: number,
): SheetPart {
  const radialClearanceUm = sweptClearanceUm + 300;
  const axialClearanceUm = 300;
  const notches = centersUm.map((centerXUm, index) => {
    const localStart = worldToLocal(part, {
      xUm: centerXUm,
      yUm: axisPoint.yUm,
      zUm: axisPoint.zUm - radialClearanceUm
    });
    const widthUm = thicknessUm + axialClearanceUm * 2;
    const contour = rectangleContour(
      `moving-leaf-clearance-${String(index + 1)}-contour`,
      localStart.xUm - Math.floor(widthUm / 2),
      localStart.yUm,
      widthUm,
      radialClearanceUm + panelAxisOffsetUm + 1_000,
    );
    return { id: `moving-leaf-clearance-${String(index + 1)}`, contour };
  });
  if (notches.length === 0) {
    return part;
  }
  const regions = booleanRegions(
    "difference",
    [part.nominalRegion],
    notches.map((notch) => ({ outer: notch.contour, holes: [] })),
    `${part.id}-hinge-clearance`,
  );
  if (regions.length !== 1) {
    throw new Error(
      `Stationary hinge clearances must preserve one connected anchor region; observed ${String(regions.length)} regions.`,
    );
  }
  const region = regions[0]!;
  return {
    ...part,
    nominalRegion: region,
    features: [
      ...notches.map((notch) => ({
        id: notch.id,
        kind: "slot" as const,
        operation: "cut" as const,
        fitClass: null,
        jointId: null,
        region: { outer: notch.contour, holes: [] },
        path: null,
        parametersUm: { sweptRadialClearance: radialClearanceUm }
      })),
      ...part.features.map((feature) =>
        feature.kind === "outer-boundary"
          ? { ...feature, region }
          : feature,
      )
    ]
  };
}

function selectConstruction(
  program: RetainedPinProgramV1,
  profiles: OrthogonalCompileProfiles,
  leafRadiusUm: number,
): {
  candidate: Candidate;
  selection: ConstructionSelection;
  centersUm: number[];
  guardLeftCenterUm: number;
  guardRightCenterUm: number;
  stopCenterUm: number;
} {
  const thicknessUm = mmToUm(profiles.material.measuredThicknessMm);
  const snugClearanceUm = mmToUm(profiles.fit.snug.totalDeltaMm);
  const seatOpeningUm = thicknessUm + snugClearanceUm;
  const minimumGapUm = seatOpeningUm + mmToUm(profiles.machine.minimumFeatureMm);
  const { startUm, endUm } = program.mechanism.stationSpan;
  const attempts: ConstructionSelection["attempts"] = [];
  for (const candidate of RETAINED_PIN_SEARCH_POLICY.candidates) {
    const usableUm = endUm - startUm - leafRadiusUm * 2;
    const centerPitchUm = usableUm / (candidate.stationCount - 1);
    const findingCodes: string[] = [];
    if (usableUm <= 0 || centerPitchUm - thicknessUm < minimumGapUm) {
      findingCodes.push("HINGE_STATION_SPACING_UNAVAILABLE");
    }
    const centersUm = usableUm > 0
      ? Array.from({ length: candidate.stationCount }, (_, index) =>
          Math.round(startUm + leafRadiusUm + centerPitchUm * index),
        )
      : [];
    const guardStationPitchUm = seatOpeningUm + mmToUm(profiles.machine.minimumFeatureMm);
    const guardLeftCenterUm = centersUm.length > 0
      ? centersUm[0]! - guardStationPitchUm
      : startUm;
    const guardRightCenterUm = centersUm.length > 0
      ? centersUm[centersUm.length - 1]! + guardStationPitchUm
      : endUm;
    if (
      guardLeftCenterUm - Math.ceil(seatOpeningUm / 2) < 0 ||
      guardRightCenterUm + Math.ceil(seatOpeningUm / 2) > program.mechanism.panelWidthUm
    ) {
      findingCodes.push("HINGE_RETAINER_MARGIN_UNAVAILABLE");
    }
    const stopCenterUm = openStopAxialCenterUm(
      [guardLeftCenterUm, ...centersUm, guardRightCenterUm],
      seatOpeningUm,
    );
    if (stopCenterUm === null) {
      findingCodes.push("HINGE_OPEN_STOP_AXIAL_GAP_UNAVAILABLE");
    }
    if (findingCodes.length > 0) {
      attempts.push({
        candidateId: candidate.id,
        status: "rejected",
        findingCodes
      });
      continue;
    }
    attempts.push({ candidateId: candidate.id, status: "selected", findingCodes: [] });
    const preferredCandidateId = RETAINED_PIN_SEARCH_POLICY.candidates[0].id;
    const changedConstruction = candidate.id !== preferredCandidateId;
    return {
      candidate,
      centersUm,
      guardLeftCenterUm,
      guardRightCenterUm,
      stopCenterUm: stopCenterUm!,
      selection: {
        schemaVersion: "1.0",
        operatorId: RETAINED_PIN_REVOLUTE_OPERATOR.id,
        operatorVersion: RETAINED_PIN_REVOLUTE_OPERATOR.version,
        searchPolicyId: RETAINED_PIN_SEARCH_POLICY.id,
        searchPolicyVersion: RETAINED_PIN_SEARCH_POLICY.version,
        preferredCandidateId,
        selectedCandidateId: candidate.id,
        changedConstruction,
        attempts,
        disclosure: changedConstruction
          ? `The preferred five-station construction did not preserve minimum station spacing at the entered measurements. The fixed ${RETAINED_PIN_SEARCH_POLICY.id}@${RETAINED_PIN_SEARCH_POLICY.version} order selected the three-station construction without changing thickness, kerf, pin diameter, or requested envelope.`
          : `The preferred five-station construction passed at the entered measurements under ${RETAINED_PIN_SEARCH_POLICY.id}@${RETAINED_PIN_SEARCH_POLICY.version}; no measurement or requested dimension was changed.`
      }
    };
  }
  throw new RetainedPinConstructionError(attempts, {
    thicknessUm,
    snugClearanceUm,
    pinDiameterUm: program.mechanism.pin.measuredDiameterUm,
    kerfXUm: mmToUm(profiles.processRecipe.cutWidth.xMm),
    kerfYUm: mmToUm(profiles.processRecipe.cutWidth.yMm)
  });
}

function leafPart(
  partId: string,
  name: string,
  markingCode: string,
  centerXUm: number,
  axisYUm: number,
  axisZUm: number,
  radiusUm: number,
  boreDiameterUm: number,
  totalDiametralClearanceUm: number,
  thicknessUm: number,
  materialProfileId: string,
  moving: boolean,
  panelAxisOffsetUm: number,
  stationaryAttachmentRadialUm: number,
  dependencyPartId: string,
  jointId: string,
): SheetPart {
  const lobe = {
    outer: rectangleContour(`${partId}-lobe`, 0, 0, radiusUm * 2, radiusUm * 2),
    holes: []
  };
  const radialStartUm = moving ? radiusUm - 1_000 : radiusUm - 1_000;
  const radialEndUm = moving
    ? panelAxisOffsetUm + 5_000
    : stationaryAttachmentRadialUm + thicknessUm;
  const armMinimumHUm = moving ? radiusUm - 1_000 : -2_000;
  const armMaximumHUm = moving ? radiusUm + 1_000 : 2_000;
  const arm = {
    outer: rectangleContour(
      `${partId}-arm`,
      radiusUm - radialEndUm,
      radiusUm + armMinimumHUm,
      radialEndUm - radialStartUm,
      armMaximumHUm - armMinimumHUm,
    ),
    holes: []
  };
  const tongueMinimumRadialUm = moving
    ? panelAxisOffsetUm + 1_000
    : stationaryAttachmentRadialUm;
  const tongueMaximumRadialUm = moving
    ? panelAxisOffsetUm + 5_000
    : stationaryAttachmentRadialUm + thicknessUm;
  const tongueMinimumHUm = moving ? radiusUm - 1_000 : -2_000;
  const tongueMaximumHUm = moving
    ? panelAxisOffsetUm + thicknessUm
    : 2_000;
  const tongue = rectangleContour(
    `${partId}-attachment-contour`,
    radiusUm - tongueMaximumRadialUm,
    radiusUm + tongueMinimumHUm,
    tongueMaximumRadialUm - tongueMinimumRadialUm,
    tongueMaximumHUm - tongueMinimumHUm,
  );
  const unioned = booleanRegions(
    "union",
    [lobe, arm, { outer: tongue, holes: [] }],
    [],
    `${partId}-profile`,
  );
  if (unioned.length !== 1 || unioned[0]!.holes.length !== 0) {
    throw new Error(`Hinge leaf ${partId} must produce one connected hole-free profile.`);
  }
  const outer = { ...unioned[0]!.outer, id: `${partId}-outer` };
  const bore = circleContour(
    `${partId}-bore-contour`,
    radiusUm,
    radiusUm,
    Math.round(boreDiameterUm / 2),
  );
  const region = { outer, holes: [bore] };
  const boreFeature: PartFeature = {
    id: `${partId}-bore`,
    kind: "bore",
    operation: "cut",
    fitClass: "rotating",
    jointId: "pin-axis",
    region: { outer: bore, holes: [] },
    path: null,
    parametersUm: {
      diameter: boreDiameterUm,
      totalDiametralClearance: totalDiametralClearanceUm
    }
  };
  return {
    schemaVersion: "1.0",
    id: partId,
    name,
    role: "hinge-leaf",
    markingCode,
    materialProfileId,
    thicknessUm,
    grainVector: { x: 0, y: 1 },
    nominalRegion: region,
    features: [
      boreFeature,
      {
        id: `${partId}-attachment`,
        kind: "hinge-leaf",
        operation: "none",
        fitClass: "snug",
        jointId,
        region: { outer: tongue, holes: [] },
        path: null,
        parametersUm: { engagement: thicknessUm }
      },
      boundaryFeature(partId, region)
    ],
    assembledFrame: {
      origin: {
        xUm: centerXUm - Math.floor(thicknessUm / 2),
        yUm: axisYUm - radiusUm,
        zUm: axisZUm - radiusUm
      },
      xAxis: { x: 0, y: 1, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: 1, y: 0, z: 0 }
    },
    explodedOffset: moving
      ? { xUm: 0, yUm: -18_000, zUm: 24_000 }
      : { xUm: 0, yUm: 18_000, zUm: 12_000 },
    assemblyDependencyPartIds: [dependencyPartId],
    sourceOperator: RETAINED_PIN_REVOLUTE_OPERATOR
  };
}

function movingPanel(
  program: RetainedPinProgramV1,
  profiles: OrthogonalCompileProfiles,
  movingCentersUm: readonly { centerXUm: number; stationNumber: number }[],
  panelAxisOffsetUm: number,
  snugClearanceUm: number,
): SheetPart {
  const thicknessUm = mmToUm(profiles.material.measuredThicknessMm);
  const radialStartUm = panelAxisOffsetUm;
  const outer = rectangleContour(
    `${program.mechanism.movingPanelId}-outer`,
    0,
    0,
    program.mechanism.panelWidthUm,
    program.mechanism.panelDepthUm,
  );
  const slots = movingCentersUm.map(({ centerXUm, stationNumber }) => {
    const jointId = `moving-leaf-seat-${String(stationNumber)}`;
    const openingUm = thicknessUm + snugClearanceUm;
    const contour = rectangleContour(
      `${jointId}-slot-contour`,
      centerXUm - Math.floor(openingUm / 2),
      1_000,
      openingUm,
      4_000,
      "cw",
    );
    return { jointId, contour, openingUm };
  });
  const region: Region2D = { outer, holes: slots.map((slot) => slot.contour) };
  return {
    schemaVersion: "1.0",
    id: program.mechanism.movingPanelId,
    name: program.mechanism.movingPanelName,
    role: "moving-panel",
    markingCode: program.mechanism.movingPanelMarkingCode,
    materialProfileId: profiles.material.id,
    thicknessUm,
    grainVector: { x: 1, y: 0 },
    nominalRegion: region,
    features: [
      ...slots.map((slot) =>
        slotFeature(
          `${slot.jointId}-slot`,
          slot.contour,
          slot.jointId,
          slot.openingUm,
        ),
      ),
      {
        id: `${program.mechanism.movingPanelId}-closed-stop`,
        kind: "stop-face",
        operation: "none",
        fitClass: null,
        jointId: null,
        region: {
          outer: rectangleContour(
            `${program.mechanism.movingPanelId}-closed-stop-contour`,
            Math.max(1_000, Math.floor(program.mechanism.panelWidthUm / 2) - 2_000),
            program.mechanism.panelDepthUm - 2_000,
            4_000,
            1_000,
          ),
          holes: []
        },
        path: null,
        parametersUm: { angleMillidegrees: 0 }
      },
      {
        id: `${program.mechanism.movingPanelId}-open-stop`,
        kind: "stop-face",
        operation: "none",
        fitClass: null,
        jointId: null,
        region: {
          outer: rectangleContour(
            `${program.mechanism.movingPanelId}-open-stop-contour`,
            1_000,
            0,
            4_000,
            2_000,
          ),
          holes: []
        },
        path: null,
        parametersUm: {
          angleMillidegrees: Math.round(program.mechanism.openAngleDegrees * 1_000)
        }
      },
      boundaryFeature(program.mechanism.movingPanelId, region)
    ],
    assembledFrame: {
      origin: {
        xUm: program.mechanism.axis.origin.xUm,
        yUm: program.mechanism.axis.origin.yUm - radialStartUm,
        zUm: program.mechanism.axis.origin.zUm + panelAxisOffsetUm + thicknessUm
      },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: -1, z: 0 },
      zAxis: { x: 0, y: 0, z: -1 }
    },
    explodedOffset: { xUm: 0, yUm: -30_000, zUm: 44_000 },
    assemblyDependencyPartIds: [],
    sourceOperator: RETAINED_PIN_REVOLUTE_OPERATOR
  };
}

function retainerPart(
  side: "negative" | "positive",
  centerXUm: number,
  program: RetainedPinProgramV1,
  profiles: OrthogonalCompileProfiles,
  leafRadiusUm: number,
  stationaryAttachmentRadialUm: number,
  dependencyPartId: string,
): SheetPart {
  const thicknessUm = mmToUm(profiles.material.measuredThicknessMm);
  const id = `pin-guard-${side}`;
  const lobe = {
    outer: rectangleContour(`${id}-lobe`, 0, 0, leafRadiusUm * 2, leafRadiusUm * 2),
    holes: []
  };
  const armMinimumRadialUm = leafRadiusUm - 1_000;
  const armMaximumRadialUm = stationaryAttachmentRadialUm + thicknessUm;
  const arm = {
    outer: rectangleContour(
      `${id}-arm`,
      leafRadiusUm - armMaximumRadialUm,
      leafRadiusUm - 2_000,
      armMaximumRadialUm - armMinimumRadialUm,
      4_000,
    ),
    holes: []
  };
  const unioned = booleanRegions("union", [lobe, arm], [], `${id}-profile`);
  if (unioned.length !== 1 || unioned[0]!.holes.length !== 0) {
    throw new Error(`Pin guard ${id} must produce one connected profile.`);
  }
  const outer = { ...unioned[0]!.outer, id: `${id}-outer` };
  const region = { outer, holes: [] };
  return {
    schemaVersion: "1.0",
    id,
    name: `${side === "negative" ? "Left" : "Right"} pin guard`,
    role: "retainer",
    markingCode: side === "negative" ? "r1" : "r2",
    materialProfileId: profiles.material.id,
    thicknessUm,
    grainVector: { x: 0, y: 1 },
    nominalRegion: region,
    features: [
      {
        id: `${id}-seat`,
        kind: "retainer-seat",
        operation: "none",
        fitClass: "snug",
        jointId: `${id}-joint`,
        region: {
          outer: rectangleContour(
            `${id}-seat-contour`,
            leafRadiusUm - armMaximumRadialUm,
            leafRadiusUm - 2_000,
            thicknessUm,
            4_000,
          ),
          holes: []
        },
        path: null,
        parametersUm: { axialBlock: thicknessUm }
      },
      boundaryFeature(id, region)
    ],
    assembledFrame: {
      origin: {
        xUm: centerXUm - Math.floor(thicknessUm / 2),
        yUm: program.mechanism.axis.origin.yUm - leafRadiusUm,
        zUm: program.mechanism.axis.origin.zUm - leafRadiusUm
      },
      xAxis: { x: 0, y: 1, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: 1, y: 0, z: 0 }
    },
    explodedOffset: {
      xUm: side === "negative" ? -28_000 : 28_000,
      yUm: 12_000,
      zUm: 8_000
    },
    assemblyDependencyPartIds: [dependencyPartId],
    sourceOperator: RETAINED_PIN_REVOLUTE_OPERATOR
  };
}

function openStopBrace(
  centerXUm: number,
  program: RetainedPinProgramV1,
  profiles: OrthogonalCompileProfiles,
  panelAxisOffsetUm: number,
  stationaryAttachmentRadialUm: number,
): SheetPart {
  const thicknessUm = mmToUm(profiles.material.measuredThicknessMm);
  const radians = program.mechanism.openAngleDegrees * Math.PI / 180;
  const tangent = { x: Math.cos(radians), y: Math.sin(radians) };
  const normal = { x: -Math.sin(radians), y: Math.cos(radians) };
  const contact = {
    x: panelAxisOffsetUm * tangent.x - panelAxisOffsetUm * tangent.y,
    y: panelAxisOffsetUm * tangent.y + panelAxisOffsetUm * tangent.x
  };
  const stopLengthUm = 8_000;
  const stopWidthUm = 8_000;
  const stopPoints = [
    contact,
    {
      x: contact.x - tangent.x * stopLengthUm,
      y: contact.y - tangent.y * stopLengthUm
    },
    {
      x: contact.x - tangent.x * stopLengthUm - normal.x * stopWidthUm,
      y: contact.y - tangent.y * stopLengthUm - normal.y * stopWidthUm
    },
    {
      x: contact.x - normal.x * stopWidthUm,
      y: contact.y - normal.y * stopWidthUm
    }
  ].map((point) => ({
    xUm: Math.round(point.x),
    yUm: Math.round(point.y)
  }));
  const stopFace = {
    id: "open-stop-brace-face-contour",
    closed: true as const,
    points: stopPoints
  };
  const bottomUm = -panelAxisOffsetUm - 6_000;
  const tongueEndUm = stationaryAttachmentRadialUm + thicknessUm;
  const solids: Region2D[] = [
    { outer: stopFace, holes: [] },
    {
      outer: rectangleContour(
        "open-stop-brace-drop",
        0,
        bottomUm,
        2_500,
        -bottomUm,
      ),
      holes: []
    },
    {
      outer: rectangleContour(
        "open-stop-brace-crossbar",
        0,
        bottomUm,
        tongueEndUm,
        2_500,
      ),
      holes: []
    },
    {
      outer: rectangleContour(
        "open-stop-brace-tongue-solid",
        stationaryAttachmentRadialUm,
        bottomUm,
        thicknessUm,
        panelAxisOffsetUm - 1_000 - bottomUm,
      ),
      holes: []
    }
  ];
  const unioned = booleanRegions("union", solids, [], "open-stop-brace-profile");
  if (unioned.length !== 1 || unioned[0]!.holes.length !== 0) {
    throw new Error("The open-stop brace must produce one connected sheet profile.");
  }
  const region: Region2D = {
    outer: { ...unioned[0]!.outer, id: "open-stop-brace-outer" },
    holes: []
  };
  const seat = rectangleContour(
    "open-stop-brace-seat-contour",
    stationaryAttachmentRadialUm,
    -2_000,
    thicknessUm,
    4_000,
  );
  return {
    schemaVersion: "1.0",
    id: "open-stop-brace",
    name: "Open-angle stop brace",
    role: "motion-stop",
    markingCode: "s1",
    materialProfileId: profiles.material.id,
    thicknessUm,
    grainVector: { x: 0, y: 1 },
    nominalRegion: region,
    features: [
      {
        id: "open-stop-brace-face",
        kind: "stop-face",
        operation: "none",
        fitClass: null,
        jointId: null,
        region: { outer: stopFace, holes: [] },
        path: null,
        parametersUm: {
          angleMillidegrees: Math.round(program.mechanism.openAngleDegrees * 1_000)
        }
      },
      {
        id: "open-stop-brace-seat",
        kind: "retainer-seat",
        operation: "none",
        fitClass: "snug",
        jointId: "open-stop-brace-joint",
        region: { outer: seat, holes: [] },
        path: null,
        parametersUm: { engagement: thicknessUm }
      },
      boundaryFeature("open-stop-brace", region)
    ],
    assembledFrame: {
      origin: {
        xUm: centerXUm - Math.floor(thicknessUm / 2),
        yUm: program.mechanism.axis.origin.yUm,
        zUm: program.mechanism.axis.origin.zUm
      },
      xAxis: { x: 0, y: -1, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: 1, y: 0, z: 0 }
    },
    explodedOffset: { xUm: -12_000, yUm: 16_000, zUm: 20_000 },
    assemblyDependencyPartIds: [program.mechanism.stationaryAnchorPartId],
    sourceOperator: RETAINED_PIN_REVOLUTE_OPERATOR
  };
}

function anchorSlots(
  anchor: SheetPart,
  centers: readonly { xUm: number; jointId: string }[],
  axisPoint: { xUm: number; yUm: number; zUm: number },
  thicknessUm: number,
  snugClearanceUm: number,
): { feature: PartFeature; contour: Region2D["outer"] }[] {
  return centers.map(({ xUm, jointId }) => {
    const local = worldToLocal(anchor, {
      xUm,
      yUm: axisPoint.yUm,
      zUm: axisPoint.zUm - 2_000
    });
    const openingUm = thicknessUm + snugClearanceUm;
    const contour = rectangleContour(
      `${jointId}-slot-contour`,
      local.xUm - Math.floor(openingUm / 2),
      local.yUm - 2_000,
      openingUm,
      4_000,
      "cw",
    );
    return {
      contour,
      feature: slotFeature(`${jointId}-slot`, contour, jointId, openingUm)
    };
  });
}

function sectionPolygon(
  part: SheetPart,
  axis: MotionConstraint["axis"],
): { xUm: number; yUm: number }[] {
  return part.nominalRegion.outer.points.map((point) => {
    const world = localToWorld(part, { xUm: point.xUm, yUm: point.yUm, zUm: 0 });
    return {
      xUm: axis.origin.yUm - world.yUm,
      yUm: world.zUm - axis.origin.zUm
    };
  });
}

function maximumSectionRadiusUm(
  parts: readonly SheetPart[],
  axis: MotionConstraint["axis"],
): number {
  return Math.ceil(Math.max(
    ...parts.flatMap((part) =>
      sectionPolygon(part, axis).map((point) => Math.hypot(point.xUm, point.yUm)),
    ),
  ));
}

function fixedJoint(
  id: string,
  insertPartId: string,
  insertFeatureId: string,
  openingPartId: string,
  openingFeatureId: string,
  kind: "rigid-mate" | "retainer-seat",
  snugClearanceUm: number,
): Joint {
  return {
    schemaVersion: "1.0",
    id,
    kind,
    between: [
      { partId: insertPartId, featureId: insertFeatureId },
      { partId: openingPartId, featureId: openingFeatureId }
    ],
    fitClass: "snug",
    nominalClearanceUm: snugClearanceUm,
    insertionDirection: { x: 0, y: 0, z: -1 }
  };
}

function proofModel(
  program: RetainedPinProgramV1,
  axialParts: readonly SheetPart[],
  movingPartIds: ReadonlySet<string>,
  panelAxisOffsetUm: number,
  movingSweptRadiusUm: number,
  thicknessUm: number,
): NonNullable<MotionConstraint["revolute"]>["proofModel"] {
  const panelStartUm = program.mechanism.axis.origin.xUm;
  const panelEndUm = panelStartUm + program.mechanism.panelWidthUm;
  const radialStartUm = panelAxisOffsetUm;
  const movingPanelPrimitive = {
    id: "moving-panel-section",
    ownerId: program.mechanism.movingPanelId,
    behavior: "moving" as const,
    axialStartUm: panelStartUm,
    axialEndUm: panelEndUm,
    polygon: [
      { xUm: radialStartUm, yUm: panelAxisOffsetUm },
      { xUm: radialStartUm + program.mechanism.panelDepthUm, yUm: panelAxisOffsetUm },
      { xUm: radialStartUm + program.mechanism.panelDepthUm, yUm: panelAxisOffsetUm + thicknessUm },
      { xUm: radialStartUm, yUm: panelAxisOffsetUm + thicknessUm }
    ]
  };
  const fixedGeneral = {
    id: "stationary-envelope-section",
    ownerId: program.mechanism.stationaryAnchorPartId,
    behavior: "stationary" as const,
    axialStartUm: panelStartUm,
    axialEndUm: panelEndUm,
    polygon: [
      { xUm: radialStartUm, yUm: -program.mechanism.axis.origin.zUm },
      { xUm: radialStartUm + program.mechanism.panelDepthUm, yUm: -program.mechanism.axis.origin.zUm },
      { xUm: radialStartUm + program.mechanism.panelDepthUm, yUm: panelAxisOffsetUm - 1_000 },
      { xUm: radialStartUm, yUm: panelAxisOffsetUm - 1_000 }
    ]
  };
  const fixedClearance = {
    ...fixedGeneral,
    id: "stationary-slot-clearance-section",
    polygon: fixedGeneral.polygon.map((point) => ({
      ...point,
      yUm: point.yUm === panelAxisOffsetUm - 1_000
        ? panelAxisOffsetUm - movingSweptRadiusUm - 300
        : point.yUm
    }))
  };
  const closedStopPrimitives = [
    {
      id: "closed-stop-left-section",
      ownerId: "left-panel",
      behavior: "stationary" as const,
      axialStartUm: panelStartUm,
      axialEndUm: panelStartUm + thicknessUm,
      polygon: [
        { xUm: radialStartUm, yUm: panelAxisOffsetUm - 1_000 },
        { xUm: radialStartUm + program.mechanism.panelDepthUm, yUm: panelAxisOffsetUm - 1_000 },
        { xUm: radialStartUm + program.mechanism.panelDepthUm, yUm: panelAxisOffsetUm },
        { xUm: radialStartUm, yUm: panelAxisOffsetUm }
      ]
    },
    {
      id: "closed-stop-right-section",
      ownerId: "right-panel",
      behavior: "stationary" as const,
      axialStartUm: panelEndUm - thicknessUm,
      axialEndUm: panelEndUm,
      polygon: [
        { xUm: radialStartUm, yUm: panelAxisOffsetUm - 1_000 },
        { xUm: radialStartUm + program.mechanism.panelDepthUm, yUm: panelAxisOffsetUm - 1_000 },
        { xUm: radialStartUm + program.mechanism.panelDepthUm, yUm: panelAxisOffsetUm },
        { xUm: radialStartUm, yUm: panelAxisOffsetUm }
      ]
    }
  ];
  const axialPrimitives = axialParts.map((part) => {
    const centerXUm = part.assembledFrame.origin.xUm + Math.floor(thicknessUm / 2);
    return {
      id: `${part.id}-section`,
      ownerId: part.id,
      behavior: movingPartIds.has(part.id) ? "moving" as const : "stationary" as const,
      axialStartUm: centerXUm - Math.floor(thicknessUm / 2),
      axialEndUm: centerXUm + Math.ceil(thicknessUm / 2),
      polygon: sectionPolygon(part, program.mechanism.axis)
    };
  });
  const primitives = [
    movingPanelPrimitive,
    fixedGeneral,
    fixedClearance,
    ...closedStopPrimitives,
    ...axialPrimitives
  ];
  const boundaries = [
    panelStartUm,
    panelEndUm,
    ...closedStopPrimitives.flatMap((primitive) => [
      primitive.axialStartUm,
      primitive.axialEndUm
    ]),
    ...axialPrimitives.flatMap((primitive) => [primitive.axialStartUm, primitive.axialEndUm])
  ].filter((value) => value >= panelStartUm && value <= panelEndUm)
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || value !== values[index - 1]);
  const sectionIntervals = boundaries.slice(0, -1).map((startUm, index) => {
    const endUm = boundaries[index + 1]!;
    const middleUm = (startUm + endUm) / 2;
    const activeAxialParts = axialPrimitives.filter(
      (primitive) =>
        middleUm >= primitive.axialStartUm && middleUm <= primitive.axialEndUm,
    );
    const activeClosedStops = closedStopPrimitives.filter(
      (primitive) =>
        middleUm >= primitive.axialStartUm && middleUm <= primitive.axialEndUm,
    );
    const hasMovingLeaf = activeAxialParts.some((primitive) => primitive.behavior === "moving");
    return {
      id: `axis-interval-${String(index + 1)}`,
      axialStartUm: startUm,
      axialEndUm: endUm,
      movingPrimitiveIds: [
        movingPanelPrimitive.id,
        ...activeAxialParts.filter((primitive) => primitive.behavior === "moving").map((primitive) => primitive.id)
      ],
      stationaryPrimitiveIds: [
        hasMovingLeaf ? fixedClearance.id : fixedGeneral.id,
        ...activeClosedStops.map((primitive) => primitive.id),
        ...activeAxialParts.filter((primitive) => primitive.behavior === "stationary").map((primitive) => primitive.id)
      ]
    };
  });
  return {
    method: "axis-partition-conservative-angle-interval",
    assumptionVersion: "1.0.0",
    inflationUm: 100,
    maximumAngleIntervalDegrees: 5,
    animationSampleMaximumDegrees: 2,
    axisPartitionBoundariesUm: boundaries,
    sectionPrimitives: primitives,
    allowedEndpointContacts: [
      ...closedStopPrimitives.map((primitive) => ({
        id: `${primitive.id}-contact`,
        movingPrimitiveId: movingPanelPrimitive.id,
        stationaryPrimitiveId: primitive.id,
        angleDegrees: 0,
        transitionDegrees: 2.5,
        maximumContactGapUm: 10,
        approach: "operator-tangent-stop" as const
      })),
      {
        id: "open-stop-brace-contact",
        movingPrimitiveId: movingPanelPrimitive.id,
        stationaryPrimitiveId: "open-stop-brace-section",
        angleDegrees: program.mechanism.openAngleDegrees,
        transitionDegrees: 2.5,
        maximumContactGapUm: 10,
        approach: "operator-tangent-stop" as const
      }
    ],
    sectionIntervals
  };
}

export async function compileRetainedPinProgram(
  programInput: RetainedPinProgramV1,
  profiles: OrthogonalCompileProfiles,
  inputPolicyEvaluation?: InputPolicyEvaluation,
): Promise<RetainedPinCompileResult> {
  const assessment = assessRetainedPinProgram(programInput);
  if (assessment.status === "concept-only") {
    throw new RetainedPinAssumptionError();
  }
  const program = assessment.program;
  const base = await compileOrthogonalPanelProgram(
    program.supportProgram,
    profiles,
    inputPolicyEvaluation,
  );
  const thicknessUm = mmToUm(profiles.material.measuredThicknessMm);
  const snugClearanceUm = mmToUm(profiles.fit.snug.totalDeltaMm);
  const totalDiametralClearanceUm = mmToUm(profiles.fit.rotating.totalDeltaMm);
  const {
    boreDiameterUm,
    minimumBoreLigamentUm,
    leafRadiusUm,
    panelAxisOffsetUm
  } = retainedPinGeometryDimensions({
    measuredPinDiameterUm: program.mechanism.pin.measuredDiameterUm,
    totalDiametralClearanceUm,
    machineMinimumFeatureUm: mmToUm(profiles.machine.minimumFeatureMm)
  });
  const selected = selectConstruction(program, profiles, leafRadiusUm);
  const movingCenters = selected.centersUm.flatMap((centerXUm, index) =>
    index % 2 === 1
      ? [{ centerXUm, stationNumber: index + 1 }]
      : [],
  );
  const leftGuardCenterUm = selected.guardLeftCenterUm;
  const rightGuardCenterUm = selected.guardRightCenterUm;
  const stationaryCenters = selected.centersUm.filter((_, index) => index % 2 === 0);
  const anchorIndex = base.parts.findIndex(
    (part) => part.id === program.mechanism.stationaryAnchorPartId,
  );
  const anchor = base.parts[anchorIndex]!;
  const stationaryAttachmentRadialUm =
    program.mechanism.axis.origin.yUm - anchor.assembledFrame.origin.yUm;
  const moving = movingPanel(
    program,
    profiles,
    movingCenters,
    panelAxisOffsetUm,
    snugClearanceUm,
  );
  const leafParts = selected.centersUm.map((centerXUm, index) => {
    const isMoving = index % 2 === 1;
    const stationNumber = String(index + 1);
    return leafPart(
      `hinge-station-${stationNumber}`,
      `${isMoving ? "Moving" : "Stationary"} hinge leaf ${stationNumber}`,
      `h${stationNumber}`,
      centerXUm,
      program.mechanism.axis.origin.yUm,
      program.mechanism.axis.origin.zUm,
      leafRadiusUm,
      boreDiameterUm,
      totalDiametralClearanceUm,
      thicknessUm,
      profiles.material.id,
      isMoving,
      panelAxisOffsetUm,
      stationaryAttachmentRadialUm,
      isMoving ? moving.id : program.mechanism.stationaryAnchorPartId,
      `${isMoving ? "moving" : "stationary"}-leaf-seat-${stationNumber}`,
    );
  });
  const retainers = [
    retainerPart(
      "negative",
      leftGuardCenterUm,
      program,
      profiles,
      leafRadiusUm,
      stationaryAttachmentRadialUm,
      program.mechanism.stationaryAnchorPartId,
    ),
    retainerPart(
      "positive",
      rightGuardCenterUm,
      program,
      profiles,
      leafRadiusUm,
      stationaryAttachmentRadialUm,
      program.mechanism.stationaryAnchorPartId,
    )
  ] as const;
  const stopBrace = openStopBrace(
    selected.stopCenterUm,
    program,
    profiles,
    panelAxisOffsetUm,
    stationaryAttachmentRadialUm,
  );
  const movingLeafParts = leafParts.filter((_, index) => index % 2 === 1);
  const movingSweptRadiusUm = maximumSectionRadiusUm(
    movingLeafParts,
    program.mechanism.axis,
  );
  const anchorSeatSpecs = [
    ...stationaryCenters.map((centerXUm, index) => ({
      xUm: centerXUm,
      jointId: `stationary-leaf-seat-${String(index * 2 + 1)}`
    })),
    { xUm: leftGuardCenterUm, jointId: "pin-guard-negative-joint" },
    { xUm: rightGuardCenterUm, jointId: "pin-guard-positive-joint" },
    { xUm: selected.stopCenterUm, jointId: "open-stop-brace-joint" }
  ];
  const updatedAnchor = withHingeClearanceNotches(
    withSlots(
      anchor,
      anchorSlots(
        anchor,
        anchorSeatSpecs,
        program.mechanism.axis.origin,
        thicknessUm,
        snugClearanceUm,
      ),
    ),
    movingCenters.map((station) => station.centerXUm),
    program.mechanism.axis.origin,
    movingSweptRadiusUm,
    panelAxisOffsetUm,
    thicknessUm,
  );
  const parts = [...base.parts];
  parts[anchorIndex] = updatedAnchor;
  for (const stopPartId of ["left-panel", "right-panel"]) {
    const stopPartIndex = parts.findIndex((part) => part.id === stopPartId);
    if (stopPartIndex < 0) {
      throw new Error(`Retained-pin support is missing closed-stop part ${stopPartId}.`);
    }
    parts[stopPartIndex] = withClosedStopFeature(parts[stopPartIndex]!);
  }
  parts.push(moving, ...leafParts, ...retainers, stopBrace);
  parts.sort((left, right) => left.id.localeCompare(right.id));

  const attachmentJoints: Joint[] = leafParts.map((part, index) => {
    const isMoving = index % 2 === 1;
    const jointId = `${isMoving ? "moving" : "stationary"}-leaf-seat-${String(index + 1)}`;
    return fixedJoint(
      jointId,
      part.id,
      `${part.id}-attachment`,
      isMoving ? moving.id : updatedAnchor.id,
      `${jointId}-slot`,
      "rigid-mate",
      snugClearanceUm,
    );
  });
  const retainerJoints = retainers.map((part) =>
    fixedJoint(
      `${part.id}-joint`,
      part.id,
      `${part.id}-seat`,
      updatedAnchor.id,
      `${part.id}-joint-slot`,
      "retainer-seat",
      snugClearanceUm,
    ),
  );
  const stopJoint = fixedJoint(
    "open-stop-brace-joint",
    stopBrace.id,
    "open-stop-brace-seat",
    updatedAnchor.id,
    "open-stop-brace-joint-slot",
    "rigid-mate",
    snugClearanceUm,
  );
  const boreJoints = leafParts.slice(0, -1).map((part, index): Joint => ({
    schemaVersion: "1.0",
    id: `pin-bore-pair-${String(index + 1)}`,
    kind: "pin-bore",
    between: [
      { partId: part.id, featureId: `${part.id}-bore` },
      {
        partId: leafParts[index + 1]!.id,
        featureId: `${leafParts[index + 1]!.id}-bore`
      }
    ],
    fitClass: "rotating",
    nominalClearanceUm: totalDiametralClearanceUm,
    insertionDirection: program.mechanism.axis.direction
  }));
  const joints = [
    ...base.joints,
    ...attachmentJoints,
    ...retainerJoints,
    stopJoint,
    ...boreJoints
  ].sort((left, right) => left.id.localeCompare(right.id));

  const leftInnerFaceUm = leftGuardCenterUm + Math.ceil(thicknessUm / 2);
  const rightInnerFaceUm = rightGuardCenterUm - Math.floor(thicknessUm / 2);
  const retainerGapUm = rightInnerFaceUm - leftInnerFaceUm;
  const pinCutLengthUm = retainerGapUm - program.mechanism.axialEndplayUm;
  const pinId = "measured-hinge-pin";
  const motionId = "retained-pin-axis";
  const pinName = program.mechanism.pin.diameterBasis === "nominal-preset"
    ? "Nominal 3 mm hinge pin"
    : program.mechanism.pin.diameterBasis === "user-reported-caliper"
      ? "Caliper-measured hinge pin"
      : "Reference-gauged toothpick hinge pin";
  const externalStock: ExternalStockItem = {
    schemaVersion: "1.0",
    id: pinId,
    name: pinName,
    kind: program.mechanism.pin.kind,
    stockProfile: {
      id: program.mechanism.pin.stockProfileId,
      sourceLabel: program.mechanism.pin.sourceLabel,
      nominalDiameterUm: program.mechanism.pin.nominalDiameterUm,
      measuredDiameterUm: program.mechanism.pin.measuredDiameterUm,
      measuredMinimumDiameterUm: program.mechanism.pin.measuredMinimumDiameterUm,
      measuredMaximumDiameterUm: program.mechanism.pin.measuredMaximumDiameterUm,
      measurementResolutionUm: 10,
      straightnessEvidence: program.mechanism.pin.straightnessEvidence,
      ...(program.mechanism.pin.diameterBasis === undefined
        ? {}
        : { diameterBasis: program.mechanism.pin.diameterBasis }),
      ...(program.mechanism.pin.referenceGauge === undefined
        ? {}
        : { referenceGauge: program.mechanism.pin.referenceGauge })
    },
    quantity: 1,
    cutLengthUm: pinCutLengthUm,
    pose: {
      origin: {
        xUm: leftInnerFaceUm + Math.floor(program.mechanism.axialEndplayUm / 2),
        yUm: program.mechanism.axis.origin.yUm,
        zUm: program.mechanism.axis.origin.zUm
      },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 }
    },
    interfaceIds: [motionId, ...boreJoints.map((joint) => joint.id)],
    retention: {
      method: "opposed-sheet-guards",
      retainerPartIds: retainers.map((part) => part.id),
      insertionDirection: program.mechanism.axis.direction,
      axialEndplayUm: program.mechanism.axialEndplayUm,
      installationClearanceUm: program.mechanism.installationClearanceUm
    },
    assemblyDependencyPartIds: leafParts.map((part) => part.id),
    evidenceState: program.mechanism.pin.evidenceState
  };
  const movingPartIds = new Set([
    moving.id,
    ...leafParts.filter((_, index) => index % 2 === 1).map((part) => part.id)
  ]);
  const stations = leafParts.map((part, index) => ({
    id: `coaxial-station-${String(index + 1)}`,
    partId: part.id,
    featureId: `${part.id}-bore`,
    axisPoint: {
      xUm: selected.centersUm[index]!,
      yUm: program.mechanism.axis.origin.yUm,
      zUm: program.mechanism.axis.origin.zUm
    },
    axisDirection: program.mechanism.axis.direction,
    axialCenterUm: selected.centersUm[index]!,
    boreDiameterUm,
    boreLigamentUm: leafRadiusUm - Math.ceil(boreDiameterUm / 2)
  }));
  const motionConstraint: MotionConstraint = {
    schemaVersion: "1.0",
    id: motionId,
    kind: "revolute",
    bodyPartIds: [...movingPartIds].sort(),
    axis: program.mechanism.axis,
    range: {
      minimum: 0,
      maximum: program.mechanism.openAngleDegrees,
      unit: "degree"
    },
    revolute: {
      rotationSign: -1,
      pinStockItemId: pinId,
      boreDiameterUm,
      totalDiametralClearanceUm,
      axialEndplayUm: program.mechanism.axialEndplayUm,
      minimumBoreLigamentUm,
      coaxialToleranceUm: 10,
      stations,
      retention: {
        retainerPartIds: retainers.map((part) => part.id),
        installationSide: "negative-axis",
        installationClearanceUm: program.mechanism.installationClearanceUm,
        retainedTravel: {
          minimumDegrees: 0,
          maximumDegrees: program.mechanism.openAngleDegrees
        }
      },
      stops: {
        closed: {
          angleDegrees: 0,
          fixedPartIds: ["left-panel", "right-panel"],
          fixedFeatureIds: ["left-panel-closed-stop", "right-panel-closed-stop"],
          movingPartId: moving.id,
          movingFeatureId: `${moving.id}-closed-stop`,
          contactGapUm: 0
        },
        open: {
          angleDegrees: program.mechanism.openAngleDegrees,
          fixedPartId: stopBrace.id,
          fixedFeatureId: "open-stop-brace-face",
          movingPartId: moving.id,
          movingFeatureId: `${moving.id}-open-stop`,
          contactGapUm: 0
        }
      },
      proofModel: proofModel(
        program,
        [...leafParts, ...retainers, stopBrace],
        movingPartIds,
        panelAxisOffsetUm,
        movingSweptRadiusUm,
        thicknessUm,
      )
    }
  };
  const firstMovingLeafId = leafParts.find((_, index) => index % 2 === 1)!.id;
  const baseActions = base.assemblyPlan.map((action) => ({
    ...action,
    phase: "assembly" as const
  }));
  const lastBaseActionId = baseActions.at(-1)!.id;
  const assemblyPlan = [
    ...baseActions,
    {
      schemaVersion: "1.0" as const,
      id: "seat-hinge-leaves",
      order: baseActions.length,
      action: "insert" as const,
      partIds: [moving.id, ...leafParts.map((part) => part.id)],
      jointIds: attachmentJoints.map((joint) => joint.id),
      direction: { x: 0 as const, y: 0 as const, z: -1 as const },
      dependsOnActionIds: [lastBaseActionId],
      instructionKey: "seat-hinge-leaves",
      phase: "assembly" as const
    },
    {
      schemaVersion: "1.0" as const,
      id: "install-open-stop-brace",
      order: baseActions.length + 1,
      action: "insert" as const,
      partIds: [stopBrace.id],
      jointIds: [stopJoint.id],
      direction: { x: 0 as const, y: 0 as const, z: -1 as const },
      dependsOnActionIds: ["seat-hinge-leaves"],
      instructionKey: "install-open-stop-brace",
      phase: "assembly" as const
    },
    {
      schemaVersion: "1.0" as const,
      id: "insert-measured-pin",
      order: baseActions.length + 2,
      action: "insert" as const,
      partIds: leafParts.map((part) => part.id),
      stockItemIds: [pinId],
      jointIds: boreJoints.map((joint) => joint.id),
      direction: program.mechanism.axis.direction,
      dependsOnActionIds: ["install-open-stop-brace"],
      instructionKey: "insert-retained-pin",
      phase: "assembly" as const
    },
    {
      schemaVersion: "1.0" as const,
      id: "install-pin-guards",
      order: baseActions.length + 3,
      action: "insert" as const,
      partIds: retainers.map((part) => part.id),
      jointIds: retainerJoints.map((joint) => joint.id),
      direction: { x: 0 as const, y: 0 as const, z: -1 as const },
      dependsOnActionIds: ["insert-measured-pin"],
      instructionKey: "install-pin-guards",
      phase: "assembly" as const
    },
    {
      schemaVersion: "1.0" as const,
      id: "verify-revolute-travel",
      order: baseActions.length + 4,
      action: "rotate" as const,
      partIds: [moving.id, firstMovingLeafId],
      jointIds: boreJoints.map((joint) => joint.id),
      direction: null,
      dependsOnActionIds: ["install-pin-guards"],
      instructionKey: "verify-revolute-travel",
      phase: "assembly" as const
    },
    {
      schemaVersion: "1.0" as const,
      id: "remove-left-pin-guard",
      order: baseActions.length + 5,
      action: "remove" as const,
      partIds: [retainers[0].id],
      jointIds: [retainerJoints[0]!.id],
      direction: { x: 0 as const, y: 0 as const, z: 1 as const },
      dependsOnActionIds: ["verify-revolute-travel"],
      instructionKey: "remove-left-pin-guard",
      phase: "disassembly" as const
    },
    {
      schemaVersion: "1.0" as const,
      id: "withdraw-measured-pin",
      order: baseActions.length + 6,
      action: "remove" as const,
      partIds: leafParts.map((part) => part.id),
      stockItemIds: [pinId],
      jointIds: boreJoints.map((joint) => joint.id),
      direction: { x: -1 as const, y: 0 as const, z: 0 as const },
      dependsOnActionIds: ["remove-left-pin-guard"],
      instructionKey: "withdraw-retained-pin",
      phase: "disassembly" as const
    }
  ];
  const operatorProgram = [
    ...base.operatorProgram,
    {
      operatorId: RETAINED_PIN_REVOLUTE_OPERATOR.id,
      operatorVersion: RETAINED_PIN_REVOLUTE_OPERATOR.version,
      parameterHash: await hashCanonical({
        operator: RETAINED_PIN_REVOLUTE_OPERATOR,
        searchPolicy: RETAINED_PIN_SEARCH_POLICY,
        selection: selected.selection,
        mechanism: program.mechanism,
        boreDiameterUm,
        leafRadiusUm,
        pinCutLengthUm
      })
    }
  ];
  const inputDigest = await hashCanonical({ program, profiles });
  const provisional = DesignDocumentV1Schema.parse({
    ...base,
    projectId: program.projectId,
    request: {
      ...base.request,
      requestId: `${program.projectId}-request`,
      title: program.title,
      description: program.description,
      envelopeMm: {
        x: umToMm(program.mechanism.panelWidthUm),
        y: umToMm(program.mechanism.panelDepthUm + leafRadiusUm * 2),
        z: base.request.envelopeMm.z + umToMm(leafRadiusUm * 2)
      }
    },
    intent: {
      ...base.intent,
      fixtureId: `${program.programId}-intent`,
      title: program.title,
      coreIntent: "Compose a rigid moving panel with one retained wooden-pin revolute interface through a reusable deterministic operator.",
      topology: {
        bodies: [
          ...("topology" in base.intent ? base.intent.topology.bodies : []),
          {
            id: moving.id,
            role: "moving-panel" as const,
            quantity: 1,
            shapeClass: "planar" as const
          },
          {
            id: pinId,
            role: "connector" as const,
            quantity: 1,
            shapeClass: "rod" as const
          }
        ],
        interfaces: [
          ...("topology" in base.intent ? base.intent.topology.interfaces : []),
          {
            id: `${motionId}-interface`,
            between: [program.mechanism.stationaryAnchorPartId, moving.id] as [string, string],
            behavior: "revolute" as const,
            function: "A measured wooden pin passes through alternating coaxial plywood stations with geometric axial guards and explicit stops."
          }
        ]
      }
    },
    resolvedInputs: {
      ...base.resolvedInputs,
      hardwarePolicy: {
        glueAllowed: false as const,
        permittedKinds: ["sheet-part" as const, "wooden-pin" as const]
      }
    },
    operatorProgram,
    parts,
    externalStock: [externalStock],
    joints,
    motionConstraints: [motionConstraint],
    assemblyPlan,
    constructionSelections: [selected.selection],
    validation: { schemaVersion: "1.0", status: "pass", findings: [] },
    provenance: {
      ...base.provenance,
      inputDigest,
      operatorVersions: {
        ...base.provenance.operatorVersions,
        [RETAINED_PIN_REVOLUTE_OPERATOR.id]: RETAINED_PIN_REVOLUTE_OPERATOR.version
      },
      deterministicSeed: program.deterministicSeed
    }
  });
  const mechanism = validateRetainedPinMechanism(provisional);
  const validation = mergeReports(
    validateParts(parts, {
      minimumWebUm: mmToUm(profiles.machine.minimumFeatureMm),
      compensationXUm: Math.round(mmToUm(profiles.processRecipe.cutWidth.xMm) / 2),
      compensationYUm: Math.round(mmToUm(profiles.processRecipe.cutWidth.yMm) / 2)
    }),
    validateOrthogonalAssembly(provisional),
    mechanism.validation,
  );
  return {
    document: DesignDocumentV1Schema.parse({ ...provisional, validation }),
    proofReports: mechanism.proofReports
  };
}

export type RetainedPinProfiles = {
  material: MaterialProfile;
  machine: MachineProfile;
  processRecipe: OrthogonalCompileProfiles["processRecipe"];
  fabricationContext: OrthogonalCompileProfiles["fabricationContext"];
  fit: FitProfile;
};
