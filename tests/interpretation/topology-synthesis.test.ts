import { describe, expect, it } from "vitest";

import type { IntentGraphV2 } from "../../src/interpretation/intent-graph-v2.js";
import { synthesizeSymbolicTopologies } from "../../src/interpretation/topology-synthesis.js";

function intent(overrides: Partial<IntentGraphV2> = {}): IntentGraphV2 {
  return {
    schemaVersion: "2.4",
    title: "Topology proof",
    purpose: "Prove semantic topology synthesis.",
    requirements: [
      { id: "containment-required", priority: "must", kind: "containment", semanticSummary: "Contain objects.", evidenceIds: ["brief-one"] },
      { id: "access-required", priority: "must", kind: "access", semanticSummary: "Use the requested access.", evidenceIds: ["brief-one"] }
    ],
    constructionBodies: [{
      id: "primary-body",
      role: "primary-enclosure",
      shapeClass: "orthogonal-shell",
      requirementIds: ["containment-required", "access-required"],
      evidenceIds: ["brief-one"]
    }],
    objects: [{ id: "contents", role: "contained", engagement: "full-envelope", semanticLabel: "contents", quantity: null, fitCritical: false, evidenceIds: ["brief-one"] }],
    interfaces: [],
    access: [{ bodyId: "primary-body", kind: "open-top", direction: "top", priority: "must", requirementId: "access-required", evidenceIds: ["brief-one"] }],
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

describe("symbolic topology synthesis", () => {
  it("distinguishes open-top and open-front faces without named product programs", async () => {
    const openTop = await synthesizeSymbolicTopologies(intent());
    expect(openTop).toMatchObject({ kind: "candidates" });
    if (openTop.kind !== "candidates") throw new Error("expected candidates");
    expect(openTop.candidates[0]!.faces.map((item) => item.role)).toContain("front");
    expect(openTop.candidates[0]!.faces.map((item) => item.role)).not.toContain("cover");

    const openFront = await synthesizeSymbolicTopologies(intent({
      access: [{ bodyId: "primary-body", kind: "open-front", direction: "front", priority: "must", requirementId: "access-required", evidenceIds: ["brief-one"] }]
    }));
    expect(openFront).toMatchObject({ kind: "candidates" });
    if (openFront.kind !== "candidates") throw new Error("expected candidates");
    expect(openFront.candidates[0]!.faces.map((item) => item.role)).not.toContain("front");
    expect(openFront.candidates[0]!.access).toBe("open-front");
  });

  it("turns a permitted four-space semantic count into two deterministic partition candidates", async () => {
    const result = await synthesizeSymbolicTopologies(intent({
      requirements: [
        { id: "containment-required", priority: "must", kind: "containment", semanticSummary: "Contain cards.", evidenceIds: ["brief-one"] },
        { id: "access-required", priority: "must", kind: "access", semanticSummary: "Remain open at top.", evidenceIds: ["brief-one"] },
        { id: "organization-required", priority: "must", kind: "organization", semanticSummary: "Provide four spaces.", evidenceIds: ["brief-one"] }
      ],
      constructionBodies: [{
        id: "primary-body",
        role: "primary-enclosure",
        shapeClass: "orthogonal-shell",
        requirementIds: ["containment-required", "access-required", "organization-required"],
        evidenceIds: ["brief-one"]
      }],
      organization: [{
        bodyId: "primary-body",
        desiredSpaceCount: 4,
        rows: null,
        columns: null,
        priority: "must",
        requirementId: "organization-required",
        evidenceIds: ["brief-one"]
      }]
    }));
    expect(result).toMatchObject({ kind: "candidates" });
    if (result.kind !== "candidates") throw new Error("expected candidates");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((item) => item.partitionAxis)).toEqual(["width", "depth"]);
    for (const candidate of result.candidates) {
      expect(candidate.canonicalSpaces).toHaveLength(4);
      expect(candidate.faces.filter((item) => item.role === "divider")).toHaveLength(3);
    }
  });

  it("synthesizes registered retained and captured mechanisms from interfaces", async () => {
    for (const [behavior, expected, axis] of [
      ["revolute", "retained-pin", "width"],
      ["prismatic", "captured-slide", "depth"]
    ] as const) {
      const result = await synthesizeSymbolicTopologies(intent({
        requirements: [
          { id: "containment-required", priority: "must", kind: "containment", semanticSummary: "Contain objects.", evidenceIds: ["brief-one"] },
          { id: "access-required", priority: "must", kind: "access", semanticSummary: "Use a covered access.", evidenceIds: ["brief-one"] },
          { id: "motion-required", priority: "must", kind: behavior === "revolute" ? "revolute-interface" : "prismatic-interface", semanticSummary: "Move the cover.", evidenceIds: ["brief-one"] }
        ],
        constructionBodies: [
          { id: "primary-body", role: "primary-enclosure", shapeClass: "orthogonal-shell", requirementIds: ["containment-required", "access-required", "motion-required"], evidenceIds: ["brief-one"] },
          { id: "moving-cover", role: "cover", shapeClass: "planar", requirementIds: ["motion-required"], evidenceIds: ["brief-one"] }
        ],
        interfaces: [{ id: "moving-interface", betweenBodyIds: ["primary-body", "moving-cover"], behavior, axis, requirementIds: ["motion-required"], evidenceIds: ["brief-one"] }],
        access: [{ bodyId: "primary-body", kind: "covered", direction: "top", priority: "must", requirementId: "access-required", evidenceIds: ["brief-one"] }]
      }));
      expect(result).toMatchObject({ kind: "candidates" });
      if (result.kind !== "candidates") throw new Error("expected candidates");
      expect(result.candidates[0]).toMatchObject({ mechanism: expected, mechanismAxis: axis, access: "covered" });
      expect(result.candidates[0]!.faces.map((item) => item.role)).toContain("cover");
    }
  });

  it("enumerates registered moving-cover realizations when covered access omits a mechanism", async () => {
    const result = await synthesizeSymbolicTopologies(intent({
      access: [{ bodyId: "primary-body", kind: "covered", direction: "top", priority: "must", requirementId: "access-required", evidenceIds: ["brief-one"] }]
    }));
    expect(result).toMatchObject({ kind: "candidates" });
    if (result.kind !== "candidates") throw new Error("expected candidates");
    expect(result.candidates.map((item) => [item.mechanism, item.mechanismAxis])).toEqual([
      ["retained-pin", "width"],
      ["captured-slide", "depth"]
    ]);
    expect(result.candidates.every((item) => item.assumptionIds.includes("moving-cover-realization-assumption"))).toBe(true);
  });

  it("withholds unsupported angled and compound-motion core intent", async () => {
    const angled = intent();
    angled.constructionBodies[0]!.shapeClass = "angled";
    expect(await synthesizeSymbolicTopologies(angled)).toMatchObject({
      kind: "concept-only",
      findings: [expect.objectContaining({ code: "MANDATORY_REQUIREMENT_UNSUPPORTED" })]
    });

    const compound = intent({
      constructionBodies: [
        { id: "primary-body", role: "primary-enclosure", shapeClass: "orthogonal-shell", requirementIds: ["containment-required", "access-required"], evidenceIds: ["brief-one"] },
        { id: "cover-one", role: "cover", shapeClass: "planar", requirementIds: ["access-required"], evidenceIds: ["brief-one"] },
        { id: "cover-two", role: "cover", shapeClass: "planar", requirementIds: ["access-required"], evidenceIds: ["brief-one"] }
      ],
      interfaces: [
        { id: "motion-one", betweenBodyIds: ["primary-body", "cover-one"], behavior: "revolute", axis: "width", requirementIds: ["access-required"], evidenceIds: ["brief-one"] },
        { id: "motion-two", betweenBodyIds: ["primary-body", "cover-two"], behavior: "prismatic", axis: "depth", requirementIds: ["access-required"], evidenceIds: ["brief-one"] }
      ]
    });
    expect(await synthesizeSymbolicTopologies(compound)).toMatchObject({
      kind: "concept-only",
      findings: [expect.objectContaining({ code: "COMPOUND_MOTION_UNSUPPORTED" })]
    });
  });

  it("does not treat contained objects as disconnected construction bodies", async () => {
    const result = await synthesizeSymbolicTopologies(intent({
      objects: [
        { id: "pencil-one", role: "contained", engagement: "full-envelope", semanticLabel: "pencil", quantity: 6, fitCritical: false, evidenceIds: ["brief-one"] },
        { id: "eraser", role: "contained", engagement: "full-envelope", semanticLabel: "eraser", quantity: 1, fitCritical: false, evidenceIds: ["brief-one"] }
      ]
    }));
    expect(result.kind).toBe("candidates");
  });

  it("uses one standalone semantic support body as the deterministic topology root", async () => {
    const standalone = await synthesizeSymbolicTopologies(intent({
      requirements: [
        { id: "support-required", priority: "must", kind: "support", semanticSummary: "Support an exposed object.", evidenceIds: ["brief-one"] },
        { id: "access-required", priority: "must", kind: "access", semanticSummary: "Remain open at top.", evidenceIds: ["brief-one"] }
      ],
      constructionBodies: [{
        id: "standalone-support",
        role: "support",
        shapeClass: "orthogonal-shell",
        requirementIds: ["support-required", "access-required"],
        evidenceIds: ["brief-one"]
      }],
      objects: [{
        id: "supported-object",
        role: "supported",
        engagement: "partial-support",
        semanticLabel: "exposed object",
        quantity: null,
        fitCritical: false,
        evidenceIds: ["brief-one"]
      }],
      access: [{
        bodyId: "standalone-support",
        kind: "open-top",
        direction: "top",
        priority: "must",
        requirementId: "access-required",
        evidenceIds: ["brief-one"]
      }]
    }));
    expect(standalone).toMatchObject({
      kind: "candidates",
      policyVersion: "symbolic-topology-synthesis-v2",
      candidates: [expect.objectContaining({ primaryBodyId: "standalone-support" })]
    });

    const ambiguous = intent({
      constructionBodies: [
        { id: "support-one", role: "support", shapeClass: "orthogonal-shell", requirementIds: ["containment-required"], evidenceIds: ["brief-one"] },
        { id: "support-two", role: "support", shapeClass: "orthogonal-shell", requirementIds: ["access-required"], evidenceIds: ["brief-one"] }
      ],
      interfaces: [{
        id: "support-interface",
        betweenBodyIds: ["support-one", "support-two"],
        behavior: "rigid",
        axis: null,
        requirementIds: ["containment-required"],
        evidenceIds: ["brief-one"]
      }],
      access: []
    });
    expect(await synthesizeSymbolicTopologies(ambiguous)).toMatchObject({
      kind: "concept-only",
      findings: [expect.objectContaining({ code: "EMPTY_OR_DISCONNECTED_TOPOLOGY" })]
    });
  });

  it("keeps the registered one-to-four one-axis organization boundary explicit", async () => {
    const required = intent({
      requirements: [
        { id: "containment-required", priority: "must", kind: "containment", semanticSummary: "Contain objects.", evidenceIds: ["brief-one"] },
        { id: "access-required", priority: "must", kind: "access", semanticSummary: "Remain open at top.", evidenceIds: ["brief-one"] },
        { id: "organization-required", priority: "must", kind: "organization", semanticSummary: "Provide five spaces.", evidenceIds: ["brief-one"] }
      ],
      constructionBodies: [{
        id: "primary-body",
        role: "primary-enclosure",
        shapeClass: "orthogonal-shell",
        requirementIds: ["containment-required", "access-required", "organization-required"],
        evidenceIds: ["brief-one"]
      }],
      organization: [{
        bodyId: "primary-body",
        desiredSpaceCount: 5,
        rows: null,
        columns: null,
        priority: "must",
        requirementId: "organization-required",
        evidenceIds: ["brief-one"]
      }]
    });
    expect(await synthesizeSymbolicTopologies(required)).toMatchObject({
      kind: "concept-only",
      findings: [expect.objectContaining({ code: "MANDATORY_REQUIREMENT_UNSUPPORTED" })]
    });

    const preferred = structuredClone(required);
    preferred.requirements[2]!.priority = "prefer";
    preferred.organization[0]!.priority = "prefer";
    const fallback = await synthesizeSymbolicTopologies(preferred);
    expect(fallback).toMatchObject({ kind: "candidates" });
    if (fallback.kind !== "candidates") throw new Error("expected candidates");
    expect(fallback.candidates).toHaveLength(1);
    expect(fallback.candidates[0]!.canonicalSpaces).toHaveLength(1);
  });
});
