import { z } from "zod";

export const CURRENT_FABRICATION_RELEASE_POLICY_VERSION =
  "fabrication-release-policy-v1" as const;

export const StructuralProgramKindSchema = z.enum([
  "orthogonal-panel",
  "retained-pin",
  "captured-slide"
]);

export type StructuralProgramKind = z.infer<typeof StructuralProgramKindSchema>;

export type FabricationReleaseDecision =
  | {
      policyVersion: typeof CURRENT_FABRICATION_RELEASE_POLICY_VERSION;
      exportAllowed: true;
      findingCode: null;
      reason: null;
    }
  | {
      policyVersion: typeof CURRENT_FABRICATION_RELEASE_POLICY_VERSION;
      exportAllowed: false;
      findingCode: "FABRICATION_EXPORT_WITHHELD_PENDING_STRUCTURAL_REDESIGN";
      reason: string;
    };

const WITHHELD_REASON =
  "Fabrication export for this moving-interface construction is withheld pending structural redesign and repeat physical verification.";

export function fabricationReleaseForStructuralKind(
  structuralKind: StructuralProgramKind,
): FabricationReleaseDecision {
  if (structuralKind === "orthogonal-panel") {
    return {
      policyVersion: CURRENT_FABRICATION_RELEASE_POLICY_VERSION,
      exportAllowed: true,
      findingCode: null,
      reason: null
    };
  }
  return {
    policyVersion: CURRENT_FABRICATION_RELEASE_POLICY_VERSION,
    exportAllowed: false,
    findingCode: "FABRICATION_EXPORT_WITHHELD_PENDING_STRUCTURAL_REDESIGN",
    reason: WITHHELD_REASON
  };
}

export function fabricationReleaseForMechanism(
  mechanism: "rigid" | "retained-pin" | "captured-slide",
): FabricationReleaseDecision {
  return fabricationReleaseForStructuralKind(
    mechanism === "retained-pin"
      ? "retained-pin"
      : mechanism === "captured-slide"
      ? "captured-slide"
      : "orthogonal-panel",
  );
}
