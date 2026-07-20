import { z } from "zod";

import type { GenerationOutcomeV2 } from "./generation-outcome-v2.js";
import type { IntentGraphV2 } from "./intent-graph-v2.js";

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
  outcome: z.enum(["supported", "simplified", "concept-only", "failure"]),
  telemetryVersion: z.literal(ELICITATION_TELEMETRY_VERSION)
}).strict();

export type ElicitationTelemetryV1 = z.infer<typeof ElicitationTelemetryV1Schema>;

function selectedSizing(outcome: GenerationOutcomeV2) {
  return outcome.kind === "supported" || outcome.kind === "simplified"
    ? outcome.source.selectedSizing
    : null;
}

export function createElicitationTelemetryV1(input: {
  semanticSource: "fresh-dispatch" | "cache-hit";
  referenceCount: number;
  intent: IntentGraphV2 | null;
  outcome: GenerationOutcomeV2;
}): ElicitationTelemetryV1 {
  if (!Number.isInteger(input.referenceCount) || input.referenceCount < 0 || input.referenceCount > 3) {
    throw new Error("ELICITATION_TELEMETRY_REFERENCE_COUNT_INVALID");
  }
  const sizing = selectedSizing(input.outcome);
  const countsPopulated = input.intent !== null && (
    input.intent.objects.some((item) => item.quantity !== null) ||
    input.intent.organization.some((item) =>
      item.desiredSpaceCount !== null || item.rows !== null || item.columns !== null
    )
  );
  const topologyPopulated = input.intent !== null && (
    input.intent.access.length > 0 ||
    input.intent.organization.length > 0 ||
    input.intent.interfaces.length > 0
  );
  return ElicitationTelemetryV1Schema.parse({
    schemaVersion: "1.0",
    semanticSource: input.semanticSource,
    referenceCountBucket: input.referenceCount === 0 ? "zero" : "one-to-three",
    proportionRelation: sizing?.canonicalDefaultProportions.used === true
      ? "canonical-default-proportions"
      : input.intent !== null && input.intent.proportions.length > 0
        ? "populated"
        : "empty",
    permittedCounts: countsPopulated ? "populated" : "empty",
    nonProjectScaleEvidence: input.intent !== null && input.intent.scaleEvidence.length > 0
      ? "populated"
      : "empty",
    accessTopologySemantics: topologyPopulated ? "populated" : "empty",
    unanchoredFallback: sizing?.fallback.used === true ? "used" : "unused",
    outcome: input.outcome.kind,
    telemetryVersion: ELICITATION_TELEMETRY_VERSION
  });
}
