import type {
  CapturedSlideProgramV1,
  FitProfile,
  MachineProfile,
  MaterialProfile,
  OrthogonalPanelProgramV1,
  RetainedPinProgramV1
} from "../../domain/contracts";
import { retainedPinGeometryDimensions } from "../../domain/retained-pin-policy";
import { mmToUm } from "../../domain/units";

export const PRODUCT_COPY = {
  eyebrow: "Sketch to fabrication candidate",
  title: "A box you can inspect before you cut",
  description: "One canonical design drives the sheet layout, assembled preview, bill of materials, parts legend, and build sequence.",
  verification: "Physical verification required before relying on fit, strength, durability, or machine compatibility."
} as const;

export const ORTHOGONAL_PRESETS = [
  { id: "small", label: "Small", widthMm: 90, depthMm: 70, heightMm: 42 },
  { id: "medium", label: "Medium", widthMm: 120, depthMm: 90, heightMm: 58 },
  { id: "large", label: "Large", widthMm: 160, depthMm: 120, heightMm: 78 }
] as const;

export type OrthogonalPresetId = (typeof ORTHOGONAL_PRESETS)[number]["id"];

type ProgramDimensions = {
  widthMm: number;
  depthMm: number;
  heightMm: number;
};

export type ProgramContent = {
  programId: string;
  projectId: string;
  title: string;
  description: string;
  dimensions: ProgramDimensions;
  includeFront: boolean;
  dividerCount: number;
  treatmentPrimitive: "parallel-lines" | "inset-frame" | "corner-ticks" | null;
};

export const PRIMARY_PROGRAM_CONTENT: ProgramContent = {
  programId: "orthogonal-five-panel",
  projectId: "m2-primary-medium",
  title: "Medium finger-jointed box",
  description: "A glue-free five-panel fabrication candidate with complementary corner fingers and wall-to-base tab-slot mates.",
  dimensions: { widthMm: 120, depthMm: 90, heightMm: 58 },
  includeFront: true,
  dividerCount: 0,
  treatmentPrimitive: "parallel-lines"
};

function panel(
  id: string,
  name: string,
  markingCode: string,
  widthUm: number,
  heightUm: number,
  bottomInsetUm: number,
  frame: OrthogonalPanelProgramV1["panels"][number]["frame"],
  explodedOffset: OrthogonalPanelProgramV1["panels"][number]["explodedOffset"],
): OrthogonalPanelProgramV1["panels"][number] {
  return {
    id,
    name,
    markingCode,
    widthUm,
    heightUm,
    bodyInsetUm: { bottom: bottomInsetUm, right: 0, top: 0, left: 0 },
    frame,
    explodedOffset,
    grainVector: { x: 1, y: 0 }
  };
}

export function createPanelProgram(
  content: ProgramContent,
  profiles: { material: MaterialProfile; machine: MachineProfile; fit: FitProfile },
): OrthogonalPanelProgramV1 {
  const thicknessUm = mmToUm(profiles.material.measuredThicknessMm);
  const widthUm = mmToUm(content.dimensions.widthMm);
  const depthUm = mmToUm(content.dimensions.depthMm);
  const wallHeightUm = mmToUm(content.dimensions.heightMm) + thicknessUm;
  const wallWidthUm = widthUm - thicknessUm * 2;
  const sideWidthUm = depthUm - thicknessUm * 2;
  const verticalSpanStartUm = thicknessUm;
  const verticalSpanEndUm = wallHeightUm;
  const panels: OrthogonalPanelProgramV1["panels"] = [
    panel(
      "foundation-panel",
      "Foundation panel",
      "p1",
      widthUm,
      depthUm,
      0,
      {
        origin: { xUm: 0, yUm: 0, zUm: 0 },
        xAxis: { x: 1, y: 0, z: 0 },
        yAxis: { x: 0, y: 1, z: 0 },
        zAxis: { x: 0, y: 0, z: 1 }
      },
      { xUm: 0, yUm: 0, zUm: -24_000 },
    ),
    panel(
      "rear-panel",
      "Rear panel",
      "p3",
      wallWidthUm,
      wallHeightUm,
      thicknessUm,
      {
          origin: { xUm: thicknessUm, yUm: depthUm - thicknessUm, zUm: 0 },
          xAxis: { x: 1, y: 0, z: 0 },
          yAxis: { x: 0, y: 0, z: 1 },
          zAxis: { x: 0, y: -1, z: 0 }
      },
      { xUm: 0, yUm: 18_000, zUm: 20_000 },
    ),
    panel(
      "left-panel",
      "Left panel",
      "p4",
      sideWidthUm,
      wallHeightUm,
      thicknessUm,
      {
        origin: { xUm: thicknessUm, yUm: thicknessUm, zUm: 0 },
        xAxis: { x: 0, y: 1, z: 0 },
        yAxis: { x: 0, y: 0, z: 1 },
        zAxis: { x: 1, y: 0, z: 0 }
      },
      { xUm: -24_000, yUm: 0, zUm: 16_000 },
    ),
    panel(
      "right-panel",
      "Right panel",
      "p5",
      sideWidthUm,
      wallHeightUm,
      thicknessUm,
      {
        origin: { xUm: widthUm - thicknessUm * 2, yUm: thicknessUm, zUm: 0 },
        xAxis: { x: 0, y: 1, z: 0 },
        yAxis: { x: 0, y: 0, z: 1 },
        zAxis: { x: 1, y: 0, z: 0 }
      },
      { xUm: 24_000, yUm: 0, zUm: 16_000 },
    )
  ];
  if (content.includeFront) {
    panels.push(
      panel(
        "front-panel",
        "Front panel",
        "p2",
        wallWidthUm,
        wallHeightUm,
        thicknessUm,
        {
          origin: { xUm: thicknessUm, yUm: thicknessUm * 2, zUm: 0 },
          xAxis: { x: 1, y: 0, z: 0 },
          yAxis: { x: 0, y: 0, z: 1 },
          zAxis: { x: 0, y: -1, z: 0 }
        },
        { xUm: 0, yUm: -18_000, zUm: 20_000 },
      ),
    );
  }
  for (let index = 0; index < content.dividerCount; index += 1) {
    const xUm = Math.round(((index + 1) * widthUm) / (content.dividerCount + 1));
    panels.push(
      panel(
        `divider-${String(index + 1)}`,
        `Divider ${String(index + 1)}`,
        `p${String(panels.length + 1)}`,
        sideWidthUm,
        wallHeightUm - thicknessUm * 2,
        thicknessUm,
        {
          origin: { xUm: xUm - Math.floor(thicknessUm / 2), yUm: thicknessUm, zUm: 0 },
          xAxis: { x: 0, y: 1, z: 0 },
          yAxis: { x: 0, y: 0, z: 1 },
          zAxis: { x: 1, y: 0, z: 0 }
        },
        { xUm: 0, yUm: 0, zUm: 34_000 + index * 8_000 },
      ),
    );
  }

  const tabSlotMates: OrthogonalPanelProgramV1["tabSlotMates"] = panels
    .filter((candidate) => candidate.id !== "foundation-panel")
    .map((candidate) => ({
      id: `seat-${candidate.id}`,
      insertPartId: candidate.id,
      openingPartId: "foundation-panel",
      insertEdge: "bottom",
      fitClass: "snug",
      tabCount: candidate.id.startsWith("divider-") ? 2 : 3,
      endInsetUm: thicknessUm * 2,
      tabDepthUm: thicknessUm
    }));
  const edgeMates: OrthogonalPanelProgramV1["edgeMates"] = [
    {
      id: "rear-left-corner",
      firstPartId: "rear-panel",
      firstEdge: "left",
      secondPartId: "left-panel",
      secondEdge: "right",
      spanStartUm: verticalSpanStartUm,
      spanEndUm: verticalSpanEndUm,
      fingerCount: 7,
      insertionDirection: { x: 0, y: 0, z: -1 }
    },
    {
      id: "rear-right-corner",
      firstPartId: "rear-panel",
      firstEdge: "right",
      secondPartId: "right-panel",
      secondEdge: "right",
      spanStartUm: verticalSpanStartUm,
      spanEndUm: verticalSpanEndUm,
      fingerCount: 7,
      insertionDirection: { x: 0, y: 0, z: -1 }
    }
  ];
  if (content.includeFront) {
    edgeMates.push(
      {
        id: "front-left-corner",
        firstPartId: "front-panel",
        firstEdge: "left",
        secondPartId: "left-panel",
        secondEdge: "left",
        spanStartUm: verticalSpanStartUm,
        spanEndUm: verticalSpanEndUm,
        fingerCount: 7,
        insertionDirection: { x: 0, y: 0, z: -1 }
      },
      {
        id: "front-right-corner",
        firstPartId: "front-panel",
        firstEdge: "right",
        secondPartId: "right-panel",
        secondEdge: "left",
        spanStartUm: verticalSpanStartUm,
        spanEndUm: verticalSpanEndUm,
        fingerCount: 7,
        insertionDirection: { x: 0, y: 0, z: -1 }
      },
    );
  }
  const wallPartIds = panels.filter((candidate) => candidate.id !== "foundation-panel").map((candidate) => candidate.id);
  const edgeJointIds = edgeMates.map((mate) => mate.id);
  const seatJointIds = tabSlotMates.map((mate) => mate.id);
  return {
    schemaVersion: "1.0",
    programId: content.programId,
    projectId: content.projectId,
    title: content.title,
    description: content.description,
    materialProfileId: profiles.material.id,
    machineProfileId: profiles.machine.id,
    fitProfileId: profiles.fit.id,
    deterministicSeed: `${content.programId}-v1`,
    panels,
    tabSlotMates,
    edgeMates,
    treatments: content.treatmentPrimitive === null
      ? []
      : panels
          .filter((candidate) => candidate.id !== "foundation-panel" && !candidate.id.startsWith("divider-"))
          .map((candidate) => ({
            id: `${candidate.id}-surface`,
            partId: candidate.id,
            primitive: content.treatmentPrimitive!,
            operation: "score" as const,
            insetUm: thicknessUm * 3,
            count: 3
          })),
    assemblyGroups: [
      {
        id: "align-panel-frame",
        order: 0,
        action: "align",
        partIds: wallPartIds,
        jointIds: edgeJointIds,
        direction: null,
        dependsOnActionIds: [],
        instructionKey: "align-panel-frame"
      },
      {
        id: "seat-panel-frame",
        order: 1,
        action: "insert",
        partIds: wallPartIds,
        jointIds: seatJointIds,
        direction: { x: 0, y: 0, z: -1 },
        dependsOnActionIds: ["align-panel-frame"],
        instructionKey: "seat-panel-frame"
      },
      {
        id: "verify-panel-assembly",
        order: 2,
        action: "verify",
        partIds: panels.map((candidate) => candidate.id),
        jointIds: [...edgeJointIds, ...seatJointIds],
        direction: null,
        dependsOnActionIds: ["seat-panel-frame"],
        instructionKey: "verify-panel-assembly"
      }
    ]
  };
}

export function createPrimaryPreset(
  presetId: OrthogonalPresetId,
  profiles: { material: MaterialProfile; machine: MachineProfile; fit: FitProfile },
): OrthogonalPanelProgramV1 {
  const preset = ORTHOGONAL_PRESETS.find((candidate) => candidate.id === presetId);
  if (preset === undefined) {
    throw new Error(`Unknown preset ${presetId}.`);
  }
  return createPanelProgram(
    {
      ...PRIMARY_PROGRAM_CONTENT,
      projectId: `m2-primary-${preset.id}`,
      title: `${preset.label} finger-jointed box`,
      dimensions: preset
    },
    profiles,
  );
}

export type RetainedProgramContent = {
  programId: string;
  projectId: string;
  title: string;
  description: string;
  support: ProgramContent;
  movingPanelId: string;
  movingPanelName: string;
  movingPanelMarkingCode: string;
  stationaryAnchorPartId: string;
  panelWidthMm: number;
  panelDepthMm: number;
  axisXmm: number;
  stationSpanMm: { start: number; end: number };
  openAngleDegrees: number;
  axialEndplayMm: number;
  installationClearanceMm: number;
  pin: {
    kind: "wooden-dowel" | "bamboo-skewer" | "custom-wooden-pin";
    stockProfileId: string;
    sourceLabel: string;
    nominalDiameterMm: number;
    measuredDiameterMm: number;
    measuredMinimumDiameterMm: number;
    measuredMaximumDiameterMm: number;
    straightnessEvidence: "unverified" | "user-reported" | "reviewed-measurement";
    evidenceState: "provisional-preset" | "user-reported" | "coupon-selected" | "reviewed-measurement";
    diameterBasis?: "nominal-preset" | "user-reported-caliper";
  };
};

export function createRetainedProgram(
  content: RetainedProgramContent,
  profiles: { material: MaterialProfile; machine: MachineProfile; fit: FitProfile },
): RetainedPinProgramV1 {
  const geometry = retainedPinGeometryDimensions({
    measuredPinDiameterUm: mmToUm(content.pin.measuredDiameterMm),
    totalDiametralClearanceUm: mmToUm(profiles.fit.rotating.totalDeltaMm),
    machineMinimumFeatureUm: mmToUm(profiles.machine.minimumFeatureMm)
  });
  const supportTopUm = mmToUm(
    content.support.dimensions.heightMm + profiles.material.measuredThicknessMm,
  );
  return {
    schemaVersion: "1.0",
    programId: content.programId,
    projectId: content.projectId,
    title: content.title,
    description: content.description,
    deterministicSeed: `${content.programId}-v1`,
    supportProgram: createPanelProgram(content.support, profiles),
    mechanism: {
      movingPanelId: content.movingPanelId,
      movingPanelName: content.movingPanelName,
      movingPanelMarkingCode: content.movingPanelMarkingCode,
      stationaryAnchorPartId: content.stationaryAnchorPartId,
      panelWidthUm: mmToUm(content.panelWidthMm),
      panelDepthUm: mmToUm(content.panelDepthMm),
      axis: {
        origin: {
          xUm: mmToUm(content.axisXmm),
          yUm: mmToUm(content.panelDepthMm) + geometry.panelAxisOffsetUm,
          zUm: supportTopUm - geometry.panelAxisOffsetUm
        },
        direction: { x: 1, y: 0, z: 0 }
      },
      stationSpan: {
        startUm: mmToUm(content.stationSpanMm.start),
        endUm: mmToUm(content.stationSpanMm.end)
      },
      openAngleDegrees: content.openAngleDegrees,
      axialEndplayUm: mmToUm(content.axialEndplayMm),
      installationClearanceUm: mmToUm(content.installationClearanceMm),
      pin: {
        kind: content.pin.kind,
        stockProfileId: content.pin.stockProfileId,
        sourceLabel: content.pin.sourceLabel,
        nominalDiameterUm: mmToUm(content.pin.nominalDiameterMm),
        measuredDiameterUm: mmToUm(content.pin.measuredDiameterMm),
        measuredMinimumDiameterUm: mmToUm(content.pin.measuredMinimumDiameterMm),
        measuredMaximumDiameterUm: mmToUm(content.pin.measuredMaximumDiameterMm),
        straightnessEvidence: content.pin.straightnessEvidence,
        evidenceState: content.pin.evidenceState,
        ...(content.pin.diameterBasis === undefined
          ? {}
          : { diameterBasis: content.pin.diameterBasis })
      }
    }
  };
}

export const PRIMARY_RETAINED_PROGRAM_CONTENT: RetainedProgramContent = {
  programId: "retained-cover-proof",
  projectId: "m3-primary-retained-cover",
  title: "Retained-pin hinged-lid box",
  description: "The M2 shell gains a rigid moving lid, alternating plywood hinge leaves, a measured wooden pin, opposed axial guards, and explicit closed/open stops.",
  support: {
    ...PRIMARY_PROGRAM_CONTENT,
    programId: "retained-cover-support",
    projectId: "m3-primary-support",
    title: "Retained-cover support shell"
  },
  movingPanelId: "cover-panel",
  movingPanelName: "Rigid lid panel",
  movingPanelMarkingCode: "p6",
  stationaryAnchorPartId: "rear-panel",
  panelWidthMm: 120,
  panelDepthMm: 90,
  axisXmm: 0,
  stationSpanMm: { start: 15, end: 105 },
  openAngleDegrees: 105,
  axialEndplayMm: 0.6,
  installationClearanceMm: 12,
  pin: {
    kind: "wooden-dowel",
    stockProfileId: "wooden-pin-measured-3000",
    sourceLabel: "User-measured nominal 3 mm straight wooden dowel",
    nominalDiameterMm: 3,
    measuredDiameterMm: 3,
    measuredMinimumDiameterMm: 2.99,
    measuredMaximumDiameterMm: 3.01,
    straightnessEvidence: "unverified",
    evidenceState: "user-reported"
  }
};

export function createPrimaryRetainedProgram(
  profiles: { material: MaterialProfile; machine: MachineProfile; fit: FitProfile },
): RetainedPinProgramV1 {
  return createRetainedProgram(PRIMARY_RETAINED_PROGRAM_CONTENT, profiles);
}

export function createRetainedPreset(
  presetId: OrthogonalPresetId,
  profiles: { material: MaterialProfile; machine: MachineProfile; fit: FitProfile },
  pinInput: number | {
    effectiveDiameterMm: number;
    basis: "nominal-preset" | "user-reported-caliper";
  } = 3,
): RetainedPinProgramV1 {
  const preset = ORTHOGONAL_PRESETS.find((candidate) => candidate.id === presetId);
  if (preset === undefined) {
    throw new Error(`Unknown preset ${presetId}.`);
  }
  const normalizedPinDiameterMm = Math.round(
    (typeof pinInput === "number" ? pinInput : pinInput.effectiveDiameterMm) * 100,
  ) / 100;
  const sourceAwarePin = typeof pinInput === "number"
    ? {
        stockProfileId: `wooden-pin-measured-${String(Math.round(normalizedPinDiameterMm * 1_000))}`
      }
    : pinInput.basis === "nominal-preset"
    ? {
        stockProfileId: `wooden-pin-starter-${String(Math.round(normalizedPinDiameterMm * 1_000))}`,
        sourceLabel: "Sold as a 3 mm straight wooden dowel or bamboo skewer; actual diameter unmeasured",
        evidenceState: "provisional-preset" as const,
        diameterBasis: "nominal-preset" as const
      }
    : {
        stockProfileId: `wooden-pin-measured-${String(Math.round(normalizedPinDiameterMm * 1_000))}`,
        sourceLabel: "User-measured nominal 3 mm straight wooden dowel or bamboo skewer",
        evidenceState: "user-reported" as const,
        diameterBasis: "user-reported-caliper" as const
      };
  const stationMarginMm = 20;
  return createRetainedProgram(
    {
      ...PRIMARY_RETAINED_PROGRAM_CONTENT,
      projectId: `m3-retained-cover-${preset.id}`,
      title: `${preset.label} retained-pin hinged-lid box`,
      support: {
        ...PRIMARY_RETAINED_PROGRAM_CONTENT.support,
        projectId: `m3-retained-support-${preset.id}`,
        title: `${preset.label} retained-cover support shell`,
        dimensions: preset
      },
      panelWidthMm: preset.widthMm,
      panelDepthMm: preset.depthMm,
      axisXmm: 0,
      stationSpanMm: {
        start: stationMarginMm,
        end: preset.widthMm - stationMarginMm
      },
      pin: {
        ...PRIMARY_RETAINED_PROGRAM_CONTENT.pin,
        ...sourceAwarePin,
        measuredDiameterMm: normalizedPinDiameterMm,
        measuredMinimumDiameterMm: normalizedPinDiameterMm,
        measuredMaximumDiameterMm: normalizedPinDiameterMm
      }
    },
    profiles,
  );
}

export type CapturedSlideProgramContent = {
  programId: string;
  projectId: string;
  title: string;
  description: string;
  support: ProgramContent;
  movingPanelId: string;
  movingPanelName: string;
  movingPanelMarkingCode: string;
  minimumGuideEngagementMm: number;
  verticalRunningClearanceMm: number;
  lateralRunningClearanceMm: number;
  thumbAccessWidthMm: number;
  thumbAccessDepthMm: number;
};

export function createCapturedSlideProgram(
  content: CapturedSlideProgramContent,
  profiles: { material: MaterialProfile; machine: MachineProfile; fit: FitProfile },
): CapturedSlideProgramV1 {
  const thicknessMm = profiles.material.measuredThicknessMm;
  const panelWidthMm =
    content.support.dimensions.widthMm -
    thicknessMm * 4 -
    content.lateralRunningClearanceMm;
  const panelDepthMm = content.support.dimensions.depthMm - thicknessMm * 4;
  const normalTravelMm = panelDepthMm - content.minimumGuideEngagementMm;
  if (panelWidthMm <= 0 || panelDepthMm <= 0 || normalTravelMm <= 0) {
    throw new Error("Captured-slide dimensions do not retain a positive panel or normal travel.");
  }
  const lateralHalfMm = content.lateralRunningClearanceMm / 2;
  const lowerClearanceMm = content.verticalRunningClearanceMm / 2;
  const supportTopMm = content.support.dimensions.heightMm + thicknessMm;
  return {
    schemaVersion: "1.0",
    programId: content.programId,
    projectId: content.projectId,
    title: content.title,
    description: content.description,
    deterministicSeed: `${content.programId}-v1`,
    supportProgram: createPanelProgram(content.support, profiles),
    mechanism: {
      movingPanelId: content.movingPanelId,
      movingPanelName: content.movingPanelName,
      movingPanelMarkingCode: content.movingPanelMarkingCode,
      stationaryAnchorPartIds: ["left-panel", "right-panel", "rear-panel"],
      panelWidthUm: mmToUm(panelWidthMm),
      panelDepthUm: mmToUm(panelDepthMm),
      axis: {
        origin: {
          xUm: mmToUm(thicknessMm * 2 + lateralHalfMm),
          yUm: mmToUm(content.support.dimensions.depthMm - thicknessMm * 2),
          zUm: mmToUm(supportTopMm + lowerClearanceMm + thicknessMm)
        },
        direction: { x: 0, y: -1, z: 0 }
      },
      normalTravelUm: mmToUm(normalTravelMm),
      removalTravelUm: mmToUm(panelDepthMm + thicknessMm + 1),
      minimumGuideEngagementUm: mmToUm(content.minimumGuideEngagementMm),
      verticalRunningClearanceUm: mmToUm(content.verticalRunningClearanceMm),
      lateralRunningClearanceUm: mmToUm(content.lateralRunningClearanceMm),
      thumbAccessWidthUm: mmToUm(content.thumbAccessWidthMm),
      thumbAccessDepthUm: mmToUm(content.thumbAccessDepthMm)
    }
  };
}

export const PRIMARY_CAPTURED_SLIDE_PROGRAM_CONTENT: CapturedSlideProgramContent = {
  programId: "captured-cover-proof",
  projectId: "m4-primary-captured-cover",
  title: "Captured sliding-lid box",
  description: "The rigid shell gains a panel captured beneath mechanically tabbed guide caps, exact closed/open stops, a thumb notch, and keyed removal.",
  support: {
    ...PRIMARY_PROGRAM_CONTENT,
    programId: "captured-cover-support",
    projectId: "m4-primary-support",
    title: "Captured-cover support shell"
  },
  movingPanelId: "sliding-cover-panel",
  movingPanelName: "Captured sliding cover",
  movingPanelMarkingCode: "p6",
  minimumGuideEngagementMm: 18,
  verticalRunningClearanceMm: 0.6,
  lateralRunningClearanceMm: 0.6,
  thumbAccessWidthMm: 24,
  thumbAccessDepthMm: 10
};

export function createCapturedSlidePreset(
  presetId: OrthogonalPresetId,
  profiles: { material: MaterialProfile; machine: MachineProfile; fit: FitProfile },
): CapturedSlideProgramV1 {
  const preset = ORTHOGONAL_PRESETS.find((candidate) => candidate.id === presetId);
  if (preset === undefined) throw new Error(`Unknown preset ${presetId}.`);
  return createCapturedSlideProgram(
    {
      ...PRIMARY_CAPTURED_SLIDE_PROGRAM_CONTENT,
      projectId: `m4-captured-cover-${preset.id}`,
      title: `${preset.label} captured sliding-lid box`,
      support: {
        ...PRIMARY_CAPTURED_SLIDE_PROGRAM_CONTENT.support,
        projectId: `m4-captured-support-${preset.id}`,
        title: `${preset.label} captured-cover support shell`,
        dimensions: preset
      }
    },
    profiles,
  );
}
