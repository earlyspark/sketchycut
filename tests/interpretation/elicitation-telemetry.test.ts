import { describe, expect, it } from "vitest";

import { hashCanonical } from "../../src/domain/hash.js";
import {
  ElicitationTelemetryV1Schema,
  createElicitationTelemetryV1
} from "../../src/interpretation/elicitation-telemetry.js";
import { generationFailureV2, type GenerationOutcomeV2 } from "../../src/interpretation/generation-outcome-v2.js";
import type { IntentGraphV2 } from "../../src/interpretation/intent-graph-v2.js";

function intent(overrides: Partial<IntentGraphV2> = {}): IntentGraphV2 {
  return {
    schemaVersion: "2.2",
    title: "Private object title must not survive",
    purpose: "Private purpose must not survive into telemetry.",
    requirements: [{
      id: "containment-required",
      priority: "must",
      kind: "containment",
      semanticSummary: "Contain a secret named object.",
      evidenceIds: ["brief-secret-evidence"]
    }],
    constructionBodies: [{
      id: "private-primary-body",
      role: "primary-enclosure",
      shapeClass: "orthogonal-shell",
      requirementIds: ["containment-required"],
      evidenceIds: ["brief-secret-evidence"]
    }],
    objects: [{
      id: "private-object-id",
      role: "contained",
      engagement: "full-envelope",
      semanticLabel: "passport belonging to a named person",
      quantity: 4,
      fitCritical: false,
      evidenceIds: ["brief-secret-evidence"]
    }],
    interfaces: [],
    access: [],
    organization: [],
    scaleEvidence: [],
    proportions: [],
    clearance: [],
    rankedGoals: [],
    motif: null,
    referenceBrief: [],
    assumptions: [],
    conflicts: [],
    unresolvedNeeds: [],
    ...overrides
  };
}

function fabricationOutcome(input: {
  kind?: "supported" | "simplified";
  fallbackUsed?: boolean;
  canonicalDefaultUsed?: boolean;
} = {}): GenerationOutcomeV2 {
  return {
    kind: input.kind ?? "supported",
    source: {
      selectedSizing: {
        fallback: { used: input.fallbackUsed ?? false },
        canonicalDefaultProportions: { used: input.canonicalDefaultUsed ?? false }
      }
    }
  } as unknown as GenerationOutcomeV2;
}

describe("ElicitationTelemetryV1", () => {
  it("reduces strict intent and outcome data to the approved categorical fields", () => {
    const summary = createElicitationTelemetryV1({
      semanticSource: "fresh-dispatch",
      referenceCount: 3,
      intent: intent({
        access: [{
          bodyId: "private-primary-body",
          kind: "open-front",
          direction: "front",
          priority: "must",
          requirementId: "containment-required",
          evidenceIds: ["brief-secret-evidence"]
        }],
        proportions: [{
          id: "private-proportion-id",
          targetBodyId: "private-primary-body",
          numeratorAxis: "width",
          denominatorAxis: "depth",
          strength: "moderate",
          priority: "prefer",
          confidence: "high",
          evidenceIds: ["brief-secret-evidence"]
        }],
        scaleEvidence: [{
          id: "private-scale-id",
          objectId: "private-object-id",
          long: { minimumUm: 80_000, maximumUm: 90_000 },
          short: { minimumUm: 40_000, maximumUm: 50_000 },
          height: { minimumUm: 10_000, maximumUm: 20_000 },
          confidence: "medium",
          basis: "model-prior",
          evidenceIds: ["brief-secret-evidence"]
        }]
      }),
      outcome: fabricationOutcome({ fallbackUsed: true })
    });

    expect(summary).toEqual({
      schemaVersion: "1.0",
      semanticSource: "fresh-dispatch",
      referenceCountBucket: "one-to-three",
      proportionRelation: "populated",
      permittedCounts: "populated",
      nonProjectScaleEvidence: "populated",
      accessTopologySemantics: "populated",
      unanchoredFallback: "used",
      outcome: "supported",
      telemetryVersion: "elicitation-telemetry-v1"
    });
    const serialized = JSON.stringify(summary);
    for (const forbidden of [
      "passport", "named person", "private-", "brief-secret", "80000", "90000",
      "referenceId", "evidenceId", "userId", "sessionId", "geometry"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("gives canonical defaults precedence and represents failures without invented semantic data", async () => {
    const digest = await hashCanonical("telemetry-failure");
    expect(createElicitationTelemetryV1({
      semanticSource: "cache-hit",
      referenceCount: 0,
      intent: intent(),
      outcome: fabricationOutcome({ canonicalDefaultUsed: true })
    })).toMatchObject({
      proportionRelation: "canonical-default-proportions",
      permittedCounts: "populated"
    });
    expect(createElicitationTelemetryV1({
      semanticSource: "fresh-dispatch",
      referenceCount: 0,
      intent: null,
      outcome: generationFailureV2({
        requestId: "not-retained",
        transportMode: "fixture",
        semanticRequestDigest: digest,
        stage: "transport",
        code: "TRANSPORT_FAILED",
        retryable: true,
        attemptId: null
      })
    })).toMatchObject({
      permittedCounts: "empty",
      accessTopologySemantics: "empty",
      unanchoredFallback: "unused",
      outcome: "failure"
    });
    expect(() => createElicitationTelemetryV1({
      semanticSource: "fresh-dispatch",
      referenceCount: 4,
      intent: null,
      outcome: fabricationOutcome()
    })).toThrow("ELICITATION_TELEMETRY_REFERENCE_COUNT_INVALID");
  });

  it("keeps the summary schema closed", () => {
    expect(() => ElicitationTelemetryV1Schema.parse({
      schemaVersion: "1.0",
      telemetryVersion: "elicitation-telemetry-v1",
      semanticSource: "fresh-dispatch",
      referenceCountBucket: "zero",
      proportionRelation: "empty",
      permittedCounts: "empty",
      nonProjectScaleEvidence: "empty",
      accessTopologySemantics: "empty",
      unanchoredFallback: "unused",
      outcome: "supported",
      briefDigest: "reversible-private-input"
    })).toThrow();
  });
});
