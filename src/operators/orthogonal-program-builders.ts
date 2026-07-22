import type {
  CapturedSlideProgramV1,
  FitProfile,
  MachineProfile,
  MaterialProfile,
  OrthogonalPanelProgramV1,
  RetainedPinProgramV1
} from "../domain/contracts.js";
import { retainedPinGeometryDimensions } from "../domain/retained-pin-policy.js";
import { mmToUm } from "../domain/units.js";

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
  dividerAxis: "width" | "depth";
  treatmentPrimitive: "parallel-lines" | "inset-frame" | "corner-ticks" | null;
  fixedTop?: boolean;
};

type CompileProfiles = {
  material: MaterialProfile;
  machine: MachineProfile;
  fit: FitProfile;
};

function panel(
  id: string,
  name: string,
  markingCode: string,
  widthUm: number,
  heightUm: number,
  bodyInsetUm: number | OrthogonalPanelProgramV1["panels"][number]["bodyInsetUm"],
  frame: OrthogonalPanelProgramV1["panels"][number]["frame"],
  explodedOffset: OrthogonalPanelProgramV1["panels"][number]["explodedOffset"],
): OrthogonalPanelProgramV1["panels"][number] {
  return {
    id,
    name,
    markingCode,
    widthUm,
    heightUm,
    bodyInsetUm: typeof bodyInsetUm === "number"
      ? { bottom: bodyInsetUm, right: 0, top: 0, left: 0 }
      : bodyInsetUm,
    frame,
    explodedOffset,
    grainVector: { x: 1, y: 0 }
  };
}

export function createPanelProgram(
  content: ProgramContent,
  profiles: CompileProfiles,
): OrthogonalPanelProgramV1 {
  const thicknessUm = mmToUm(profiles.material.measuredThicknessMm);
  const widthUm = mmToUm(content.dimensions.widthMm);
  const depthUm = mmToUm(content.dimensions.depthMm);
  const fixedTop = content.fixedTop === true;
  if (fixedTop && !content.includeFront) {
    throw new Error("A fixed top frame requires four enclosing walls.");
  }
  const wallHeightUm = mmToUm(content.dimensions.heightMm) + thicknessUm * (fixedTop ? 2 : 1);
  const wallWidthUm = widthUm - thicknessUm * 2;
  const sideWidthUm = depthUm - thicknessUm * 2;
  const verticalSpanStartUm = thicknessUm;
  const verticalSpanEndUm = wallHeightUm - (fixedTop ? thicknessUm : 0);
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
      fixedTop
        ? { bottom: thicknessUm, right: 0, top: thicknessUm, left: 0 }
        : thicknessUm,
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
      fixedTop
        ? { bottom: thicknessUm, right: 0, top: thicknessUm, left: 0 }
        : thicknessUm,
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
      fixedTop
        ? { bottom: thicknessUm, right: 0, top: thicknessUm, left: 0 }
        : thicknessUm,
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
        fixedTop
          ? { bottom: thicknessUm, right: 0, top: thicknessUm, left: 0 }
          : thicknessUm,
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
  if (fixedTop) {
    panels.push(
      panel(
        "cover-panel",
        "Fixed top frame",
        `p${String(6 + content.dividerCount)}`,
        widthUm,
        depthUm,
        0,
        {
          origin: { xUm: 0, yUm: 0, zUm: wallHeightUm - thicknessUm },
          xAxis: { x: 1, y: 0, z: 0 },
          yAxis: { x: 0, y: 1, z: 0 },
          zAxis: { x: 0, y: 0, z: 1 }
        },
        { xUm: 0, yUm: 0, zUm: 42_000 },
      ),
    );
  }
  for (let index = 0; index < content.dividerCount; index += 1) {
    const positionUm = Math.round(
      ((index + 1) * (content.dividerAxis === "width" ? widthUm : depthUm)) /
      (content.dividerCount + 1),
    );
    panels.push(
      panel(
        `divider-${String(index + 1)}`,
        `Divider ${String(index + 1)}`,
        `p${String(6 + index)}`,
        content.dividerAxis === "width" ? sideWidthUm : wallWidthUm,
        wallHeightUm - thicknessUm * 2,
        thicknessUm,
        content.dividerAxis === "width"
          ? {
              origin: { xUm: positionUm - Math.floor(thicknessUm / 2), yUm: thicknessUm, zUm: 0 },
              xAxis: { x: 0, y: 1, z: 0 },
              yAxis: { x: 0, y: 0, z: 1 },
              zAxis: { x: 1, y: 0, z: 0 }
            }
          : {
              origin: { xUm: thicknessUm, yUm: positionUm + Math.floor(thicknessUm / 2), zUm: 0 },
              xAxis: { x: 1, y: 0, z: 0 },
              yAxis: { x: 0, y: 0, z: 1 },
              zAxis: { x: 0, y: -1, z: 0 }
            },
        { xUm: 0, yUm: 0, zUm: 34_000 + index * 8_000 },
      ),
    );
  }

  const tabSlotMates: OrthogonalPanelProgramV1["tabSlotMates"] = panels
    .filter((candidate) =>
      candidate.id !== "foundation-panel" && candidate.id !== "cover-panel"
    )
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
  const fixedTopJointIds = fixedTop
    ? ["rear-panel", "right-panel", "front-panel", "left-panel"].map((partId) => {
        const id = `retain-top-${partId}`;
        tabSlotMates.push({
          id,
          insertPartId: partId,
          openingPartId: "cover-panel",
          insertEdge: "top",
          fitClass: "snug",
          tabCount: 3,
          endInsetUm: thicknessUm * 2,
          tabDepthUm: thicknessUm
        });
        return id;
      })
    : [];
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
  const wallPartIds = panels
    .filter((candidate) =>
      candidate.id !== "foundation-panel" && candidate.id !== "cover-panel"
    )
    .map((candidate) => candidate.id);
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
          .filter((candidate) =>
            candidate.id !== "foundation-panel" && !candidate.id.startsWith("divider-")
            && candidate.id !== "cover-panel"
          )
          .map((candidate) => ({
            id: `${candidate.id}-surface`,
            partId: candidate.id,
            primitive: content.treatmentPrimitive!,
            operation: "score" as const,
            insetUm: thicknessUm * 3,
            count: 3
          })),
    cutThroughTreatments: [],
    applicationLimitations: [],
    fixedTopFrame: fixedTop
      ? {
          partId: "cover-panel",
          retainedByJointIds: fixedTopJointIds,
          assemblyActionId: "seat-fixed-top-frame"
        }
      : null,
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
      ...(fixedTop
        ? [{
            id: "seat-fixed-top-frame",
            order: 2,
            action: "insert" as const,
            partIds: ["cover-panel"],
            jointIds: fixedTopJointIds,
            direction: { x: 0 as const, y: 0 as const, z: -1 as const },
            dependsOnActionIds: ["seat-panel-frame"],
            instructionKey: "seat-fixed-top-frame"
          }]
        : []),
      {
        id: "verify-panel-assembly",
        order: fixedTop ? 3 : 2,
        action: "verify",
        partIds: panels.map((candidate) => candidate.id),
        jointIds: [...edgeJointIds, ...seatJointIds, ...fixedTopJointIds],
        direction: null,
        dependsOnActionIds: [fixedTop ? "seat-fixed-top-frame" : "seat-panel-frame"],
        instructionKey: "verify-panel-assembly"
      }
    ]
  };
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
    kind: "wooden-dowel" | "bamboo-skewer" | "wooden-toothpick" | "custom-wooden-pin";
    stockProfileId: string;
    sourceLabel: string;
    nominalDiameterMm: number;
    measuredDiameterMm: number;
    measuredMinimumDiameterMm: number;
    measuredMaximumDiameterMm: number;
    straightnessEvidence: "unverified" | "user-reported" | "reviewed-measurement";
    evidenceState: "provisional-preset" | "user-reported" | "coupon-selected" | "reviewed-measurement";
    diameterBasis?: "nominal-preset" | "user-reported-caliper" | "user-reported-reference-gauge";
    referenceGauge?: {
      system: "american-wire-gauge";
      largerDiameterGaugeNumber: number;
      smallerDiameterGaugeNumber: number;
      policyId: "american-wire-gauge-diameter";
      policyVersion: "1.0.0";
    };
  };
};

export function createRetainedProgram(
  content: RetainedProgramContent,
  profiles: CompileProfiles,
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
          : { diameterBasis: content.pin.diameterBasis }),
        ...(content.pin.referenceGauge === undefined
          ? {}
          : { referenceGauge: content.pin.referenceGauge })
      }
    }
  };
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
  profiles: CompileProfiles,
): CapturedSlideProgramV1 {
  const thicknessMm = profiles.material.measuredThicknessMm;
  const panelWidthMm = content.support.dimensions.widthMm -
    thicknessMm * 4 -
    content.lateralRunningClearanceMm;
  const panelDepthMm = content.support.dimensions.depthMm - thicknessMm * 4;
  const normalTravelMm = panelDepthMm - content.minimumGuideEngagementMm;
  if (panelWidthMm <= 0 || panelDepthMm <= 0 || normalTravelMm <= 0) {
    throw new Error("Captured-panel dimensions do not retain a positive panel or normal travel.");
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
