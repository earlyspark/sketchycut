import {
  createStarterPinSetup,
  type AppliedPinSetup
} from "../domain/fabrication-setup";

export type StructuralProgramKind = "orthogonal-panel" | "retained-pin";

export type RetainedPinDraft = {
  basis: "nominal-preset" | "user-reported-caliper";
  diameter: string;
};

export type CapabilityInputState = {
  activeStructuralKind: StructuralProgramKind;
  retainedPin: {
    applied: AppliedPinSetup;
    draft: RetainedPinDraft;
  };
};

export type CapabilityInputAction =
  | { type: "activate"; structuralKind: StructuralProgramKind }
  | { type: "edit-retained-pin"; draft: RetainedPinDraft }
  | { type: "apply-retained-pin"; applied: AppliedPinSetup }
  | { type: "discard-retained-pin" };

function formatMm(value: number): string {
  return value.toFixed(2);
}

export function pinDraftFromApplied(applied: AppliedPinSetup): RetainedPinDraft {
  return {
    basis: applied.basis,
    diameter: formatMm(applied.effectiveDiameterMm)
  };
}

export function createCapabilityInputState(
  activeStructuralKind: StructuralProgramKind,
): CapabilityInputState {
  const applied = createStarterPinSetup();
  return {
    activeStructuralKind,
    retainedPin: { applied, draft: pinDraftFromApplied(applied) }
  };
}

export function capabilityInputReducer(
  state: CapabilityInputState,
  action: CapabilityInputAction,
): CapabilityInputState {
  switch (action.type) {
    case "activate":
      return { ...state, activeStructuralKind: action.structuralKind };
    case "edit-retained-pin":
      return {
        ...state,
        retainedPin: { ...state.retainedPin, draft: structuredClone(action.draft) }
      };
    case "apply-retained-pin": {
      const applied = structuredClone(action.applied);
      return {
        ...state,
        retainedPin: { applied, draft: pinDraftFromApplied(applied) }
      };
    }
    case "discard-retained-pin":
      return {
        ...state,
        retainedPin: {
          ...state.retainedPin,
          draft: pinDraftFromApplied(state.retainedPin.applied)
        }
      };
  }
}

export function activeCapabilityIsStale(state: CapabilityInputState): boolean {
  return state.activeStructuralKind === "retained-pin" &&
    JSON.stringify(state.retainedPin.draft) !==
      JSON.stringify(pinDraftFromApplied(state.retainedPin.applied));
}
