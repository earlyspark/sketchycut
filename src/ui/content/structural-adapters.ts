import type { StructuralProgramKind } from "../capability-input-state";

export type CapabilityInputRequirement = {
  id: "retained-wooden-pin";
  required: true;
};

export type StructuralProgramAdapterDeclaration = {
  structuralKind: StructuralProgramKind;
  capabilityInputs: readonly CapabilityInputRequirement[];
};

export const ORTHOGONAL_PANEL_ADAPTER = {
  structuralKind: "orthogonal-panel",
  capabilityInputs: []
} as const satisfies StructuralProgramAdapterDeclaration;

export const RETAINED_PIN_ADAPTER = {
  structuralKind: "retained-pin",
  capabilityInputs: [{ id: "retained-wooden-pin", required: true }]
} as const satisfies StructuralProgramAdapterDeclaration;

export const STRUCTURAL_PROGRAM_ADAPTERS = [
  ORTHOGONAL_PANEL_ADAPTER,
  RETAINED_PIN_ADAPTER
] as const;
