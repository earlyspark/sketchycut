import { describe, expect, it } from "vitest";

import {
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/domain/fabrication-setup.js";
import { hashCanonical } from "../../src/domain/hash.js";
import { planIntentConditionedConstruction } from "../../src/interpretation/construction-planner.js";
import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import { generationOutcomeV2FromPlanner } from "../../src/interpretation/generation-outcome-v2.js";
import { reconcileIntentAtInterpretationBoundary } from "../../src/interpretation/intent-boundary-reconciliation.js";
import { IntentGraphV2Schema, type IntentGraphV2 } from "../../src/interpretation/intent-graph-v2.js";
import { buildSourceEvidenceIndex, type SourceEvidenceIndexV1 } from "../../src/interpretation/source-evidence.js";
import { synthesizeSymbolicTopologies } from "../../src/interpretation/topology-synthesis.js";

const reference = {
  referenceId: "tea-light-reference",
  sha256: "a".repeat(64),
  mediaType: "image/webp" as const,
  width: 570,
  height: 426
};

async function source(
  brief = "Make a tea light holder like the one pictured.",
  roles: readonly ("structure" | "motif")[] = ["structure"],
) {
  return buildSourceEvidenceIndex({
    brief,
    references: [reference],
    roleConstraints: roles.length === 0 ? [] : [{ referenceId: reference.referenceId, roles }]
  });
}

function reportedIntent(
  index: SourceEvidenceIndexV1,
  options: { requiredThermalOperation?: boolean } = {},
): IntentGraphV2 {
  const briefEvidenceId = index.spans[0]!.evidenceId;
  const referenceEvidenceId = index.references[0]!.evidenceId;
  const requirements: IntentGraphV2["requirements"] = [
    { id: "containment-required", priority: "must", kind: "containment", semanticSummary: "Contain the tea-light form factor.", evidenceIds: [briefEvidenceId] },
    { id: "access-required", priority: "must", kind: "access", semanticSummary: "Provide top access.", evidenceIds: [briefEvidenceId] },
    { id: "top-aperture-required", priority: "must", kind: "functional-aperture", semanticSummary: "Provide a geometric top aperture.", evidenceIds: [referenceEvidenceId] },
    { id: "wall-treatment-required", priority: "must", kind: "cut-through-treatment", semanticSummary: "Repeat visible cut-through wall treatment.", evidenceIds: [referenceEvidenceId] },
    ...(options.requiredThermalOperation === true ? [{
      id: "thermal-operation-required",
      priority: "must" as const,
      kind: "thermal-source" as const,
      semanticSummary: "The plywood construction must operate around continuing combustion.",
      evidenceIds: [briefEvidenceId]
    }] : [])
  ];
  const observation = (
    id: string,
    kind: IntentGraphV2["referenceBrief"][number]["observations"][number]["kind"],
    value: string,
    face: "all" | "cover" | "unspecified" = "all",
  ) => ({
    id,
    kind,
    value,
    targetBodyRole: "primary-enclosure" as const,
    targetFaceRole: face,
    salience: "defining" as const,
    confidence: "high" as const,
    visibility: "visible" as const,
    evidenceIds: [referenceEvidenceId]
  });
  return IntentGraphV2Schema.parse({
    schemaVersion: "2.4",
    title: "Pictured tea-light holder",
    purpose: "Build a compact holder based on the supplied structural reference.",
    requirements,
    constructionBodies: [{
      id: "primary-body",
      role: "primary-enclosure",
      shapeClass: "orthogonal-shell",
      requirementIds: requirements.map((item) => item.id),
      evidenceIds: [briefEvidenceId, referenceEvidenceId]
    }],
    objects: [{
      id: "contained-size-cue",
      role: "contained",
      engagement: "full-envelope",
      semanticLabel: "small referenced insert",
      quantity: 1,
      fitCritical: false,
      evidenceIds: [briefEvidenceId]
    }],
    interfaces: [],
    access: [{
      bodyId: "primary-body",
      kind: "covered",
      direction: "top",
      priority: "must",
      requirementId: "access-required",
      evidenceIds: [briefEvidenceId]
    }],
    organization: [],
    scaleEvidence: [{
      id: "contained-size-cue-scale",
      objectId: "contained-size-cue",
      long: { minimumUm: 35_000, maximumUm: 45_000 },
      short: { minimumUm: 35_000, maximumUm: 45_000 },
      height: { minimumUm: 15_000, maximumUm: 25_000 },
      confidence: "medium",
      basis: "model-prior",
      evidenceIds: [briefEvidenceId]
    }],
    proportions: [],
    clearance: [],
    rankedGoals: [{ id: "compactness-goal", kind: "compactness", rank: 1, evidenceIds: [briefEvidenceId] }],
    motif: null,
    cutThrough: [
      {
        id: "top-access-aperture",
        bodyId: "primary-body",
        targetFaceRoles: ["cover"],
        patternFamily: "ring-aperture",
        purpose: "access",
        density: "sparse",
        symmetry: "radial",
        repetition: "single-face",
        fixedTopAccess: false,
        priority: "must",
        requirementId: "top-aperture-required",
        evidenceIds: [referenceEvidenceId]
      },
      {
        id: "pictured-wall-treatment",
        bodyId: "primary-body",
        targetFaceRoles: ["rear", "left", "right", "front"],
        patternFamily: "radial-rosette",
        purpose: "illumination-ornament",
        density: "dense",
        symmetry: "radial",
        repetition: "matched-faces",
        fixedTopAccess: false,
        priority: "must",
        requirementId: "wall-treatment-required",
        evidenceIds: [referenceEvidenceId]
      }
    ],
    referenceBrief: [{
      referenceEvidenceId,
      relationship: "reproduce",
      observations: [
        observation("pictured-primary-subject", "primary-subject", "lantern", "unspecified"),
        observation("pictured-silhouette", "silhouette", "orthogonal", "unspecified"),
        observation("pictured-proportion", "proportion", "tall", "unspecified"),
        observation("pictured-top-opening", "opening", "geometric-aperture", "cover"),
        observation("pictured-repeated-openings", "opening", "repeated-apertures"),
        observation("pictured-cut-through", "operation-character", "cut-through-visible"),
        observation("pictured-visible-joint", "visible-joint", "finger")
      ]
    }],
    assumptions: [],
    conflicts: [],
    unresolvedNeeds: []
  });
}

async function plan(intent: IntentGraphV2) {
  const setup = resolveFabricationSetup(createPublicFabricationSetup());
  const explicitConstraints = await reconcileExplicitSizingConstraints({
    advancedSizing: { basis: "auto" },
    parsedConstraints: [],
    parserFindings: []
  });
  const planning = await planIntentConditionedConstruction({
    intent,
    explicitConstraints,
    profiles: {
      material: setup.material,
      machine: setup.machine,
      processRecipe: setup.processRecipe,
      fabricationContext: setup.fabricationContext,
      fit: setup.fit
    },
    inputPolicyEvaluation: setup.inputPolicyEvaluation,
    pin: createStarterPinSetup()
  });
  return { planning, explicitConstraints };
}

describe("interpretation-boundary reconciliation", () => {
  it("keeps an object as scale evidence, removes out-of-role decoration, and makes the structure-only request plannable", async () => {
    const prepared = await source();
    const raw = reportedIntent(prepared.sourceEvidenceIndex);
    const rawTopology = await synthesizeSymbolicTopologies(raw);
    expect(rawTopology.kind).toBe("candidates");

    const reconciled = reconcileIntentAtInterpretationBoundary({
      intent: raw,
      sourceEvidenceIndex: prepared.sourceEvidenceIndex
    });
    expect(reconciled.objects).toEqual(raw.objects);
    expect(reconciled.scaleEvidence).toEqual(raw.scaleEvidence);
    expect(reconciled.requirements.some((item) => item.kind === "thermal-source")).toBe(false);
    expect(reconciled.requirements.map((item) => item.id)).not.toContain("wall-treatment-required");
    expect(reconciled.cutThrough.map((item) => item.id)).toEqual(["top-access-aperture"]);
    expect(reconciled.cutThrough[0]?.fixedTopAccess).toBe(true);
    expect(reconciled.referenceBrief[0]?.observations.map((item) => `${item.kind}:${item.value}`)).toEqual([
      "primary-subject:lantern",
      "silhouette:orthogonal",
      "proportion:tall",
      "opening:geometric-aperture",
      "visible-joint:finger"
    ]);
    expect(reconcileIntentAtInterpretationBoundary({
      intent: reconciled,
      sourceEvidenceIndex: prepared.sourceEvidenceIndex
    })).toEqual(reconciled);

    const { planning, explicitConstraints } = await plan(reconciled);
    expect(planning.kind, JSON.stringify(planning)).toBe("planned");
    if (planning.kind !== "planned") throw new Error("reconciled tea-light holder did not plan");
    expect(planning.selected.plan?.topology.mechanism).toBe("fixed-top-frame");
    expect(planning.selected.compiled?.compiled.document.applicationLimitations ?? []).toEqual([]);
    expect(planning.selected.compiled?.observationRealization.blockingObservationIds).toEqual([]);
    expect(planning.selected.compiled?.observationRealization.records.find((record) =>
      record.observationId === "pictured-proportion"
    )).toMatchObject({ coverage: "must", state: "simplified" });
    const digest = await hashCanonical({ proof: "commitment-context-boundary" });
    const outcome = await generationOutcomeV2FromPlanner({
      requestId: "commitment-context-boundary",
      transportMode: "fixture",
      semanticRequestDigest: digest,
      sourceEvidenceIndexDigest: prepared.sourceEvidenceIndex.digest,
      promptIdentity: "semantic-interpretation-current",
      promptHash: digest,
      modelId: "fixture-model",
      cacheResult: "miss",
      attemptId: null,
      providerRequestId: null,
      intent: reconciled,
      explicitSizing: explicitConstraints,
      planning
    });
    expect(outcome).toMatchObject({
      kind: "simplified",
      fabricationCandidate: true,
      exportAllowed: true,
      changedSemanticIds: ["pictured-proportion"]
    });
  });

  it.each([
    { label: "automatic roles", roles: [] as const },
    { label: "motif only", roles: ["motif"] as const },
    { label: "both roles", roles: ["structure", "motif"] as const }
  ])("does not apply structure-only filtering to $label", async ({ roles }) => {
    const prepared = await source("Make a tea light holder like the one pictured.", roles);
    const raw = reportedIntent(prepared.sourceEvidenceIndex);
    raw.cutThrough[0] = { ...raw.cutThrough[0]!, fixedTopAccess: true };
    const reconciled = reconcileIntentAtInterpretationBoundary({
      intent: raw,
      sourceEvidenceIndex: prepared.sourceEvidenceIndex
    });
    expect(reconciled).toEqual(raw);
  });

  it("blocks a required thermal operating condition by capability commitment, independent of prompt wording", async () => {
    const prepared = await source("Build the enclosure for the required operating state shown in the reference.");
    const reconciled = reconcileIntentAtInterpretationBoundary({
      intent: reportedIntent(prepared.sourceEvidenceIndex, { requiredThermalOperation: true }),
      sourceEvidenceIndex: prepared.sourceEvidenceIndex
    });
    expect(reconciled.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "thermal-operation-required", kind: "thermal-source" })
    ]));
    await expect(synthesizeSymbolicTopologies(reconciled)).resolves.toMatchObject({
      kind: "concept-only",
      findings: [expect.objectContaining({ code: "THERMAL_FIRE_INTENT_UNSUPPORTED" })]
    });
  });

  it.each([
    "Make a tea light holder like the one pictured.",
    "Make a vessel around the pictured insert.",
    "Use the reference object only to establish approximate scale."
  ])("does not infer capabilities from lexical content: %s", async (brief) => {
    const prepared = await source(brief);
    const reconciled = reconcileIntentAtInterpretationBoundary({
      intent: reportedIntent(prepared.sourceEvidenceIndex),
      sourceEvidenceIndex: prepared.sourceEvidenceIndex
    });
    expect(reconciled.requirements.some((item) => item.kind === "thermal-source")).toBe(false);
    await expect(synthesizeSymbolicTopologies(reconciled)).resolves.toMatchObject({ kind: "candidates" });
  });
});
