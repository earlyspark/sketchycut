import { describe, expect, it } from "vitest";

import {
  authorizeIntentGraphV2Evidence,
  INTENT_GRAPH_V2_JSON_SCHEMA,
  IntentGraphV2Schema,
  intentGraphV2ProviderSchema,
  reconcileDeterministicReferenceConflicts
} from "../../src/interpretation/intent-graph-v2.js";
import { buildSourceEvidenceIndex } from "../../src/interpretation/source-evidence.js";

async function fixture() {
  const source = await buildSourceEvidenceIndex({
    brief: "Make a long open-top organizer for six pencils.",
    references: [],
    roleConstraints: []
  });
  const evidenceId = source.sourceEvidenceIndex.spans[0]!.evidenceId;
  const intent = {
    schemaVersion: "2.4",
    title: "Long pencil organizer",
    purpose: "Contain and expose pencils from the top.",
    requirements: [
      { id: "contain-pencils", priority: "must", kind: "containment", semanticSummary: "Contain pencils.", evidenceIds: [evidenceId] },
      { id: "top-access", priority: "must", kind: "access", semanticSummary: "Remain open at the top.", evidenceIds: [evidenceId] }
    ],
    constructionBodies: [{
      id: "primary-body",
      role: "primary-enclosure",
      shapeClass: "orthogonal-shell",
      requirementIds: ["contain-pencils", "top-access"],
      evidenceIds: [evidenceId]
    }],
    objects: [{
      id: "pencils",
      role: "contained",
      engagement: "full-envelope",
      semanticLabel: "standard pencils",
      quantity: 6,
      fitCritical: false,
      evidenceIds: [evidenceId]
    }],
    interfaces: [],
    access: [{
      bodyId: "primary-body",
      kind: "open-top",
      direction: "top",
      priority: "must",
      requirementId: "top-access",
      evidenceIds: [evidenceId]
    }],
    organization: [],
    scaleEvidence: [{
      id: "pencil-scale",
      objectId: "pencils",
      long: { minimumUm: 170_000, maximumUm: 200_000 },
      short: { minimumUm: 6_000, maximumUm: 10_000 },
      height: { minimumUm: 6_000, maximumUm: 10_000 },
      confidence: "medium",
      basis: "model-prior",
      evidenceIds: [evidenceId]
    }],
    proportions: [{
      id: "long-shape",
      targetBodyId: "primary-body",
      numeratorAxis: "width",
      denominatorAxis: "depth",
      strength: "strong",
      priority: "prefer",
      confidence: "high",
      evidenceIds: [evidenceId]
    }],
    clearance: [{ objectId: "pencils", kind: "ordinary-access", priority: "prefer", evidenceIds: [evidenceId] }],
    rankedGoals: [{ id: "compact-goal", kind: "compactness", rank: 1, evidenceIds: [evidenceId] }],
    motif: null,
    cutThrough: [],
    referenceBrief: [],
    assumptions: [],
    conflicts: [],
    unresolvedNeeds: []
  };
  return { source, intent, evidenceId };
}

describe("IntentGraphV2", () => {
  it("accepts compact evidence-grounded semantic intent and authorizes only server IDs", async () => {
    const { source, intent } = await fixture();
    expect(IntentGraphV2Schema.parse(intent)).toEqual(intent);
    expect(authorizeIntentGraphV2Evidence({
      intent,
      sourceEvidenceIndex: source.sourceEvidenceIndex
    })).toMatchObject({ success: true });
    const unknown = structuredClone(intent);
    unknown.requirements[0]!.evidenceIds = ["model-invented-evidence"];
    expect(authorizeIntentGraphV2Evidence({
      intent: unknown,
      sourceEvidenceIndex: source.sourceEvidenceIndex
    })).toEqual({ success: false, unknownEvidenceIds: ["model-invented-evidence"], schemaIssues: [] });
  });

  it("rejects project dimensions, construction counts, and model-authored capability verdicts", async () => {
    const { intent } = await fixture();
    for (const forbidden of [
      { projectDimensionsMm: { width: 200, depth: 80, height: 50 } },
      { dividerCount: 3 },
      { capabilityAssessment: { coreIntentRepresentable: true } }
    ]) {
      expect(IntentGraphV2Schema.safeParse({ ...intent, ...forbidden }).success).toBe(false);
    }
  });

  it("represents thermal operation only as a capability commitment, not a noun classifier", async () => {
    const { intent, evidenceId } = await fixture();
    expect(JSON.stringify(INTENT_GRAPH_V2_JSON_SCHEMA)).not.toContain("thermalSource");
    expect(IntentGraphV2Schema.safeParse({
      ...intent,
      thermalSource: { source: "open-flame", evidenceIds: [evidenceId] }
    }).success).toBe(false);
    expect(IntentGraphV2Schema.safeParse({
      ...intent,
      requirements: [...intent.requirements, {
        id: "required-thermal-operation",
        priority: "must",
        kind: "thermal-source",
        semanticSummary: "The construction must operate with a continuing heat source.",
        evidenceIds: [evidenceId]
      }],
      constructionBodies: intent.constructionBodies.map((body) => ({
        ...body,
        requirementIds: [...body.requirementIds, "required-thermal-operation"]
      }))
    }).success).toBe(true);
  });

  it("rejects invalid or fake-precision scale ranges", async () => {
    const { intent } = await fixture();
    const nonQuantized = structuredClone(intent);
    nonQuantized.scaleEvidence[0]!.long.minimumUm = 170_001;
    expect(IntentGraphV2Schema.safeParse(nonQuantized).success).toBe(false);
    const inverted = structuredClone(intent);
    inverted.scaleEvidence[0]!.long = { minimumUm: 210_000, maximumUm: 200_000 };
    expect(IntentGraphV2Schema.safeParse(inverted).success).toBe(false);
  });

  it("requires role-consistent engagement and qualitative proportion strength", async () => {
    const { intent } = await fixture();
    const wrongEngagement = structuredClone(intent);
    wrongEngagement.objects[0]!.engagement = "partial-support";
    expect(IntentGraphV2Schema.safeParse(wrongEngagement).success).toBe(false);

    const numericRatio = structuredClone(intent) as typeof intent & {
      proportions: ((typeof intent.proportions)[number] & { ratioPermille?: number })[];
    };
    numericRatio.proportions[0]!.ratioPermille = 2_500;
    expect(IntentGraphV2Schema.safeParse(numericRatio).success).toBe(false);

    const supported = structuredClone(intent);
    supported.objects[0]!.role = "supported";
    supported.objects[0]!.engagement = "partial-support";
    expect(IntentGraphV2Schema.safeParse(supported).success).toBe(true);

    const emptyOrganization = {
      ...structuredClone(intent),
      organization: [{
        bodyId: intent.constructionBodies[0]!.id,
        desiredSpaceCount: null,
        rows: null,
        columns: null,
        priority: "prefer",
        requirementId: intent.requirements[0]!.id,
        evidenceIds: ["brief-evidence"]
      }]
    };
    expect(IntentGraphV2Schema.safeParse(emptyOrganization).success).toBe(false);
  });

  it("deterministically records contradictory non-context access observations", async () => {
    const { intent, evidenceId } = await fixture();
    const candidate = {
      ...intent,
      referenceBrief: [
        {
          referenceEvidenceId: "reference-open",
          relationship: "reproduce",
          observations: [{
            id: "observed-open-top",
            kind: "opening",
            value: "open-top",
            targetBodyRole: "primary-enclosure",
            targetFaceRole: "all",
            salience: "dominant",
            confidence: "high",
            visibility: "visible",
            evidenceIds: ["reference-open"]
          }]
        },
        {
          referenceEvidenceId: "reference-covered",
          relationship: "reproduce",
          observations: [{
            id: "observed-covered",
            kind: "opening",
            value: "covered",
            targetBodyRole: "primary-enclosure",
            targetFaceRole: "cover",
            salience: "dominant",
            confidence: "high",
            visibility: "visible",
            evidenceIds: ["reference-covered"]
          }]
        }
      ]
    };
    const unresolved = reconcileDeterministicReferenceConflicts({
      intent: candidate,
      semanticBrief: "Make a container from these references.",
      briefEvidenceId: evidenceId
    });
    expect(unresolved.conflicts).toEqual([{
      id: "reference-access-conflict-1",
      attribute: "access",
      textEvidenceIds: [evidenceId],
      observationIds: ["observed-covered", "observed-open-top"],
      resolution: "unresolved"
    }]);
    expect(reconcileDeterministicReferenceConflicts({
      intent: unresolved,
      semanticBrief: "Make a container from these references.",
      briefEvidenceId: evidenceId
    })).toEqual(unresolved);

    const explicit = reconcileDeterministicReferenceConflicts({
      intent: candidate,
      semanticBrief: "Make an open-top container from these references.",
      briefEvidenceId: evidenceId
    });
    expect(explicit.conflicts[0]?.resolution).toBe("explicit-text-wins");

    const contextOnly = structuredClone(candidate);
    contextOnly.referenceBrief[1]!.relationship = "context";
    expect(reconcileDeterministicReferenceConflicts({
      intent: contextOnly,
      semanticBrief: "Make a container from these references.",
      briefEvidenceId: evidenceId
    }).conflicts).toEqual([]);

    const unknownTargets = {
      ...candidate,
      referenceBrief: candidate.referenceBrief.map((entry) => ({
        ...entry,
        observations: entry.observations.map((observation) => ({
          ...observation,
          targetBodyRole: null
        }))
      }))
    };
    expect(reconcileDeterministicReferenceConflicts({
      intent: unknownTargets,
      semanticBrief: "Make a container from these references.",
      briefEvidenceId: evidenceId
    }).conflicts).toEqual([]);
  });

  it("adds an evidence-authorized access conflict on the complete authorization path", async () => {
    const { intent } = await fixture();
    const source = await buildSourceEvidenceIndex({
      brief: "Make a container from these references.",
      references: [
        {
          referenceId: "open-reference",
          sha256: "1".repeat(64),
          mediaType: "image/png",
          width: 640,
          height: 480
        },
        {
          referenceId: "covered-reference",
          sha256: "2".repeat(64),
          mediaType: "image/png",
          width: 640,
          height: 480
        }
      ],
      roleConstraints: []
    });
    const briefEvidenceId = source.sourceEvidenceIndex.spans[0]!.evidenceId;
    const [openReferenceId, coveredReferenceId] = source.sourceEvidenceIndex.references.map((item) => item.evidenceId);
    const candidate = {
      ...intent,
      requirements: intent.requirements.map((requirement) => ({ ...requirement, evidenceIds: [briefEvidenceId] })),
      constructionBodies: intent.constructionBodies.map((body) => ({ ...body, evidenceIds: [briefEvidenceId] })),
      objects: intent.objects.map((object) => ({ ...object, evidenceIds: [briefEvidenceId] })),
      access: intent.access.map((access) => ({ ...access, evidenceIds: [briefEvidenceId] })),
      scaleEvidence: intent.scaleEvidence.map((scale) => ({ ...scale, evidenceIds: [briefEvidenceId] })),
      proportions: intent.proportions.map((proportion) => ({ ...proportion, evidenceIds: [briefEvidenceId] })),
      clearance: intent.clearance.map((clearance) => ({ ...clearance, evidenceIds: [briefEvidenceId] })),
      rankedGoals: intent.rankedGoals.map((goal) => ({ ...goal, evidenceIds: [briefEvidenceId] })),
      referenceBrief: [
        {
          referenceEvidenceId: openReferenceId!,
          relationship: "reproduce",
          observations: [{
            id: "authorized-open-top",
            kind: "opening",
            value: "open-top",
            targetBodyRole: "primary-enclosure",
            targetFaceRole: "all",
            salience: "dominant",
            confidence: "high",
            visibility: "visible",
            evidenceIds: [openReferenceId!]
          }]
        },
        {
          referenceEvidenceId: coveredReferenceId!,
          relationship: "reproduce",
          observations: [{
            id: "authorized-covered",
            kind: "opening",
            value: "covered",
            targetBodyRole: "primary-enclosure",
            targetFaceRole: "cover",
            salience: "dominant",
            confidence: "high",
            visibility: "visible",
            evidenceIds: [coveredReferenceId!]
          }]
        }
      ]
    };
    const authorized = authorizeIntentGraphV2Evidence({
      intent: candidate,
      sourceEvidenceIndex: source.sourceEvidenceIndex,
      semanticBrief: source.semanticBrief
    });
    expect(authorized).toMatchObject({
      success: true,
      intent: {
        conflicts: [{
          attribute: "access",
          textEvidenceIds: [briefEvidenceId],
          observationIds: ["authorized-covered", "authorized-open-top"],
          resolution: "unresolved"
        }]
      }
    });
  });

  it("emits a strict provider schema", () => {
    expect(INTENT_GRAPH_V2_JSON_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false
    });
  });

  it("binds provider evidence references to exact server-authored IDs without mutating the base schema", async () => {
    const source = await buildSourceEvidenceIndex({
      brief: "Make a pencil holder. Keep it open at the top.",
      references: [{
        referenceId: "reference-one",
        sha256: "a".repeat(64),
        mediaType: "image/jpeg",
        width: 500,
        height: 500
      }],
      roleConstraints: []
    });
    const authorizedIds = [
      ...source.sourceEvidenceIndex.spans.map((item) => item.evidenceId),
      ...source.sourceEvidenceIndex.references.map((item) => item.evidenceId)
    ];
    const referenceId = source.sourceEvidenceIndex.references[0]!.evidenceId;
    const schema = intentGraphV2ProviderSchema(source.sourceEvidenceIndex) as {
      $defs: Record<string, unknown>;
      properties: Record<string, unknown>;
    };
    expect(schema.$defs).toEqual({
      authorizedEvidenceId: { type: "string", enum: authorizedIds },
      referenceEvidenceId: { type: "string", enum: [referenceId] }
    });
    expect(schema.properties.referenceBrief).toMatchObject({ minItems: 1, maxItems: 1 });

    const serialized = JSON.stringify(schema);
    expect(serialized).toContain('"$ref":"#/$defs/authorizedEvidenceId"');
    expect(serialized).toContain('"$ref":"#/$defs/referenceEvidenceId"');
    expect(serialized).not.toContain(`${authorizedIds[0]!}-capacity`);
    expect(serialized).not.toContain(`${referenceId}-open-top`);
    expect(JSON.stringify(INTENT_GRAPH_V2_JSON_SCHEMA)).not.toContain('"$defs"');

    const textOnly = await buildSourceEvidenceIndex({
      brief: "Make an open-top pencil holder.",
      references: [],
      roleConstraints: []
    });
    const textOnlySchema = intentGraphV2ProviderSchema(textOnly.sourceEvidenceIndex);
    expect(textOnlySchema).toMatchObject({
      properties: { referenceBrief: { minItems: 0, maxItems: 0 } },
      $defs: {
        authorizedEvidenceId: {
          type: "string",
          enum: textOnly.sourceEvidenceIndex.spans.map((item) => item.evidenceId)
        }
      }
    });
    expect(JSON.stringify(textOnlySchema)).not.toContain(referenceId);
  });
});
