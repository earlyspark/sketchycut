import { describe, expect, it } from "vitest";

import { createPublicFabricationSetup, createStarterPinSetup, resolveFabricationSetup } from "../../src/domain/fabrication-setup.js";
import { planIntentConditionedConstruction } from "../../src/interpretation/construction-planner.js";
import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import {
  MINIMUM_SEPARATED_ORGANIZATION_DISCLOSURE,
  type ClosedSemanticProjection
} from "../../src/interpretation/semantic-interpretation.js";
import { buildXToolStudioHandoff } from "../../src/projections/handoff.js";
import { closedProjectionForTest } from "../helpers/closed-semantic-projection.js";

function intent(input: { preferredSpaces?: number; requiredSpaces?: number; requiredClearance?: boolean; shape?: "orthogonal-shell" | "angled" } = {}): ClosedSemanticProjection {
  const organizationCount = input.requiredSpaces ?? input.preferredSpaces;
  const organizationPriority = input.requiredSpaces === undefined ? "prefer" as const : "must" as const;
  return closedProjectionForTest({
    schemaVersion: "2.4",
    title: "Planner proof",
    purpose: "Exercise deterministic candidate search and ranking.",
    requirements: [
      { id: "containment-required", priority: "must", kind: "containment", inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"] },
      { id: "access-required", priority: "must", kind: "access", inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"] },
      ...(organizationCount === undefined ? [] : [{
        id: "organization-request",
        priority: organizationPriority,
        kind: "organization" as const,

        inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"]
      }])
    ],
    constructionBodies: [{
      id: "primary-body",
      role: "primary-enclosure",
      shapeClass: input.shape ?? "orthogonal-shell",
      requirementIds: ["containment-required", "access-required", ...(organizationCount === undefined ? [] : ["organization-request"])],
      inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"]
    }],
    objects: input.requiredClearance
      ? [{ id: "camera", role: "contained", engagement: "full-envelope", quantity: 1, inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"] }]
      : [],
    interfaces: [],
    access: [{ bodyId: "primary-body", kind: "open-top", direction: "top", basis: "explicit-open-top", priority: "must", requirementId: "access-required", inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"] }],
    organization: organizationCount === undefined ? [] : [{
      bodyId: "primary-body",
      desiredSpaceCount: organizationCount,
      rows: null,
      columns: null,
      basis: "explicit-count" as const,
      priority: organizationPriority,
      requirementId: "organization-request",
      inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"]
    }],
    scaleEvidence: [],
    proportions: [],
    clearance: input.requiredClearance
      ? [{ objectId: "camera", kind: "ordinary-access", priority: "must", inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"] }]
      : [],
    rankedGoals: [{ id: "compact-goal", kind: "compactness", rank: 1, inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"] }],
    motif: null,
    cutThrough: [],
    referenceBrief: [],
    assumptions: [],
    conflicts: [],
    unresolvedNeeds: []
  });
}

async function run(candidate: ClosedSemanticProjection, candidateBudget?: number) {
  const setup = resolveFabricationSetup(createPublicFabricationSetup());
  const explicitConstraints = await reconcileExplicitSizingConstraints({
    advancedSizing: { basis: "auto" }, parsedConstraints: [], parserFindings: []
  });
  return planIntentConditionedConstruction({
    projection: candidate,
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

  it("realizes qualitative organization as two width-axis spaces with a nonblocking handoff disclosure", async () => {
    const candidate = intent({ requiredSpaces: 2 });
    candidate.organization[0]!.basis = "minimum-separated-policy";
    const result = await run(candidate);
    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") throw new Error("expected planned");
    const compiledCandidate = result.selected.compiled;
    if (compiledCandidate === null) throw new Error("expected compiled candidate");
    const compiled = compiledCandidate.compiled;

    expect(result.selected.topology).toMatchObject({
      partitionAxis: "width",
      canonicalSpaces: [{ id: "space-1" }, { id: "space-2" }]
    });
    expect(result.selected.plan?.assumptions).toContainEqual({
      id: "organization-layout-defaulted-to-minimum",
      disclosure: MINIMUM_SEPARATED_ORGANIZATION_DISCLOSURE
    });
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "ORGANIZATION_LAYOUT_DEFAULTED_TO_MINIMUM",
      blocking: false,
      message: MINIMUM_SEPARATED_ORGANIZATION_DISCLOSURE
    }));
    expect(compiled.document.applicationLimitations).toContainEqual({
      code: "ORGANIZATION_LAYOUT_DEFAULTED_TO_MINIMUM",
      message: MINIMUM_SEPARATED_ORGANIZATION_DISCLOSURE,
      relatedIds: ["divider-1"]
    });
    expect(compiled.document.parts.filter((part) => part.id === "divider-1")).toHaveLength(1);
    expect(compiled.svgs.some((sheet) =>
      sheet.svg.includes('data-part-id="divider-1"')
    )).toBe(true);
    expect(compiled.bundle.fabrication.sheets.some((sheet) =>
      sheet.paths.some((path) => path.partId === "divider-1" && path.operation === "cut")
    )).toBe(true);
    expect(compiled.bundle.scene.meshes.some((mesh) => mesh.partId === "divider-1")).toBe(true);
    expect(compiled.bundle.scene.states.find((state) => state.kind === "assembled")
      ?.instances.some((instance) => instance.partId === "divider-1")).toBe(true);
    expect(compiled.bundle.bom.entries.some((entry) => entry.partId === "divider-1")).toBe(true);
    expect(compiled.bundle.legend?.entries.some((entry) => entry.partId === "divider-1")).toBe(true);
    expect(compiled.bundle.instructions?.steps.some((step) =>
      step.partIds.includes("divider-1") &&
      step.limitationCodes?.includes("ORGANIZATION_LAYOUT_DEFAULTED_TO_MINIMUM") === true
    )).toBe(true);
    if (!("organization" in compiled.document.intent)) {
      throw new Error("expected current closed semantic projection");
    }
    expect(compiled.document.intent.organization).toEqual([
      expect.objectContaining({
        desiredSpaceCount: 2,
        rows: null,
        columns: null,
        basis: "minimum-separated-policy"
      })
    ]);
    const organizationRequirementId = candidate.organization[0]!.requirementId;
    const organizationRealization = compiledCandidate.requirementRealization.records.find(
      (record) => record.requirementId === organizationRequirementId,
    );
    expect(organizationRealization).toMatchObject({
      requirementKind: "organization",
      state: "realized",
      findingCode: "REQUIREMENT_REALIZED"
    });
    expect(organizationRealization?.evidenceLinks.some((link) =>
      link.kind === "canonical-feature" && link.sourceId === "divider-1"
    )).toBe(true);

    const handoff = await buildXToolStudioHandoff(
      compiled.document.resolvedInputs.machine,
      { fabrication: compiled.bundle.fabrication, svgs: compiled.svgs },
      { fabrication: compiled.bundle.fabrication, svgs: compiled.svgs },
      1,
      compiled.document,
    );
    expect(handoff.applicationLimitations).toContainEqual({
      code: "ORGANIZATION_LAYOUT_DEFAULTED_TO_MINIMUM",
      message: MINIMUM_SEPARATED_ORGANIZATION_DISCLOSURE,
      relatedIds: ["divider-1"]
    });
  });

  it("compiles an elongated full-envelope object through a three-axis proportion hierarchy", async () => {
    const candidate = intent();
    candidate.objects = [{
      id: "elongated-item",
      role: "contained",
      engagement: "full-envelope",

      quantity: null,
      inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"]
    }];
    candidate.scaleEvidence = [{
      id: "elongated-item-prior",
      objectId: "elongated-item",
      long: { minimumUm: 150_000, maximumUm: 320_000 },
      short: { minimumUm: 3_000, maximumUm: 50_000 },
      height: { minimumUm: 3_000, maximumUm: 20_000 },
      confidence: "low",
      basis: "model-prior",
      inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"]
    }];
    candidate.proportions = [
      { id: "upright-over-middle", targetBodyId: "primary-body", numeratorAxis: "height", denominatorAxis: "depth", strength: "moderate", priority: "must", confidence: "high", inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"] },
      { id: "middle-over-narrow", targetBodyId: "primary-body", numeratorAxis: "depth", denominatorAxis: "width", strength: "moderate", priority: "must", confidence: "high", inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-one"] }
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

  it("returns concept-only for unsupported shape and mandatory typed clearance without an exact measurement", async () => {
    expect(await run(intent({ shape: "angled" }))).toMatchObject({
      kind: "concept-only",
      findings: [expect.objectContaining({ code: "MANDATORY_REQUIREMENT_UNSUPPORTED" })]
    });
    const fit = await run(intent({ requiredClearance: true }));
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
