import type {
  DesignDocumentV1,
  ProjectionBundle
} from "../domain/contracts";
import type { GuidedMotionPresentation } from "./content/guided-examples";

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

export type ResolvedMotionPresentation =
  | RigidMotionPresentation
  | RevoluteMotionPresentation;

export function resolveMotionPresentation(
  document: DesignDocumentV1,
  scene: ProjectionBundle["scene"],
  copy?: GuidedMotionPresentation,
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
  if (resolved.constraint.kind !== "revolute" || resolved.constraint.revolute === undefined) {
    throw new Error(`Unsupported guided motion kind ${resolved.constraint.kind}.`);
  }
  if (resolved.constraint.range.unit !== "degree") {
    throw new Error("A revolute guided motion must use canonical degree units.");
  }
  const endpointSelectionPartId = copy === undefined || ![
    ...document.parts.map((part) => part.id),
    ...(document.externalStock ?? []).map((item) => item.id)
  ].includes(copy.endpointSelectionPartId)
    ? null
    : copy.endpointSelectionPartId;
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
