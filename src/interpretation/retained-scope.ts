import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";
import { StableIdSchema } from "../domain/primitives.js";
import {
  ClosedSemanticProjectionSchema,
  SemanticInterpretationSchema,
  type ClosedSemanticProjection,
  type SemanticInterpretation
} from "./semantic-interpretation.js";
import {
  SubstitutionSearchTraceSchema,
  type SubstitutionSearchTrace
} from "./substitution-graph.js";

export const CURRENT_RETAINED_SCOPE_POLICY_VERSION =
  "retained-scope-v3" as const;
export const RETAINED_SCOPE_MAX_OMISSION_DEPTH = 3 as const;
export const RETAINED_SCOPE_MAX_ELIGIBLE_ITEMS = 4 as const;
export const RETAINED_SCOPE_MAX_CANDIDATES = 14 as const;

const RETAINED_SCOPE_HARD_REQUIREMENT_KINDS = [
  "containment",
  "support",
  "access",
  "closure",
  "rigid-interface",
  "permitted-stock"
] as const;

const RetainedScopeDisclosureSchema = z.object({
  semanticId: StableIdSchema,
  code: z.literal("DETERMINISTIC_RETAINED_SCOPE_OMISSION"),
  message: z.string().min(1).max(900)
}).strict();

export const RetainedScopeDecisionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  policyVersion: z.literal(CURRENT_RETAINED_SCOPE_POLICY_VERSION),
  omittedInventoryItemIds: z.array(StableIdSchema),
  omittedRequirementIds: z.array(StableIdSchema),
  disclosures: z.array(RetainedScopeDisclosureSchema)
}).strict().superRefine((decision, context) => {
  const sortedUnique = (values: readonly string[]): boolean =>
    values.every((value, index) =>
      index === 0 || values[index - 1]! < value
    );
  if (
    !sortedUnique(decision.omittedInventoryItemIds) ||
    !sortedUnique(decision.omittedRequirementIds)
  ) {
    context.addIssue({
      code: "custom",
      message: "Retained-scope semantic ID arrays must be uniquely sorted."
    });
  }
  if (
    JSON.stringify(decision.disclosures.map((item) => item.semanticId)) !==
      JSON.stringify(decision.omittedInventoryItemIds)
  ) {
    context.addIssue({
      code: "custom",
      message: "Every retained-scope inventory omission requires exactly one ordered disclosure."
    });
  }
});

export type RetainedScopeDecision = z.infer<
  typeof RetainedScopeDecisionSchema
>;

export type RetainedScopeCandidate = {
  planningProjection: ClosedSemanticProjection;
  decision: RetainedScopeDecision;
};

export type RetainedScopeEnumerationResult =
  | {
      kind: "complete";
      policyVersion: typeof CURRENT_RETAINED_SCOPE_POLICY_VERSION;
      eligibleItemIds: string[];
      rootCombinationCount: number;
      candidates: RetainedScopeCandidate[];
    }
  | {
      kind: "fail-closed";
      policyVersion: typeof CURRENT_RETAINED_SCOPE_POLICY_VERSION;
      code:
        | "RETAINED_SCOPE_ELIGIBLE_DOMAIN_EXCEEDED"
        | "RETAINED_SCOPE_CANDIDATE_BOUND_EXCEEDED";
      eligibleItemIds: string[];
      maximumEligibleItemCount:
        typeof RETAINED_SCOPE_MAX_ELIGIBLE_ITEMS;
      maximumRootCombinationCount:
        typeof RETAINED_SCOPE_MAX_CANDIDATES;
    };

const POLICY = {
  version: CURRENT_RETAINED_SCOPE_POLICY_VERSION,
  maximumOmissionDepth: RETAINED_SCOPE_MAX_OMISSION_DEPTH,
  maximumEligibleItems: RETAINED_SCOPE_MAX_ELIGIBLE_ITEMS,
  maximumCandidates: RETAINED_SCOPE_MAX_CANDIDATES,
  hardRequirementKinds: RETAINED_SCOPE_HARD_REQUIREMENT_KINDS,
  anchorBodyRoles: ["primary-enclosure", "support"],
  wholeBranchOmissionAccountingReason: "EVIDENCE_INSUFFICIENT",
  wholeBranchOmissionRequiredState: "uncertain",
  wholeBranchOmissionRequiredEvidenceSupport: "direct",
  protectedAccountingReasons: [
    "EVIDENCE_CONFLICT",
    "PROJECTION_COVERAGE_MISMATCH"
  ],
  dependencyClosure: "reverse-depends-on"
} as const;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export async function retainedScopePolicyHash(): Promise<string> {
  return hashCanonical(POLICY);
}

export function initialRetainedScopeDecision(): RetainedScopeDecision {
  return RetainedScopeDecisionSchema.parse({
    schemaVersion: "1.0",
    policyVersion: CURRENT_RETAINED_SCOPE_POLICY_VERSION,
    omittedInventoryItemIds: [],
    omittedRequirementIds: [],
    disclosures: []
  });
}

function retainedItemIds(
  ids: readonly string[],
  omitted: ReadonlySet<string>,
): string[] {
  return ids.filter((id) => !omitted.has(id));
}

function pruneProjection(input: {
  interpretation: SemanticInterpretation;
  omittedItemIds: readonly string[];
}): RetainedScopeCandidate {
  const omitted = new Set(input.omittedItemIds);
  const source = input.interpretation.projection;
  const requirements = source.requirements.flatMap((requirement) => {
    const inventoryItemIds = retainedItemIds(
      requirement.inventoryItemIds,
      omitted,
    );
    return inventoryItemIds.length === 0
      ? []
      : [{ ...requirement, inventoryItemIds }];
  });
  const requirementIds = new Set(requirements.map((item) => item.id));
  const constructionBodies = source.constructionBodies.flatMap((body) => {
    const inventoryItemIds = retainedItemIds(body.inventoryItemIds, omitted);
    const requirementIdsForBody = body.requirementIds.filter((id) =>
      requirementIds.has(id)
    );
    return inventoryItemIds.length === 0 || requirementIdsForBody.length === 0
      ? []
      : [{
          ...body,
          inventoryItemIds,
          requirementIds: requirementIdsForBody
        }];
  });
  const bodyIds = new Set(constructionBodies.map((item) => item.id));
  const objects = source.objects.flatMap((object) => {
    const inventoryItemIds = retainedItemIds(object.inventoryItemIds, omitted);
    return inventoryItemIds.length === 0
      ? []
      : [{ ...object, inventoryItemIds }];
  });
  const objectIds = new Set(objects.map((item) => item.id));
  const interfaces = source.interfaces.flatMap((item) => {
    const inventoryItemIds = retainedItemIds(item.inventoryItemIds, omitted);
    const requirementIdsForInterface = item.requirementIds.filter((id) =>
      requirementIds.has(id)
    );
    return inventoryItemIds.length === 0 ||
      requirementIdsForInterface.length === 0 ||
      item.betweenBodyIds.some((id) => !bodyIds.has(id))
      ? []
      : [{
          ...item,
          inventoryItemIds,
          requirementIds: requirementIdsForInterface
        }];
  });
  const interfaceIds = new Set(interfaces.map((item) => item.id));
  const withOwnedItemIds = <
    T extends { inventoryItemIds: string[] }
  >(items: readonly T[]): T[] => items.flatMap((item) => {
    const inventoryItemIds = retainedItemIds(item.inventoryItemIds, omitted);
    return inventoryItemIds.length === 0
      ? []
      : [{ ...item, inventoryItemIds }];
  });
  const access = withOwnedItemIds(source.access).filter((item) =>
    bodyIds.has(item.bodyId) && requirementIds.has(item.requirementId)
  );
  const organization = withOwnedItemIds(source.organization).filter((item) =>
    bodyIds.has(item.bodyId) && requirementIds.has(item.requirementId)
  );
  const scaleEvidence = withOwnedItemIds(source.scaleEvidence).filter((item) =>
    objectIds.has(item.objectId)
  );
  const proportions = withOwnedItemIds(source.proportions).filter((item) =>
    bodyIds.has(item.targetBodyId)
  );
  const clearance = withOwnedItemIds(source.clearance).filter((item) =>
    objectIds.has(item.objectId)
  );
  const rankedGoals = withOwnedItemIds(source.rankedGoals);
  const cutThrough = withOwnedItemIds(source.cutThrough).filter((item) =>
    bodyIds.has(item.bodyId) && requirementIds.has(item.requirementId)
  );
  const motifInventoryItemIds = source.motif === null
    ? []
    : retainedItemIds(source.motif.inventoryItemIds, omitted);
  const motif = source.motif === null || motifInventoryItemIds.length === 0
    ? null
    : { ...source.motif, inventoryItemIds: motifInventoryItemIds };
  const accounting: ClosedSemanticProjection["accounting"] = [];
  for (const record of source.accounting) {
    if (omitted.has(record.itemId)) continue;
    if (record.state !== "bound") {
      accounting.push(record);
      continue;
    }
    const next = {
      ...record,
      requirementIds: record.requirementIds.filter((id) =>
        requirementIds.has(id)
      ),
      bodyIds: record.bodyIds.filter((id) => bodyIds.has(id)),
      interfaceIds: record.interfaceIds.filter((id) => interfaceIds.has(id))
    };
    if (next.requirementIds.length +
      next.bodyIds.length +
      next.interfaceIds.length +
      next.relationIds.length +
      next.capabilityIds.length > 0) {
      accounting.push(next);
    }
  }
  const planningProjection = ClosedSemanticProjectionSchema.parse({
    requirements,
    constructionBodies,
    objects,
    interfaces,
    access,
    organization,
    scaleEvidence,
    proportions,
    clearance,
    rankedGoals,
    motif,
    cutThrough,
    accounting
  });
  const omittedRequirementIds = uniqueSorted(
    source.requirements.flatMap((requirement) =>
      requirementIds.has(requirement.id) ? [] : [requirement.id]
    ),
  );
  const omittedInventoryItemIds = uniqueSorted(input.omittedItemIds);
  return {
    planningProjection,
    decision: RetainedScopeDecisionSchema.parse({
      schemaVersion: "1.0",
      policyVersion: CURRENT_RETAINED_SCOPE_POLICY_VERSION,
      omittedInventoryItemIds,
      omittedRequirementIds,
      disclosures: omittedInventoryItemIds.map((semanticId) => ({
        semanticId,
        code: "DETERMINISTIC_RETAINED_SCOPE_OMISSION",
        message:
          `Inventory item ${semanticId} was omitted by the deterministic retained-scope fallback after the complete candidate did not pass registered construction gates.`
      }))
    })
  };
}

export function planningProjectionForRetainedScope(input: {
  interpretation: SemanticInterpretation;
  decision: RetainedScopeDecision;
  substitutionTrace?: SubstitutionSearchTrace;
}): ClosedSemanticProjection {
  const interpretation = SemanticInterpretationSchema.parse(
    input.interpretation,
  );
  const decision = RetainedScopeDecisionSchema.parse(input.decision);
  if (decision.omittedInventoryItemIds.length === 0) {
    if (
      decision.omittedRequirementIds.length !== 0 ||
      decision.disclosures.length !== 0
    ) {
      throw new Error("RETAINED_SCOPE_EMPTY_DECISION_INVALID");
    }
    return interpretation.projection;
  }
  const enumeration = enumerateRetainedScopeCandidates({
    interpretation,
    ...(input.substitutionTrace === undefined
      ? {}
      : { substitutionTrace: input.substitutionTrace })
  });
  const candidate = enumeration.kind === "complete"
    ? enumeration.candidates.find((item) =>
    JSON.stringify(item.decision) === JSON.stringify(decision)
    )
    : undefined;
  if (candidate === undefined) {
    throw new Error("RETAINED_SCOPE_DECISION_NOT_AUTHORIZED");
  }
  return candidate.planningProjection;
}

function omissionClosure(input: {
  seedItemIds: readonly string[];
  interpretation: SemanticInterpretation;
  protectedItemIds: ReadonlySet<string>;
}): string[] | null {
  const omitted = new Set(input.seedItemIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const relationship of input.interpretation.inventory.relationships) {
      if (
        relationship.kind === "depends-on" &&
        omitted.has(relationship.toItemId) &&
        !omitted.has(relationship.fromItemId)
      ) {
        omitted.add(relationship.fromItemId);
        changed = true;
      }
    }
  }
  return [...omitted].some((id) => input.protectedItemIds.has(id))
    ? null
    : uniqueSorted([...omitted]);
}

function stableIdCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rootCombinations(
  eligibleItemIds: readonly string[],
): string[][] {
  const combinations: string[][] = [];
  const visit = (start: number, selected: string[]): void => {
    if (selected.length > 0) combinations.push(selected);
    if (selected.length >= RETAINED_SCOPE_MAX_OMISSION_DEPTH) return;
    for (let index = start; index < eligibleItemIds.length; index += 1) {
      visit(index + 1, [...selected, eligibleItemIds[index]!]);
    }
  };
  visit(0, []);
  return combinations;
}

export function enumerateRetainedScopeCandidates(input: {
  interpretation: SemanticInterpretation;
  substitutionTrace?: SubstitutionSearchTrace;
}): RetainedScopeEnumerationResult {
  const interpretation = SemanticInterpretationSchema.parse(
    input.interpretation,
  );
  const substitutionTrace = input.substitutionTrace === undefined
    ? null
    : SubstitutionSearchTraceSchema.parse(input.substitutionTrace);
  const substitutedItemIds = new Set(
    substitutionTrace?.appliedSubstitutions.flatMap((application) =>
      application.affectedSemanticIds
    ) ?? [],
  );
  const measurementItemIds = new Set(
    interpretation.inventory.measurementTargets.map((item) =>
      item.inventoryItemId
    ),
  );
  const hardRequirementItemIds = new Set(
    interpretation.projection.requirements.flatMap((requirement) =>
      RETAINED_SCOPE_HARD_REQUIREMENT_KINDS.includes(
        requirement.kind as typeof RETAINED_SCOPE_HARD_REQUIREMENT_KINDS[number],
      )
        ? requirement.inventoryItemIds
        : []
    ),
  );
  const usableAccessApertureItemIds = new Set(
    interpretation.projection.cutThrough.flatMap((application) =>
      application.purpose === "access" || application.fixedTopAccess
        ? application.inventoryItemIds
        : []
    ),
  );
  const directlyEvidencedInsufficientItemIds = new Set(
    interpretation.projection.accounting.flatMap((record) => {
      if (
        record.state !== "uncertain" ||
        record.reason !== "EVIDENCE_INSUFFICIENT"
      ) {
        return [];
      }
      const item = interpretation.inventory.items.find((candidate) =>
        candidate.id === record.itemId
      );
      return item?.evidenceBindings.some((binding) =>
        binding.support === "direct"
      )
        ? [record.itemId]
        : [];
    }),
  );
  const protectedAccountingItemIds = new Set(
    interpretation.projection.accounting.flatMap((record) =>
      record.reason === "EVIDENCE_CONFLICT" ||
      record.reason === "PROJECTION_COVERAGE_MISMATCH" ||
      (
        record.reason === "EVIDENCE_INSUFFICIENT" &&
        !directlyEvidencedInsufficientItemIds.has(record.itemId)
      )
        ? [record.itemId]
        : []
    ),
  );
  const protectedItemIds = new Set([
    ...hardRequirementItemIds,
    ...usableAccessApertureItemIds,
    ...measurementItemIds,
    ...substitutedItemIds,
    ...protectedAccountingItemIds
  ]);
  const eligibleItemIds = interpretation.inventory.items.flatMap((item) =>
    item.importance !== "context" && !protectedItemIds.has(item.id)
      ? [item.id]
      : []
  ).sort(stableIdCompare);
  if (eligibleItemIds.length > RETAINED_SCOPE_MAX_ELIGIBLE_ITEMS) {
    return {
      kind: "fail-closed",
      policyVersion: CURRENT_RETAINED_SCOPE_POLICY_VERSION,
      code: "RETAINED_SCOPE_ELIGIBLE_DOMAIN_EXCEEDED",
      eligibleItemIds,
      maximumEligibleItemCount: RETAINED_SCOPE_MAX_ELIGIBLE_ITEMS,
      maximumRootCombinationCount: RETAINED_SCOPE_MAX_CANDIDATES
    };
  }
  const roots = rootCombinations(eligibleItemIds);
  if (roots.length > RETAINED_SCOPE_MAX_CANDIDATES) {
    return {
      kind: "fail-closed",
      policyVersion: CURRENT_RETAINED_SCOPE_POLICY_VERSION,
      code: "RETAINED_SCOPE_CANDIDATE_BOUND_EXCEEDED",
      eligibleItemIds,
      maximumEligibleItemCount: RETAINED_SCOPE_MAX_ELIGIBLE_ITEMS,
      maximumRootCombinationCount: RETAINED_SCOPE_MAX_CANDIDATES
    };
  }
  const itemById = new Map(
    interpretation.inventory.items.map((item) => [item.id, item]),
  );
  const candidateRank = (
    candidate: RetainedScopeCandidate,
  ): [number, number, number, string] => [
    candidate.decision.omittedInventoryItemIds.filter((itemId) =>
      itemById.get(itemId)?.importance === "essential"
    ).length,
    candidate.decision.omittedInventoryItemIds.length,
    candidate.decision.omittedRequirementIds.length,
    candidate.decision.omittedInventoryItemIds.join("\u0000")
  ];
  const compareCandidates = (
    left: RetainedScopeCandidate,
    right: RetainedScopeCandidate,
  ): number => {
    const leftRank = candidateRank(left);
    const rightRank = candidateRank(right);
    return leftRank[0] - rightRank[0] ||
      leftRank[1] - rightRank[1] ||
      leftRank[2] - rightRank[2] ||
      stableIdCompare(leftRank[3], rightRank[3]);
  };
  const candidateForRoots = (
    rootItemIds: string[],
  ): RetainedScopeCandidate | null => {
    const closure = omissionClosure({
      seedItemIds: rootItemIds,
      interpretation,
      protectedItemIds
    });
    return closure === null
      ? null
      : pruneProjection({
          interpretation,
          omittedItemIds: closure
        });
  };
  const candidates = new Map<string, RetainedScopeCandidate>();
  for (const rootItemIds of roots) {
    const candidate = candidateForRoots(rootItemIds);
    if (candidate === null) continue;
    const key = candidate.decision.omittedInventoryItemIds.join(
      "\u0000",
    );
    if (!candidates.has(key)) {
      candidates.set(key, candidate);
    }
  }
  return {
    kind: "complete",
    policyVersion: CURRENT_RETAINED_SCOPE_POLICY_VERSION,
    eligibleItemIds,
    rootCombinationCount: roots.length,
    candidates: [...candidates.values()].sort(compareCandidates)
  };
}
