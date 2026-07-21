import { describe, expect, it } from "vitest";

import { createPublicFabricationSetup, createStarterPinSetup, resolveFabricationSetup } from "../../src/domain/fabrication-setup.js";
import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import { composeConstructionPlan } from "../../src/interpretation/construction-composition.js";
import { compileConstructionPlan } from "../../src/interpretation/construction-plan-compiler.js";
import { solveSizingConstraints } from "../../src/interpretation/constraint-sizing-solver.js";
import type { IntentGraphV2 } from "../../src/interpretation/intent-graph-v2.js";
import { synthesizeSymbolicTopologies } from "../../src/interpretation/topology-synthesis.js";

function baseIntent(input: {
  access?: "open-top" | "open-front" | "covered";
  spaces?: number;
  motion?: "rigid" | "revolute" | "prismatic";
} = {}): IntentGraphV2 {
  const access = input.access ?? "open-top";
  const spaces = input.spaces ?? 1;
  const motion = input.motion ?? "rigid";
  const requirements: IntentGraphV2["requirements"] = [
    { id: "containment-required", priority: "must", kind: "containment", semanticSummary: "Contain objects.", evidenceIds: ["brief-one"] },
    { id: "access-required", priority: "must", kind: "access", semanticSummary: "Preserve access.", evidenceIds: ["brief-one"] },
    ...(spaces > 1 ? [{ id: "organization-required", priority: "must" as const, kind: "organization" as const, semanticSummary: "Provide multiple spaces.", evidenceIds: ["brief-one"] }] : []),
    ...(motion === "rigid" ? [] : [{
      id: "motion-required",
      priority: "must" as const,
      kind: motion === "revolute" ? "revolute-interface" as const : "prismatic-interface" as const,
      semanticSummary: "Move and retain the cover.",
      evidenceIds: ["brief-one"]
    }])
  ];
  const primaryRequirements = requirements.map((item) => item.id);
  return {
    schemaVersion: "2.2",
    title: "Composed construction proof",
    purpose: "Compile symbolic topology through registered deterministic operators.",
    requirements,
    constructionBodies: [
      { id: "primary-body", role: "primary-enclosure", shapeClass: "orthogonal-shell", requirementIds: primaryRequirements, evidenceIds: ["brief-one"] },
      ...(motion === "rigid" ? [] : [{ id: "moving-cover", role: "cover" as const, shapeClass: "planar" as const, requirementIds: ["motion-required"], evidenceIds: ["brief-one"] }])
    ],
    objects: [],
    interfaces: motion === "rigid" ? [] : [{
      id: "moving-interface",
      betweenBodyIds: ["primary-body", "moving-cover"],
      behavior: motion,
      axis: motion === "revolute" ? "width" : "depth",
      requirementIds: ["motion-required"],
      evidenceIds: ["brief-one"]
    }],
    access: [{ bodyId: "primary-body", kind: access, direction: access === "open-front" ? "front" : "top", priority: "must", requirementId: "access-required", evidenceIds: ["brief-one"] }],
    organization: spaces > 1 ? [{ bodyId: "primary-body", desiredSpaceCount: spaces, rows: null, columns: null, priority: "must", requirementId: "organization-required", evidenceIds: ["brief-one"] }] : [],
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

async function compileCandidate(intent: IntentGraphV2, candidateIndex = 0) {
  const synthesis = await synthesizeSymbolicTopologies(intent);
  if (synthesis.kind !== "candidates") throw new Error("expected candidates");
  const candidate = synthesis.candidates[candidateIndex]!;
  const explicit = await reconcileExplicitSizingConstraints({
    advancedSizing: { basis: "auto" }, parsedConstraints: [], parserFindings: []
  });
  const setup = resolveFabricationSetup(createPublicFabricationSetup());
  const sizing = await solveSizingConstraints({
    intent,
    explicitConstraints: explicit,
    topology: candidate,
    materialThicknessUm: Math.round(setup.material.measuredThicknessMm * 1_000)
  });
  if (sizing.kind !== "solved") throw new Error(`expected solved: ${sizing.findingCode}`);
  const plan = await composeConstructionPlan({ intent, topology: candidate, sizing });
  const compiled = await compileConstructionPlan({
    requestId: `compile-${candidate.candidateId}`,
    intent,
    plan,
    sizing,
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
  return { candidate, sizing, plan, compiled };
}

describe("ConstructionPlanV1 composition and compilation", () => {
  it("projects open-front topology through the same canonical document", async () => {
    const result = await compileCandidate(baseIntent({ access: "open-front" }));
    expect(result.plan.panels.map((item) => item.role)).not.toContain("front");
    expect(result.compiled.compiled.document.parts.map((item) => item.id)).not.toContain("front-panel");
    const sourceHashes = [
      result.compiled.compiled.bundle.sourceDocumentHash,
      result.compiled.compiled.bundle.fabrication.sourceDocumentHash,
      result.compiled.compiled.bundle.scene.sourceDocumentHash,
      result.compiled.compiled.bundle.bom.sourceDocumentHash,
      result.compiled.compiled.bundle.legend?.sourceDocumentHash,
      result.compiled.compiled.bundle.instructions?.sourceDocumentHash
    ];
    expect(new Set(sourceHashes)).toHaveLength(1);
    expect(result.compiled.importComplexity.every((item) => item.withinCurrentLimit)).toBe(true);
  });

  it("compiles a standalone support body through every deterministic projection", async () => {
    const support = baseIntent();
    support.requirements[0] = {
      id: "support-required",
      priority: "must",
      kind: "support",
      semanticSummary: "Support an exposed object.",
      evidenceIds: ["brief-one"]
    };
    support.constructionBodies[0] = {
      id: "standalone-support",
      role: "support",
      shapeClass: "orthogonal-shell",
      requirementIds: ["support-required", "access-required"],
      evidenceIds: ["brief-one"]
    };
    support.objects = [{
      id: "supported-object",
      role: "supported",
      engagement: "partial-support",
      semanticLabel: "exposed object",
      quantity: null,
      fitCritical: false,
      evidenceIds: ["brief-one"]
    }];
    support.access[0]!.bodyId = "standalone-support";
    support.proportions = [{
      id: "upright-proportion",
      targetBodyId: "standalone-support",
      numeratorAxis: "height",
      denominatorAxis: "width",
      strength: "strong",
      priority: "must",
      confidence: "high",
      evidenceIds: ["brief-one"]
    }];
    const result = await compileCandidate(support);
    expect(result.candidate.primaryBodyId).toBe("standalone-support");
    expect(result.sizing.external.heightUm).toBeGreaterThan(result.sizing.external.widthUm);
    expect(result.compiled.compiled.document.validation.status).toBe("pass");
    expect(result.compiled.importComplexity.every((item) => item.withinCurrentLimit)).toBe(true);
    expect(result.compiled.compiled.bundle.instructions?.sourceDocumentHash).toBe(
      result.compiled.compiled.bundle.sourceDocumentHash,
    );
  });

  it("compiles both width- and depth-partitioned four-space constructions with matching marks", async () => {
    const intent = baseIntent({ spaces: 4 });
    for (const index of [0, 1]) {
      const result = await compileCandidate(intent, index);
      expect(result.candidate.canonicalSpaces).toHaveLength(4);
      expect(result.compiled.compiled.document.parts.filter((item) => item.id.startsWith("divider-"))).toHaveLength(3);
      for (const panel of result.plan.panels) {
        expect(result.compiled.compiled.document.parts.find((item) => item.id === panel.id)?.markingCode).toBe(panel.markingCode);
      }
      expect(result.compiled.importComplexity.every((item) => item.withinCurrentLimit)).toBe(true);
    }
  });

  it("composes retained-pin and captured-slide mechanisms only through registered operators", async () => {
    for (const motion of ["revolute", "prismatic"] as const) {
      const result = await compileCandidate(baseIntent({ access: "covered", motion }));
      expect(result.compiled.compiled.document.validation.status).toBe("pass");
      expect(result.plan.operatorProgram.map((item) => item.operatorId)).toContain(
        motion === "revolute" ? "retained-pin-revolute" : "captured-panel-slide",
      );
      expect(result.compiled.compiled.document.motionConstraints.some((item) =>
        item.kind === (motion === "revolute" ? "revolute" : "prismatic")
      )).toBe(true);
    }
  });

  it("is repeat-stable from semantic topology through every projection", async () => {
    const first = await compileCandidate(baseIntent({ spaces: 2 }), 0);
    const second = await compileCandidate(baseIntent({ spaces: 2 }), 0);
    expect(first.sizing.decisionHash).toBe(second.sizing.decisionHash);
    expect(first.plan).toEqual(second.plan);
    expect(first.compiled.compiled.geometryHash).toBe(second.compiled.compiled.geometryHash);
    expect(first.compiled.compiled.bundle).toEqual(second.compiled.compiled.bundle);
    expect(first.compiled.compiled.svgs).toEqual(second.compiled.compiled.svgs);
  });

  it("retains the registered procedural motif vocabulary on newly synthesized host faces", async () => {
    const intent = baseIntent({ access: "open-front", spaces: 2 });
    intent.motif = {
      vocabulary: ["quiet geometric border"],
      composition: "border",
      density: "sparse",
      symmetry: "bilateral",
      primitiveFamilies: ["inset-score-frame", "filled-diamond-focal"],
      preferredOperations: ["score", "engrave"],
      preferredBodyRoles: ["primary-enclosure"],
      evidenceIds: ["brief-one"]
    };
    const result = await compileCandidate(intent);
    expect(result.plan.operatorProgram.map((item) => item.operatorId)).toContain("procedural-surface-treatment");
    expect(result.compiled.motifRecipeHash).toHaveLength(64);
    expect(result.compiled.motifStatus).toBe("applied");
    expect(result.compiled.compiled.document.operatorProgram.filter((item) =>
      item.operatorId === "procedural-surface-treatment"
    )).toHaveLength(1);
    expect(result.compiled.compiled.document.parts.some((part) =>
      part.features.some((feature) => feature.kind === "treatment")
    )).toBe(true);
    expect(result.compiled.compiled.bundle.sourceDocumentHash).toBe(
      result.compiled.compiled.bundle.fabrication.sourceDocumentHash,
    );
  });
});
