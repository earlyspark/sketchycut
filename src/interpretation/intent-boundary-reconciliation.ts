import { IntentGraphV2Schema, type IntentGraphV2 } from "./intent-graph-v2.js";
import { SourceEvidenceIndexV1Schema, type SourceEvidenceIndexV1 } from "./source-evidence.js";

export const INTENT_BOUNDARY_RECONCILIATION_POLICY_VERSION =
  "intent-boundary-reconciliation-v2" as const;

type Observation = IntentGraphV2["referenceBrief"][number]["observations"][number];

function targetsOverlap(left: Observation, right: Observation): boolean {
  const bodyMatches = left.targetBodyRole === null || right.targetBodyRole === null ||
    left.targetBodyRole === right.targetBodyRole;
  const faceMatches = left.targetFaceRole === "unspecified" || right.targetFaceRole === "unspecified" ||
    left.targetFaceRole === "all" || right.targetFaceRole === "all" ||
    left.targetFaceRole === right.targetFaceRole;
  return bodyMatches && faceMatches;
}

function isRoleExcludedObservation(
  observation: Observation,
  siblings: readonly Observation[],
): boolean {
  if (observation.kind === "ornament" || observation.kind === "operation-character") return true;
  if (observation.kind !== "opening" || observation.value !== "repeated-apertures") return false;
  return siblings.some((candidate) =>
    targetsOverlap(observation, candidate) &&
    (candidate.kind === "ornament" ||
      (candidate.kind === "operation-character" && candidate.value === "cut-through-visible"))
  );
}

function citesOnly(ids: readonly string[], permitted: ReadonlySet<string>): boolean {
  return ids.length > 0 && ids.every((id) => permitted.has(id));
}

function fallbackObservation(input: {
  entry: IntentGraphV2["referenceBrief"][number];
  ordinal: number;
  existingIds: Set<string>;
}): Observation {
  let suffix = input.ordinal;
  let id = `role-filtered-reference-${String(suffix)}`;
  while (input.existingIds.has(id)) {
    suffix += 1;
    id = `role-filtered-reference-${String(suffix)}`;
  }
  input.existingIds.add(id);
  return {
    id,
    kind: "primary-subject",
    value: "unknown",
    targetBodyRole: null,
    targetFaceRole: "unspecified",
    salience: "secondary",
    confidence: "low",
    visibility: "uncertain",
    evidenceIds: [input.entry.referenceEvidenceId]
  };
}

/**
 * Reconciles strict model output before any topology, realization, or telemetry
 * consumer receives it. The operation is deterministic and idempotent so it is
 * also safe to apply to semantic-cache hits produced before this policy existed.
 */
export function reconcileIntentAtInterpretationBoundary(input: {
  intent: unknown;
  sourceEvidenceIndex: SourceEvidenceIndexV1;
}): IntentGraphV2 {
  const intent = IntentGraphV2Schema.parse(input.intent);
  const sourceEvidenceIndex = SourceEvidenceIndexV1Schema.parse(input.sourceEvidenceIndex);
  const structureOnlyEvidenceIds = new Set(sourceEvidenceIndex.references
    .filter((reference) => reference.declaredRoles.length === 1 && reference.declaredRoles[0] === "structure")
    .map((reference) => reference.evidenceId));

  const existingIds = new Set(intent.referenceBrief.flatMap((entry) =>
    entry.observations.map((observation) => observation.id)
  ));
  const strippedObservationIds = new Set<string>();
  const referenceBrief = intent.referenceBrief.map((entry, index) => {
    if (!structureOnlyEvidenceIds.has(entry.referenceEvidenceId)) return entry;
    const observations = entry.observations.filter((observation) => {
      const strip = isRoleExcludedObservation(observation, entry.observations);
      if (strip) strippedObservationIds.add(observation.id);
      return !strip;
    });
    return {
      ...entry,
      observations: observations.length > 0
        ? observations
        : [fallbackObservation({ entry, ordinal: index + 1, existingIds })]
    };
  });

  const cutThrough = intent.cutThrough
    .filter((item) => item.purpose === "access" || !citesOnly(item.evidenceIds, structureOnlyEvidenceIds))
    .map((item) => item.patternFamily === "ring-aperture" &&
      item.purpose === "access" && item.targetFaceRoles.includes("cover")
      ? { ...item, fixedTopAccess: true }
      : item);
  const retainedCutThroughRequirementIds = new Set(cutThrough.map((item) => item.requirementId));
  const requirementIdsUsedOutsideTreatment = new Set([
    ...intent.access.map((item) => item.requirementId),
    ...intent.organization.map((item) => item.requirementId),
    ...intent.interfaces.flatMap((item) => item.requirementIds)
  ]);
  const removedRequirementIds = new Set(intent.requirements.filter((requirement) =>
    (requirement.kind === "cut-through-treatment" || requirement.kind === "visual-treatment") &&
    citesOnly(requirement.evidenceIds, structureOnlyEvidenceIds) &&
    !retainedCutThroughRequirementIds.has(requirement.id) &&
    !requirementIdsUsedOutsideTreatment.has(requirement.id)
  ).map((requirement) => requirement.id));
  for (const body of intent.constructionBodies) {
    if (body.requirementIds.every((id) => removedRequirementIds.has(id))) {
      for (const id of body.requirementIds) removedRequirementIds.delete(id);
    }
  }
  if (intent.requirements.every((requirement) => removedRequirementIds.has(requirement.id))) {
    removedRequirementIds.delete(intent.requirements[0]!.id);
  }
  const requirements = intent.requirements.filter((requirement) => !removedRequirementIds.has(requirement.id));

  const candidate = {
    ...intent,
    requirements,
    constructionBodies: intent.constructionBodies.map((body) => ({
      ...body,
      requirementIds: body.requirementIds.filter((id) => !removedRequirementIds.has(id))
    })),
    motif: intent.motif !== null && citesOnly(intent.motif.evidenceIds, structureOnlyEvidenceIds)
      ? null
      : intent.motif,
    cutThrough,
    referenceBrief,
    conflicts: intent.conflicts.flatMap((conflict) => {
      const observationIds = conflict.observationIds.filter((id) => !strippedObservationIds.has(id));
      return observationIds.length === 0 ? [] : [{ ...conflict, observationIds }];
    }),
    unresolvedNeeds: intent.unresolvedNeeds.map((need) => ({
      ...need,
      requirementIds: need.requirementIds.filter((id) => !removedRequirementIds.has(id))
    }))
  };
  return IntentGraphV2Schema.parse(candidate);
}
