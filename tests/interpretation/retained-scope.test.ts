import { describe, expect, it } from "vitest";

import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION
} from "../../src/interpretation/semantic-atom-registry.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  SemanticInterpretationCandidateSchema,
  expandSemanticInterpretationCandidate
} from "../../src/interpretation/semantic-model-contract.js";
import {
  enumerateRetainedScopeCandidates,
  initialRetainedScopeDecision,
  planningProjectionForRetainedScope,
  retainedScopePolicyHash
} from "../../src/interpretation/retained-scope.js";
import { buildSourceEvidenceIndex } from "../../src/interpretation/source-evidence.js";
import {
  prepareFirstRegisteredSubstitution,
  substitutionTraceForRetainedScope
} from "../../src/interpretation/substitution-graph.js";

async function fixedTopInterpretation(input?: {
  auxiliaryMeasurement?: boolean;
  auxiliaryReason?: "CAPABILITY_NOT_REGISTERED" | "EVIDENCE_INSUFFICIENT";
  auxiliaryPurpose?: "illumination" | "access";
  includeDependent?: boolean;
}) {
  const brief = "Builder-authored typed retained-scope proof.";
  const source = await buildSourceEvidenceIndex({
    brief,
    references: [],
    roleConstraints: []
  });
  const evidenceId = source.sourceEvidenceIndex.spans[0]!.evidenceId;
  const auxiliary = input?.auxiliaryReason === undefined
    ? {
        claim: "A non-access aperture branch occupies eligible side faces.",
        importance: "essential" as const,
        evidenceBindings: [{
          evidenceId,
          aspect: "surface" as const,
          support: "direct" as const
        }],
        relationships: [],
        measurements: input?.auxiliaryMeasurement === true
          ? [{
              target: {
                subject: "project" as const,
                envelope: "external" as const,
                axis: "width" as const
              },
              interpretation: "exact" as const,
              literal: { evidenceId, start: 0, end: brief.length }
            }]
          : [],
        state: "bound" as const,
        atoms: [{
          kind: "structural-aperture" as const,
          targetBodyRole: "primary-enclosure" as const,
          targetFaceRoles: ["rear" as const, "left" as const],
          patternFamily: "lattice-grid" as const,
          purpose: input?.auxiliaryPurpose ?? "illumination",
          density: "dense" as const,
          symmetry: "translational" as const,
          repetition: "matched-faces" as const,
          priority: "must" as const
        }]
      }
    : {
        claim: "The auxiliary branch remains unresolved.",
        importance: "essential" as const,
        evidenceBindings: [{
          evidenceId,
          aspect: "surface" as const,
          support: "direct" as const
        }],
        relationships: [],
        measurements: [],
        state: "unbound" as const,
        reason: input.auxiliaryReason,
        unsupportedSignatureIds: []
      };
  const items: unknown[] = [{
    claim: "One fixed-top primary enclosure retains a circular access aperture.",
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
        kind: "covered-top",
        priority: "must",
        evidenceIds: [evidenceId]
      },
      space: {
        layout: "unspecified",
        priority: "must",
        evidenceIds: [evidenceId]
      }
    }, {
      kind: "structural-aperture",
      targetBodyRole: "primary-enclosure",
      targetFaceRoles: ["cover"],
      patternFamily: "ring-aperture",
      purpose: "access",
      density: "sparse",
      symmetry: "radial",
      repetition: "single-face",
      priority: "must"
    }]
  }, auxiliary, {
    claim: "The primary enclosure corners require kerf-flexure construction.",
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
    unsupportedSignatureIds: ["kerf-flexure-corner-construction"]
  }];
  if (input?.includeDependent === true) {
    items.push({
      claim: "A secondary surface branch depends on the auxiliary branch.",
      importance: "preference",
      evidenceBindings: [{
        evidenceId,
        aspect: "surface",
        support: "direct"
      }],
      relationships: [{ kind: "depends-on", targetItemOrdinal: 2 }],
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

describe("deterministic retained-scope policy", () => {
  it("removes only the independently owned non-access branch after substitution", async () => {
    const direct = await fixedTopInterpretation();
    const substitution = prepareFirstRegisteredSubstitution({
      interpretation: direct
    });
    expect(substitution.kind).toBe("candidate");
    if (substitution.kind !== "candidate") return;
    const enumeration = enumerateRetainedScopeCandidates({
      interpretation: substitution.candidate.interpretation,
      substitutionTrace: substitution.candidate.trace
    });
    expect(enumeration.kind).toBe("complete");
    if (enumeration.kind !== "complete") return;
    const candidates = enumeration.candidates;
    expect(candidates[0]?.decision.omittedInventoryItemIds).toEqual([
      "inventory-item-2"
    ]);
    expect(candidates[0]?.decision.omittedRequirementIds).toEqual([
      "atom-inventory-item-2-1-requirement-cut-through-treatment"
    ]);
    expect(candidates[0]?.planningProjection.cutThrough).toEqual([
      expect.objectContaining({
        purpose: "access",
        fixedTopAccess: true
      })
    ]);
    expect(candidates[0]?.planningProjection.constructionBodies).toHaveLength(1);
    expect(candidates[0]?.decision.disclosures).toEqual([
      expect.objectContaining({
        semanticId: "inventory-item-2",
        code: "DETERMINISTIC_RETAINED_SCOPE_OMISSION"
      })
    ]);
  });

  it("closes reverse dependencies and is invariant to claim wording", async () => {
    const interpretation = await fixedTopInterpretation({
      includeDependent: true
    });
    const substitution = prepareFirstRegisteredSubstitution({ interpretation });
    expect(substitution.kind).toBe("candidate");
    if (substitution.kind !== "candidate") return;
    const firstEnumeration = enumerateRetainedScopeCandidates({
      interpretation: substitution.candidate.interpretation,
      substitutionTrace: substitution.candidate.trace
    });
    expect(firstEnumeration.kind).toBe("complete");
    if (firstEnumeration.kind !== "complete") return;
    const first = firstEnumeration.candidates;
    const renamed = structuredClone(substitution.candidate.interpretation);
    renamed.inventory.items[1]!.claim =
      "Arbitrary replacement text outside deterministic authority.";
    const secondEnumeration = enumerateRetainedScopeCandidates({
      interpretation: renamed,
      substitutionTrace: substitution.candidate.trace
    });
    expect(secondEnumeration.kind).toBe("complete");
    if (secondEnumeration.kind !== "complete") return;
    const second = secondEnumeration.candidates;
    const firstDependent = first.find((item) =>
      item.decision.omittedInventoryItemIds.includes("inventory-item-2")
    );
    expect(firstDependent?.decision.omittedInventoryItemIds).toEqual([
      "inventory-item-2",
      "inventory-item-4"
    ]);
    expect(second.map((item) => item.decision)).toEqual(
      first.map((item) => item.decision),
    );
  });

  it("protects exact measurement and evidence-uncertain branches", async () => {
    for (const interpretation of await Promise.all([
      fixedTopInterpretation({ auxiliaryMeasurement: true }),
      fixedTopInterpretation({ auxiliaryReason: "EVIDENCE_INSUFFICIENT" })
    ])) {
      const substitution = prepareFirstRegisteredSubstitution({
        interpretation
      });
      expect(substitution.kind).toBe("candidate");
      if (substitution.kind !== "candidate") continue;
      const enumeration = enumerateRetainedScopeCandidates({
        interpretation: substitution.candidate.interpretation,
        substitutionTrace: substitution.candidate.trace
      });
      expect(enumeration.kind).toBe("complete");
      if (enumeration.kind === "complete") {
        expect(enumeration.candidates).toEqual([]);
      }
    }
  });

  it("never omits or relaxes an access-purpose aperture", async () => {
    const interpretation = await fixedTopInterpretation({
      auxiliaryPurpose: "access"
    });
    const substitution = prepareFirstRegisteredSubstitution({
      interpretation
    });
    expect(substitution.kind).toBe("candidate");
    if (substitution.kind !== "candidate") return;
    const enumeration = enumerateRetainedScopeCandidates({
      interpretation: substitution.candidate.interpretation,
      substitutionTrace: substitution.candidate.trace
    });
    expect(enumeration.kind).toBe("complete");
    if (enumeration.kind === "complete") {
      expect(enumeration.candidates).toEqual([]);
    }
    const accessRequirementId =
      substitution.candidate.interpretation.projection.cutThrough.find(
        (application) =>
          application.purpose === "access" &&
          application.inventoryItemIds.includes("inventory-item-2"),
      )!.requirementId;
    expect(substitutionTraceForRetainedScope({
      interpretation: substitution.candidate.interpretation,
      trace: substitution.candidate.trace,
      omittedRequirementIds: [accessRequirementId]
    })).toBeNull();
  });

  it("round-trips an exact decision and rejects decision tampering", async () => {
    const interpretation = await fixedTopInterpretation();
    const enumeration = enumerateRetainedScopeCandidates({
      interpretation
    });
    expect(enumeration.kind).toBe("complete");
    if (enumeration.kind !== "complete") return;
    const candidate = enumeration.candidates.find((item) =>
      item.decision.omittedInventoryItemIds.includes("inventory-item-2")
    )!;
    expect(planningProjectionForRetainedScope({
      interpretation,
      decision: candidate.decision
    })).toEqual(candidate.planningProjection);
    expect(() => planningProjectionForRetainedScope({
      interpretation,
      decision: {
        ...candidate.decision,
        omittedRequirementIds: []
      }
    })).toThrow("RETAINED_SCOPE_DECISION_NOT_AUTHORIZED");
    const primaryItemId = "inventory-item-1";
    const primaryRequirementIds = interpretation.projection.requirements
      .flatMap((requirement) =>
        requirement.inventoryItemIds.every((itemId) =>
          itemId === primaryItemId
        )
          ? [requirement.id]
          : []
      ).sort();
    expect(() => planningProjectionForRetainedScope({
      interpretation,
      decision: {
        schemaVersion: "1.0",
        policyVersion: "retained-scope-v3",
        omittedInventoryItemIds: [primaryItemId],
        omittedRequirementIds: primaryRequirementIds,
        disclosures: [{
          semanticId: primaryItemId,
          code: "DETERMINISTIC_RETAINED_SCOPE_OMISSION",
          message: "Forged hard-scope omission."
        }]
      }
    })).toThrow("RETAINED_SCOPE_DECISION_NOT_AUTHORIZED");
    expect(initialRetainedScopeDecision()).toMatchObject({
      omittedInventoryItemIds: [],
      omittedRequirementIds: []
    });
    await expect(retainedScopePolicyHash()).resolves.toMatch(/^[a-f0-9]{64}$/u);
  });

  it("fails closed above the complete finite candidate domain", async () => {
    const brief = "Builder-authored bounded ranking proof.";
    const source = await buildSourceEvidenceIndex({
      brief,
      references: [],
      roleConstraints: []
    });
    const evidenceId = source.sourceEvidenceIndex.spans[0]!.evidenceId;
    const items = [{
      claim: "A primary construction remains the non-omittable anchor.",
      importance: "essential" as const,
      evidenceBindings: [{
        evidenceId,
        aspect: "structure" as const,
        support: "direct" as const
      }],
      relationships: [],
      measurements: [],
      state: "bound" as const,
      atoms: [{
        kind: "primary-enclosure" as const,
        enclosure: {
          quantity: null,
          priority: "must" as const,
          evidenceIds: [evidenceId]
        },
        access: {
          kind: "open-top" as const,
          priority: "must" as const,
          evidenceIds: [evidenceId]
        },
        space: {
          layout: "unspecified" as const,
          priority: "must" as const,
          evidenceIds: [evidenceId]
        }
      }]
    }, ...Array.from({ length: 25 }, (_, index) => ({
      claim: `Independent unsupported branch ${String(index + 1)}.`,
      importance: index === 24 ? "preference" as const : "essential" as const,
      evidenceBindings: [{
        evidenceId,
        aspect: "surface" as const,
        support: "direct" as const
      }],
      relationships: [],
      measurements: [],
      state: "unbound" as const,
      reason: "CAPABILITY_NOT_REGISTERED" as const,
      unsupportedSignatureIds: []
    }))];
    const interpretation = expandSemanticInterpretationCandidate(
      SemanticInterpretationCandidateSchema.parse({
        schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
        atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
        items
      }),
      source.sourceEvidenceIndex,
    );
    const enumeration = enumerateRetainedScopeCandidates({ interpretation });
    expect(enumeration).toMatchObject({
      kind: "fail-closed",
      code: "RETAINED_SCOPE_ELIGIBLE_DOMAIN_EXCEEDED",
      maximumEligibleItemCount: 4,
      maximumRootCombinationCount: 14
    });
  });
});
