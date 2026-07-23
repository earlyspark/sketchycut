import {
  ClosedSemanticProjectionSchema,
  type ClosedSemanticProjection
} from "../../src/interpretation/semantic-interpretation.js";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`TEST_PROJECTION_${label}_INVALID`);
  }
  return value as UnknownRecord;
}

function records(value: unknown, label: string): UnknownRecord[] {
  if (!Array.isArray(value)) throw new Error(`TEST_PROJECTION_${label}_INVALID`);
  return value.map((item) => record(item, label));
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function itemId(requirementId: string): string {
  return `inventory-${requirementId}`;
}

function itemIdsForRequirements(requirementIds: readonly string[], fallback: string): string[] {
  const result = requirementIds.map(itemId);
  return result.length === 0 ? [fallback] : result;
}

function cleanNode(node: UnknownRecord): UnknownRecord {
  const clean = { ...node };
  delete clean.semanticSummary;
  delete clean.semanticLabel;
  return clean;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Builds current closed semantic projections for deterministic unit tests.
 * It deliberately accepts only already-semantic typed fields; it performs no
 * natural-language interpretation and is not shipped in production code.
 */
export function closedProjectionForTest(candidate: unknown): ClosedSemanticProjection {
  const source = record(candidate, "ROOT");
  const rawRequirements = records(source.requirements ?? [], "REQUIREMENTS");
  const requirements: UnknownRecord[] = rawRequirements.map((node) => {
    const id = stringValue(node.id, "generic-commitment");
    return {
      ...cleanNode(node),
      inventoryItemIds: strings(node.inventoryItemIds).length > 0
        ? strings(node.inventoryItemIds)
        : [itemId(id)]
    };
  });
  const firstRequirementId = stringValue(rawRequirements[0]?.id, "generic-commitment");
  const fallbackItemId = itemId(firstRequirementId);

  const withRequirementItems = (node: UnknownRecord) => ({
    ...cleanNode(node),
    inventoryItemIds: strings(node.inventoryItemIds).length > 0
      ? strings(node.inventoryItemIds)
      : itemIdsForRequirements(strings(node.requirementIds), fallbackItemId)
  });
  const withSingleRequirementItem = (node: UnknownRecord) => ({
    ...cleanNode(node),
    inventoryItemIds: strings(node.inventoryItemIds).length > 0
      ? strings(node.inventoryItemIds)
      : [itemId(stringValue(node.requirementId, firstRequirementId))]
  });

  const constructionBodies: UnknownRecord[] = records(source.constructionBodies ?? [], "BODIES").map(withRequirementItems);
  const objects: UnknownRecord[] = records(source.objects ?? [], "OBJECTS").map((node) => ({
    ...cleanNode(node),
    inventoryItemIds: strings(node.inventoryItemIds).length > 0
      ? strings(node.inventoryItemIds)
      : [fallbackItemId]
  }));
  const objectItemIds = new Map(objects.map((node) => [stringValue(node.id, "unknown-object"), strings(node.inventoryItemIds)]));
  const bodyItemIds = new Map(constructionBodies.map((node) => [stringValue(node.id, "unknown-body"), strings(node.inventoryItemIds)]));
  const interfaces: UnknownRecord[] = records(source.interfaces ?? [], "INTERFACES").map(withRequirementItems);
  const access = records(source.access ?? [], "ACCESS").map((node) => ({
    ...withSingleRequirementItem(node),
    basis: node.basis ?? (
      node.kind === "covered"
        ? node.direction === "front" ? "explicit-covered-front" : "explicit-covered-top"
        : node.kind === "open-front" ? "explicit-open-front" : "explicit-open-top"
    )
  }));
  const organization = records(source.organization ?? [], "ORGANIZATION").map((node) => ({
    ...withSingleRequirementItem(node),
    basis: node.basis ?? (
      node.rows !== null && node.rows !== undefined
        ? "explicit-grid"
        : node.desiredSpaceCount === 1
          ? "explicit-single-space"
          : "explicit-count"
    )
  }));
  const scaleEvidence = records(source.scaleEvidence ?? [], "SCALE").map((node) => ({
    ...cleanNode(node),
    inventoryItemIds: strings(node.inventoryItemIds).length > 0
      ? strings(node.inventoryItemIds)
      : objectItemIds.get(String(node.objectId)) ?? [fallbackItemId]
  }));
  const proportions = records(source.proportions ?? [], "PROPORTIONS").map((node) => ({
    ...cleanNode(node),
    inventoryItemIds: strings(node.inventoryItemIds).length > 0
      ? strings(node.inventoryItemIds)
      : bodyItemIds.get(String(node.targetBodyId)) ?? [fallbackItemId]
  }));
  const clearance = records(source.clearance ?? [], "CLEARANCE").map((node) => ({
    ...cleanNode(node),
    inventoryItemIds: strings(node.inventoryItemIds).length > 0
      ? strings(node.inventoryItemIds)
      : objectItemIds.get(String(node.objectId)) ?? [fallbackItemId]
  }));
  const rankedGoals = records(source.rankedGoals ?? [], "GOALS").map((node) => ({
    ...cleanNode(node),
    inventoryItemIds: strings(node.inventoryItemIds).length > 0
      ? strings(node.inventoryItemIds)
      : [fallbackItemId]
  }));
  const motif = source.motif === null || source.motif === undefined
    ? null
    : { ...cleanNode(record(source.motif, "MOTIF")), inventoryItemIds: [fallbackItemId] };
  const cutThrough = records(source.cutThrough ?? [], "CUT_THROUGH").map(withSingleRequirementItem);

  const accounting = requirements.map((requirement) => {
    const requirementId = stringValue(requirement.id, "generic-commitment");
    const currentItemId = itemId(requirementId);
    return {
      itemId: currentItemId,
      state: "bound" as const,
      requirementIds: [requirementId],
      bodyIds: constructionBodies.filter((node) => strings(node.inventoryItemIds).includes(currentItemId)).map((node) => stringValue(node.id, "unknown-body")),
      interfaceIds: interfaces.filter((node) => strings(node.inventoryItemIds).includes(currentItemId)).map((node) => stringValue(node.id, "unknown-interface")),
      relationIds: [],
      capabilityIds: ["rigid-orthogonal-sheet-assembly"],
      deferredByEvidenceIds: [],
      reason: null,
    };
  });
  return ClosedSemanticProjectionSchema.parse({
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
}
