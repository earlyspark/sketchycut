import { describe, expect, it } from "vitest";

import {
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/domain/fabrication-setup.js";
import { hashCanonical } from "../../src/domain/hash.js";
import { planIntentConditionedConstruction } from "../../src/interpretation/construction-planner.js";
import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import {
  GenerationOutcomeV2Schema,
  generationFailureV2,
  generationOutcomeV2FromPlanner
} from "../../src/interpretation/generation-outcome-v2.js";
import type { IntentGraphV2 } from "../../src/interpretation/intent-graph-v2.js";
import { compiledFromCurrentPlanning } from "../../src/server/generation/project-persistence-v2.js";

function intent(input: {
  spaces?: number;
  organizationPriority?: "must" | "prefer";
  moving?: "retained" | "captured";
  fitCritical?: boolean;
} = {}): IntentGraphV2 {
  const moving = input.moving !== undefined;
  const spaces = input.spaces ?? 1;
  const organizationPriority = input.organizationPriority ?? "must";
  const requirements: IntentGraphV2["requirements"] = [
    { id: "containment-required", priority: "must", kind: "containment", semanticSummary: "Contain the object.", evidenceIds: ["brief-evidence"] },
    { id: "access-required", priority: "must", kind: "access", semanticSummary: moving ? "Use covered access." : "Remain open at top.", evidenceIds: ["brief-evidence"] },
    { id: "organization-request", priority: organizationPriority, kind: "organization", semanticSummary: `Provide ${String(spaces)} spaces.`, evidenceIds: ["brief-evidence"] },
    ...(moving ? [{
      id: "motion-required",
      priority: "must" as const,
      kind: input.moving === "retained" ? "revolute-interface" as const : "prismatic-interface" as const,
      semanticSummary: input.moving === "retained" ? "Retain a moving cover." : "Capture a sliding cover.",
      evidenceIds: ["brief-evidence"]
    }] : [])
  ];
  return {
    schemaVersion: "2.2",
    title: "Outcome proof",
    purpose: "Prove strict outcome construction without retaining the raw request.",
    requirements,
    constructionBodies: [
      { id: "primary-body", role: "primary-enclosure", shapeClass: "orthogonal-shell", requirementIds: requirements.map((item) => item.id), evidenceIds: ["brief-evidence"] },
      ...(moving ? [{ id: "moving-cover", role: "cover" as const, shapeClass: "planar" as const, requirementIds: ["motion-required"], evidenceIds: ["brief-evidence"] }] : [])
    ],
    objects: [{ id: "contents", role: "contained", engagement: "full-envelope", semanticLabel: "object", quantity: 1, fitCritical: input.fitCritical ?? false, evidenceIds: ["brief-evidence"] }],
    interfaces: moving ? [{
      id: "moving-interface",
      betweenBodyIds: ["primary-body", "moving-cover"],
      behavior: input.moving === "retained" ? "revolute" : "prismatic",
      axis: input.moving === "retained" ? "width" : "depth",
      requirementIds: ["motion-required"],
      evidenceIds: ["brief-evidence"]
    }] : [],
    access: [{ bodyId: "primary-body", kind: moving ? "covered" : "open-top", direction: "top", priority: "must", requirementId: "access-required", evidenceIds: ["brief-evidence"] }],
    organization: [{ bodyId: "primary-body", desiredSpaceCount: spaces, rows: null, columns: null, priority: organizationPriority, requirementId: "organization-request", evidenceIds: ["brief-evidence"] }],
    scaleEvidence: [],
    proportions: [],
    clearance: [],
    rankedGoals: [],
    motif: null,
    referenceBrief: [],
    assumptions: [],
    conflicts: [],
    unresolvedNeeds: []
  };
}

async function plan(candidate: IntentGraphV2, candidateBudget?: number) {
  const setup = resolveFabricationSetup(createPublicFabricationSetup());
  const explicitSizing = await reconcileExplicitSizingConstraints({ advancedSizing: { basis: "auto" }, parsedConstraints: [], parserFindings: [] });
  const planning = await planIntentConditionedConstruction({
    intent: candidate,
    explicitConstraints: explicitSizing,
    profiles: {
      material: setup.material,
      machine: setup.machine,
      processRecipe: setup.processRecipe,
      fabricationContext: setup.fabricationContext,
      fit: setup.fit
    },
    inputPolicyEvaluation: setup.inputPolicyEvaluation,
    pin: createStarterPinSetup(),
    ...(candidateBudget === undefined ? {} : { candidateBudget })
  });
  const digest = await hashCanonical({ proof: "outcome-v2" });
  return {
    explicitSizing,
    planning,
    common: {
      requestId: "outcome-proof-request",
      transportMode: "fixture" as const,
      semanticRequestDigest: digest,
      sourceEvidenceIndexDigest: digest,
      promptIdentity: "current-neutral-prompt",
      promptHash: digest,
      modelId: "fixture-model",
      cacheResult: "miss" as const,
      attemptId: null,
      providerRequestId: null,
      intent: candidate
    }
  };
}

describe("GenerationOutcomeV2", () => {
  it("persists only source authority for supported output and records deterministic hashes separately", async () => {
    const prepared = await plan(intent());
    const outcome = await generationOutcomeV2FromPlanner({ ...prepared.common, explicitSizing: prepared.explicitSizing, planning: prepared.planning });
    expect(outcome.kind).toBe("supported");
    if (outcome.kind !== "supported") throw new Error("expected supported");
    expect(outcome.exportAllowed).toBe(true);
    expect(outcome.source.selectedPlan.topology.canonicalSpaces).toHaveLength(1);
    expect(outcome.source.componentManifest.manifestHash).toHaveLength(64);
    expect(outcome.canonicalResult.physicalVerification).toBe("required");
    expect(JSON.stringify(outcome.source)).not.toContain("secret raw brief");
  });

  it("uses simplified only when an exact preferred requirement is changed and disclosed", async () => {
    const prepared = await plan(intent({ moving: "retained", spaces: 4, organizationPriority: "prefer" }));
    const outcome = await generationOutcomeV2FromPlanner({ ...prepared.common, explicitSizing: prepared.explicitSizing, planning: prepared.planning });
    expect(outcome).toMatchObject({
      kind: "simplified",
      changedSemanticIds: ["organization-request"],
      fabricationCandidate: false,
      exportAllowed: false
    });
    if (outcome.kind !== "simplified") throw new Error("expected simplified");
    expect(outcome.simplificationDisclosures[0]).toContain("4-space organization");
    expect(outcome.source.selectedPlan.topology.canonicalSpaces).toHaveLength(1);
  });

  it("keeps moving-interface previews but withholds fabrication authority", async () => {
    for (const moving of ["retained", "captured"] as const) {
      const prepared = await plan(intent({ moving }));
      const outcome = await generationOutcomeV2FromPlanner({
        ...prepared.common,
        explicitSizing: prepared.explicitSizing,
        planning: prepared.planning
      });
      expect(outcome.kind).toBe("supported");
      if (outcome.kind !== "supported") throw new Error("expected supported");
      expect(outcome).toMatchObject({
        fabricationCandidate: false,
        exportAllowed: false,
        canonicalResult: {
          fabricationCandidate: false,
          exportAllowed: false
        }
      });
      expect(outcome.findingCodes).toContain(
        "FABRICATION_EXPORT_WITHHELD_PENDING_STRUCTURAL_REDESIGN",
      );
    }
  });

  it("carries supported-object partial engagement into canonical findings and user disclosure", async () => {
    const candidate = intent();
    candidate.requirements[0] = {
      ...candidate.requirements[0]!,
      kind: "support",
      semanticSummary: "Partially support the object."
    };
    candidate.objects[0] = {
      ...candidate.objects[0]!,
      role: "supported",
      engagement: "partial-support"
    };
    candidate.scaleEvidence = [{
      id: "supported-object-scale",
      objectId: "contents",
      long: { minimumUm: 350_000, maximumUm: 450_000 },
      short: { minimumUm: 10_000, maximumUm: 20_000 },
      height: { minimumUm: 10_000, maximumUm: 20_000 },
      confidence: "medium",
      basis: "model-prior",
      evidenceIds: ["brief-evidence"]
    }];
    candidate.proportions = [{
      id: "upright-proportion",
      targetBodyId: "primary-body",
      numeratorAxis: "height",
      denominatorAxis: "width",
      strength: "moderate",
      priority: "prefer",
      confidence: "high",
      evidenceIds: ["brief-evidence"]
    }];
    const prepared = await plan(candidate);
    const outcome = await generationOutcomeV2FromPlanner({
      ...prepared.common,
      explicitSizing: prepared.explicitSizing,
      planning: prepared.planning
    });
    expect(outcome.kind).toBe("supported");
    if (outcome.kind !== "supported") throw new Error("expected supported");
    expect(outcome.findingCodes).toContain("SUPPORTED_OBJECT_PARTIAL_ENGAGEMENT_APPLIED");
    expect(outcome.source.selectedSizing.supportEngagement.used).toBe(true);
    expect(compiledFromCurrentPlanning(prepared.planning).scaleDisclosure).toContain(
      "partial engagement"
    );
  });

  it("withholds export when a mandatory visual treatment has no applied canonical feature", async () => {
    const candidate = intent();
    candidate.requirements.push({
      id: "visual-treatment-required",
      priority: "must",
      kind: "visual-treatment",
      semanticSummary: "Apply the defining visual treatment.",
      evidenceIds: ["brief-evidence"]
    });
    candidate.constructionBodies[0]!.requirementIds.push("visual-treatment-required");
    const prepared = await plan(candidate);
    const outcome = await generationOutcomeV2FromPlanner({
      ...prepared.common,
      explicitSizing: prepared.explicitSizing,
      planning: prepared.planning
    });
    expect(outcome).toMatchObject({
      kind: "concept-only",
      blockedRequirementIds: ["visual-treatment-required"],
      fabricationCandidate: false,
      exportAllowed: false
    });
    if (outcome.kind !== "concept-only" || outcome.requirementRealization === null) {
      throw new Error("expected requirement-gated concept-only outcome");
    }
    expect(outcome.requirementRealization.records.find((record) =>
      record.requirementId === "visual-treatment-required"
    )).toMatchObject({ state: "unsupported", evidenceLinks: [] });
  });

  it("uses reproduce, inspire, context, and scoped conflicts without inventing visual support", async () => {
    for (const [relationship, expectedKind] of [
      ["reproduce", "concept-only"],
      ["inspire", "simplified"],
      ["context", "supported"]
    ] as const) {
      const candidate = intent();
      candidate.referenceBrief = [{
        referenceEvidenceId: "reference-evidence",
        relationship,
        observations: [{
          id: "dominant-cut-through",
          kind: "operation-character",
          value: "cut-through-visible",
          targetBodyRole: "primary-enclosure",
          targetFaceRole: "front",
          salience: "dominant",
          confidence: "high",
          visibility: "visible",
          evidenceIds: ["reference-evidence"]
        }]
      }];
      const prepared = await plan(candidate);
      const outcome = await generationOutcomeV2FromPlanner({
        ...prepared.common,
        explicitSizing: prepared.explicitSizing,
        planning: prepared.planning
      });
      expect(outcome.kind).toBe(expectedKind);
      if (outcome.kind === "concept-only") {
        expect(outcome.blockedObservationIds).toEqual(["dominant-cut-through"]);
      } else if (outcome.kind === "supported" || outcome.kind === "simplified") {
        expect(outcome.source.observationRealization.records[0]).toMatchObject({
          state: "unsupported",
          coverage: relationship === "context" ? "context" : "prefer"
        });
      }
    }

    const resolved = intent();
    resolved.referenceBrief = [{
      referenceEvidenceId: "reference-evidence",
      relationship: "reproduce",
      observations: [{
        id: "dominant-cut-through",
        kind: "operation-character",
        value: "cut-through-visible",
        targetBodyRole: "primary-enclosure",
        targetFaceRole: "front",
        salience: "dominant",
        confidence: "high",
        visibility: "visible",
        evidenceIds: ["reference-evidence"]
      }]
    }];
    resolved.conflicts = [{
      id: "explicit-treatment-conflict",
      attribute: "visual-treatment",
      textEvidenceIds: ["brief-evidence"],
      observationIds: ["dominant-cut-through"],
      resolution: "explicit-text-wins"
    }];
    const prepared = await plan(resolved);
    const outcome = await generationOutcomeV2FromPlanner({
      ...prepared.common,
      explicitSizing: prepared.explicitSizing,
      planning: prepared.planning
    });
    expect(outcome.kind).toBe("supported");
    if (outcome.kind !== "supported") throw new Error("expected scoped conflict resolution");
    expect(outcome.source.observationRealization.records[0]).toMatchObject({
      state: "conflict-resolved",
      coverage: "must"
    });
  });

  it("retains interpreted blockers but no source project or export for concept-only", async () => {
    const candidate = intent({ fitCritical: true });
    candidate.referenceBrief = [{
      referenceEvidenceId: "reference-evidence",
      relationship: "reproduce",
      observations: [{
        id: "unsupported-arched-opening",
        kind: "opening",
        value: "arched-aperture",
        targetBodyRole: "primary-enclosure",
        targetFaceRole: "front",
        salience: "dominant",
        confidence: "high",
        visibility: "visible",
        evidenceIds: ["reference-evidence"]
      }]
    }];
    const prepared = await plan(candidate);
    const outcome = await generationOutcomeV2FromPlanner({ ...prepared.common, explicitSizing: prepared.explicitSizing, planning: prepared.planning });
    expect(outcome).toMatchObject({
      kind: "concept-only",
      source: null,
      canonicalResult: null,
      fabricationCandidate: false,
      exportAllowed: false
    });
    if (outcome.kind !== "concept-only") throw new Error("expected concept-only");
    expect(outcome.findingCodes).toContain("FIT_CRITICAL_MEASUREMENT_REQUIRED");
    expect(outcome.findingCodes).toContain("MANDATORY_REFERENCE_OBSERVATION_UNSUPPORTED");
    expect(outcome.requirementRealization?.records).toHaveLength(candidate.requirements.length);
    expect(outcome.observationRealization?.records[0]).toMatchObject({
      observationId: "unsupported-arched-opening",
      coverage: "must",
      state: "unsupported",
      findingCode: "REFERENCE_OBSERVATION_UNSUPPORTED",
      evidenceLinks: []
    });
    expect(outcome.blockedObservationIds).toEqual(["unsupported-arched-opening"]);
    expect(() => GenerationOutcomeV2Schema.parse({ ...outcome, exportAllowed: true })).toThrow();
  });

  it("maps deterministic search exhaustion and unexpected failures to non-project failure", async () => {
    const prepared = await plan(intent({ spaces: 2, organizationPriority: "prefer" }), 0);
    const outcome = await generationOutcomeV2FromPlanner({ ...prepared.common, explicitSizing: prepared.explicitSizing, planning: prepared.planning });
    expect(outcome).toMatchObject({
      kind: "failure",
      stage: "planning",
      code: "SEARCH_BUDGET_EXHAUSTED",
      retryable: false,
      inputState: "preserved-by-caller",
      source: null,
      exportAllowed: false
    });
    expect(generationFailureV2({
      requestId: "unexpected-proof",
      transportMode: "fixture",
      semanticRequestDigest: prepared.common.semanticRequestDigest,
      stage: "compilation",
      code: "UNEXPECTED_COMPILER_FAILURE",
      retryable: true,
      attemptId: null
    })).toMatchObject({ kind: "failure", retryable: true, canonicalResult: null });
  });

  it("rejects unknown top-level kinds and extra fields", async () => {
    const digest = await hashCanonical("strict-outcome");
    expect(() => GenerationOutcomeV2Schema.parse({ schemaVersion: "2.0", kind: "fit-needed" })).toThrow();
    expect(() => GenerationOutcomeV2Schema.parse({
      ...generationFailureV2({ requestId: "strict-proof", transportMode: "fixture", semanticRequestDigest: digest, stage: "schema", code: "STRICT_FAILURE", retryable: false, attemptId: null }),
      legacyProject: {}
    })).toThrow();
  });
});
