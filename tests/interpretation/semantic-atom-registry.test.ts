import { describe, expect, it } from "vitest";

import { hashCanonical } from "../../src/domain/hash.js";
import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
  SEMANTIC_ATOM_TEMPLATES,
  semanticAtomKinds,
  semanticAtomTemplateRegistryHash,
  type SemanticAtom
} from "../../src/interpretation/semantic-atom-registry.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  SemanticInterpretationCandidateSchema,
  authorizeSemanticInterpretation,
  expandSemanticInterpretationCandidate,
  type SemanticInterpretationCandidate
} from "../../src/interpretation/semantic-model-contract.js";
import { buildSourceEvidenceIndex } from "../../src/interpretation/source-evidence.js";

async function source() {
  return buildSourceEvidenceIndex({
    brief: "Preserve the selected semantic relationships in a deterministic construction.",
    references: [],
    roleConstraints: []
  });
}

type PrimaryEnclosureAtom = Extract<SemanticAtom, { kind: "primary-enclosure" }>;
type PrimarySpaceChoice =
  | { layout: "unspecified" }
  | { layout: "explicit-single-space" }
  | { layout: "minimum-separated" }
  | { layout: "count"; desiredSpaceCount: number }
  | { layout: "grid"; rows: number; columns: number };

function primaryEnclosureAtom(input: {
  evidenceId: string;
  quantity?: number | null;
  accessKind?: PrimaryEnclosureAtom["access"]["kind"];
  space?: PrimarySpaceChoice;
  enclosurePriority?: "must" | "prefer";
  accessPriority?: "must" | "prefer";
  spacePriority?: "must" | "prefer";
  enclosureEvidenceIds?: string[];
  accessEvidenceIds?: string[];
  spaceEvidenceIds?: string[];
}): PrimaryEnclosureAtom {
  return {
    kind: "primary-enclosure",
    enclosure: {
      quantity: input.quantity ?? null,
      priority: input.enclosurePriority ?? "must",
      evidenceIds: input.enclosureEvidenceIds ?? [input.evidenceId]
    },
    access: {
      kind: input.accessKind ?? "unspecified",
      priority: input.accessPriority ?? "must",
      evidenceIds: input.accessEvidenceIds ?? [input.evidenceId]
    },
    space: {
      ...(input.space ?? { layout: "unspecified" }),
      priority: input.spacePriority ?? "must",
      evidenceIds: input.spaceEvidenceIds ?? [input.evidenceId]
    }
  } as PrimaryEnclosureAtom;
}

function candidateFor(input: {
  evidenceId: string;
  atom: SemanticAtom;
  aspect?: "structure" | "surface";
}): SemanticInterpretationCandidate {
  const aspect = input.aspect ?? "structure";
  const primaryEnclosure = primaryEnclosureAtom({
    evidenceId: input.evidenceId,
    quantity: 1,
    accessKind: input.atom.kind === "retained-revolute-cover" ||
        input.atom.kind === "captured-prismatic-cover"
      ? "covered-top"
      : "unspecified"
  });
  return SemanticInterpretationCandidateSchema.parse({
    schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    items: [{
      claim: "Opaque maker meaning remains available for disclosure.",
      importance: "essential",
      evidenceBindings: aspect === "surface"
        ? [
            { evidenceId: input.evidenceId, aspect: "structure", support: "direct" },
            { evidenceId: input.evidenceId, aspect: "surface", support: "direct" }
          ]
        : [{ evidenceId: input.evidenceId, aspect: "structure", support: "direct" }],
      relationships: [],
      measurements: [],
      state: "bound",
      atoms: input.atom.kind === "primary-enclosure"
        ? [input.atom]
        : [primaryEnclosure, input.atom]
    }]
  });
}

describe("versioned semantic-atom registry", () => {
  it("expands every registered atom with complete deterministic authority and accounting", async () => {
    const evidence = await source();
    const evidenceId = evidence.sourceEvidenceIndex.spans[0]!.evidenceId;
    const atoms: Record<SemanticAtom["kind"], { atom: SemanticAtom; aspect?: "surface" }> = {
      "primary-enclosure": { atom: primaryEnclosureAtom({ evidenceId }) },
      "partial-support": { atom: { kind: "partial-support", priority: "prefer", quantity: 2 } },
      "open-access": { atom: { kind: "open-access", targetBodyRole: "support", accessKind: "open-top", priority: "must" } },
      "retained-revolute-cover": { atom: { kind: "retained-revolute-cover", axis: "width", priority: "must" } },
      "captured-prismatic-cover": { atom: { kind: "captured-prismatic-cover", axis: "depth", priority: "must" } },
      organization: { atom: { kind: "organization", targetBodyRole: "support", layout: "count", desiredSpaceCount: 3, priority: "must" } },
      "qualitative-proportion": { atom: { kind: "qualitative-proportion", targetBodyRole: "primary-enclosure", numeratorAxis: "height", denominatorAxis: "width", strength: "strong", priority: "must", confidence: "medium" } },
      "object-clearance": { atom: { kind: "object-clearance", targetObjectRole: "contained", clearance: "ordinary-access", priority: "must" } },
      "object-scale": { atom: { kind: "object-scale", targetObjectRole: "contained", long: { minimumUm: 10000, maximumUm: 20000 }, short: { minimumUm: 5000, maximumUm: 10000 }, height: { minimumUm: 10000, maximumUm: 30000 }, confidence: "medium" } },
      "ranked-goal": { atom: { kind: "ranked-goal", goal: "compactness", rank: 1 } },
      "registered-surface-treatment": { aspect: "surface", atom: { kind: "registered-surface-treatment", composition: "border", density: "sparse", symmetry: "bilateral", primitiveFamilies: ["inset-score-frame"], preferredOperations: ["score"], preferredBodyRoles: ["primary-enclosure"] } },
      "structural-aperture": { aspect: "surface", atom: { kind: "structural-aperture", targetBodyRole: "primary-enclosure", targetFaceRoles: ["rear"], patternFamily: "lattice-grid", purpose: "ventilation", density: "sparse", symmetry: "bilateral", repetition: "single-face", priority: "prefer" } }
    };
    expect(new Set(Object.keys(atoms))).toEqual(new Set(semanticAtomKinds()));
    for (const kind of semanticAtomKinds()) {
      const fixture = atoms[kind];
      const authorized = authorizeSemanticInterpretation({
        interpretation: candidateFor({
          evidenceId,
          atom: fixture.atom,
          ...(fixture.aspect === undefined ? {} : { aspect: fixture.aspect })
        }),
        sourceEvidenceIndex: evidence.sourceEvidenceIndex
      });
      expect(authorized.success, kind).toBe(true);
      if (!authorized.success) continue;
      const projection = authorized.interpretation.projection;
      expect(projection.accounting, kind).toHaveLength(1);
      expect(projection.accounting[0], kind).toMatchObject({
        itemId: "inventory-item-1",
        state: "bound"
      });
      expect(projection.accounting[0]!.capabilityIds, kind)
        .toEqual(expect.arrayContaining([...SEMANTIC_ATOM_TEMPLATES[kind].capabilityIds]));
      for (const record of [
        ...projection.requirements,
        ...projection.constructionBodies,
        ...projection.objects,
        ...projection.interfaces,
        ...projection.access,
        ...projection.organization,
        ...projection.scaleEvidence,
        ...projection.proportions,
        ...projection.clearance,
        ...projection.rankedGoals,
        ...(projection.motif === null ? [] : [projection.motif]),
        ...projection.cutThrough
      ]) {
        expect(record.inventoryItemIds, kind).toContain("inventory-item-1");
        expect(record.evidenceIds, kind).toContain(evidenceId);
      }
    }
    expect(await semanticAtomTemplateRegistryHash()).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("preserves independent access and space priority, evidence, provenance, and accounting", async () => {
    const evidence = await buildSourceEvidenceIndex({
      brief: "The enclosure must contain the object and preserve the selected access.",
      references: [{
        referenceId: "reference-layout",
        sha256: "a".repeat(64),
        mediaType: "image/png",
        width: 640,
        height: 480
      }],
      roleConstraints: [{
        referenceId: "reference-layout",
        roles: ["structure"]
      }]
    });
    const briefEvidenceId = evidence.sourceEvidenceIndex.spans[0]!.evidenceId;
    const referenceEvidenceId = evidence.sourceEvidenceIndex.references[0]!.evidenceId;

    for (const priorities of [
      { access: "must", space: "prefer" },
      { access: "prefer", space: "must" }
    ] as const) {
      const candidate = candidateFor({
        evidenceId: briefEvidenceId,
        atom: primaryEnclosureAtom({
          evidenceId: briefEvidenceId,
          accessKind: "covered-top",
          space: { layout: "minimum-separated" },
          accessPriority: priorities.access,
          spacePriority: priorities.space,
          accessEvidenceIds: [briefEvidenceId],
          spaceEvidenceIds: [referenceEvidenceId]
        })
      });
      candidate.items[0]!.evidenceBindings.push({
        evidenceId: referenceEvidenceId,
        aspect: "structure",
        support: "inferred"
      });

      const authorized = authorizeSemanticInterpretation({
        interpretation: candidate,
        sourceEvidenceIndex: evidence.sourceEvidenceIndex
      });
      expect(authorized.success).toBe(true);
      if (!authorized.success) continue;
      const projection = authorized.interpretation.projection;
      const accessRequirement = projection.requirements.find(
        (requirement) => requirement.kind === "access",
      );
      const closureRequirement = projection.requirements.find(
        (requirement) => requirement.kind === "closure",
      );
      const organizationRequirement = projection.requirements.find(
        (requirement) => requirement.kind === "organization",
      );
      const containmentRequirements = projection.requirements.filter((requirement) =>
        requirement.kind === "containment" || requirement.kind === "rigid-interface"
      );
      expect(containmentRequirements).toHaveLength(2);
      for (const requirement of containmentRequirements) {
        expect(requirement).toMatchObject({
          priority: "must",
          evidenceIds: [briefEvidenceId]
        });
      }
      expect(accessRequirement).toMatchObject({
        priority: priorities.access,
        evidenceIds: [briefEvidenceId]
      });
      expect(closureRequirement).toMatchObject({
        priority: priorities.access,
        evidenceIds: [briefEvidenceId]
      });
      expect(organizationRequirement).toMatchObject({
        priority: priorities.space,
        evidenceIds: [referenceEvidenceId]
      });
      expect(projection.access).toEqual([
        expect.objectContaining({
          priority: priorities.access,
          requirementId: accessRequirement?.id,
          evidenceIds: [briefEvidenceId],
          basis: "explicit-covered-top"
        })
      ]);
      expect(projection.organization).toEqual([
        expect.objectContaining({
          priority: priorities.space,
          requirementId: organizationRequirement?.id,
          evidenceIds: [referenceEvidenceId],
          basis: "minimum-separated-policy",
          desiredSpaceCount: 2
        })
      ]);
      expect(projection.objects).toEqual([
        expect.objectContaining({ evidenceIds: [briefEvidenceId] })
      ]);
      expect(projection.constructionBodies).toHaveLength(1);
      const body = projection.constructionBodies[0]!;
      expect(body.evidenceIds).toEqual([briefEvidenceId, referenceEvidenceId]);
      expect(body.requirementIds).toEqual(expect.arrayContaining([
        accessRequirement?.id,
        closureRequirement?.id,
        organizationRequirement?.id
      ]));
      expect(projection.accounting).toHaveLength(1);
      expect(projection.accounting[0]!.requirementIds).toEqual(expect.arrayContaining([
        accessRequirement?.id,
        closureRequirement?.id,
        organizationRequirement?.id
      ]));
      expect(projection.accounting[0]!.bodyIds).toEqual([body.id]);
    }
  });

  it("derives atom aspects from selected evidence without weakening maker-selected reference roles", async () => {
    const briefEvidence = await source();
    const briefEvidenceId = briefEvidence.sourceEvidenceIndex.spans[0]!.evidenceId;
    for (const atom of [
      primaryEnclosureAtom({ evidenceId: briefEvidenceId }),
      {
        kind: "registered-surface-treatment",
        composition: "border",
        density: "sparse",
        symmetry: "bilateral",
        primitiveFamilies: ["inset-score-frame"],
        preferredOperations: ["score"],
        preferredBodyRoles: ["primary-enclosure"]
      }
    ] as const) {
      const candidate = candidateFor({
        evidenceId: briefEvidenceId,
        atom: atom as SemanticAtom
      });
      if (candidate.items[0]?.state !== "bound") throw new Error("expected bound fixture");
      candidate.items[0].evidenceBindings = [{
        evidenceId: briefEvidenceId,
        aspect: atom.kind === "primary-enclosure" ? "surface" : "structure",
        support: "direct"
      }];
      const authorization = authorizeSemanticInterpretation({
        interpretation: candidate,
        sourceEvidenceIndex: briefEvidence.sourceEvidenceIndex
      });
      expect(authorization.success, atom.kind).toBe(true);
      if (!authorization.success) continue;
      expect(authorization.interpretation.inventory.items[0]!.aspects)
        .toEqual(atom.kind === "primary-enclosure"
          ? ["structure"]
          : ["structure", "surface"]);
      expect(authorization.interpretation.projection.accounting[0])
        .toMatchObject({ state: "bound" });
    }

    const referenceEvidence = await buildSourceEvidenceIndex({
      brief: "Use only the maker-selected image role.",
      references: [{
        referenceId: "reference-surface-only",
        sha256: "c".repeat(64),
        mediaType: "image/png",
        width: 320,
        height: 240
      }],
      roleConstraints: [{
        referenceId: "reference-surface-only",
        roles: ["surface"]
      }]
    });
    const surfaceReferenceId = referenceEvidence.sourceEvidenceIndex.references[0]!.evidenceId;
    const unauthorized = candidateFor({
      evidenceId: surfaceReferenceId,
      atom: primaryEnclosureAtom({ evidenceId: surfaceReferenceId })
    });
    if (unauthorized.items[0]?.state !== "bound") throw new Error("expected bound fixture");
    unauthorized.items[0].evidenceBindings = [{
      evidenceId: surfaceReferenceId,
      aspect: "surface",
      support: "direct"
    }];
    const denied = authorizeSemanticInterpretation({
      interpretation: unauthorized,
      sourceEvidenceIndex: referenceEvidence.sourceEvidenceIndex
    });
    expect(denied.success).toBe(false);
    if (denied.success) throw new Error("expected maker-selected role rejection");
    expect(denied.findings.map((finding) => finding.code))
      .toContain("SEMANTIC_ATOM_EVIDENCE_BINDING_UNAUTHORIZED");
  });

  it("defers role-excluded secondary atoms instead of rejecting the whole interpretation", async () => {
    const evidence = await buildSourceEvidenceIndex({
      brief: "Use the reference only for its construction.",
      references: [{
        referenceId: "reference-structure-only",
        sha256: "d".repeat(64),
        mediaType: "image/png",
        width: 320,
        height: 240
      }],
      roleConstraints: [{
        referenceId: "reference-structure-only",
        roles: ["structure"]
      }]
    });
    const referenceEvidenceId = evidence.sourceEvidenceIndex.references[0]!.evidenceId;
    const surfaceTreatment: SemanticAtom = {
      kind: "registered-surface-treatment",
      composition: "border",
      density: "sparse",
      symmetry: "bilateral",
      primitiveFamilies: ["inset-score-frame"],
      preferredOperations: ["score"],
      preferredBodyRoles: ["primary-enclosure"]
    };

    const mixed = candidateFor({
      evidenceId: referenceEvidenceId,
      atom: surfaceTreatment,
      aspect: "surface"
    });
    const mixedAuthorization = authorizeSemanticInterpretation({
      interpretation: mixed,
      sourceEvidenceIndex: evidence.sourceEvidenceIndex
    });
    expect(mixedAuthorization.success).toBe(true);
    if (!mixedAuthorization.success) throw new Error("expected secondary-atom reconciliation");
    expect(mixedAuthorization.findings).toContainEqual({
      code: "REFERENCE_ROLE_ATOM_EXCLUDED",
      path: "items.0.atoms.1"
    });
    expect(mixedAuthorization.candidate.items[0]).toMatchObject({
      state: "bound",
      atoms: [expect.objectContaining({ kind: "primary-enclosure" })],
      evidenceBindings: [{
        evidenceId: referenceEvidenceId,
        aspect: "structure",
        support: "direct"
      }]
    });
    expect(mixedAuthorization.interpretation.projection.accounting[0])
      .toMatchObject({ state: "bound" });

    const excludedOnly = SemanticInterpretationCandidateSchema.parse({
      schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
      atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
      items: [{
        claim: "Reference-only decoration is outside the selected role.",
        importance: "preference",
        evidenceBindings: [{
          evidenceId: referenceEvidenceId,
          aspect: "structure",
          support: "direct"
        }],
        relationships: [],
        measurements: [],
        state: "bound",
        atoms: [surfaceTreatment]
      }]
    });
    const excludedAuthorization = authorizeSemanticInterpretation({
      interpretation: excludedOnly,
      sourceEvidenceIndex: evidence.sourceEvidenceIndex
    });
    expect(excludedAuthorization.success).toBe(true);
    if (!excludedAuthorization.success) throw new Error("expected role-deferred item");
    expect(excludedAuthorization.candidate.items[0]).toMatchObject({
      state: "deferred",
      evidenceBindings: [{
        evidenceId: referenceEvidenceId,
        aspect: "surface",
        support: "direct"
      }]
    });
    expect(excludedAuthorization.interpretation.projection.accounting[0])
      .toMatchObject({
        state: "deferred",
        reason: "REFERENCE_ROLE_DEFERRED"
      });
  });

  it("rejects primary subchoice evidence not selected by the item", async () => {
    const evidence = await buildSourceEvidenceIndex({
      brief: "The enclosure must remain open from above.",
      references: [{
        referenceId: "reference-unselected",
        sha256: "b".repeat(64),
        mediaType: "image/png",
        width: 320,
        height: 240
      }],
      roleConstraints: [{
        referenceId: "reference-unselected",
        roles: ["structure"]
      }]
    });
    const briefEvidenceId = evidence.sourceEvidenceIndex.spans[0]!.evidenceId;
    const unselectedEvidenceId = evidence.sourceEvidenceIndex.references[0]!.evidenceId;
    const candidate = candidateFor({
      evidenceId: briefEvidenceId,
      atom: primaryEnclosureAtom({
        evidenceId: briefEvidenceId,
        accessKind: "open-top",
        accessEvidenceIds: [unselectedEvidenceId]
      })
    });
    expect(authorizeSemanticInterpretation({
      interpretation: candidate,
      sourceEvidenceIndex: evidence.sourceEvidenceIndex
    })).toMatchObject({
      success: false,
      findings: [expect.objectContaining({
        code: "SEMANTIC_ATOM_EVIDENCE_BINDING_UNAUTHORIZED",
        path: "items.0.atoms.0.access.evidenceIds"
      })]
    });
  });

  it("fails closed for unknown, semantically invalid, and incompatible atom mutations", async () => {
    const evidence = await source();
    const evidenceId = evidence.sourceEvidenceIndex.spans[0]!.evidenceId;
    const candidate = candidateFor({
      evidenceId,
      atom: { kind: "open-access", targetBodyRole: "support", accessKind: "open-top", priority: "must" }
    });

    const unknown = structuredClone(candidate) as unknown as { items: { atoms: Record<string, unknown>[] }[] };
    unknown.items[0]!.atoms[1] = { kind: "unknown-atom" };
    expect(authorizeSemanticInterpretation({
      interpretation: unknown,
      sourceEvidenceIndex: evidence.sourceEvidenceIndex
    })).toMatchObject({ success: false, schemaIssues: [expect.stringContaining("Invalid")] });

    const hiddenCorrelation = structuredClone(candidate);
    if (hiddenCorrelation.items[0]!.state !== "bound") throw new Error("expected bound fixture");
    hiddenCorrelation.items[0]!.atoms[1] = {
      kind: "qualitative-proportion",
      targetBodyRole: "primary-enclosure",
      numeratorAxis: "height",
      denominatorAxis: "height",
      strength: "strong",
      priority: "must",
      confidence: "medium"
    };
    expect(authorizeSemanticInterpretation({
      interpretation: hiddenCorrelation,
      sourceEvidenceIndex: evidence.sourceEvidenceIndex
    })).toMatchObject({
      success: false,
      findings: [expect.objectContaining({ code: "SEMANTIC_ATOM_INVALID" })]
    });

    const conflicting = structuredClone(candidate);
    if (conflicting.items[0]!.state !== "bound") throw new Error("expected bound fixture");
    conflicting.items[0]!.atoms.push({
      kind: "open-access",
      targetBodyRole: "support",
      accessKind: "open-front",
      priority: "must"
    });
    expect(authorizeSemanticInterpretation({
      interpretation: conflicting,
      sourceEvidenceIndex: evidence.sourceEvidenceIndex
    })).toMatchObject({
      success: false,
      findings: [expect.objectContaining({
        code: "SEMANTIC_ATOM_INCOMPATIBLE",
        path: "SEMANTIC_ATOM_INCOMPATIBLE_REQUIRED_SUPPORT_ACCESS"
      })]
    });
  });

  it("makes context promotion, deferred atoms, and a second uncertainty representation unrepresentable", async () => {
    const evidence = await source();
    const evidenceId = evidence.sourceEvidenceIndex.spans[0]!.evidenceId;
    const common = {
      claim: "Opaque context.",
      evidenceBindings: [{ evidenceId, aspect: "context", support: "direct" }],
      relationships: [],
      measurements: []
    };
    const contextWithAuthority = {
      schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
      atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
      items: [{
        ...common,
        importance: "context",
        state: "bound",
        atoms: [{ kind: "ranked-goal", goal: "capacity", rank: 1 }]
      }]
    };
    expect(SemanticInterpretationCandidateSchema.safeParse(contextWithAuthority).success).toBe(false);
    expect(SemanticInterpretationCandidateSchema.safeParse({
      schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
      atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
      items: [{ ...common, state: "context", importance: "context" }]
    }).success).toBe(false);

    const deferredWithAtoms = {
      schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
      atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
      items: [{
        ...common,
        importance: "preference",
        state: "deferred",
        atoms: [{ kind: "ranked-goal", goal: "capacity", rank: 1 }]
      }]
    };
    expect(SemanticInterpretationCandidateSchema.safeParse(deferredWithAtoms).success).toBe(false);

    const duplicateUncertainty = {
      schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
      atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
      items: [{
        ...common,
        importance: "essential",
        state: "bound",
        atoms: [{
          ...primaryEnclosureAtom({ evidenceId })
        }],
        uncertainty: { state: "uncertain", rationale: "Duplicated state." }
      }]
    };
    expect(SemanticInterpretationCandidateSchema.safeParse(duplicateUncertainty).success).toBe(false);

    const correlatedAtomFields = [
      {
        kind: "open-access",
        targetBodyRole: "primary-enclosure",
        accessKind: "open-top",
        direction: "top",
        priority: "must"
      },
      {
        kind: "organization",
        targetBodyRole: "primary-enclosure",
        layout: "count",
        desiredSpaceCount: 3,
        rows: 1,
        columns: 3,
        priority: "must"
      },
      {
        kind: "structural-aperture",
        targetBodyRole: "primary-enclosure",
        targetFaceRoles: ["cover"],
        patternFamily: "ring-aperture",
        purpose: "access",
        density: "sparse",
        symmetry: "radial",
        repetition: "single-face",
        fixedTopAccess: true,
        priority: "must"
      }
    ];
    for (const atom of correlatedAtomFields) {
      expect(SemanticInterpretationCandidateSchema.safeParse({
        schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
        atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
        items: [{
          claim: "One structurally minimal commitment.",
          importance: "essential",
          evidenceBindings: [{ evidenceId, aspect: "structure", support: "direct" }],
          relationships: [],
          measurements: [],
          state: "bound",
          atoms: [atom]
        }]
      }).success).toBe(false);
    }
  });

  it("expands every primary-enclosure space variant with normalized provenance and ignores claim wording", async () => {
    const evidence = await source();
    const evidenceId = evidence.sourceEvidenceIndex.spans[0]!.evidenceId;
    const cases: {
      atom: Extract<SemanticAtom, { kind: "primary-enclosure" }>;
      expected: {
        desiredSpaceCount: number;
        rows: number | null;
        columns: number | null;
        basis: "default-single-space-policy" | "explicit-single-space" | "explicit-count" | "explicit-grid" | "minimum-separated-policy";
      };
    }[] = [
      {
        atom: primaryEnclosureAtom({ evidenceId }),
        expected: {
          desiredSpaceCount: 1,
          rows: null,
          columns: null,
          basis: "default-single-space-policy"
        }
      },
      {
        atom: primaryEnclosureAtom({
          evidenceId,
          accessKind: "open-top",
          space: { layout: "explicit-single-space" }
        }),
        expected: {
          desiredSpaceCount: 1,
          rows: null,
          columns: null,
          basis: "explicit-single-space"
        }
      },
      {
        atom: primaryEnclosureAtom({
          evidenceId,
          accessKind: "open-front",
          space: { layout: "minimum-separated" }
        }),
        expected: {
          desiredSpaceCount: 2,
          rows: null,
          columns: null,
          basis: "minimum-separated-policy"
        }
      },
      {
        atom: primaryEnclosureAtom({
          evidenceId,
          accessKind: "covered-top",
          space: { layout: "count", desiredSpaceCount: 4 }
        }),
        expected: {
          desiredSpaceCount: 4,
          rows: null,
          columns: null,
          basis: "explicit-count"
        }
      },
      {
        atom: primaryEnclosureAtom({
          evidenceId,
          accessKind: "covered-front",
          space: { layout: "grid", rows: 2, columns: 3 }
        }),
        expected: {
          desiredSpaceCount: 6,
          rows: 2,
          columns: 3,
          basis: "explicit-grid"
        }
      }
    ];
    for (const { atom, expected } of cases) {
      const left = candidateFor({ evidenceId, atom });
      const right = structuredClone(left);
      right.items[0]!.claim = "No noun or phrase in this sentence participates in expansion.";

      const leftProjection = expandSemanticInterpretationCandidate(left, evidence.sourceEvidenceIndex).projection;
      const rightProjection = expandSemanticInterpretationCandidate(right, evidence.sourceEvidenceIndex).projection;
      expect(rightProjection).toEqual(leftProjection);
      expect(leftProjection.organization).toHaveLength(1);
      expect(leftProjection.organization[0]).toMatchObject(expected);
      expect(leftProjection.access[0]).toMatchObject(
        atom.access.kind === "unspecified"
          ? { kind: "open-top", direction: "top", basis: "default-open-top-policy" }
          : atom.access.kind === "open-top"
            ? { kind: "open-top", direction: "top", basis: "explicit-open-top" }
            : atom.access.kind === "open-front"
              ? { kind: "open-front", direction: "front", basis: "explicit-open-front" }
              : atom.access.kind === "covered-top"
                ? { kind: "covered", direction: "top", basis: "explicit-covered-top" }
                : { kind: "covered", direction: "front", basis: "explicit-covered-front" }
      );
      const leftArtifactHash = await hashCanonical({
        schemaVersion: "semantic-atom-expansion-artifact@3.0.0",
        projection: leftProjection
      });
      const rightArtifactHash = await hashCanonical({
        schemaVersion: "semantic-atom-expansion-artifact@3.0.0",
        projection: rightProjection
      });
      expect(rightArtifactHash).toBe(leftArtifactHash);

      const deletedAtom = structuredClone(left);
      deletedAtom.items[0]!.claim =
        "Four separate storage cells in two rows and three columns remain written in claim text.";
      if (deletedAtom.items[0]!.state !== "bound") throw new Error("expected bound fixture");
      deletedAtom.items[0]!.atoms = deletedAtom.items[0]!.atoms.filter((candidate) =>
        candidate.kind !== "primary-enclosure"
      );
      expect(SemanticInterpretationCandidateSchema.safeParse(deletedAtom).success).toBe(false);
    }
    expect(SEMANTIC_ATOM_TEMPLATES["primary-enclosure"].selectionDescription)
      .toContain("deterministic registered defaults");
  });

  it("rejects explicit multi-space primary-enclosure variants that request fewer than two spaces", async () => {
    const evidence = await source();
    const evidenceId = evidence.sourceEvidenceIndex.spans[0]!.evidenceId;
    const candidate = candidateFor({
      evidenceId,
      atom: primaryEnclosureAtom({
        evidenceId,
        accessKind: "open-top",
        space: { layout: "minimum-separated" }
      })
    }) as unknown as { items: { atoms: unknown[] }[] };
    candidate.items[0]!.atoms[0] = {
      kind: "primary-enclosure",
      enclosure: { quantity: null, priority: "must", evidenceIds: [evidenceId] },
      access: { kind: "open-top", priority: "must", evidenceIds: [evidenceId] },
      space: {
        layout: "count",
        desiredSpaceCount: 1,
        priority: "must",
        evidenceIds: [evidenceId]
      }
    };
    expect(SemanticInterpretationCandidateSchema.safeParse(candidate).success).toBe(false);

    candidate.items[0]!.atoms[0] = {
      kind: "primary-enclosure",
      enclosure: { quantity: null, priority: "must", evidenceIds: [evidenceId] },
      access: { kind: "open-top", priority: "must", evidenceIds: [evidenceId] },
      space: {
        layout: "grid",
        rows: 1,
        columns: 1,
        priority: "must",
        evidenceIds: [evidenceId]
      }
    };
    expect(SemanticInterpretationCandidateSchema.safeParse(candidate).success).toBe(false);
  });
});
