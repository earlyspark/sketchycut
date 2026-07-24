import { zodTextFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";

import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import { generationConceptOnlyFromInterpretation } from "../../src/interpretation/generation-outcome.js";
import {
  SemanticInterpretationSchema,
  assertSemanticStrictOutputSchema
} from "../../src/interpretation/semantic-interpretation.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  SEMANTIC_INTERPRETATION_JSON_SCHEMA,
  authorizeSemanticInterpretation,
  semanticInterpretationCandidateSchema,
  semanticInterpretationProviderSchema,
  type SemanticInterpretationCandidate
} from "../../src/interpretation/semantic-model-contract.js";
import { CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION } from "../../src/interpretation/semantic-atom-registry.js";
import { buildSourceEvidenceIndex } from "../../src/interpretation/source-evidence.js";
import { basicSemanticCandidate, basicSemanticInterpretation } from "../helpers/semantic-interpretation.js";

describe("open semantic inventory and closed projection", () => {
  it("accounts for every commitment exactly once while keeping context out of requirements", async () => {
    const source = await buildSourceEvidenceIndex({
      brief: "Build a qori keeper with rigid walls and top access; qori is only the maker's name for the contents.",
      references: [],
      roleConstraints: []
    });
    const interpretation = basicSemanticInterpretation({ sourceEvidenceIndex: source.sourceEvidenceIndex });
    interpretation.inventory.items.push({
      id: "inventory-item-2",
      claim: "Qori is the maker's contextual name for the contents.",
      importance: "context",
      aspects: ["context"],
      evidenceBindings: [{
        evidenceId: source.sourceEvidenceIndex.spans[0]!.evidenceId,
        aspect: "context",
        support: "direct"
      }],
      omissionConsequence: null,
      uncertainty: { state: "certain", rationale: null }
    });
    expect(SemanticInterpretationSchema.parse(interpretation).projection.accounting).toHaveLength(1);

    const invalid = structuredClone(interpretation);
    invalid.projection.requirements[0]!.inventoryItemIds = ["inventory-item-2"];
    expect(SemanticInterpretationSchema.safeParse(invalid).success).toBe(false);

    const missing = structuredClone(interpretation);
    missing.projection.accounting = [];
    expect(SemanticInterpretationSchema.safeParse(missing).success).toBe(false);
  });

  it("preserves an unsupported essential commitment without coercion and withholds export", async () => {
    const source = await buildSourceEvidenceIndex({
      brief: "The cover must split into two independently moving wings.",
      references: [],
      roleConstraints: []
    });
    const evidenceId = source.sourceEvidenceIndex.spans[0]!.evidenceId;
    const authorized = authorizeSemanticInterpretation({
      interpretation: {
        schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
        atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
        items: [{
          claim: "The cover splits into two independently moving wings.",
          importance: "essential",
          evidenceBindings: [
            { evidenceId, aspect: "structure", support: "direct" },
            { evidenceId, aspect: "operation", support: "direct" }
          ],
          relationships: [],
          measurements: [],
          state: "unbound",
          reason: "CAPABILITY_NOT_REGISTERED",
          unsupportedSignatureIds: []
        }]
      },
      sourceEvidenceIndex: source.sourceEvidenceIndex
    });
    expect(authorized.success).toBe(true);
    if (!authorized.success) throw new Error("expected authorized unbound interpretation");
    const explicitSizing = await reconcileExplicitSizingConstraints({
      advancedSizing: { basis: "auto" },
      parsedConstraints: [],
      parserFindings: []
    });
    const outcome = generationConceptOnlyFromInterpretation({
      requestId: "unsupported-commitment",
      transportMode: "fixture",
      interpretation: authorized.interpretation,
      explicitSizing
    });
    expect(outcome).toMatchObject({
      kind: "concept-only",
      exportAllowed: false,
      blockedInventoryItemIds: ["inventory-item-1"]
    });
    if (outcome.kind !== "concept-only") throw new Error("expected concept-only outcome");
    expect(outcome.unresolvedNeeds).toEqual([
      expect.stringContaining("inventory-item-1")
    ]);
  });

  it("binds the one source parser schema to server-authorized evidence", async () => {
    const source = await buildSourceEvidenceIndex({
      brief: "Make a rigid open container.",
      references: [],
      roleConstraints: []
    });
    const candidate = basicSemanticCandidate({ sourceEvidenceIndex: source.sourceEvidenceIndex });
    const schemaText = JSON.stringify(semanticInterpretationProviderSchema(source.sourceEvidenceIndex));
    expect(schemaText).toContain(source.sourceEvidenceIndex.spans[0]!.evidenceId);
    expect(schemaText).toContain("primary-enclosure");
    expect(schemaText).toContain("explicit-single-space");
    expect(schemaText).not.toContain("fitCritical");
    for (const forbidden of [
      "capabilityIds",
      "requirementIds",
      "omissionConsequence",
      "reviewRecoverable",
      "deferredByEvidenceIds",
      "uncertainty"
    ]) {
      expect(schemaText).not.toContain(`"${forbidden}"`);
    }

    candidate.items[0]!.evidenceBindings[0]!.evidenceId = "invented-evidence";
    const authorization = authorizeSemanticInterpretation({
      interpretation: candidate,
      sourceEvidenceIndex: source.sourceEvidenceIndex
    });
    expect(authorization).toMatchObject({
      success: false,
      schemaIssues: [expect.stringContaining("Invalid")]
    });
  });

  it("keeps the exact SDK provider schema and local candidate parser isomorphic", async () => {
    const source = await buildSourceEvidenceIndex({
      brief: "Make a rigid open container.",
      references: [],
      roleConstraints: []
    });
    const parser = semanticInterpretationCandidateSchema(source.sourceEvidenceIndex);
    const sdkFormat = zodTextFormat(parser, "sketchycut_semantic_interpretation");
    const providerSchema = semanticInterpretationProviderSchema(source.sourceEvidenceIndex);
    expect(sdkFormat.schema).toEqual(providerSchema);
    expect(() => assertSemanticStrictOutputSchema(providerSchema)).not.toThrow();
    expect(JSON.stringify(providerSchema)).not.toContain('"oneOf"');
    expect(JSON.stringify(providerSchema)).not.toContain('"allOf"');

    const candidate = basicSemanticCandidate({ sourceEvidenceIndex: source.sourceEvidenceIndex });
    expect(parser.parse(candidate)).toEqual(candidate);
    const mutations: unknown[] = [
      { ...candidate, extra: true },
      { ...candidate, schemaVersion: "2.0" },
      { ...candidate, items: [] },
      {
        ...candidate,
        items: [{ ...candidate.items[0], evidenceBindings: [{
          evidenceId: "invented-evidence",
          aspect: "structure",
          support: "direct"
        }] }]
      }
    ];
    for (const mutation of mutations) {
      expect(parser.safeParse(mutation).success).toBe(false);
    }
  });

  it("keeps every registered unsupported construction signature identical across provider parsing, local parsing, and normalization", async () => {
    const source = await buildSourceEvidenceIndex({
      brief: "The primary enclosure corners specifically require kerf-flexure construction.",
      references: [],
      roleConstraints: []
    });
    const evidenceId = source.sourceEvidenceIndex.spans[0]!.evidenceId;
    const parser = semanticInterpretationCandidateSchema(
      source.sourceEvidenceIndex,
    );
    expect(JSON.stringify(semanticInterpretationProviderSchema(
      source.sourceEvidenceIndex,
    ))).toContain("kerf-flexure-corner-construction");
    for (const state of ["unbound", "uncertain"] as const) {
      const candidate = {
        schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
        atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
        items: [{
          claim: "The primary enclosure corners require kerf-flexure construction.",
          importance: "essential" as const,
          evidenceBindings: [{
            evidenceId,
            aspect: "structure" as const,
            support: "direct" as const
          }],
          relationships: [],
          measurements: [],
          state,
          reason: "CAPABILITY_NOT_REGISTERED" as const,
          ...(state === "uncertain"
            ? { rationale: "The exact construction remains semantically uncertain." }
            : {}),
          unsupportedSignatureIds: [
            "kerf-flexure-corner-construction" as const
          ]
        }]
      };
      expect(parser.parse(candidate)).toEqual(candidate);
      const authorization = authorizeSemanticInterpretation({
        interpretation: candidate,
        sourceEvidenceIndex: source.sourceEvidenceIndex
      });
      expect(authorization.success).toBe(true);
      if (!authorization.success) {
        throw new Error("expected authorized unsupported signature");
      }
      expect(authorization.interpretation.projection.accounting).toEqual([
        expect.objectContaining({
          itemId: "inventory-item-1",
          state,
          reason: "CAPABILITY_NOT_REGISTERED",
          unsupportedSignatureIds: [
            "kerf-flexure-corner-construction"
          ]
        })
      ]);
    }
    const valid = {
      schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
      atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
      items: [{
        claim: "The corners require kerf-flexure construction.",
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
        unsupportedSignatureIds: [
          "kerf-flexure-corner-construction"
        ]
      }]
    };
    expect(parser.safeParse({
      ...valid,
      items: [{ ...valid.items[0], importance: "preference" }]
    }).success).toBe(false);
    expect(parser.safeParse({
      ...valid,
      items: [{
        ...valid.items[0],
        evidenceBindings: [{
          evidenceId,
          aspect: "surface",
          support: "direct"
        }]
      }]
    }).success).toBe(false);
    expect(parser.safeParse({
      ...valid,
      items: [{ ...valid.items[0], reason: "EVIDENCE_INSUFFICIENT" }]
    }).success).toBe(false);
  });

  it("keeps provider-bound parsing identical for every primary-enclosure space layout variant", async () => {
    const source = await buildSourceEvidenceIndex({
      brief: "Make a rigid organizer with evidence-grounded separation.",
      references: [],
      roleConstraints: []
    });
    const parser = semanticInterpretationCandidateSchema(source.sourceEvidenceIndex);
    expect(zodTextFormat(parser, "sketchycut_semantic_interpretation").schema)
      .toEqual(semanticInterpretationProviderSchema(source.sourceEvidenceIndex));
    const spaces = [
      { layout: "unspecified" as const },
      { layout: "explicit-single-space" as const },
      { layout: "minimum-separated" as const },
      { layout: "count" as const, desiredSpaceCount: 4 },
      { layout: "grid" as const, rows: 2, columns: 3 }
    ];
    for (const space of spaces) {
      const candidate = basicSemanticCandidate({
        sourceEvidenceIndex: source.sourceEvidenceIndex
      });
      const evidenceId = source.sourceEvidenceIndex.spans[0]!.evidenceId;
      if (candidate.items[0]?.state !== "bound") {
        throw new Error("expected bound semantic candidate");
      }
      candidate.items[0].atoms = [{
        kind: "primary-enclosure",
        enclosure: { quantity: null, priority: "must", evidenceIds: [evidenceId] },
        access: { kind: "unspecified", priority: "must", evidenceIds: [evidenceId] },
        space: { ...space, priority: "must", evidenceIds: [evidenceId] }
      } as unknown as (
        Extract<SemanticInterpretationCandidate["items"][number], { state: "bound" }>["atoms"][number]
      )];
      expect(parser.parse(candidate)).toEqual(candidate);
    }
  });

  it("rejects invalid grids identically in the provider-bound and local parsers", async () => {
    const source = await buildSourceEvidenceIndex({
      brief: "Make a rigid organizer with an explicit grid.",
      references: [],
      roleConstraints: []
    });
    const parser = semanticInterpretationCandidateSchema(source.sourceEvidenceIndex);
    const evidenceId = source.sourceEvidenceIndex.spans[0]!.evidenceId;
    const candidate = basicSemanticCandidate({
      sourceEvidenceIndex: source.sourceEvidenceIndex
    });
    if (candidate.items[0]?.state !== "bound") {
      throw new Error("expected bound semantic candidate");
    }
    const primary = {
      kind: "primary-enclosure" as const,
      enclosure: { quantity: null, priority: "must" as const, evidenceIds: [evidenceId] },
      access: {
        kind: "open-top" as const,
        priority: "must" as const,
        evidenceIds: [evidenceId]
      }
    };
    for (const space of [
      {
        layout: "grid",
        rows: 1,
        columns: 1,
        priority: "must",
        evidenceIds: [evidenceId]
      },
      {
        layout: "grid",
        rows: 7,
        columns: 2,
        priority: "must",
        evidenceIds: [evidenceId]
      },
      {
        layout: "grid",
        rows: 2,
        columns: 7,
        priority: "must",
        evidenceIds: [evidenceId]
      },
      {
        layout: "count",
        desiredSpaceCount: 13,
        priority: "must",
        evidenceIds: [evidenceId]
      }
    ] as const) {
      const mutation = structuredClone(candidate) as unknown as {
        items: { atoms: unknown[] }[];
      };
      mutation.items[0]!.atoms = [{ ...primary, space }];
      expect(parser.safeParse(mutation).success).toBe(false);
      const authorization = authorizeSemanticInterpretation({
        interpretation: mutation,
        sourceEvidenceIndex: source.sourceEvidenceIndex
      });
      expect(authorization.success).toBe(false);
      if (authorization.success) throw new Error("expected provider-bound rejection");
      expect(authorization.schemaIssues.length).toBeGreaterThan(0);
    }

    for (const space of [
      {
        layout: "grid",
        rows: 1,
        columns: 6,
        priority: "must",
        evidenceIds: [evidenceId]
      },
      {
        layout: "grid",
        rows: 6,
        columns: 6,
        priority: "must",
        evidenceIds: [evidenceId]
      }
    ] as const) {
      const valid = structuredClone(candidate) as unknown as {
        items: { atoms: unknown[] }[];
      };
      valid.items[0]!.atoms = [{ ...primary, space }];
      expect(parser.safeParse(valid).success).toBe(true);
      expect(authorizeSemanticInterpretation({
        interpretation: valid,
        sourceEvidenceIndex: source.sourceEvidenceIndex
      })).toMatchObject({ success: true });
    }

    for (const atom of [
      {
        kind: "organization",
        targetBodyRole: "support",
        layout: "grid",
        rows: 1,
        columns: 1,
        priority: "must"
      },
      {
        kind: "organization",
        targetBodyRole: "support",
        layout: "grid",
        rows: 7,
        columns: 2,
        priority: "must"
      }
    ] as const) {
      const mutation = structuredClone(candidate) as unknown as {
        items: { atoms: unknown[] }[];
      };
      mutation.items[0]!.atoms = [atom];
      expect(parser.safeParse(mutation).success).toBe(false);
    }

    const validSupportGrid = structuredClone(candidate) as unknown as {
      items: { atoms: unknown[] }[];
    };
    validSupportGrid.items[0]!.atoms = [{
      kind: "organization",
      targetBodyRole: "support",
      layout: "grid",
      rows: 6,
      columns: 6,
      priority: "must"
    }];
    expect(parser.safeParse(validSupportGrid).success).toBe(true);
  });

  it("normalizes context-only unresolved items to nonblocking context", async () => {
    const source = await buildSourceEvidenceIndex({
      brief: "Store keys in the entryway.",
      references: [],
      roleConstraints: []
    });
    const evidenceId = source.sourceEvidenceIndex.spans[0]!.evidenceId;
    const authorized = authorizeSemanticInterpretation({
      interpretation: {
        schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
        atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
        items: [{
          claim: "The intended destination is the entryway.",
          importance: "essential",
          evidenceBindings: [{ evidenceId, aspect: "context", support: "direct" }],
          relationships: [],
          measurements: [],
          state: "unbound",
          reason: "CAPABILITY_NOT_REGISTERED",
          unsupportedSignatureIds: []
        }]
      },
      sourceEvidenceIndex: source.sourceEvidenceIndex
    });
    expect(authorized.success).toBe(true);
    if (!authorized.success) throw new Error("expected authorized context-only interpretation");
    expect(authorized.interpretation.inventory.items).toEqual([
      expect.objectContaining({
        importance: "context",
        aspects: ["context"],
        omissionConsequence: null
      })
    ]);
    expect(authorized.interpretation.projection.accounting).toEqual([]);
    expect(authorized.interpretation.projection.requirements).toEqual([]);
  });

  it("keeps every normalized or accounting record out of the provider contract", () => {
    const schemaText = JSON.stringify(SEMANTIC_INTERPRETATION_JSON_SCHEMA);
    expect((SEMANTIC_INTERPRETATION_JSON_SCHEMA as { properties?: Record<string, unknown> }).properties)
      .not.toHaveProperty("projection");
    for (const forbidden of [
      "semanticIds",
      "capabilityIds",
      "requirementIds",
      "bodyIds",
      "interfaceIds",
      "accounting",
      "inventoryItemId",
      "objectId",
      "relationshipId",
      "title",
      "aspects",
      "omissionConsequence",
      "reviewRecoverable"
    ]) {
      expect(schemaText).not.toContain(`"${forbidden}"`);
    }
  });
});
