import { describe, expect, it } from "vitest";

import { createPublicFabricationSetup, createStarterPinSetup, resolveFabricationSetup } from "../../src/domain/fabrication-setup.js";
import { planIntentConditionedConstruction } from "../../src/interpretation/construction-planner.js";
import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import type { IntentGraphV2 } from "../../src/interpretation/intent-graph-v2.js";

function intent(input: { preferredSpaces?: number; requiredSpaces?: number; fitCritical?: boolean; shape?: "orthogonal-shell" | "angled" } = {}): IntentGraphV2 {
  const organizationCount = input.requiredSpaces ?? input.preferredSpaces;
  const organizationPriority = input.requiredSpaces === undefined ? "prefer" as const : "must" as const;
  return {
    schemaVersion: "2.1",
    title: "Planner proof",
    purpose: "Exercise deterministic candidate search and ranking.",
    requirements: [
      { id: "containment-required", priority: "must", kind: "containment", semanticSummary: "Contain objects.", evidenceIds: ["brief-one"] },
      { id: "access-required", priority: "must", kind: "access", semanticSummary: "Remain open at top.", evidenceIds: ["brief-one"] },
      ...(organizationCount === undefined ? [] : [{
        id: "organization-request",
        priority: organizationPriority,
        kind: "organization" as const,
        semanticSummary: "Use the requested number of spaces.",
        evidenceIds: ["brief-one"]
      }])
    ],
    constructionBodies: [{
      id: "primary-body",
      role: "primary-enclosure",
      shapeClass: input.shape ?? "orthogonal-shell",
      requirementIds: ["containment-required", "access-required", ...(organizationCount === undefined ? [] : ["organization-request"])],
      evidenceIds: ["brief-one"]
    }],
    objects: input.fitCritical
      ? [{ id: "camera", role: "contained", engagement: "full-envelope", semanticLabel: "my camera", quantity: 1, fitCritical: true, evidenceIds: ["brief-one"] }]
      : [],
    interfaces: [],
    access: [{ bodyId: "primary-body", kind: "open-top", direction: "top", priority: "must", requirementId: "access-required", evidenceIds: ["brief-one"] }],
    organization: organizationCount === undefined ? [] : [{
      bodyId: "primary-body",
      desiredSpaceCount: organizationCount,
      rows: null,
      columns: null,
      priority: organizationPriority,
      requirementId: "organization-request",
      evidenceIds: ["brief-one"]
    }],
    scaleEvidence: [],
    proportions: [],
    clearance: [],
    rankedGoals: [{ id: "compact-goal", kind: "compactness", rank: 1, evidenceIds: ["brief-one"] }],
    motif: null,
    assumptions: [],
    conflicts: [],
    unresolvedNeeds: []
  };
}

async function run(candidate: IntentGraphV2, candidateBudget?: number) {
  const setup = resolveFabricationSetup(createPublicFabricationSetup());
  const explicitConstraints = await reconcileExplicitSizingConstraints({
    advancedSizing: { basis: "auto" }, parsedConstraints: [], parserFindings: []
  });
  return planIntentConditionedConstruction({
    intent: candidate,
    explicitConstraints,
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
}

describe("ConstructionPlannerV1", () => {
  it("ranks an evidence-backed divided preference ahead of a valid plain construction", async () => {
    const result = await run(intent({ preferredSpaces: 4 }));
    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") throw new Error("expected planned");
    expect(result.candidates.filter((item) => item.status === "feasible").length).toBeGreaterThanOrEqual(2);
    expect(result.candidates.some((item) => item.topology.canonicalSpaces.length === 1)).toBe(true);
    expect(result.selected.topology.canonicalSpaces).toHaveLength(4);
    expect(result.selected.plan?.rankingVector[0]).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("preserves required organization through compilation and projections", async () => {
    const result = await run(intent({ requiredSpaces: 4 }));
    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") throw new Error("expected planned");
    expect(result.selected.topology.canonicalSpaces).toHaveLength(4);
    expect(result.selected.compiled?.compiled.document.parts.filter((item) => item.id.startsWith("divider-"))).toHaveLength(3);
    expect(result.selected.compiled?.compiled.bundle.instructions?.steps.some((item) =>
      item.partIds.some((partId) => partId.startsWith("divider-"))
    )).toBe(true);
  });

  it("compiles an elongated full-envelope object through a three-axis proportion hierarchy", async () => {
    const candidate = intent();
    candidate.objects = [{
      id: "elongated-item",
      role: "contained",
      engagement: "full-envelope",
      semanticLabel: "elongated item",
      quantity: null,
      fitCritical: false,
      evidenceIds: ["brief-one"]
    }];
    candidate.scaleEvidence = [{
      id: "elongated-item-prior",
      objectId: "elongated-item",
      long: { minimumUm: 150_000, maximumUm: 320_000 },
      short: { minimumUm: 3_000, maximumUm: 50_000 },
      height: { minimumUm: 3_000, maximumUm: 20_000 },
      confidence: "low",
      basis: "model-prior",
      evidenceIds: ["brief-one"]
    }];
    candidate.proportions = [
      { id: "upright-over-middle", targetBodyId: "primary-body", numeratorAxis: "height", denominatorAxis: "depth", strength: "moderate", priority: "must", confidence: "high", evidenceIds: ["brief-one"] },
      { id: "middle-over-narrow", targetBodyId: "primary-body", numeratorAxis: "depth", denominatorAxis: "width", strength: "moderate", priority: "must", confidence: "high", evidenceIds: ["brief-one"] }
    ];

    const result = await run(candidate);
    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") throw new Error("expected planned");
    expect(result.selected.sizing).toMatchObject({
      kind: "solved",
      external: { widthUm: 80_000, depthUm: 144_000, heightUm: 259_200 },
      scaleAxisMappings: [{ longAxis: "height", shortAxis: "depth", heightAxis: "width" }]
    });
    expect(result.selected.compiled).not.toBeNull();
    expect(result.selected.compiled?.importComplexity.every((item) => item.withinCurrentLimit)).toBe(true);
  });

  it("reports deterministic search-budget exhaustion rather than silently returning a partial best", async () => {
    const result = await run(intent({ preferredSpaces: 4 }), 1);
    expect(result).toMatchObject({
      kind: "failure",
      failureCode: "SEARCH_BUDGET_EXHAUSTED",
      retryable: false,
      findings: [expect.objectContaining({ code: "SEARCH_BUDGET_EXHAUSTED" })]
    });
  });

  it("returns concept-only for unsupported shape and fit-critical missing measurement", async () => {
    expect(await run(intent({ shape: "angled" }))).toMatchObject({
      kind: "concept-only",
      findings: [expect.objectContaining({ code: "MANDATORY_REQUIREMENT_UNSUPPORTED" })]
    });
    const fit = await run(intent({ fitCritical: true }));
    expect(fit.kind).toBe("concept-only");
    expect(fit.findings.some((item) => item.code === "FIT_CRITICAL_MEASUREMENT_REQUIRED")).toBe(true);
    if (fit.kind === "concept-only") {
      expect(fit.candidates.every((item) => item.compiled === null)).toBe(true);
    }
  });

  it("is deterministic for identical normalized inputs and policy versions", async () => {
    const first = await run(intent({ requiredSpaces: 2 }));
    const second = await run(intent({ requiredSpaces: 2 }));
    expect(first.kind).toBe("planned");
    expect(second.kind).toBe("planned");
    if (first.kind !== "planned" || second.kind !== "planned") throw new Error("expected planned");
    expect(first.selected.plan).toEqual(second.selected.plan);
    expect(first.selected.sizing).toEqual(second.selected.sizing);
    expect(first.selected.compiled?.compiled.geometryHash).toBe(second.selected.compiled?.compiled.geometryHash);
    expect(first.selected.compiled?.compiled.bundle).toEqual(second.selected.compiled?.compiled.bundle);
  });
});
