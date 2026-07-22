export const MVP_SAFE_OMISSION_POLICY_VERSION = "mvp-safe-omission-v2" as const;

type RequirementCandidate = {
  kind: string;
};

type ObservationCandidate = {
  kind: string;
  value: string;
  targetBodyRole: string | null;
  targetFaceRole: string;
};

export function isMvpOmittableRequirement(requirement: RequirementCandidate): boolean {
  return requirement.kind === "visual-treatment";
}

function targetsOverlap(left: ObservationCandidate, right: ObservationCandidate): boolean {
  const bodyMatches = left.targetBodyRole === null || right.targetBodyRole === null ||
    left.targetBodyRole === right.targetBodyRole;
  const faceMatches = left.targetFaceRole === "unspecified" || right.targetFaceRole === "unspecified" ||
    left.targetFaceRole === "all" || right.targetFaceRole === "all" ||
    left.targetFaceRole === right.targetFaceRole;
  return bodyMatches && faceMatches;
}

export function isMvpOmittableObservation(input: {
  observation: ObservationCandidate;
  siblingObservations: readonly ObservationCandidate[];
}): boolean {
  const { observation, siblingObservations } = input;
  if (observation.kind !== "ornament") return false;
  if (["lattice", "geometric"].includes(observation.value)) return false;
  if (observation.value === "botanical") return true;
  if (!["border", "field", "focal", "repeated"].includes(observation.value)) return false;
  return !siblingObservations.some((candidate) =>
    targetsOverlap(observation, candidate) && candidate.kind === "operation-character" &&
    candidate.value === "cut-through-visible"
  );
}

export function mvpRequirementOmissionDisclosure(requirementId: string): string {
  return `Visual treatment requirement ${requirementId} was omitted under the current MVP policy because no supported deterministic surface treatment was applied; the functional construction is unchanged.`;
}

export function mvpObservationOmissionDisclosure(observation: ObservationCandidate & { id: string }): string {
  const omittedFeature = observation.kind === "operation-character"
    ? "decorative cut-through motif"
    : observation.kind === "opening"
      ? "decorative repeated apertures"
      : "unsupported ornament";
  return `Reference observation ${observation.id} (${observation.kind}: ${observation.value}) was omitted under the current MVP policy as ${omittedFeature}; the functional construction is unchanged.`;
}
