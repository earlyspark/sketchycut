import type {
  CapturedSlideProgramV1,
  InputPolicyEvaluation,
  OrthogonalPanelProgramV1,
  RetainedPinProgramV1
} from "../../domain/contracts";
import type { AppliedPinSetup } from "../../domain/fabrication-setup";
import type { OrthogonalCompileProfiles } from "../../operators/orthogonal-compiler";
import type { ProductCompileWorkerRequest } from "../../workers/protocol";
import type { OrthogonalPresetId } from "./presets";
import {
  createCapturedSlidePreset,
  createPrimaryPreset,
  createRetainedPreset
} from "./presets";
import {
  CAPTURED_SLIDE_ADAPTER,
  ORTHOGONAL_PANEL_ADAPTER,
  RETAINED_PIN_ADAPTER
} from "./structural-adapters";

export type GuidedMotionPresentation = {
  restStateLabel: string;
  endpointStateLabel: string;
  controlLabel: string;
  rangeAriaLabel: string;
  endpointContactText: string;
  midTravelText: string;
  endpointSelectionPartId: string;
  explanation: string;
  removalStateLabel?: string;
  removalExplanation?: string;
};

type ProgramBuildInput = {
  presetId: OrthogonalPresetId;
  profiles: OrthogonalCompileProfiles;
};

type OrthogonalGuidedProgramAdapter = typeof ORTHOGONAL_PANEL_ADAPTER & {
  buildProgram: (input: ProgramBuildInput) => OrthogonalPanelProgramV1;
};

type RetainedPinGuidedProgramAdapter = typeof RETAINED_PIN_ADAPTER & {
  buildProgram: (
    input: ProgramBuildInput & { retainedPin: AppliedPinSetup },
  ) => RetainedPinProgramV1;
};

type CapturedSlideGuidedProgramAdapter = typeof CAPTURED_SLIDE_ADAPTER & {
  buildProgram: (input: ProgramBuildInput) => CapturedSlideProgramV1;
};

export type GuidedProgramAdapter =
  | OrthogonalGuidedProgramAdapter
  | RetainedPinGuidedProgramAdapter
  | CapturedSlideGuidedProgramAdapter;

type GuidedExampleBase<Id extends string> = {
  id: Id;
  order: number;
  label: string;
  summary: string;
  whatThisStepAdds: string;
};

export type AvailableGuidedExample<Id extends string = string> =
  GuidedExampleBase<Id> & {
    status: "available";
    statusText: "Explore now";
    firstLoadDefault: boolean;
    programAdapter: GuidedProgramAdapter;
    partAliases: Readonly<Record<string, string>>;
    instructionAliases: Readonly<Record<string, string>>;
    motionPresentation?: GuidedMotionPresentation;
    evidenceMilestone: "M2" | "M3" | "M4";
  };

export type PlannedGuidedExample<Id extends string = string> =
  GuidedExampleBase<Id> & {
    status: "planned";
    statusText: "Planned next · no preview or download yet";
    firstLoadDefault?: never;
    programAdapter?: never;
    evidenceMilestone: "M4";
  };

export type GuidedExample = AvailableGuidedExample | PlannedGuidedExample;

const BASIC_PROGRAM_ADAPTER: OrthogonalGuidedProgramAdapter = {
  ...ORTHOGONAL_PANEL_ADAPTER,
  buildProgram: ({ presetId, profiles }) => createPrimaryPreset(presetId, profiles)
};

const HINGED_PROGRAM_ADAPTER: RetainedPinGuidedProgramAdapter = {
  ...RETAINED_PIN_ADAPTER,
  buildProgram: ({ presetId, profiles, retainedPin }) =>
    createRetainedPreset(presetId, profiles, retainedPin)
};

const CAPTURED_PROGRAM_ADAPTER: CapturedSlideGuidedProgramAdapter = {
  ...CAPTURED_SLIDE_ADAPTER,
  buildProgram: ({ presetId, profiles }) =>
    createCapturedSlidePreset(presetId, profiles)
};

export const GUIDED_EXAMPLE_CATALOG = [
  {
    id: "basic-box",
    order: 1,
    label: "Basic box",
    summary: "Rigid shell",
    whatThisStepAdds: "A rigid, glue-free shell with exact finger joints and tab-slot assembly.",
    status: "available",
    statusText: "Explore now",
    firstLoadDefault: true,
    programAdapter: BASIC_PROGRAM_ADAPTER,
    partAliases: {},
    instructionAliases: {},
    evidenceMilestone: "M2"
  },
  {
    id: "hinged-lid-box",
    order: 2,
    label: "Hinged-lid box",
    summary: "Adds retained motion",
    whatThisStepAdds: "A rigid lid, alternating hinge leaves, retained wooden pin, and proven stop geometry.",
    status: "available",
    statusText: "Explore now",
    firstLoadDefault: false,
    programAdapter: HINGED_PROGRAM_ADAPTER,
    partAliases: { "open-stop-brace": "Lid-open stop" },
    instructionAliases: { "install-open-stop-brace": "install lid-open stop" },
    motionPresentation: {
      restStateLabel: "Closed",
      endpointStateLabel: "Open",
      controlLabel: "Open / close",
      rangeAriaLabel: "Retained pin motion angle",
      endpointContactText: "lid-open stop contact",
      midTravelText: "expected gap before stop",
      endpointSelectionPartId: "open-stop-brace",
      explanation: "Deterministic endpoint proof certifies canonical contact; this animation only explains the pose. Physical contact and motion remain unverified."
    },
    evidenceMilestone: "M3"
  },
  {
    id: "sliding-lid-box",
    order: 3,
    label: "Sliding-lid box",
    summary: "Adds captured travel",
    whatThisStepAdds: "A captured lid with exact linear travel, mechanical guide retention, stops, and an explicit removal path.",
    status: "available",
    statusText: "Explore now",
    firstLoadDefault: false,
    programAdapter: CAPTURED_PROGRAM_ADAPTER,
    partAliases: { "travel-stop-key": "Removable travel stop" },
    instructionAliases: {
      "install-captured-guides": "install captured guide caps",
      "insert-captured-panel": "insert sliding lid",
      "install-travel-stop-key": "install removable travel stop",
      "verify-captured-travel": "verify closed-to-open travel",
      "remove-travel-stop-key": "remove travel stop for disassembly",
      "withdraw-captured-panel": "withdraw lid at removal state"
    },
    motionPresentation: {
      restStateLabel: "Closed",
      endpointStateLabel: "Fully open",
      removalStateLabel: "Removal",
      controlLabel: "Slide open / closed",
      rangeAriaLabel: "Captured lid travel distance",
      endpointContactText: "travel-stop key contact",
      midTravelText: "captured by both guide caps",
      endpointSelectionPartId: "travel-stop-key",
      explanation: "Exact interval and capture proofs certify the canonical travel envelope; this animation only explains the pose. Physical motion remains unverified.",
      removalExplanation: "Removal is a disassembly state: remove the keyed stop first, then withdraw the lid beyond normal travel."
    },
    evidenceMilestone: "M4"
  }
] as const satisfies readonly GuidedExample[];

function assertCatalog(
  catalog: readonly GuidedExample[],
): asserts catalog is readonly GuidedExample[] {
  const ids = new Set<string>();
  const orders = new Set<number>();
  let defaultCount = 0;
  for (const entry of catalog) {
    if (ids.has(entry.id)) throw new Error(`Duplicate guided example ID ${entry.id}.`);
    if (orders.has(entry.order)) throw new Error(`Duplicate guided example order ${String(entry.order)}.`);
    ids.add(entry.id);
    orders.add(entry.order);
    if (entry.status === "available" && entry.firstLoadDefault) defaultCount += 1;
  }
  if (defaultCount !== 1) {
    throw new Error("The guided example catalog must declare exactly one available first-load default.");
  }
}

assertCatalog(GUIDED_EXAMPLE_CATALOG);

export type GuidedExampleId = (typeof GUIDED_EXAMPLE_CATALOG)[number]["id"];

export const AVAILABLE_GUIDED_EXAMPLES: readonly AvailableGuidedExample[] =
  GUIDED_EXAMPLE_CATALOG;

export const DEFAULT_GUIDED_EXAMPLE = AVAILABLE_GUIDED_EXAMPLES.find(
  (entry) => entry.firstLoadDefault,
)!;

export function findAvailableGuidedExample(
  id: GuidedExampleId,
): (typeof AVAILABLE_GUIDED_EXAMPLES)[number] | undefined {
  return AVAILABLE_GUIDED_EXAMPLES.find((entry) => entry.id === id);
}

type GuidedCompileInput = {
  requestId: string;
  presetId: OrthogonalPresetId;
  profiles: OrthogonalCompileProfiles;
  inputPolicyEvaluation: InputPolicyEvaluation;
  retainedPin: AppliedPinSetup;
};

export function buildGuidedProductCompileRequest(
  entry: AvailableGuidedExample,
  input: GuidedCompileInput,
): ProductCompileWorkerRequest {
  const common = {
    kind: "product-compile" as const,
    requestId: input.requestId,
    profiles: input.profiles,
    inputPolicyEvaluation: input.inputPolicyEvaluation
  };
  if (entry.programAdapter.structuralKind === "orthogonal-panel") {
    return {
      ...common,
      structuralKind: "orthogonal-panel",
      program: entry.programAdapter.buildProgram({
        presetId: input.presetId,
        profiles: input.profiles
      })
    };
  }
  if (entry.programAdapter.structuralKind === "retained-pin") return {
    ...common,
    structuralKind: "retained-pin",
    program: entry.programAdapter.buildProgram({
      presetId: input.presetId,
      profiles: input.profiles,
      retainedPin: input.retainedPin
    })
  };
  return {
    ...common,
    structuralKind: "captured-slide",
    program: entry.programAdapter.buildProgram({
      presetId: input.presetId,
      profiles: input.profiles
    })
  };
}
