import {
  CapturedSlideProgramV1Schema,
  DesignDocumentV1Schema,
  type CapturedSlideProgramV1,
  type DesignDocumentV1,
  type InputPolicyEvaluation,
  type Joint,
  type MotionConstraint,
  type PartFeature,
  type Region2D,
  type SheetPart,
  type ValidationReport
} from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import { mmToUm, umToMm } from "../domain/units.js";
import { booleanRegions } from "../kernel/geometry/clipper-adapter.js";
import { boundsUm } from "../kernel/geometry/metrics.js";
import { validateOrthogonalAssembly } from "../validation/assembly.js";
import { validateParts } from "../validation/geometry.js";
import {
  validateCapturedPanelSlide,
  type PrismaticProofReport
} from "../validation/prismatic.js";
import { derivePrismaticForbiddenIntervals } from "../validation/prismatic-proof.js";

import {
  compileOrthogonalPanelProgram,
  type OrthogonalCompileProfiles
} from "./orthogonal-compiler.js";
import { rectangleContour, worldToLocal } from "./orthogonal-model.js";

export const CAPTURED_PANEL_SLIDE_OPERATOR = {
  id: "captured-panel-slide",
  version: "1.0.0"
} as const;

export class CapturedSlideAssumptionError extends Error {
  readonly code = "PRISMATIC_ASSUMPTION_UNSUPPORTED";
  readonly outcome = "concept-only" as const;

  constructor() {
    super(
      "The requested prismatic geometry is outside captured-panel-slide@1.0.0's negative-Y axis/transverse-section assumptions; fabrication export is withheld.",
    );
  }
}

export function assessCapturedSlideProgram(value: unknown):
  | { status: "supported"; program: CapturedSlideProgramV1 }
  | {
      status: "concept-only";
      code: "PRISMATIC_ASSUMPTION_UNSUPPORTED";
      message: string;
    } {
  const result = CapturedSlideProgramV1Schema.safeParse(value);
  if (result.success) return { status: "supported", program: result.data };
  if (
    result.error.issues.some(
      (issue) =>
        issue.path.join(".") === "mechanism.axis.direction" &&
        issue.message.includes("negative-Y axis/transverse-section"),
    )
  ) {
    const error = new CapturedSlideAssumptionError();
    return { status: "concept-only", code: error.code, message: error.message };
  }
  throw result.error;
}

export type CapturedSlideCompileResult = {
  document: DesignDocumentV1;
  proofReports: PrismaticProofReport[];
};

function mergeReports(...reports: readonly ValidationReport[]): ValidationReport {
  const findings = reports.flatMap((report) => report.findings);
  return {
    schemaVersion: "1.0",
    status: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    findings
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

function regionFeature(
  id: string,
  kind: PartFeature["kind"],
  region: Region2D,
  jointId: string | null,
  fitClass: PartFeature["fitClass"] = null,
  parametersUm: Record<string, number> = {},
): PartFeature {
  return {
    id,
    kind,
    operation: "none",
    fitClass,
    jointId,
    region,
    path: null,
    parametersUm
  };
}

function cutSlotFeature(
  id: string,
  contour: Region2D["outer"],
  jointId: string,
): PartFeature {
  return {
    id,
    kind: "slot",
    operation: "cut",
    fitClass: "snug",
    jointId,
    region: { outer: contour, holes: [] },
    path: null,
    parametersUm: { opening: 0 }
  };
}

type GuideGeometry = {
  lowerZUm: number;
  leftInnerXUm: number;
  rightInnerXUm: number;
  overlapUm: number;
  lengthUm: number;
  tabStationsUm: readonly number[];
  tabWidthUm: number;
};

function guidePart(
  side: "left" | "right",
  program: CapturedSlideProgramV1,
  profiles: OrthogonalCompileProfiles,
  geometry: GuideGeometry,
): SheetPart {
  const thicknessUm = mmToUm(profiles.material.measuredThicknessMm);
  const id = `${side}-guide`;
  const right = side === "right";
  const bodyStartYUm = right ? 0 : thicknessUm;
  const body = {
    outer: rectangleContour(
      `${id}-body-contour`,
      0,
      bodyStartYUm,
      geometry.lengthUm,
      geometry.overlapUm,
    ),
    holes: []
  };
  const tabs = geometry.tabStationsUm.map((stationUm, index) => {
    const tabYUm = right ? geometry.overlapUm : 0;
    const stem = {
      outer: rectangleContour(
        `${id}-tab-${String(index + 1)}-stem`,
        stationUm - Math.floor(geometry.tabWidthUm / 2),
        tabYUm,
        geometry.tabWidthUm,
        thicknessUm,
      ),
      holes: []
    };
    const head = {
      outer: rectangleContour(
        `${id}-tab-${String(index + 1)}-head`,
        stationUm - Math.floor(geometry.tabWidthUm / 2) - 1_000,
        right ? tabYUm + thicknessUm - 1_000 : tabYUm,
        geometry.tabWidthUm + 2_000,
        1_000,
      ),
      holes: []
    };
    return { stem, head };
  });
  const unioned = booleanRegions(
    "union",
    [body, ...tabs.flatMap((tab) => [tab.stem, tab.head])],
    [],
    `${id}-profile`,
  );
  if (unioned.length !== 1 || unioned[0]!.holes.length !== 0) {
    throw new Error(`Guide ${id} must remain one connected hole-free sheet part.`);
  }
  const region = {
    outer: { ...unioned[0]!.outer, id: `${id}-outer` },
    holes: []
  };
  const originXUm = right
    ? geometry.rightInnerXUm - geometry.overlapUm
    : geometry.leftInnerXUm - thicknessUm;
  return {
    schemaVersion: "1.0",
    id,
    name: `${side === "left" ? "Left" : "Right"} captured guide cap`,
    role: "guide-rail",
    markingCode: side === "left" ? "g1" : "g2",
    materialProfileId: profiles.material.id,
    thicknessUm,
    grainVector: { x: 1, y: 0 },
    nominalRegion: region,
    features: [
      ...tabs.map((tab, index) =>
        regionFeature(
          `${id}-mount-${String(index + 1)}`,
          "retainer-seat",
          tab.stem,
          `${id}-mount-${String(index + 1)}`,
          "snug",
          { headedTab: 1, engagement: thicknessUm },
        ),
      ),
      regionFeature(
        `${id}-capture-face`,
        "capture-face",
        body,
        `${id}-captured-interface`,
        "sliding",
        { overlap: geometry.overlapUm },
      ),
      boundaryFeature(id, region)
    ],
    assembledFrame: {
      origin: {
        xUm: originXUm,
        yUm: program.mechanism.axis.origin.yUm,
        zUm: geometry.lowerZUm
      },
      xAxis: { x: 0, y: -1, z: 0 },
      yAxis: { x: 1, y: 0, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 }
    },
    explodedOffset: {
      xUm: side === "left" ? -24_000 : 24_000,
      yUm: 0,
      zUm: 28_000
    },
    assemblyDependencyPartIds: [side === "left" ? "left-panel" : "right-panel"],
    sourceOperator: CAPTURED_PANEL_SLIDE_OPERATOR
  };
}

function withGuideMounts(
  part: SheetPart,
  side: "left" | "right",
  program: CapturedSlideProgramV1,
  geometry: GuideGeometry,
  thicknessUm: number,
): SheetPart {
  const bounds = boundsUm(part.nominalRegion.outer.points);
  const slotCenters = geometry.tabStationsUm.map((stationUm) => {
    const worldYUm = program.mechanism.axis.origin.yUm - stationUm;
    return worldToLocal(part, {
      xUm: side === "left" ? part.assembledFrame.origin.xUm : part.assembledFrame.origin.xUm,
      yUm: worldYUm,
      zUm: geometry.lowerZUm + Math.floor(thicknessUm / 2)
    });
  });
  const earWidthUm = geometry.tabWidthUm + 4_000;
  const earTopUm = geometry.lowerZUm + thicknessUm + 2_000;
  const ears = slotCenters.map((center, index) => ({
    outer: rectangleContour(
      `${part.id}-guide-ear-${String(index + 1)}`,
      center.xUm - Math.floor(earWidthUm / 2),
      bounds.maxYUm,
      earWidthUm,
      earTopUm - bounds.maxYUm,
    ),
    holes: []
  }));
  const unioned = booleanRegions(
    "union",
    [part.nominalRegion, ...ears],
    [],
    `${part.id}-guide-ear-union`,
  );
  if (unioned.length !== 1) {
    throw new Error(`Guide mounting ears must preserve one connected ${part.id} region.`);
  }
  const slots = slotCenters.map((center, index) => rectangleContour(
    `${part.id}-guide-slot-${String(index + 1)}-contour`,
    center.xUm - Math.floor(geometry.tabWidthUm / 2),
    geometry.lowerZUm,
    geometry.tabWidthUm,
    thicknessUm,
    "cw",
  ));
  const region: Region2D = {
    outer: { ...unioned[0]!.outer, id: `${part.id}-outer-with-guide-ears` },
    holes: [...unioned[0]!.holes, ...slots]
  };
  return {
    ...part,
    nominalRegion: region,
    features: [
      ...slots.map((slot, index) =>
        cutSlotFeature(
          `${part.id}-guide-slot-${String(index + 1)}`,
          slot,
          `${side}-guide-mount-${String(index + 1)}`,
        ),
      ),
      ...part.features.map((feature) =>
        feature.kind === "outer-boundary" ? { ...feature, region } : feature,
      )
    ]
  };
}

function withClosedStopHorn(
  part: SheetPart,
  program: CapturedSlideProgramV1,
  panelBottomZUm: number,
  panelTopZUm: number,
): SheetPart {
  const centerWorldXUm =
    program.mechanism.axis.origin.xUm + Math.floor(program.mechanism.panelWidthUm / 2);
  const center = worldToLocal(part, {
    xUm: centerWorldXUm,
    yUm: program.mechanism.axis.origin.yUm,
    zUm: panelBottomZUm
  });
  const horn = {
    outer: rectangleContour(
      `${part.id}-closed-stop-horn-contour`,
      center.xUm - 6_000,
      boundsUm(part.nominalRegion.outer.points).maxYUm,
      12_000,
      panelTopZUm - boundsUm(part.nominalRegion.outer.points).maxYUm,
    ),
    holes: []
  };
  const stopFace = {
    outer: rectangleContour(
      `${part.id}-closed-stop-face-contour`,
      center.xUm - 5_000,
      panelBottomZUm,
      10_000,
      panelTopZUm - panelBottomZUm,
    ),
    holes: []
  };
  const unioned = booleanRegions(
    "union",
    [part.nominalRegion, horn],
    [],
    `${part.id}-closed-stop-union`,
  );
  if (unioned.length !== 1) {
    throw new Error("The closed-stop horn must remain integral with its support wall.");
  }
  const region: Region2D = {
    outer: { ...unioned[0]!.outer, id: `${part.id}-outer-with-closed-stop` },
    holes: unioned[0]!.holes
  };
  return {
    ...part,
    nominalRegion: region,
    features: [
      regionFeature(
        `${part.id}-closed-stop-face`,
        "stop-face",
        stopFace,
        null,
        null,
        { contactGap: 0 },
      ),
      ...part.features.map((feature) =>
        feature.kind === "outer-boundary" ? { ...feature, region } : feature,
      )
    ]
  };
}

function movingPanel(
  program: CapturedSlideProgramV1,
  profiles: OrthogonalCompileProfiles,
): SheetPart {
  const thicknessUm = mmToUm(profiles.material.measuredThicknessMm);
  const id = program.mechanism.movingPanelId;
  const body = {
    outer: rectangleContour(
      `${id}-body-contour`,
      0,
      0,
      program.mechanism.panelWidthUm,
      program.mechanism.panelDepthUm,
    ),
    holes: []
  };
  const stopLug = {
    outer: rectangleContour(`${id}-open-stop-lug-contour`, -1_000, 0, 1_000, 3_000),
    holes: []
  };
  const withLug = booleanRegions(
    "union",
    [body, stopLug],
    [],
    `${id}-lug-union`,
  );
  const thumbCutout = {
    outer: rectangleContour(
      `${id}-thumb-access-contour`,
      Math.floor((program.mechanism.panelWidthUm - program.mechanism.thumbAccessWidthUm) / 2),
      program.mechanism.panelDepthUm - program.mechanism.thumbAccessDepthUm,
      program.mechanism.thumbAccessWidthUm,
      program.mechanism.thumbAccessDepthUm + 1_000,
    ),
    holes: []
  };
  const cut = booleanRegions(
    "difference",
    withLug,
    [thumbCutout],
    `${id}-thumb-cut`,
  );
  if (cut.length !== 1 || cut[0]!.holes.length !== 0) {
    throw new Error("The captured moving panel must remain one connected hole-free region.");
  }
  const region: Region2D = {
    outer: { ...cut[0]!.outer, id: `${id}-outer` },
    holes: []
  };
  const leftCapture = {
    outer: rectangleContour(`${id}-left-capture-contour`, 0, 0, 1_000, program.mechanism.panelDepthUm),
    holes: []
  };
  const rightCapture = {
    outer: rectangleContour(
      `${id}-right-capture-contour`,
      program.mechanism.panelWidthUm - 1_000,
      0,
      1_000,
      program.mechanism.panelDepthUm,
    ),
    holes: []
  };
  const closedStop = {
    outer: rectangleContour(
      `${id}-closed-stop-contour`,
      Math.floor(program.mechanism.panelWidthUm / 2) - 5_000,
      0,
      10_000,
      1_000,
    ),
    holes: []
  };
  return {
    schemaVersion: "1.0",
    id,
    name: program.mechanism.movingPanelName,
    role: "moving-panel",
    markingCode: program.mechanism.movingPanelMarkingCode,
    materialProfileId: profiles.material.id,
    thicknessUm,
    grainVector: { x: 1, y: 0 },
    nominalRegion: region,
    features: [
      regionFeature(
        `${id}-thumb-access`,
        "thumb-access",
        thumbCutout,
        null,
        null,
        {
          width: program.mechanism.thumbAccessWidthUm,
          depth: program.mechanism.thumbAccessDepthUm
        },
      ),
      regionFeature(`${id}-closed-stop`, "stop-face", closedStop, null),
      regionFeature(`${id}-open-stop`, "stop-face", stopLug, null),
      regionFeature(
        `${id}-left-capture`,
        "capture-face",
        leftCapture,
        "left-guide-captured-interface",
        "sliding",
      ),
      regionFeature(
        `${id}-right-capture`,
        "capture-face",
        rightCapture,
        "right-guide-captured-interface",
        "sliding",
      ),
      boundaryFeature(id, region)
    ],
    assembledFrame: {
      origin: program.mechanism.axis.origin,
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: -1, z: 0 },
      zAxis: { x: 0, y: 0, z: -1 }
    },
    explodedOffset: { xUm: 0, yUm: -36_000, zUm: 46_000 },
    assemblyDependencyPartIds: ["left-guide", "right-guide", "travel-stop-key"],
    sourceOperator: CAPTURED_PANEL_SLIDE_OPERATOR
  };
}

function stopKey(
  program: CapturedSlideProgramV1,
  profiles: OrthogonalCompileProfiles,
  leftGuideInnerXUm: number,
  panelBottomZUm: number,
): SheetPart {
  const thicknessUm = mmToUm(profiles.material.measuredThicknessMm);
  const id = "travel-stop-key";
  const stem = {
    outer: rectangleContour(`${id}-stem`, 0, 0, 3_000, 6_000),
    holes: []
  };
  const head = {
    outer: rectangleContour(`${id}-head`, -1_000, 6_000, 5_000, 3_000),
    holes: []
  };
  const unioned = booleanRegions("union", [stem, head], [], `${id}-profile`);
  if (unioned.length !== 1) throw new Error("The removable travel stop must remain connected.");
  const region: Region2D = {
    outer: { ...unioned[0]!.outer, id: `${id}-outer` },
    holes: []
  };
  const keyAxialStartUm = program.mechanism.normalTravelUm + 3_000;
  return {
    schemaVersion: "1.0",
    id,
    name: "Removable travel-stop key",
    role: "retainer",
    markingCode: "k1",
    materialProfileId: profiles.material.id,
    thicknessUm,
    grainVector: { x: 0, y: 1 },
    nominalRegion: region,
    features: [
      regionFeature(`${id}-seat`, "retainer-seat", stem, `${id}-joint`, "snug"),
      regionFeature(`${id}-open-stop-face`, "stop-face", stem, null),
      boundaryFeature(id, region)
    ],
    assembledFrame: {
      origin: {
        xUm: leftGuideInnerXUm,
        yUm: program.mechanism.axis.origin.yUm - keyAxialStartUm,
        zUm: panelBottomZUm
      },
      xAxis: { x: 0, y: -1, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: -1, y: 0, z: 0 }
    },
    explodedOffset: { xUm: -12_000, yUm: 0, zUm: 34_000 },
    assemblyDependencyPartIds: ["left-guide"],
    sourceOperator: CAPTURED_PANEL_SLIDE_OPERATOR
  };
}

function fixedJoint(
  id: string,
  firstPartId: string,
  firstFeatureId: string,
  secondPartId: string,
  secondFeatureId: string,
  kind: "retainer-seat" | "captured-slide",
  clearanceUm = 0,
): Joint {
  return {
    schemaVersion: "1.0",
    id,
    kind,
    between: [
      { partId: firstPartId, featureId: firstFeatureId },
      { partId: secondPartId, featureId: secondFeatureId }
    ],
    fitClass: kind === "captured-slide" ? "sliding" : "snug",
    nominalClearanceUm: clearanceUm,
    insertionDirection: kind === "captured-slide"
      ? { x: 0, y: 1, z: 0 }
      : { x: 0, y: 0, z: -1 }
  };
}

function transverseRect(
  id: string,
  minimumXUm: number,
  minimumZUm: number,
  maximumXUm: number,
  maximumZUm: number,
): Region2D {
  return {
    outer: rectangleContour(
      `${id}-transverse`,
      minimumXUm,
      minimumZUm,
      maximumXUm - minimumXUm,
      maximumZUm - minimumZUm,
    ),
    holes: []
  };
}

export async function compileCapturedSlideProgram(
  programInput: CapturedSlideProgramV1,
  profiles: OrthogonalCompileProfiles,
  inputPolicyEvaluation?: InputPolicyEvaluation,
): Promise<CapturedSlideCompileResult> {
  const assessment = assessCapturedSlideProgram(programInput);
  if (assessment.status === "concept-only") throw new CapturedSlideAssumptionError();
  const program = assessment.program;
  const base = await compileOrthogonalPanelProgram(
    program.supportProgram,
    profiles,
    inputPolicyEvaluation,
  );
  const thicknessUm = mmToUm(profiles.material.measuredThicknessMm);
  const lowerClearanceUm = Math.floor(program.mechanism.verticalRunningClearanceUm / 2);
  const upperClearanceUm = program.mechanism.verticalRunningClearanceUm - lowerClearanceUm;
  const leftClearanceUm = Math.floor(program.mechanism.lateralRunningClearanceUm / 2);
  const rightClearanceUm = program.mechanism.lateralRunningClearanceUm - leftClearanceUm;
  const panelTopZUm = program.mechanism.axis.origin.zUm;
  const panelBottomZUm = panelTopZUm - thicknessUm;
  const lowerSupportMaximumZUm = panelBottomZUm - lowerClearanceUm;
  const guideLowerZUm = panelTopZUm + upperClearanceUm;
  const leftGuideInnerXUm = program.mechanism.axis.origin.xUm - leftClearanceUm;
  const panelMaximumXUm = program.mechanism.axis.origin.xUm + program.mechanism.panelWidthUm;
  const rightGuideInnerXUm = panelMaximumXUm + rightClearanceUm;
  const guideOverlapUm = Math.max(thicknessUm + 700, 3_700);
  const guideGeometry: GuideGeometry = {
    lowerZUm: guideLowerZUm,
    leftInnerXUm: leftGuideInnerXUm,
    rightInnerXUm: rightGuideInnerXUm,
    overlapUm: guideOverlapUm,
    lengthUm: program.mechanism.panelDepthUm,
    tabStationsUm: [
      Math.round(program.mechanism.panelDepthUm * 0.28),
      Math.round(program.mechanism.panelDepthUm * 0.7)
    ],
    tabWidthUm: 6_000
  };
  const guides = [
    guidePart("left", program, profiles, guideGeometry),
    guidePart("right", program, profiles, guideGeometry)
  ] as const;
  const moving = movingPanel(program, profiles);
  const key = stopKey(program, profiles, leftGuideInnerXUm, panelBottomZUm);

  const parts = [...base.parts];
  for (const side of ["left", "right"] as const) {
    const partId = `${side}-panel`;
    const index = parts.findIndex((part) => part.id === partId);
    if (index < 0) throw new Error(`Captured slide support is missing ${partId}.`);
    parts[index] = withGuideMounts(
      parts[index]!,
      side,
      program,
      guideGeometry,
      thicknessUm,
    );
  }
  const rearIndex = parts.findIndex((part) => part.id === "rear-panel");
  if (rearIndex < 0) throw new Error("Captured slide support is missing rear-panel.");
  parts[rearIndex] = withClosedStopHorn(
    parts[rearIndex]!,
    program,
    panelBottomZUm,
    panelTopZUm,
  );
  parts.push(moving, ...guides, key);
  parts.sort((left, right) => left.id.localeCompare(right.id));

  const guideMountJoints = guides.flatMap((guide) =>
    [1, 2].map((number) => fixedJoint(
      `${guide.id}-mount-${String(number)}`,
      guide.id,
      `${guide.id}-mount-${String(number)}`,
      guide.id === "left-guide" ? "left-panel" : "right-panel",
      `${guide.id === "left-guide" ? "left-panel" : "right-panel"}-guide-slot-${String(number)}`,
      "retainer-seat",
    )),
  );
  const keyJoint = fixedJoint(
    "travel-stop-key-joint",
    key.id,
    `${key.id}-seat`,
    guides[0].id,
    `${guides[0].id}-capture-face`,
    "retainer-seat",
  );
  const captureJoints = guides.map((guide) => fixedJoint(
    `${guide.id}-captured-interface`,
    moving.id,
    `${moving.id}-${guide.id === "left-guide" ? "left" : "right"}-capture`,
    guide.id,
    `${guide.id}-capture-face`,
    "captured-slide",
    program.mechanism.lateralRunningClearanceUm,
  ));
  const joints = [
    ...base.joints,
    ...guideMountJoints,
    keyJoint,
    ...captureJoints
  ].sort((left, right) => left.id.localeCompare(right.id));

  const bodyPrimitive = {
    id: "moving-panel-body-proof",
    ownerId: moving.id,
    featureId: `${moving.id}-boundary`,
    behavior: "moving" as const,
    axialStartUm: 0,
    axialEndUm: program.mechanism.panelDepthUm,
    transverseRegion: transverseRect(
      "moving-panel-body-proof",
      program.mechanism.axis.origin.xUm,
      panelBottomZUm,
      panelMaximumXUm,
      panelTopZUm,
    )
  };
  const lugPrimitive = {
    id: "moving-open-stop-lug-proof",
    ownerId: moving.id,
    featureId: `${moving.id}-open-stop`,
    behavior: "moving" as const,
    axialStartUm: 0,
    axialEndUm: 3_000,
    transverseRegion: transverseRect(
      "moving-open-stop-lug-proof",
      program.mechanism.axis.origin.xUm - 1_000,
      panelBottomZUm,
      program.mechanism.axis.origin.xUm,
      panelTopZUm,
    )
  };
  const rearStopPrimitive = {
    id: "closed-wall-stop-proof",
    ownerId: "rear-panel",
    featureId: "rear-panel-closed-stop-face",
    behavior: "stationary" as const,
    axialStartUm: 0 - thicknessUm,
    axialEndUm: 0,
    transverseRegion: transverseRect(
      "closed-wall-stop-proof",
      program.mechanism.axis.origin.xUm + Math.floor(program.mechanism.panelWidthUm / 2) - 5_000,
      panelBottomZUm,
      program.mechanism.axis.origin.xUm + Math.floor(program.mechanism.panelWidthUm / 2) + 5_000,
      panelTopZUm,
    )
  };
  const keyAxialStartUm = program.mechanism.normalTravelUm + 3_000;
  const keyPrimitive = {
    id: "open-key-stop-proof",
    ownerId: key.id,
    featureId: `${key.id}-open-stop-face`,
    behavior: "stationary" as const,
    axialStartUm: keyAxialStartUm,
    axialEndUm: keyAxialStartUm + 3_000,
    transverseRegion: transverseRect(
      "open-key-stop-proof",
      leftGuideInnerXUm - thicknessUm,
      panelBottomZUm,
      leftGuideInnerXUm,
      panelTopZUm,
    )
  };
  const supportPrimitives = [
    {
      id: "left-lower-support-proof",
      ownerId: "left-panel",
      featureId: null,
      behavior: "stationary" as const,
      axialStartUm: 0,
      axialEndUm: program.mechanism.panelDepthUm,
      transverseRegion: transverseRect(
        "left-lower-support-proof",
        leftGuideInnerXUm - thicknessUm,
        0,
        leftGuideInnerXUm,
        lowerSupportMaximumZUm,
      )
    },
    {
      id: "right-lower-support-proof",
      ownerId: "right-panel",
      featureId: null,
      behavior: "stationary" as const,
      axialStartUm: 0,
      axialEndUm: program.mechanism.panelDepthUm,
      transverseRegion: transverseRect(
        "right-lower-support-proof",
        rightGuideInnerXUm,
        0,
        rightGuideInnerXUm + thicknessUm,
        lowerSupportMaximumZUm,
      )
    },
    {
      id: "left-upper-guide-proof",
      ownerId: guides[0].id,
      featureId: `${guides[0].id}-capture-face`,
      behavior: "stationary" as const,
      axialStartUm: 0,
      axialEndUm: program.mechanism.panelDepthUm,
      transverseRegion: transverseRect(
        "left-upper-guide-proof",
        leftGuideInnerXUm,
        guideLowerZUm,
        leftGuideInnerXUm + guideOverlapUm,
        guideLowerZUm + thicknessUm,
      )
    },
    {
      id: "right-upper-guide-proof",
      ownerId: guides[1].id,
      featureId: `${guides[1].id}-capture-face`,
      behavior: "stationary" as const,
      axialStartUm: 0,
      axialEndUm: program.mechanism.panelDepthUm,
      transverseRegion: transverseRect(
        "right-upper-guide-proof",
        rightGuideInnerXUm - guideOverlapUm,
        guideLowerZUm,
        rightGuideInnerXUm,
        guideLowerZUm + thicknessUm,
      )
    }
  ];
  const motionId = "captured-slide-axis";
  const rawConstraint: MotionConstraint = {
    schemaVersion: "1.0",
    id: motionId,
    kind: "prismatic",
    bodyPartIds: [moving.id],
    axis: program.mechanism.axis,
    range: {
      minimum: 0,
      maximum: umToMm(program.mechanism.normalTravelUm),
      unit: "mm"
    },
    prismatic: {
      normalTravelUm: { minimum: 0, maximum: program.mechanism.normalTravelUm },
      states: {
        closedUm: 0,
        fullyOpenUm: program.mechanism.normalTravelUm,
        removal: {
          positionUm: program.mechanism.removalTravelUm,
          requiresRetainerRemoval: true,
          retainerPartIds: [key.id]
        }
      },
      runningClearance: {
        verticalTotalUm: program.mechanism.verticalRunningClearanceUm,
        lateralTotalUm: program.mechanism.lateralRunningClearanceUm,
        projectedFinishedVerticalUm: program.mechanism.verticalRunningClearanceUm,
        projectedFinishedLateralUm: program.mechanism.lateralRunningClearanceUm,
        compensationMethod: "nominal-boundary-reconstruction"
      },
      capture: {
        vertical: {
          lowerSupportMaximumZUm,
          panelMinimumZUm: panelBottomZUm,
          panelMaximumZUm: panelTopZUm,
          upperRetainerMinimumZUm: guideLowerZUm,
          lowerClearanceUm,
          upperClearanceUm,
          retainerOverlapUm: guideOverlapUm
        },
        lateral: {
          leftGuideInnerXUm,
          panelMinimumXUm: program.mechanism.axis.origin.xUm,
          panelMaximumXUm,
          rightGuideInnerXUm,
          leftClearanceUm,
          rightClearanceUm,
          guideOverlapUm
        },
        railEngagement: guides.map((guide) => ({
          guidePartId: guide.id,
          movingAxialStartUm: 0,
          movingAxialEndUm: program.mechanism.panelDepthUm,
          guideAxialStartUm: 0,
          guideAxialEndUm: program.mechanism.panelDepthUm,
          minimumRequiredUm: program.mechanism.minimumGuideEngagementUm
        }))
      },
      stops: {
        closed: {
          positionUm: 0,
          fixedPartId: "rear-panel",
          fixedFeatureId: "rear-panel-closed-stop-face",
          movingPartId: moving.id,
          movingFeatureId: `${moving.id}-closed-stop`,
          contactGapUm: 0,
          wallThicknessUm: thicknessUm
        },
        open: {
          positionUm: program.mechanism.normalTravelUm,
          fixedPartId: key.id,
          fixedFeatureId: `${key.id}-open-stop-face`,
          movingPartId: moving.id,
          movingFeatureId: `${moving.id}-open-stop`,
          contactGapUm: 0
        }
      },
      retention: {
        guidePartIds: guides.map((guide) => guide.id),
        removableRetainerPartIds: [key.id],
        mechanicalJointIds: [...guideMountJoints.map((joint) => joint.id), keyJoint.id],
        method: "headed-tabs-and-keyed-stop",
        glueRequired: false
      },
      thumbAccess: {
        partId: moving.id,
        featureId: `${moving.id}-thumb-access`,
        widthUm: program.mechanism.thumbAccessWidthUm,
        depthUm: program.mechanism.thumbAccessDepthUm
      },
      proofModel: {
        method: "transverse-overlap-axial-forbidden-intervals",
        assumptionVersion: "1.0.0",
        transverseInflationUm: 100,
        animationSampleMaximumUm: 1_000,
        movingPrimitives: [bodyPrimitive, lugPrimitive],
        stationaryPrimitives: [rearStopPrimitive, keyPrimitive, ...supportPrimitives],
        forbiddenIntervals: [],
        allowedEndpointContacts: [
          {
            id: "closed-wall-contact",
            movingPrimitiveId: bodyPrimitive.id,
            stationaryPrimitiveId: rearStopPrimitive.id,
            positionUm: 0,
            contactGapUm: 0
          },
          {
            id: "open-key-contact",
            movingPrimitiveId: lugPrimitive.id,
            stationaryPrimitiveId: keyPrimitive.id,
            positionUm: program.mechanism.normalTravelUm,
            contactGapUm: 0
          }
        ]
      }
    }
  };
  const forbiddenIntervals = derivePrismaticForbiddenIntervals(rawConstraint);
  const motionConstraint: MotionConstraint = {
    ...rawConstraint,
    prismatic: {
      ...rawConstraint.prismatic!,
      proofModel: {
        ...rawConstraint.prismatic!.proofModel,
        forbiddenIntervals
      }
    }
  };

  const baseActions = base.assemblyPlan.map((action) => ({
    ...action,
    phase: "assembly" as const
  }));
  const lastBaseActionId = baseActions.at(-1)!.id;
  const assemblyPlan = [
    ...baseActions,
    {
      schemaVersion: "1.0" as const,
      id: "install-captured-guides",
      order: baseActions.length,
      action: "insert" as const,
      partIds: guides.map((guide) => guide.id),
      jointIds: guideMountJoints.map((joint) => joint.id),
      direction: { x: 0 as const, y: 0 as const, z: -1 as const },
      dependsOnActionIds: [lastBaseActionId],
      instructionKey: "install-captured-guides",
      phase: "assembly" as const
    },
    {
      schemaVersion: "1.0" as const,
      id: "insert-captured-panel",
      order: baseActions.length + 1,
      action: "insert" as const,
      partIds: [moving.id],
      jointIds: captureJoints.map((joint) => joint.id),
      direction: { x: 0 as const, y: 1 as const, z: 0 as const },
      dependsOnActionIds: ["install-captured-guides"],
      instructionKey: "insert-captured-panel",
      phase: "assembly" as const
    },
    {
      schemaVersion: "1.0" as const,
      id: "install-travel-stop-key",
      order: baseActions.length + 2,
      action: "insert" as const,
      partIds: [key.id],
      jointIds: [keyJoint.id],
      direction: { x: 0 as const, y: 0 as const, z: -1 as const },
      dependsOnActionIds: ["insert-captured-panel"],
      instructionKey: "install-travel-stop-key",
      phase: "assembly" as const
    },
    {
      schemaVersion: "1.0" as const,
      id: "verify-captured-travel",
      order: baseActions.length + 3,
      action: "translate" as const,
      partIds: [moving.id],
      jointIds: captureJoints.map((joint) => joint.id),
      direction: program.mechanism.axis.direction,
      dependsOnActionIds: ["install-travel-stop-key"],
      instructionKey: "verify-captured-travel",
      phase: "assembly" as const
    },
    {
      schemaVersion: "1.0" as const,
      id: "remove-travel-stop-key",
      order: baseActions.length + 4,
      action: "remove" as const,
      partIds: [key.id],
      jointIds: [keyJoint.id],
      direction: { x: 0 as const, y: 0 as const, z: 1 as const },
      dependsOnActionIds: ["verify-captured-travel"],
      instructionKey: "remove-travel-stop-key",
      phase: "disassembly" as const
    },
    {
      schemaVersion: "1.0" as const,
      id: "withdraw-captured-panel",
      order: baseActions.length + 5,
      action: "remove" as const,
      partIds: [moving.id],
      jointIds: captureJoints.map((joint) => joint.id),
      direction: program.mechanism.axis.direction,
      dependsOnActionIds: ["remove-travel-stop-key"],
      instructionKey: "withdraw-captured-panel",
      phase: "disassembly" as const
    }
  ];
  const operatorProgram = [
    ...base.operatorProgram,
    {
      operatorId: CAPTURED_PANEL_SLIDE_OPERATOR.id,
      operatorVersion: CAPTURED_PANEL_SLIDE_OPERATOR.version,
      parameterHash: await hashCanonical({
        operator: CAPTURED_PANEL_SLIDE_OPERATOR,
        mechanism: program.mechanism,
        guideGeometry,
        forbiddenIntervals
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
        x: Math.max(base.request.envelopeMm.x, umToMm(rightGuideInnerXUm + thicknessUm)),
        y: base.request.envelopeMm.y + umToMm(program.mechanism.normalTravelUm),
        z: Math.max(base.request.envelopeMm.z, umToMm(guideLowerZUm + thicknessUm))
      }
    },
    intent: {
      ...base.intent,
      fixtureId: `${program.programId}-intent`,
      title: program.title,
      coreIntent: "Compose one planar body with a captured, mechanically retained prismatic interface and explicit normal/removal states through a reusable deterministic operator.",
      topology: {
        bodies: [
          ...base.intent.topology.bodies,
          {
            id: moving.id,
            role: "moving-panel" as const,
            quantity: 1,
            shapeClass: "planar" as const
          }
        ],
        interfaces: [
          ...base.intent.topology.interfaces,
          {
            id: `${motionId}-interface`,
            between: [program.mechanism.stationaryAnchorPartIds[0]!, moving.id] as [string, string],
            behavior: "prismatic" as const,
            function: "Two mechanically retained guide caps constrain one translated panel between exact closed/open stops; removal requires the explicit keyed-stop disassembly action."
          }
        ]
      }
    },
    operatorProgram,
    parts,
    joints,
    motionConstraints: [motionConstraint],
    assemblyPlan,
    validation: { schemaVersion: "1.0", status: "pass", findings: [] },
    provenance: {
      ...base.provenance,
      inputDigest,
      operatorVersions: {
        ...base.provenance.operatorVersions,
        [CAPTURED_PANEL_SLIDE_OPERATOR.id]: CAPTURED_PANEL_SLIDE_OPERATOR.version
      },
      deterministicSeed: program.deterministicSeed
    }
  });
  const mechanism = validateCapturedPanelSlide(provisional);
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
