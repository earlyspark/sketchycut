import { describe, expect, it } from "vitest";

import { createStarterFabricationSetup } from "../../src/index.js";
import {
  activeCapabilityIsStale,
  capabilityInputReducer,
  createCapabilityInputState
} from "../../src/ui/capability-input-state.js";
import { evaluateRetainedPinDraft } from "../../src/ui/setup-draft.js";

describe("capability-specific draft/applied state", () => {
  it("keeps the shared starter setup free of mandatory hardware", () => {
    const starter = createStarterFabricationSetup();
    expect(starter).not.toHaveProperty("pin");
    expect(starter.stockFootprint).toBeNull();
  });

  it("preserves an invalid dormant pin draft without making a pinless adapter stale", () => {
    let state = createCapabilityInputState("retained-pin");
    state = capabilityInputReducer(state, {
      type: "edit-retained-pin",
      draft: { basis: "user-reported-caliper", diameter: "" }
    });
    expect(evaluateRetainedPinDraft(state.retainedPin.draft).status).toBe("invalid");
    expect(activeCapabilityIsStale(state)).toBe(true);

    state = capabilityInputReducer(state, {
      type: "activate",
      structuralKind: "orthogonal-panel"
    });
    expect(activeCapabilityIsStale(state)).toBe(false);
    expect(state.retainedPin.draft).toEqual({
      basis: "user-reported-caliper",
      diameter: ""
    });

    state = capabilityInputReducer(state, {
      type: "activate",
      structuralKind: "retained-pin"
    });
    expect(activeCapabilityIsStale(state)).toBe(true);
    expect(state.retainedPin.draft.diameter).toBe("");
  });

  it("applies and discards retained-pin input independently from shared setup", () => {
    let state = createCapabilityInputState();
    state = capabilityInputReducer(state, {
      type: "edit-retained-pin",
      draft: { basis: "user-reported-caliper", diameter: "2.97" }
    });
    const evaluated = evaluateRetainedPinDraft(state.retainedPin.draft);
    expect(evaluated).toEqual({
      status: "valid",
      applied: { basis: "user-reported-caliper", effectiveDiameterMm: 2.97 }
    });
    if (evaluated.status !== "valid") throw new Error("Expected a valid measured pin.");
    state = capabilityInputReducer(state, {
      type: "apply-retained-pin",
      applied: evaluated.applied
    });
    expect(activeCapabilityIsStale(state)).toBe(false);
    expect(state.retainedPin.applied.effectiveDiameterMm).toBe(2.97);

    state = capabilityInputReducer(state, {
      type: "edit-retained-pin",
      draft: { basis: "user-reported-caliper", diameter: "2.91" }
    });
    state = capabilityInputReducer(state, { type: "discard-retained-pin" });
    expect(state.retainedPin.draft.diameter).toBe("2.97");
    expect(state.retainedPin.applied.effectiveDiameterMm).toBe(2.97);
  });
});
