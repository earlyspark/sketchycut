import { z } from "zod";

import type { GenerationOutcome } from "./generation-outcome.js";
import type { SemanticInterpretation } from "./semantic-interpretation.js";

export const ELICITATION_TELEMETRY_VERSION = "elicitation-telemetry-v1" as const;

const BinaryFieldStateSchema = z.enum(["populated", "empty"]);

export const ElicitationTelemetryV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  semanticSource: z.enum(["fresh-dispatch", "cache-hit"]),
  referenceCountBucket: z.enum(["zero", "one-to-three"]),
  proportionRelation: z.enum([
    "populated",
    "empty",
    "canonical-default-proportions"
  ]),
  permittedCounts: BinaryFieldStateSchema,
  nonProjectScaleEvidence: BinaryFieldStateSchema,
  accessTopologySemantics: BinaryFieldStateSchema,
  unanchoredFallback: z.enum(["used", "unused"]),
  outcome: z.enum(["supported", "simplified", "modified", "concept-only", "failure"]),
  telemetryVersion: z.literal(ELICITATION_TELEMETRY_VERSION)
}).strict();

export type ElicitationTelemetryV1 = z.infer<typeof ElicitationTelemetryV1Schema>;

function selectedSizing(outcome: GenerationOutcome) {
  return outcome.kind === "supported" ||
    outcome.kind === "simplified" ||
    outcome.kind === "modified"
    ? outcome.source.selectedSizing
    : null;
}

export function createElicitationTelemetryV1(input: {
  semanticSource: "fresh-dispatch" | "cache-hit";
  referenceCount: number;
  interpretation: SemanticInterpretation | null;
  outcome: GenerationOutcome;
}): ElicitationTelemetryV1 {
  if (!Number.isInteger(input.referenceCount) || input.referenceCount < 0 || input.referenceCount > 3) {
    throw new Error("ELICITATION_TELEMETRY_REFERENCE_COUNT_INVALID");
  }
  const sizing = selectedSizing(input.outcome);
  const countsPopulated = input.interpretation !== null && (
    input.interpretation.projection.objects.some((item) => item.quantity !== null) ||
    input.interpretation.projection.organization.length > 0
  );
  const topologyPopulated = input.interpretation !== null && (
    input.interpretation.projection.access.length > 0 ||
    input.interpretation.projection.organization.length > 0 ||
    input.interpretation.projection.interfaces.length > 0
  );
  return ElicitationTelemetryV1Schema.parse({
    schemaVersion: "1.0",
    semanticSource: input.semanticSource,
    referenceCountBucket: input.referenceCount === 0 ? "zero" : "one-to-three",
    proportionRelation: sizing?.canonicalDefaultProportions.used === true
      ? "canonical-default-proportions"
      : input.interpretation !== null && input.interpretation.projection.proportions.length > 0
        ? "populated"
        : "empty",
    permittedCounts: countsPopulated ? "populated" : "empty",
    nonProjectScaleEvidence: input.interpretation !== null && input.interpretation.projection.scaleEvidence.length > 0
      ? "populated"
      : "empty",
    accessTopologySemantics: topologyPopulated ? "populated" : "empty",
    unanchoredFallback: sizing?.fallback.used === true ? "used" : "unused",
    outcome: input.outcome.kind,
    telemetryVersion: ELICITATION_TELEMETRY_VERSION
  });
}
