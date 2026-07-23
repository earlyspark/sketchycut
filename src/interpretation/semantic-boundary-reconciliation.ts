import {
  SemanticAspectSchema,
  SemanticInterpretationSchema,
  type SemanticInterpretation
} from "./semantic-interpretation.js";
import { SourceEvidenceIndexSchema, type SourceEvidenceIndex } from "./source-evidence.js";
import type { z } from "zod";

export const SEMANTIC_BOUNDARY_RECONCILIATION_POLICY_VERSION =
  "semantic-boundary-authorization-v4" as const;

export type SemanticBoundaryFinding = {
  code:
    | "REFERENCE_ROLE_AUTHORITY_INVALID"
    | "REFERENCE_OPERATION_AUTHORITY_INVALID"
    | "INVENTORY_CONFLICT_PRECEDENCE_UNVERIFIED"
    | "INVENTORY_PROJECTION_COVERAGE_MISMATCH";
  itemId: string;
};

function referenceAllowsAspect(
  source: SourceEvidenceIndex,
  evidenceId: string,
  aspect: z.infer<typeof SemanticAspectSchema>,
): boolean {
  const reference = source.references.find((candidate) => candidate.evidenceId === evidenceId);
  if (reference === undefined) return true;
  if (aspect === "operation") return false;
  if (aspect === "context") return true;
  return reference.declaredRoles.includes(aspect);
}

export function reconcileSemanticInterpretationBoundary(input: {
  interpretation: unknown;
  sourceEvidenceIndex: SourceEvidenceIndex;
}): { interpretation: SemanticInterpretation; findings: SemanticBoundaryFinding[] } {
  const interpretation = SemanticInterpretationSchema.parse(input.interpretation);
  const source = SourceEvidenceIndexSchema.parse(input.sourceEvidenceIndex);
  const accounting = new Map(
    interpretation.projection.accounting.map((record) => [record.itemId, record]),
  );
  const findings: SemanticBoundaryFinding[] = [];
  for (const item of interpretation.inventory.items) {
    const record = accounting.get(item.id);
    if (record?.state !== "bound") continue;
    if (item.evidenceBindings.some((binding) =>
      source.references.some((reference) => reference.evidenceId === binding.evidenceId) &&
      binding.aspect === "operation"
    )) {
      findings.push({ code: "REFERENCE_OPERATION_AUTHORITY_INVALID", itemId: item.id });
    }
    if (item.evidenceBindings.some((binding) =>
      !referenceAllowsAspect(source, binding.evidenceId, binding.aspect)
    )) {
      findings.push({ code: "REFERENCE_ROLE_AUTHORITY_INVALID", itemId: item.id });
    }
    const bindingCount = record.requirementIds.length + record.bodyIds.length +
      record.interfaceIds.length + record.relationIds.length + record.capabilityIds.length;
    if (bindingCount === 0) {
      findings.push({ code: "INVENTORY_PROJECTION_COVERAGE_MISMATCH", itemId: item.id });
    }
  }
  for (const relationship of interpretation.inventory.relationships) {
    if (relationship.kind !== "contradicts" || relationship.resolution !== "unresolved") continue;
    for (const itemId of [relationship.fromItemId, relationship.toItemId]) {
      if (accounting.get(itemId)?.state === "bound") {
        findings.push({ code: "INVENTORY_CONFLICT_PRECEDENCE_UNVERIFIED", itemId });
      }
    }
  }
  return {
    interpretation,
    findings
  };
}
