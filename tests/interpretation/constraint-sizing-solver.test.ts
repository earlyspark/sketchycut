import { describe, expect, it } from "vitest";

import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import {
  CONSTRAINT_SIZING_SOLVER_VERSION,
  PROPORTION_RELATION_POLICY_VERSION,
  PROPORTION_STRENGTH_POLICY_VERSION,
  SCALE_AXIS_MAPPING_POLICY_VERSION,
  SUPPORTED_OBJECT_ENGAGEMENT_POLICY_VERSION,
  proportionStrengthRatioPermille,
  solveSizingConstraints
} from "../../src/interpretation/constraint-sizing-solver.js";
import type { IntentGraphV2 } from "../../src/interpretation/intent-graph-v2.js";
import type { SymbolicTopologyCandidateV1 } from "../../src/interpretation/construction-contracts.js";

function intent(overrides: Partial<IntentGraphV2> = {}): IntentGraphV2 {
  return {
    schemaVersion: "2.4",
    title: "Sizing proof",
    purpose: "Exercise deterministic sizing.",
    requirements: [{
      id: "containment-required",
      priority: "must",
      kind: "containment",
      semanticSummary: "Contain the declared content.",
      evidenceIds: ["brief-one"]
    }],
    constructionBodies: [{
      id: "primary-body",
      role: "primary-enclosure",
      shapeClass: "orthogonal-shell",
      requirementIds: ["containment-required"],
      evidenceIds: ["brief-one"]
    }],
    objects: [],
    interfaces: [],
    access: [],
    organization: [],
    scaleEvidence: [],
    proportions: [],
    clearance: [],
    rankedGoals: [],
    motif: null,
    cutThrough: [],
    referenceBrief: [],
    assumptions: [],
    conflicts: [],
    unresolvedNeeds: [],
    ...overrides
  };
}

function topology(input: { spaces?: number; partitionAxis?: "width" | "depth"; covered?: boolean } = {}): SymbolicTopologyCandidateV1 {
  const spaces = input.spaces ?? 1;
  const roles = ["foundation", "rear", "left", "right", "front"] as const;
  return {
    schemaVersion: "1.0",
    candidateId: `candidate-${String(spaces)}-${input.partitionAxis ?? "none"}-${input.covered ? "covered" : "open"}`,
    primaryBodyId: "primary-body",
    access: input.covered ? "covered" : "open-top",
    mechanism: input.covered ? "retained-pin" : "rigid",
    mechanismAxis: input.covered ? "width" : null,
    faces: [
      ...roles.map((role) => ({ id: `${role}-face`, role, sourceRequirementIds: ["containment-required"] })),
      ...(input.covered ? [{ id: "cover-face", role: "cover" as const, sourceRequirementIds: ["containment-required"] }] : []),
      ...Array.from({ length: spaces - 1 }, (_, index) => ({
        id: `divider-${String(index + 1)}-face`,
        role: "divider" as const,
        sourceRequirementIds: ["containment-required"]
      }))
    ],
    canonicalSpaces: Array.from({ length: spaces }, (_, index) => ({
      id: `space-${String(index + 1)}`,
      order: index,
      sourceRequirementIds: ["containment-required"]
    })),
    partitionAxis: spaces > 1 ? input.partitionAxis ?? "width" : null,
    sourceRequirementIds: ["containment-required"],
    assumptionIds: []
  };
}

async function constraints(advancedSizing: unknown = { basis: "auto" }, parsedConstraints: never[] = []) {
  return reconcileExplicitSizingConstraints({ advancedSizing, parsedConstraints, parserFindings: [] });
}

describe("ConstraintSizingSolverV1", () => {
  it("maps qualitative proportion strength through one exact versioned policy", () => {
    expect(PROPORTION_STRENGTH_POLICY_VERSION).toBe("proportion-strength-policy-v1");
    expect([
      proportionStrengthRatioPermille("moderate"),
      proportionStrengthRatioPermille("strong"),
      proportionStrengthRatioPermille("extreme")
    ]).toEqual([1_800, 2_500, 3_500]);
    expect(PROPORTION_RELATION_POLICY_VERSION).toBe("proportion-relation-policy-v1");
    expect(CONSTRAINT_SIZING_SOLVER_VERSION).toBe("constraint-sizing-solver-v5");
  });

  it("realizes redundant pairwise ordering through a deterministic transitive reduction", async () => {
    const relations: IntentGraphV2["proportions"] = [
      {
        id: "wide",
        targetBodyId: "primary-body",
        numeratorAxis: "width",
        denominatorAxis: "depth",
        strength: "moderate",
        priority: "must",
        confidence: "high",
        evidenceIds: ["brief-one"]
      },
      {
        id: "direct-wide-low",
        targetBodyId: "primary-body",
        numeratorAxis: "width",
        denominatorAxis: "height",
        strength: "moderate",
        priority: "must",
        confidence: "high",
        evidenceIds: ["brief-one"]
      },
      {
        id: "low",
        targetBodyId: "primary-body",
        numeratorAxis: "depth",
        denominatorAxis: "height",
        strength: "moderate",
        priority: "must",
        confidence: "high",
        evidenceIds: ["brief-one"]
      }
    ];
    const first = await solveSizingConstraints({
      intent: intent({ proportions: relations }),
      explicitConstraints: await constraints(),
      topology: topology(),
      materialThicknessUm: 3_000
    });
    const renamed = await solveSizingConstraints({
      intent: intent({
        proportions: [...relations].reverse().map((item, index) => ({
          ...item,
          id: `renamed-${String(index)}`
        }))
      }),
      explicitConstraints: await constraints(),
      topology: topology(),
      materialThicknessUm: 3_000
    });
    expect(first).toMatchObject({
      kind: "solved",
      assumptions: [
        "Unanchored scale is a deterministic fallback, not evidence from the brief.",
        "Redundant qualitative proportion relations were realized through a deterministic transitive reduction.",
        "Qualitative proportion hierarchy was preserved by increasing only non-exact axes after construction and object minima."
      ]
    });
    if (first.kind !== "solved" || renamed.kind !== "solved") throw new Error("expected solved");
    expect(first.external.widthUm / first.external.heightUm).toBeGreaterThanOrEqual(3);
    expect(renamed.external).toEqual(first.external);
    expect(renamed.decisionHash).toBe(first.decisionHash);
  });

  it("withholds sizing when qualitative proportion relations contain a directed cycle", async () => {
    const result = await solveSizingConstraints({
      intent: intent({
        proportions: [
          { id: "width-depth", targetBodyId: "primary-body", numeratorAxis: "width", denominatorAxis: "depth", strength: "moderate", priority: "must", confidence: "high", evidenceIds: ["brief-one"] },
          { id: "depth-height", targetBodyId: "primary-body", numeratorAxis: "depth", denominatorAxis: "height", strength: "moderate", priority: "must", confidence: "high", evidenceIds: ["brief-one"] },
          { id: "height-width", targetBodyId: "primary-body", numeratorAxis: "height", denominatorAxis: "width", strength: "moderate", priority: "must", confidence: "high", evidenceIds: ["brief-one"] }
        ]
      }),
      explicitConstraints: await constraints(),
      topology: topology(),
      materialThicknessUm: 3_000
    });
    expect(result).toMatchObject({
      kind: "infeasible",
      findingCode: "SIZING_PROPORTION_RELATION_CONFLICT",
      relatedSemanticIds: ["depth-height", "height-width", "width-depth"]
    });
  });

  it("uses one fallback characteristic scale while semantic proportions produce distinct shapes", async () => {
    const exact = await constraints();
    const long = await solveSizingConstraints({
      intent: intent({ proportions: [{
        id: "long-ratio",
        targetBodyId: "primary-body",
        numeratorAxis: "width",
        denominatorAxis: "depth",
        strength: "strong",
        priority: "prefer",
        confidence: "high",
        evidenceIds: ["brief-one"]
      }] }),
      explicitConstraints: exact,
      topology: topology(),
      materialThicknessUm: 3_000
    });
    const tall = await solveSizingConstraints({
      intent: intent({ proportions: [{
        id: "tall-ratio",
        targetBodyId: "primary-body",
        numeratorAxis: "height",
        denominatorAxis: "width",
        strength: "moderate",
        priority: "prefer",
        confidence: "high",
        evidenceIds: ["brief-one"]
      }] }),
      explicitConstraints: exact,
      topology: topology(),
      materialThicknessUm: 3_000
    });
    expect(long).toMatchObject({ kind: "solved", fallback: { used: true } });
    expect(tall).toMatchObject({ kind: "solved", fallback: { used: true } });
    if (long.kind !== "solved" || tall.kind !== "solved") throw new Error("expected solved");
    expect(long.external.widthUm / long.external.depthUm).toBeGreaterThanOrEqual(2);
    expect(tall.external.heightUm / tall.external.widthUm).toBeGreaterThanOrEqual(1.4);
    expect(long.decisionHash).not.toBe(tall.decisionHash);
  });

  it("preserves a soft proportion hierarchy after model-prior and construction minima", async () => {
    const result = await solveSizingConstraints({
      intent: intent({
        objects: [{
          id: "ordinary-object",
          role: "contained",
          engagement: "full-envelope",
          semanticLabel: "ordinary object",
          quantity: 1,
          fitCritical: false,
          evidenceIds: ["brief-one"]
        }],
        scaleEvidence: [{
          id: "ordinary-object-prior",
          objectId: "ordinary-object",
          long: { minimumUm: 70_000, maximumUm: 80_000 },
          short: { minimumUm: 30_000, maximumUm: 40_000 },
          height: { minimumUm: 30_000, maximumUm: 40_000 },
          confidence: "medium",
          basis: "model-prior",
          evidenceIds: ["brief-one"]
        }],
        proportions: [{
          id: "strong-upright",
          targetBodyId: "primary-body",
          numeratorAxis: "height",
          denominatorAxis: "width",
          strength: "strong",
          priority: "must",
          confidence: "high",
          evidenceIds: ["brief-one"]
        }]
      }),
      explicitConstraints: await constraints(),
      topology: topology(),
      materialThicknessUm: 3_000
    });
    expect(result).toMatchObject({ kind: "solved" });
    if (result.kind !== "solved") throw new Error("expected solved");
    expect(result.external.heightUm / result.external.widthUm).toBeGreaterThanOrEqual(2.5);
    expect(result.assumptions).toContain(
      "Qualitative proportion hierarchy was preserved by increasing only non-exact axes after construction and object minima."
    );
  });

  it("orients axisless scale evidence through the complete proportion DAG", async () => {
    const relations: IntentGraphV2["proportions"] = [
      {
        id: "upright-over-middle",
        targetBodyId: "primary-body",
        numeratorAxis: "height",
        denominatorAxis: "depth",
        strength: "moderate",
        priority: "must",
        confidence: "high",
        evidenceIds: ["brief-one"]
      },
      {
        id: "middle-over-narrow",
        targetBodyId: "primary-body",
        numeratorAxis: "depth",
        denominatorAxis: "width",
        strength: "moderate",
        priority: "must",
        confidence: "high",
        evidenceIds: ["brief-one"]
      }
    ];
    const makeIntent = (proportions: IntentGraphV2["proportions"]): IntentGraphV2 => intent({
      objects: [{
        id: "elongated-item",
        role: "contained",
        engagement: "full-envelope",
        semanticLabel: "elongated item",
        quantity: null,
        fitCritical: false,
        evidenceIds: ["brief-one"]
      }],
      scaleEvidence: [{
        id: "elongated-item-prior",
        objectId: "elongated-item",
        long: { minimumUm: 150_000, maximumUm: 320_000 },
        short: { minimumUm: 3_000, maximumUm: 50_000 },
        height: { minimumUm: 3_000, maximumUm: 20_000 },
        confidence: "low",
        basis: "model-prior",
        evidenceIds: ["brief-one"]
      }],
      proportions
    });
    const first = await solveSizingConstraints({
      intent: makeIntent(relations),
      explicitConstraints: await constraints(),
      topology: topology(),
      materialThicknessUm: 3_000
    });
    const reordered = await solveSizingConstraints({
      intent: makeIntent([...relations].reverse().map((relation, index) => ({
        ...relation,
        id: `renamed-relation-${String(index)}`
      }))),
      explicitConstraints: await constraints(),
      topology: topology(),
      materialThicknessUm: 3_000
    });

    expect(first).toMatchObject({
      kind: "solved",
      scaleAxisMappings: [{
        scaleEvidenceId: "elongated-item-prior",
        objectId: "elongated-item",
        longAxis: "height",
        shortAxis: "depth",
        heightAxis: "width",
        policyVersion: SCALE_AXIS_MAPPING_POLICY_VERSION
      }]
    });
    if (first.kind !== "solved" || reordered.kind !== "solved") throw new Error("expected solved");
    expect(first.external).toEqual({ widthUm: 80_000, depthUm: 144_000, heightUm: 259_200 });
    expect(reordered.external).toEqual(first.external);
    expect(reordered.scaleAxisMappings).toEqual(first.scaleAxisMappings);
  });

  it("never changes an exact maker axis to recover a qualitative proportion", async () => {
    const result = await solveSizingConstraints({
      intent: intent({
        objects: [{
          id: "ordinary-object",
          role: "contained",
          engagement: "full-envelope",
          semanticLabel: "ordinary object",
          quantity: 1,
          fitCritical: false,
          evidenceIds: ["brief-one"]
        }],
        scaleEvidence: [{
          id: "ordinary-object-prior",
          objectId: "ordinary-object",
          long: { minimumUm: 70_000, maximumUm: 80_000 },
          short: { minimumUm: 30_000, maximumUm: 40_000 },
          height: { minimumUm: 30_000, maximumUm: 40_000 },
          confidence: "medium",
          basis: "model-prior",
          evidenceIds: ["brief-one"]
        }],
        proportions: [{
          id: "strong-upright",
          targetBodyId: "primary-body",
          numeratorAxis: "height",
          denominatorAxis: "width",
          strength: "strong",
          priority: "must",
          confidence: "high",
          evidenceIds: ["brief-one"]
        }]
      }),
      explicitConstraints: await constraints({ basis: "exact-external", dimensions: { heightMm: 120 } }),
      topology: topology(),
      materialThicknessUm: 3_000
    });
    expect(result).toMatchObject({ kind: "solved", external: { heightUm: 120_000 } });
  });

  it("preserves exact external and internal dimensions through candidate-specific wall conversion", async () => {
    const exactExternal = await constraints({ basis: "exact-external", dimensions: { widthMm: 150 } });
    const external = await solveSizingConstraints({
      intent: intent(), explicitConstraints: exactExternal, topology: topology(), materialThicknessUm: 3_000
    });
    expect(external).toMatchObject({ kind: "solved", external: { widthUm: 150_000 } });
    const exactInternal = await constraints({ basis: "exact-internal", dimensions: { widthMm: 150, heightMm: 60 } });
    const internal = await solveSizingConstraints({
      intent: intent(), explicitConstraints: exactInternal, topology: topology({ covered: true }), materialThicknessUm: 3_000
    });
    expect(internal).toMatchObject({
      kind: "solved",
      internal: { widthUm: 150_000, heightUm: 60_000 },
      external: { widthUm: 156_000, heightUm: 66_000 }
    });
  });

  it("keeps an exact contained-object measurement separate from project width and checks usable spaces", async () => {
    const parsed = [{
      constraintId: "brief-contained-cards-width",
      source: "brief" as const,
      target: { subject: "contained-object" as const, objectId: "cards", axis: "width" as const },
      valueUm: 90_000,
      sourceEvidenceId: "brief-one",
      markerStart: 10,
      markerEnd: 35,
      status: "active" as const,
      findingCode: null
    }];
    const explicit = await reconcileExplicitSizingConstraints({
      advancedSizing: { basis: "auto" }, parsedConstraints: parsed, parserFindings: []
    });
    const result = await solveSizingConstraints({
      intent: intent({
        objects: [{ id: "cards", role: "contained", engagement: "full-envelope", semanticLabel: "cards", quantity: 4, fitCritical: true, evidenceIds: ["brief-one"] }],
        clearance: [{ objectId: "cards", kind: "ordinary-access", priority: "must", evidenceIds: ["brief-one"] }]
      }),
      explicitConstraints: explicit,
      topology: topology(),
      materialThicknessUm: 3_000
    });
    expect(result).toMatchObject({ kind: "solved", usablePerSpace: { widthUm: 94_000 } });
    if (result.kind !== "solved") throw new Error("expected solved");
    expect(result.external.widthUm).toBe(100_000);
    expect(result.external.widthUm).not.toBe(90_000);
  });

  it("uses bounded partial engagement for a supported object's model-prior long extent", async () => {
    const objectScale = {
      id: "supported-tool-scale",
      objectId: "supported-tool",
      long: { minimumUm: 350_000, maximumUm: 450_000 },
      short: { minimumUm: 10_000, maximumUm: 20_000 },
      height: { minimumUm: 10_000, maximumUm: 20_000 },
      confidence: "medium" as const,
      basis: "model-prior" as const,
      evidenceIds: ["brief-one"]
    };
    const proportion = {
      id: "upright-proportion",
      targetBodyId: "primary-body",
      numeratorAxis: "height" as const,
      denominatorAxis: "width" as const,
      strength: "moderate" as const,
      priority: "prefer" as const,
      confidence: "high" as const,
      evidenceIds: ["brief-one"]
    };
    const supported = await solveSizingConstraints({
      intent: intent({
        requirements: [{
          id: "containment-required",
          priority: "must",
          kind: "support",
          semanticSummary: "Partially support the declared tool.",
          evidenceIds: ["brief-one"]
        }],
        objects: [{
          id: "supported-tool",
          role: "supported",
          engagement: "partial-support",
          semanticLabel: "long tool",
          quantity: 1,
          fitCritical: false,
          evidenceIds: ["brief-one"]
        }],
        scaleEvidence: [objectScale],
        proportions: [proportion]
      }),
      explicitConstraints: await constraints(),
      topology: topology(),
      materialThicknessUm: 3_000
    });
    const contained = await solveSizingConstraints({
      intent: intent({
        objects: [{
          id: "supported-tool",
          role: "contained",
          engagement: "full-envelope",
          semanticLabel: "long tool",
          quantity: 1,
          fitCritical: false,
          evidenceIds: ["brief-one"]
        }],
        scaleEvidence: [objectScale],
        proportions: [proportion]
      }),
      explicitConstraints: await constraints(),
      topology: topology(),
      materialThicknessUm: 3_000
    });
    expect(supported).toMatchObject({
      kind: "solved",
      supportEngagement: {
        used: true,
        policyVersion: SUPPORTED_OBJECT_ENGAGEMENT_POLICY_VERSION,
        decisions: [{
          sourceKind: "model-prior",
          originalLongExtentUm: 400_000,
          appliedLongEngagementUm: 100_000,
          longAxis: "height"
        }]
      }
    });
    expect(contained).toMatchObject({ kind: "solved", supportEngagement: { used: false } });
    if (supported.kind !== "solved" || contained.kind !== "solved") throw new Error("expected solved");
    expect(supported.external.heightUm).toBeLessThan(contained.external.heightUm);
  });

  it("preserves an exact supported-object extent while applying disclosed partial engagement", async () => {
    const explicit = await reconcileExplicitSizingConstraints({
      advancedSizing: { basis: "auto" },
      parsedConstraints: [{
        constraintId: "brief-supported-tool-height",
        source: "brief",
        target: { subject: "contained-object", objectId: "supported-tool", axis: "height" },
        valueUm: 400_000,
        sourceEvidenceId: "brief-one",
        markerStart: 10,
        markerEnd: 35,
        status: "active",
        findingCode: null
      }],
      parserFindings: []
    });
    const result = await solveSizingConstraints({
      intent: intent({
        requirements: [{
          id: "containment-required",
          priority: "must",
          kind: "support",
          semanticSummary: "Partially support the measured tool.",
          evidenceIds: ["brief-one"]
        }],
        objects: [{
          id: "supported-tool",
          role: "supported",
          engagement: "partial-support",
          semanticLabel: "measured tool",
          quantity: 1,
          fitCritical: true,
          evidenceIds: ["brief-one"]
        }],
        proportions: [{
          id: "upright-proportion",
          targetBodyId: "primary-body",
          numeratorAxis: "height",
          denominatorAxis: "width",
          strength: "moderate",
          priority: "prefer",
          confidence: "high",
          evidenceIds: ["brief-one"]
        }]
      }),
      explicitConstraints: explicit,
      topology: topology(),
      materialThicknessUm: 3_000
    });
    expect(result).toMatchObject({
      kind: "solved",
      constraintLedger: [{ constraintId: "brief-supported-tool-height", valueUm: 400_000, state: "satisfied" }],
      supportEngagement: {
        used: true,
        decisions: [{ sourceKind: "exact-maker", originalLongExtentUm: 400_000, appliedLongEngagementUm: 100_000 }]
      }
    });
  });

  it("withholds a fit-critical result without exact object measurement", async () => {
    const result = await solveSizingConstraints({
      intent: intent({
        objects: [{ id: "camera", role: "contained", engagement: "full-envelope", semanticLabel: "my camera", quantity: 1, fitCritical: true, evidenceIds: ["brief-one"] }],
        scaleEvidence: [{
          id: "camera-prior",
          objectId: "camera",
          long: { minimumUm: 100_000, maximumUm: 160_000 },
          short: { minimumUm: 60_000, maximumUm: 120_000 },
          height: { minimumUm: 40_000, maximumUm: 100_000 },
          confidence: "low",
          basis: "model-prior",
          evidenceIds: ["brief-one"]
        }]
      }),
      explicitConstraints: await constraints(),
      topology: topology(),
      materialThicknessUm: 3_000
    });
    expect(result).toMatchObject({ kind: "infeasible", findingCode: "FIT_CRITICAL_MEASUREMENT_REQUIRED" });
  });

  it("rejects an exact maker value below construction minimum without nearby substitution", async () => {
    const result = await solveSizingConstraints({
      intent: intent(),
      explicitConstraints: await constraints({ basis: "exact-external", dimensions: { widthMm: 20 } }),
      topology: topology(),
      materialThicknessUm: 3_000
    });
    expect(result).toMatchObject({
      kind: "infeasible",
      findingCode: "SIZING_HARD_CONSTRAINT_INFEASIBLE",
      conflictingConstraintIds: ["advanced-project-external-width"]
    });
  });

  it("is repeat-stable and records model-prior clamps without altering exact constraints", async () => {
    const input = {
      intent: intent({
        objects: [{ id: "generic-items", role: "contained", engagement: "full-envelope", semanticLabel: "generic items", quantity: null, fitCritical: false, evidenceIds: ["brief-one"] }],
        scaleEvidence: [{
          id: "broad-prior",
          objectId: "generic-items",
          long: { minimumUm: 600_000, maximumUm: 900_000 },
          short: { minimumUm: 20_000, maximumUm: 40_000 },
          height: { minimumUm: 20_000, maximumUm: 40_000 },
          confidence: "low",
          basis: "model-prior",
          evidenceIds: ["brief-one"]
        }]
      }),
      explicitConstraints: await constraints({ basis: "exact-external", dimensions: { depthMm: 100 } }),
      topology: topology(),
      materialThicknessUm: 3_000
    } as const;
    const first = await solveSizingConstraints(input);
    const second = await solveSizingConstraints(input);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      kind: "solved",
      external: { depthUm: 100_000 },
      scaleNormalizations: [{ clamped: true, findingCode: "SCALE_ESTIMATE_CLAMPED" }]
    });
  });
});
