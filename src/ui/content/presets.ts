import type {
  FitProfile,
  MachineProfile,
  MaterialProfile,
  OrthogonalPanelProgramV1
} from "../../domain/contracts";
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
  treatmentPrimitive: "parallel-lines" | "inset-frame" | "corner-ticks";
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
    treatments: panels
      .filter((candidate) => candidate.id !== "foundation-panel" && !candidate.id.startsWith("divider-"))
      .map((candidate, index) => ({
        id: `${candidate.id}-surface`,
        partId: candidate.id,
        primitive: content.treatmentPrimitive,
        operation: index % 2 === 0 ? "engrave" as const : "score" as const,
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
