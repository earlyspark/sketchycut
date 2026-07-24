import { describe, expect, it } from "vitest";

import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION
} from "../../src/interpretation/semantic-atom-registry.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  SemanticInterpretationCandidateSchema,
  expandSemanticInterpretationCandidate
} from "../../src/interpretation/semantic-model-contract.js";
import { buildSourceEvidenceIndex } from "../../src/interpretation/source-evidence.js";
import {
  AppliedSubstitutionSchema,
  SUBSTITUTION_GRAPH_REGISTRY,
  SubstitutionGraphRegistrySchema,
  SubstitutionSearchTraceSchema,
  enumerateBoundedSubstitutionPaths,
  initialSubstitutionSearchTrace,
  prepareFirstRegisteredSubstitution,
  substitutionTraceForRetainedScope
} from "../../src/interpretation/substitution-graph.js";

async function interpretation(input: {
  access: "open-top" | "covered-top";
  layout:
    | { layout: "unspecified" }
    | { layout: "count"; desiredSpaceCount: number };
  includeSignature?: boolean;
  includeUnresolvedDependency?: boolean;
  flexureClaim?: string;
}) {
  const source = await buildSourceEvidenceIndex({
    brief: "Builder-authored open development proof input.",
    references: [],
    roleConstraints: []
  });
  const evidenceId = source.sourceEvidenceIndex.spans[0]!.evidenceId;
  const items: unknown[] = [{
    claim: "The project is one registered rigid enclosure.",
    importance: "essential",
    evidenceBindings: [{
      evidenceId,
      aspect: "structure",
      support: "direct"
    }],
    relationships: [],
    measurements: [],
    state: "bound",
    atoms: [{
      kind: "primary-enclosure",
      enclosure: {
        quantity: null,
        priority: "must",
        evidenceIds: [evidenceId]
      },
      access: {
        kind: input.access,
        priority: "must",
        evidenceIds: [evidenceId]
      },
      space: {
        ...input.layout,
        priority: "must",
        evidenceIds: [evidenceId]
      }
    }]
  }];
  if (input.includeSignature !== false) {
    items.push({
      claim: input.flexureClaim ?? "The corners use kerf-flexure construction.",
      importance: "essential",
      evidenceBindings: [{
        evidenceId,
        aspect: "structure",
        support: "direct"
      }],
      relationships: input.includeUnresolvedDependency === true
        ? [{ kind: "depends-on", targetItemOrdinal: 3 }]
        : [],
      measurements: [],
      state: "unbound",
      reason: "CAPABILITY_NOT_REGISTERED",
      unsupportedSignatureIds: ["kerf-flexure-corner-construction"]
    });
  }
  if (input.includeUnresolvedDependency === true) {
    items.push({
      claim: "The required profile remains unsupported.",
      importance: "essential",
      evidenceBindings: [{
        evidenceId,
        aspect: "structure",
        support: "direct"
      }],
      relationships: [],
      measurements: [],
      state: "unbound",
      reason: "CAPABILITY_NOT_REGISTERED",
      unsupportedSignatureIds: []
    });
  }
  const candidate = SemanticInterpretationCandidateSchema.parse({
    schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    items
  });
  return expandSemanticInterpretationCandidate(
    candidate,
    source.sourceEvidenceIndex,
  );
}

describe("bounded deterministic substitution graph", () => {
  it("keeps one strict current registry and rejects unknown versions", () => {
    expect(SubstitutionGraphRegistrySchema.parse(
      SUBSTITUTION_GRAPH_REGISTRY,
    ).edges).toHaveLength(1);
    expect(SubstitutionGraphRegistrySchema.safeParse({
      ...SUBSTITUTION_GRAPH_REGISTRY,
      version: "0.9.0"
    }).success).toBe(false);
  });

  it("rejects applied metadata or disclosure that diverges from the registered edge", async () => {
    const source = await interpretation({
      access: "covered-top",
      layout: { layout: "unspecified" }
    });
    const result = prepareFirstRegisteredSubstitution({
      interpretation: source
    });
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") return;
    const application = result.candidate.trace.appliedSubstitutions[0]!;

    expect(AppliedSubstitutionSchema.safeParse({
      ...application,
      preservationObligations:
        [...application.preservationObligations].reverse()
    }).success).toBe(false);
    expect(AppliedSubstitutionSchema.safeParse({
      ...application,
      disclosure: "Unregistered construction substitution disclosure."
    }).success).toBe(false);
  });

  it("requires exact one-to-one applied-attempt correlation", async () => {
    const source = await interpretation({
      access: "open-top",
      layout: { layout: "count", desiredSpaceCount: 3 }
    });
    const result = prepareFirstRegisteredSubstitution({
      interpretation: source
    });
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") return;
    const trace = result.candidate.trace;
    const application = trace.appliedSubstitutions[0]!;
    const attempt = trace.attempts[0]!;
    const unrelatedAppliedAttempt = {
      ...attempt,
      affectedInventoryItemId: "inventory-item-detached"
    };

    expect(SubstitutionSearchTraceSchema.safeParse({
      ...trace,
      substitutionSearchAttemptCount: 2,
      attempts: [attempt, unrelatedAppliedAttempt]
    }).success).toBe(false);
    expect(SubstitutionSearchTraceSchema.safeParse({
      ...trace,
      appliedSubstitutions: [application, structuredClone(application)]
    }).success).toBe(false);
    expect(SubstitutionSearchTraceSchema.safeParse({
      ...trace,
      appliedEdgeIds: [],
      appliedSubstitutions: []
    }).success).toBe(false);
  });

  it("keeps hard preservation obligations outside modified fallback", async () => {
    const source = await interpretation({
      access: "covered-top",
      layout: { layout: "unspecified" }
    });
    const result = prepareFirstRegisteredSubstitution({
      interpretation: source
    });
    expect(result.kind).toBe("candidate");
    if (result.kind !== "candidate") return;
    const application = result.candidate.trace.appliedSubstitutions[0]!;
    const accessRequirement = result.candidate.interpretation.projection
      .requirements.find((requirement) =>
        requirement.priority === "must" && requirement.kind === "access"
      );
    expect(accessRequirement).toBeDefined();
    if (accessRequirement === undefined) return;

    expect(AppliedSubstitutionSchema.safeParse({
      ...application,
      relaxedPreservationObligations: ["access"]
    }).success).toBe(false);
    expect(substitutionTraceForRetainedScope({
      interpretation: result.candidate.interpretation,
      trace: result.candidate.trace,
      changedRequirementIds: [accessRequirement.id],
      omittedRequirementIds: []
    })).toBeNull();
    expect(substitutionTraceForRetainedScope({
      interpretation: result.candidate.interpretation,
      trace: result.candidate.trace,
      omittedRequirementIds: [accessRequirement.id]
    })).toBeNull();
  });

  it("requires entered searches and all attempts to agree with selected signatures", async () => {
    const source = await interpretation({
      access: "open-top",
      layout: { layout: "unspecified" },
      includeUnresolvedDependency: true
    });
    const result = prepareFirstRegisteredSubstitution({
      interpretation: source
    });
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;

    expect(SubstitutionSearchTraceSchema.safeParse({
      ...result.trace,
      selectedUnsupportedSignatureIds: []
    }).success).toBe(false);
    expect(SubstitutionSearchTraceSchema.safeParse({
      ...result.trace,
      substitutionSearchAttemptCount: 0,
      consideredEdgeIds: [],
      refusedEdgeIds: [],
      attempts: []
    }).success).toBe(false);
  });

  it("orders by cost then edge ID and rejects cycles and excessive depth", () => {
    const result = enumerateBoundedSubstitutionPaths({
      startNodeId: "node-a",
      maximumDepth: 2,
      edges: [
        {
          edgeId: "edge-beta",
          fromNodeId: "node-a",
          toNodeId: "node-c",
          cost: 1,
          maximumApplications: 1
        },
        {
          edgeId: "edge-alpha",
          fromNodeId: "node-a",
          toNodeId: "node-b",
          cost: 1,
          maximumApplications: 1
        },
        {
          edgeId: "edge-cycle",
          fromNodeId: "node-b",
          toNodeId: "node-a",
          cost: 1,
          maximumApplications: 1
        },
        {
          edgeId: "edge-depth-one",
          fromNodeId: "node-b",
          toNodeId: "node-d",
          cost: 1,
          maximumApplications: 1
        },
        {
          edgeId: "edge-depth-two",
          fromNodeId: "node-d",
          toNodeId: "node-e",
          cost: 1,
          maximumApplications: 1
        }
      ]
    });
    expect(result.paths.slice(0, 2).map((path) => path.edgeIds)).toEqual([
      ["edge-alpha"],
      ["edge-beta"]
    ]);
    expect(result.cycleRejectedEdgeIds).toEqual(["edge-cycle"]);
    expect(result.depthRejectedEdgeIds).toEqual(["edge-depth-two"]);
  });

  it("applies the same edge to two structurally distinct positive cases", async () => {
    const candidates = await Promise.all([
      interpretation({
        access: "covered-top",
        layout: { layout: "unspecified" }
      }),
      interpretation({
        access: "open-top",
        layout: { layout: "count", desiredSpaceCount: 3 }
      })
    ]);
    for (const candidate of candidates) {
      const result = prepareFirstRegisteredSubstitution({
        interpretation: candidate
      });
      expect(result.kind).toBe("candidate");
      if (result.kind !== "candidate") continue;
      expect(result.candidate.trace).toMatchObject({
        substitutionSearchEntered: true,
        substitutionSearchAttemptCount: 1,
        consideredEdgeIds: [
          "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners"
        ],
        refusedEdgeIds: [],
        appliedEdgeIds: [
          "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners"
        ]
      });
      expect(result.candidate.interpretation.projection.accounting[1])
        .toMatchObject({
          state: "bound",
          capabilityIds: ["rigid-orthogonal-sheet-assembly"],
          unsupportedSignatureIds: []
        });
    }
  });

  it("refuses an unresolved essential dependency and retains explicit refusal evidence", async () => {
    const candidate = await interpretation({
      access: "open-top",
      layout: { layout: "unspecified" },
      includeUnresolvedDependency: true
    });
    const result = prepareFirstRegisteredSubstitution({
      interpretation: candidate
    });
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.trace).toMatchObject({
      substitutionSearchEntered: true,
      substitutionSearchAttemptCount: 1,
      consideredEdgeIds: [
        "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners"
      ],
      refusedEdgeIds: [
        "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners"
      ],
      appliedEdgeIds: []
    });
    expect(result.trace.attempts[0]!.findingCodes).toContain(
      "SUBSTITUTION_ESSENTIAL_DEPENDENCY_UNRESOLVED",
    );
  });

  it("does not enter search without a selected signature and ignores claim wording", async () => {
    const direct = await interpretation({
      access: "open-top",
      layout: { layout: "unspecified" },
      includeSignature: false
    });
    expect(initialSubstitutionSearchTrace(direct)).toMatchObject({
      selectedUnsupportedSignatureIds: [],
      substitutionSearchEntered: false,
      substitutionSearchAttemptCount: 0,
      consideredEdgeIds: [],
      refusedEdgeIds: [],
      appliedEdgeIds: []
    });

    const first = await interpretation({
      access: "open-top",
      layout: { layout: "unspecified" },
      flexureClaim: "First arbitrary construction claim."
    });
    const second = structuredClone(first);
    second.inventory.items[1]!.claim =
      "Completely different wording with no shared lexical cue.";
    const firstResult = prepareFirstRegisteredSubstitution({
      interpretation: first
    });
    const secondResult = prepareFirstRegisteredSubstitution({
      interpretation: second
    });
    expect(firstResult.kind).toBe("candidate");
    expect(secondResult.kind).toBe("candidate");
    if (firstResult.kind === "candidate" && secondResult.kind === "candidate") {
      expect(firstResult.candidate.trace.appliedEdgeIds).toEqual(
        secondResult.candidate.trace.appliedEdgeIds,
      );
    }
  });
});
