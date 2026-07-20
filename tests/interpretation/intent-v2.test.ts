import { describe, expect, it } from "vitest";

import {
  authorizeIntentGraphV2Evidence,
  INTENT_GRAPH_V2_JSON_SCHEMA,
  IntentGraphV2Schema
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
    schemaVersion: "2.1",
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

  it("emits a strict provider schema", () => {
    expect(INTENT_GRAPH_V2_JSON_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false
    });
  });
});
