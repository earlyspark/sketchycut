import type {
  CapturedSlideProgramV1,
  FitProfile,
  MachineProfile,
  MaterialProfile,
  OrthogonalPanelProgramV1,
  RetainedPinProgramV1
} from "../../domain/contracts";
import {
  createCapturedSlideProgram,
  createPanelProgram,
  createRetainedProgram,
  type CapturedSlideProgramContent,
  type ProgramContent,
  type RetainedProgramContent
} from "../../operators/orthogonal-program-builders";

export {
  createCapturedSlideProgram,
  createPanelProgram,
  createRetainedProgram
} from "../../operators/orthogonal-program-builders";
export type {
  CapturedSlideProgramContent,
  ProgramContent,
  RetainedProgramContent
} from "../../operators/orthogonal-program-builders";

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

export function createPrimaryPreset(
  presetId: OrthogonalPresetId,
  profiles: { material: MaterialProfile; machine: MachineProfile; fit: FitProfile },
): OrthogonalPanelProgramV1 {
  const preset = ORTHOGONAL_PRESETS.find((candidate) => candidate.id === presetId);
  if (preset === undefined) throw new Error(`Unknown preset ${presetId}.`);
  return createPanelProgram({
    ...PRIMARY_PROGRAM_CONTENT,
    projectId: `m2-primary-${preset.id}`,
    title: `${preset.label} finger-jointed box`,
    dimensions: preset
  }, profiles);
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
  if (preset === undefined) throw new Error(`Unknown preset ${presetId}.`);
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
  return createRetainedProgram({
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
  }, profiles);
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
  return createCapturedSlideProgram({
    ...PRIMARY_CAPTURED_SLIDE_PROGRAM_CONTENT,
    projectId: `m4-captured-cover-${preset.id}`,
    title: `${preset.label} captured sliding-lid box`,
    support: {
      ...PRIMARY_CAPTURED_SLIDE_PROGRAM_CONTENT.support,
      projectId: `m4-captured-support-${preset.id}`,
      title: `${preset.label} captured-cover support shell`,
      dimensions: preset
    }
  }, profiles);
}
