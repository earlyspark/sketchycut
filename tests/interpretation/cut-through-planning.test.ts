import { describe, expect, it } from "vitest";

import {
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/domain/fabrication-setup.js";
import { hashCanonical } from "../../src/domain/hash.js";
import { planIntentConditionedConstruction } from "../../src/interpretation/construction-planner.js";
import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import { generationOutcomeV2FromPlanner } from "../../src/interpretation/generation-outcome-v2.js";
import type { IntentGraphV2 } from "../../src/interpretation/intent-graph-v2.js";

function lanternIntent(requiredThermalOperation = false): IntentGraphV2 {
  const requirements: IntentGraphV2["requirements"] = [
    { id: "containment-required", priority: "must", kind: "containment", semanticSummary: "Form a static lantern enclosure.", evidenceIds: ["brief-evidence"] },
    { id: "covered-access-required", priority: "must", kind: "access", semanticSummary: "Use a retained fixed top with access aperture.", evidenceIds: ["brief-evidence"] },
    { id: "top-aperture-required", priority: "must", kind: "functional-aperture", semanticSummary: "Provide one circular top aperture.", evidenceIds: ["brief-evidence"] },
    { id: "wall-lattice-required", priority: "must", kind: "cut-through-treatment", semanticSummary: "Repeat a geometric lattice on the walls.", evidenceIds: ["brief-evidence"] },
    ...(requiredThermalOperation ? [{
      id: "thermal-operation-required",
      priority: "must" as const,
      kind: "thermal-source" as const,
      semanticSummary: "The construction must operate around a continuing combustion source.",
      evidenceIds: ["brief-evidence"]
    }] : [])
  ];
  return {
    schemaVersion: "2.4",
    title: "Static flameless lantern",
    purpose: "Build a glue-free fixed-top enclosure with registered light and ventilation apertures.",
    requirements,
    constructionBodies: [{
      id: "primary-body",
      role: "primary-enclosure",
      shapeClass: "orthogonal-shell",
      requirementIds: requirements.map((item) => item.id),
      evidenceIds: ["brief-evidence"]
    }],
    objects: [],
    interfaces: [],
    access: [{
      bodyId: "primary-body",
      kind: "covered",
      direction: "top",
      priority: "must",
      requirementId: "covered-access-required",
      evidenceIds: ["brief-evidence"]
    }],
    organization: [],
    scaleEvidence: [],
    proportions: [],
    clearance: [],
    rankedGoals: [{ id: "compactness-goal", kind: "compactness", rank: 1, evidenceIds: ["brief-evidence"] }],
    motif: null,
    cutThrough: [
      {
        id: "top-access-application",
        bodyId: "primary-body",
        targetFaceRoles: ["cover"],
        patternFamily: "ring-aperture",
        purpose: "access",
        density: "sparse",
        symmetry: "radial",
        repetition: "single-face",
        fixedTopAccess: true,
        priority: "must",
        requirementId: "top-aperture-required",
        evidenceIds: ["brief-evidence"]
      },
      {
        id: "wall-lattice-application",
        bodyId: "primary-body",
        targetFaceRoles: ["rear", "left", "right", "front"],
        patternFamily: "lattice-grid",
        purpose: "illumination-ventilation",
        density: "dense",
        symmetry: "translational",
        repetition: "matched-faces",
        fixedTopAccess: false,
        priority: "must",
        requirementId: "wall-lattice-required",
        evidenceIds: ["brief-evidence"]
      }
    ],
    referenceBrief: [{
      referenceEvidenceId: "reference-evidence",
      relationship: "reproduce",
      observations: [
        {
          id: "pictured-lattice",
          kind: "ornament",
          value: "lattice",
          targetBodyRole: "primary-enclosure",
          targetFaceRole: "all",
          salience: "dominant",
          confidence: "high",
          visibility: "visible",
          evidenceIds: ["reference-evidence"]
        },
        {
          id: "pictured-cut-through",
          kind: "operation-character",
          value: "cut-through-visible",
          targetBodyRole: "primary-enclosure",
          targetFaceRole: "all",
          salience: "dominant",
          confidence: "high",
          visibility: "visible",
          evidenceIds: ["reference-evidence"]
        }
      ]
    }],
    assumptions: [],
    conflicts: [],
    unresolvedNeeds: []
  };
}

async function plan(intent: IntentGraphV2) {
  const setup = resolveFabricationSetup(createPublicFabricationSetup());
  const explicitSizing = await reconcileExplicitSizingConstraints({
    advancedSizing: { basis: "auto" },
    parsedConstraints: [],
    parserFindings: []
  });
  const planning = await planIntentConditionedConstruction({
    intent,
    explicitConstraints: explicitSizing,
    profiles: {
      material: setup.material,
      machine: setup.machine,
      processRecipe: setup.processRecipe,
      fabricationContext: setup.fabricationContext,
      fit: setup.fit
    },
    inputPolicyEvaluation: setup.inputPolicyEvaluation,
    pin: createStarterPinSetup()
  });
  return { planning, explicitSizing };
}

describe("intent-conditioned cut-through planning", () => {
  it("selects a fixed-top zero-DOF construction and deterministically reduces density to the Studio budget", async () => {
    const intent = lanternIntent();
    const { planning, explicitSizing } = await plan(intent);
    expect(planning.kind, JSON.stringify(planning)).toBe("planned");
    if (planning.kind !== "planned") throw new Error("lantern not planned");
    const selected = planning.selected;
    const compiled = selected.compiled;
    if (compiled === null) throw new Error("lantern did not compile");
    const document = compiled.compiled.document;
    const lattice = document.cutThroughApplications?.find((item) => item.id === "wall-lattice-application");
    expect(selected.plan?.topology.mechanism).toBe("fixed-top-frame");
    expect(selected.plan?.mates.filter((mate) => mate.kind === "fixed-top-frame")).toHaveLength(4);
    expect(document.motionConstraints).toEqual([
      expect.objectContaining({ kind: "fixed", range: { minimum: 0, maximum: 0, unit: "mm" } })
    ]);
    expect(lattice).toMatchObject({
      requestedDensity: "dense",
      realizedDensity: "sparse",
      simplificationDisclosure: "Pattern density was reduced by deterministic import-complexity policy."
    });
    expect(compiled.importComplexity.every((item) => item.withinCurrentLimit)).toBe(true);
    expect(document.applicationLimitations).toEqual([
      expect.objectContaining({ code: "NON_HEATING_LIGHT_SOURCE_ONLY" })
    ]);
    expect(compiled.requirementRealization.records.find((item) =>
      item.requirementId === "wall-lattice-required"
    )).toMatchObject({ state: "simplified" });
    expect(compiled.observationRealization.records.filter((item) =>
      ["pictured-lattice", "pictured-cut-through"].includes(item.observationId)
    ).every((item) => item.state === "realized" && item.evidenceLinks.length > 0)).toBe(true);

    const digest = await hashCanonical({ proof: "m7-2-lantern" });
    const outcome = await generationOutcomeV2FromPlanner({
      requestId: "m7-2-lantern-outcome",
      transportMode: "fixture",
      semanticRequestDigest: digest,
      sourceEvidenceIndexDigest: digest,
      promptIdentity: "current-neutral-prompt",
      promptHash: digest,
      modelId: "fixture-model",
      cacheResult: "miss",
      attemptId: null,
      providerRequestId: null,
      intent,
      explicitSizing,
      planning
    });
    expect(outcome).toMatchObject({
      kind: "simplified",
      fabricationCandidate: true,
      exportAllowed: true,
      changedSemanticIds: ["wall-lattice-required"]
    });
    if (outcome.kind !== "simplified") throw new Error("expected disclosed density simplification");
    expect(outcome.simplificationDisclosures).toContain(
      "Pattern density was reduced by deterministic import-complexity policy.",
    );
  });

  it("rejects a required thermal operating condition before construction and creates no export authority", async () => {
    const intent = lanternIntent(true);
    const { planning, explicitSizing } = await plan(intent);
    expect(planning).toMatchObject({
      kind: "concept-only",
      findings: [expect.objectContaining({ code: "THERMAL_FIRE_INTENT_UNSUPPORTED" })]
    });
    const digest = await hashCanonical({ proof: "m7-2-open-flame" });
    const outcome = await generationOutcomeV2FromPlanner({
      requestId: "m7-2-open-flame-outcome",
      transportMode: "fixture",
      semanticRequestDigest: digest,
      sourceEvidenceIndexDigest: digest,
      promptIdentity: "current-neutral-prompt",
      promptHash: digest,
      modelId: "fixture-model",
      cacheResult: "miss",
      attemptId: null,
      providerRequestId: null,
      intent,
      explicitSizing,
      planning
    });
    expect(outcome).toMatchObject({
      kind: "concept-only",
      source: null,
      canonicalResult: null,
      fabricationCandidate: false,
      exportAllowed: false
    });
    if (outcome.kind !== "concept-only") throw new Error("open-flame intent was not withheld");
    expect(outcome.findingCodes).toContain("THERMAL_FIRE_INTENT_UNSUPPORTED");
  });
});
