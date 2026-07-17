import type {
  DesignDocumentV1,
  ProjectionBundle
} from "../domain/contracts";
export type MotionPresentationCopy = {
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

export type RigidMotionPresentation = {
  kind: "rigid";
  restStateLabel: "Assembled";
  validationSummary: "No moving joint · rigid assembly";
};

export type RevoluteMotionPresentation = {
  kind: "revolute";
  constraintId: string;
  minimumDegrees: number;
  maximumDegrees: number;
  openStopDegrees: number;
  restStateLabel: string;
  endpointStateLabel: string;
  controlLabel: string;
  rangeAriaLabel: string;
  endpointContactText: string | null;
  midTravelText: string | null;
  endpointSelectionPartId: string | null;
  explanation: string | null;
  validationSummary: string;
};

export type PrismaticMotionPresentation = {
  kind: "prismatic";
  constraintId: string;
  minimumMm: number;
  maximumMm: number;
  openStopMm: number;
  removalPositionMm: number;
  removableRetainerPartIds: string[];
  restStateLabel: string;
  endpointStateLabel: string;
  removalStateLabel: string;
  controlLabel: string;
  rangeAriaLabel: string;
  endpointContactText: string | null;
  midTravelText: string | null;
  endpointSelectionPartId: string | null;
  explanation: string | null;
  removalExplanation: string | null;
  validationSummary: string;
};

export type ResolvedMotionPresentation =
  | RigidMotionPresentation
  | RevoluteMotionPresentation
  | PrismaticMotionPresentation;

export function resolveMotionPresentation(
  document: DesignDocumentV1,
  scene: ProjectionBundle["scene"],
  copy?: MotionPresentationCopy,
): ResolvedMotionPresentation {
  const sceneMotions = scene.motions ?? [];
  if (sceneMotions.length === 0) {
    return {
      kind: "rigid",
      restStateLabel: "Assembled",
      validationSummary: "No moving joint · rigid assembly"
    };
  }
  const joined = sceneMotions.map((motion) => {
    const constraint = document.motionConstraints.find(
      (candidate) => candidate.id === motion.constraintId,
    );
    if (constraint === undefined) {
      throw new Error(`Scene motion ${motion.id} references unknown constraint ${motion.constraintId}.`);
    }
    return { motion, constraint };
  });
  if (joined.length !== 1) {
    throw new Error("The guided workbench requires exactly one canonical movable constraint.");
  }
  const resolved = joined[0]!;
  const endpointSelectionPartId = copy === undefined || ![
    ...document.parts.map((part) => part.id),
    ...(document.externalStock ?? []).map((item) => item.id)
  ].includes(copy.endpointSelectionPartId)
    ? null
    : copy.endpointSelectionPartId;
  if (resolved.constraint.kind === "prismatic" && resolved.constraint.prismatic !== undefined) {
    if (resolved.motion.kind !== "prismatic" || resolved.constraint.range.unit !== "mm") {
      throw new Error("A prismatic guided motion must join a canonical millimetre scene motion.");
    }
    const minimumMm = resolved.constraint.range.minimum;
    const maximumMm = resolved.constraint.range.maximum;
    const openStopMm = resolved.constraint.prismatic.stops.open.positionUm / 1_000;
    const removalPositionMm =
      resolved.constraint.prismatic.states.removal.positionUm / 1_000;
    if (
      openStopMm < minimumMm ||
      openStopMm > maximumMm ||
      removalPositionMm <= openStopMm
    ) {
      throw new Error("Canonical open/removal positions are inconsistent with prismatic travel.");
    }
    return {
      kind: "prismatic",
      constraintId: resolved.constraint.id,
      minimumMm,
      maximumMm,
      openStopMm,
      removalPositionMm,
      removableRetainerPartIds:
        resolved.constraint.prismatic.states.removal.retainerPartIds,
      restStateLabel: copy?.restStateLabel ?? "Closed",
      endpointStateLabel: copy?.endpointStateLabel ?? "Open",
      removalStateLabel: copy?.removalStateLabel ?? "Removal",
      controlLabel: copy?.controlLabel ?? resolved.constraint.id,
      rangeAriaLabel: copy?.rangeAriaLabel ?? `${resolved.constraint.id} distance`,
      endpointContactText: copy?.endpointContactText ?? null,
      midTravelText: copy?.midTravelText ?? null,
      endpointSelectionPartId,
      explanation: copy?.explanation ?? null,
      removalExplanation: copy?.removalExplanation ?? null,
      validationSummary: `One sliding joint · ${String(minimumMm)}–${String(maximumMm)} mm`
    };
  }
  if (
    resolved.constraint.kind !== "revolute" ||
    resolved.constraint.revolute === undefined ||
    resolved.motion.kind !== "revolute"
  ) {
    throw new Error(`Unsupported guided motion kind ${resolved.constraint.kind}.`);
  }
  if (resolved.constraint.range.unit !== "degree") {
    throw new Error("A revolute guided motion must use canonical degree units.");
  }
  const minimumDegrees = resolved.constraint.range.minimum;
  const maximumDegrees = resolved.constraint.range.maximum;
  const openStopDegrees = resolved.constraint.revolute.stops.open.angleDegrees;
  if (openStopDegrees < minimumDegrees || openStopDegrees > maximumDegrees) {
    throw new Error("The canonical open stop is outside the revolute motion range.");
  }
  return {
    kind: "revolute",
    constraintId: resolved.constraint.id,
    minimumDegrees,
    maximumDegrees,
    openStopDegrees,
    restStateLabel: copy?.restStateLabel ?? resolved.constraint.id,
    endpointStateLabel: copy?.endpointStateLabel ?? "Open",
    controlLabel: copy?.controlLabel ?? resolved.constraint.id,
    rangeAriaLabel: copy?.rangeAriaLabel ?? `${resolved.constraint.id} angle`,
    endpointContactText: copy?.endpointContactText ?? null,
    midTravelText: copy?.midTravelText ?? null,
    endpointSelectionPartId,
    explanation: copy?.explanation ?? null,
    validationSummary: `One rotating joint · ${String(minimumDegrees)}–${String(maximumDegrees)}°`
  };
}
