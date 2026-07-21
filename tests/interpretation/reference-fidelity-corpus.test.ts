import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/domain/fabrication-setup.js";
import { hashCanonical, sha256 } from "../../src/domain/hash.js";
import { planIntentConditionedConstruction } from "../../src/interpretation/construction-planner.js";
import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import { generationOutcomeV2FromPlanner } from "../../src/interpretation/generation-outcome-v2.js";
import {
  authorizeIntentGraphV2Evidence,
  IntentGraphV2Schema,
  type IntentGraphV2
} from "../../src/interpretation/intent-graph-v2.js";
import { buildSourceEvidenceIndex } from "../../src/interpretation/source-evidence.js";
import {
  evaluateReferenceFidelityPredicates,
  scoreReferenceFidelityCase
} from "../../src/evaluation/reference-fidelity-predicates.js";
import {
  ReferenceFidelityManifestSchema,
  type ReferenceFidelityCaseContract,
  type ReferenceFidelityManifest
} from "../../src/evaluation/reference-fidelity-study.js";

type Case = ReferenceFidelityCaseContract;
type Reference = ReferenceFidelityManifest["references"][number];

async function manifest(): Promise<ReferenceFidelityManifest> {
  const bytes = await readFile(new URL("../fixtures/reference-fidelity/manifest.json", import.meta.url), "utf8");
  return ReferenceFidelityManifestSchema.parse(JSON.parse(bytes) as unknown);
}

function observationTemplates(referenceId: string) {
  if (referenceId === "ornate-lantern") return [
    ["primary-subject", "lantern", "secondary"],
    ["silhouette", "orthogonal", "defining"],
    ["opening", "arched-aperture", "dominant"],
    ["ornament", "lattice", "dominant"],
    ["operation-character", "cut-through-visible", "dominant"]
  ] as const;
  if (referenceId === "open-tray") return [
    ["primary-subject", "container", "defining"],
    ["silhouette", "orthogonal", "defining"],
    ["opening", "open-top", "defining"]
  ] as const;
  if (referenceId === "covered-box") return [
    ["primary-subject", "container", "defining"],
    ["silhouette", "orthogonal", "defining"],
    ["opening", "covered", "defining"]
  ] as const;
  if (referenceId === "border-pattern-box") return [
    ["primary-subject", "container", "secondary"],
    ["ornament", "border", "defining"],
    ["operation-character", "score", "defining"]
  ] as const;
  if (referenceId === "subject-with-props-and-text") return [
    ["primary-subject", "container", "defining"],
    ["silhouette", "orthogonal", "defining"]
  ] as const;
  return [
    ["primary-subject", "container", "defining"],
    ["opening", "covered", "defining"],
    ["visible-joint", "slide-guide", "defining"]
  ] as const;
}

function accessFor(candidate: Case): "open-top" | "covered" {
  if (candidate.id === "explicit-text-access-conflict" || candidate.id === "multi-reference-unresolved-conflict") {
    return "open-top";
  }
  return candidate.referenceIds.some((id) => id === "covered-box" || id === "sliding-cover")
    ? "covered"
    : "open-top";
}

function intentFor(input: {
  candidate: Case;
  sourceEvidence: Awaited<ReturnType<typeof buildSourceEvidenceIndex>>["sourceEvidenceIndex"];
}): IntentGraphV2 {
  const briefEvidence = input.sourceEvidence.spans[0]!.evidenceId;
  const referenceEvidence = input.sourceEvidence.references;
  const access = accessFor(input.candidate);
  const sliding = input.candidate.id === "heldout-slide-plus-border";
  const motif = input.candidate.referenceIds.includes("border-pattern-box");
  const requirements: IntentGraphV2["requirements"] = [
    { id: "containment-required", priority: "must", kind: "containment", semanticSummary: "Contain the primary subject.", evidenceIds: [briefEvidence] },
    { id: "access-required", priority: "must", kind: "access", semanticSummary: `Provide ${access} access.`, evidenceIds: [briefEvidence] },
    ...(sliding ? [{ id: "motion-required", priority: "must" as const, kind: "prismatic-interface" as const, semanticSummary: "Capture one sliding cover.", evidenceIds: [briefEvidence] }] : []),
    ...(motif ? [{ id: "treatment-required", priority: "must" as const, kind: "visual-treatment" as const, semanticSummary: "Apply a registered scored border.", evidenceIds: [briefEvidence] }] : [])
  ];
  const referenceBrief = input.candidate.referenceIds.map((referenceId, referenceIndex) => {
    const evidenceId = referenceEvidence[referenceIndex]!.evidenceId;
    return {
      referenceEvidenceId: evidenceId,
      relationship: input.candidate.expectedRelationships[referenceIndex]!,
      observations: observationTemplates(referenceId).map(([kind, value, salience], observationIndex) => ({
        id: `reference-${String(referenceIndex + 1)}-${kind}-${String(observationIndex + 1)}`,
        kind,
        value,
        targetBodyRole: kind === "ornament" || kind === "operation-character" ? "primary-enclosure" as const : null,
        targetFaceRole: kind === "ornament" || kind === "operation-character" ? "front" as const : "unspecified" as const,
        salience,
        confidence: "high" as const,
        visibility: "visible" as const,
        evidenceIds: [evidenceId]
      }))
    };
  });
  const coveredObservationId = referenceBrief.flatMap((entry) => entry.observations)
    .find((observation) => observation.kind === "opening" && observation.value === "covered")?.id;
  const openingObservationIds = referenceBrief.flatMap((entry) => entry.observations)
    .filter((observation) => observation.kind === "opening").map((observation) => observation.id);
  return IntentGraphV2Schema.parse({
    schemaVersion: "2.2",
    title: `Reference fidelity ${input.candidate.id}`,
    purpose: "Exercise frozen zero-call reference interpretation predicates.",
    requirements,
    constructionBodies: [
      { id: "primary-body", role: "primary-enclosure", shapeClass: "orthogonal-shell", requirementIds: requirements.map((item) => item.id), evidenceIds: [briefEvidence] },
      ...(sliding ? [{ id: "moving-cover", role: "cover" as const, shapeClass: "planar" as const, requirementIds: ["motion-required"], evidenceIds: [briefEvidence] }] : [])
    ],
    objects: [],
    interfaces: sliding ? [{ id: "moving-interface", betweenBodyIds: ["primary-body", "moving-cover"], behavior: "prismatic", axis: "depth", requirementIds: ["motion-required"], evidenceIds: [briefEvidence] }] : [],
    access: [{ bodyId: "primary-body", kind: access, direction: "top", priority: "must", requirementId: "access-required", evidenceIds: [briefEvidence] }],
    organization: [],
    scaleEvidence: [],
    proportions: [],
    clearance: [],
    rankedGoals: [{ id: "compactness-goal", kind: "compactness", rank: 1, evidenceIds: [briefEvidence] }],
    motif: motif ? {
      vocabulary: ["geometric border"], composition: "border", density: "sparse", symmetry: "bilateral",
      primitiveFamilies: ["inset-score-frame"], preferredOperations: ["score"],
      preferredBodyRoles: ["primary-enclosure"], evidenceIds: [referenceEvidence.find((item) =>
        item.referenceId === "border-pattern-box"
      )!.evidenceId]
    } : null,
    referenceBrief,
    assumptions: [],
    conflicts: input.candidate.id === "explicit-text-access-conflict" && coveredObservationId !== undefined ? [{
      id: "explicit-access-conflict",
      attribute: "access",
      textEvidenceIds: [briefEvidence],
      observationIds: [coveredObservationId],
      resolution: "explicit-text-wins"
    }] : input.candidate.id === "multi-reference-unresolved-conflict" ? [{
      id: "multi-reference-access-conflict",
      attribute: "access",
      textEvidenceIds: [briefEvidence],
      observationIds: openingObservationIds,
      resolution: "unresolved"
    }] : [],
    unresolvedNeeds: []
  });
}

async function runCase(candidate: Case, references: Reference[]) {
  const selected = candidate.referenceIds.map((id) => references.find((item) => item.id === id)!);
  const descriptors = selected.map((reference) => ({
    referenceId: reference.id,
    sha256: reference.sha256,
    mediaType: "image/png" as const,
    width: reference.width,
    height: reference.height
  }));
  const roleConstraints = candidate.roleConstraints.flatMap((roles, index) => roles.length === 0 ? [] : [{
    referenceId: descriptors[index]!.referenceId,
    roles
  }]);
  const source = await buildSourceEvidenceIndex({ brief: candidate.brief, references: descriptors, roleConstraints });
  const intentCandidate = intentFor({ candidate, sourceEvidence: source.sourceEvidenceIndex });
  const authorization = authorizeIntentGraphV2Evidence({
    intent: intentCandidate,
    sourceEvidenceIndex: source.sourceEvidenceIndex,
    semanticBrief: source.semanticBrief
  });
  if (!authorization.success) throw new Error(`REFERENCE_FIDELITY_AUTHORIZATION_FAILED:${candidate.id}`);
  const explicitSizing = await reconcileExplicitSizingConstraints({ advancedSizing: { basis: "auto" }, parsedConstraints: [], parserFindings: [] });
  const setup = resolveFabricationSetup(createPublicFabricationSetup());
  const planning = await planIntentConditionedConstruction({
    intent: authorization.intent,
    explicitConstraints: explicitSizing,
    profiles: {
      material: setup.material,
      machine: setup.machine,
      processRecipe: setup.processRecipe,
      fabricationContext: setup.fabricationContext,
      fit: setup.fit
    },
    inputPolicyEvaluation: setup.inputPolicyEvaluation,
    pin: createStarterPinSetup(),
    semanticProvenance: {
      modelId: "zero-call-reference-fixture",
      promptIdentity: "m7-1-reference-fidelity-v2",
      promptHash: await hashCanonical("m7-1-reference-fidelity-v2"),
      semanticRequestDigest: await hashCanonical({ brief: source.semanticBrief, descriptors }),
      runtimeApplicationApiCalls: 0
    }
  });
  const outcome = await generationOutcomeV2FromPlanner({
    requestId: `reference-fidelity-${candidate.id}`,
    transportMode: "fixture",
    semanticRequestDigest: await hashCanonical({ brief: source.semanticBrief, descriptors }),
    sourceEvidenceIndexDigest: source.sourceEvidenceIndex.digest,
    promptIdentity: "m7-1-reference-fidelity-v2",
    promptHash: await hashCanonical("m7-1-reference-fidelity-v2"),
    modelId: "zero-call-reference-fixture",
    cacheResult: "miss",
    attemptId: null,
    providerRequestId: null,
    intent: authorization.intent,
    explicitSizing,
    planning
  });
  return { outcome, planning, source, descriptors };
}

describe("frozen M7.1 reference-fidelity corpus", () => {
  it("is strict, hash-pinned, synthetic, role-complete, and includes a held-out arrangement", async () => {
    const corpus = await manifest();
    for (const reference of corpus.references) {
      expect(await sha256(new Uint8Array(await readFile(reference.path)))).toBe(reference.sha256);
    }
    expect(corpus.cases.some((item) => item.partition === "heldout")).toBe(true);
    expect(new Set(corpus.cases.flatMap((item) => item.roleConstraints.flat()))).toEqual(new Set(["structure", "motif"]));
    expect(corpus.cases.some((item) => item.referenceIds.length === 0)).toBe(true);
    expect(corpus.cases.some((item) => item.referenceIds.length > 1)).toBe(true);
    expect(new Set(corpus.cases.flatMap((item) => item.expectedRelationships))).toEqual(new Set(["reproduce", "inspire", "context"]));
  });

  it("meets every frozen zero-call outcome and privacy predicate", async () => {
    const corpus = await manifest();
    for (const candidate of corpus.cases) {
      const result = await runCase(candidate, corpus.references);
      expect(result.outcome.kind, candidate.id).toBe(candidate.expectedOutcome);
      expect(result.descriptors.map((item) => item.referenceId)).toEqual(candidate.referenceIds);
      expect(result.source.sourceEvidenceIndex.references.map((item) => item.declaredRoles)).toEqual(candidate.roleConstraints);
      const serialized = JSON.stringify(result.outcome);
      expect(serialized).not.toMatch(/data:image|\.png|\.svg|SALE 50%|base64/iu);
      const predicates = evaluateReferenceFidelityPredicates({
        contract: candidate,
        outcome: result.outcome
      });
      expect(predicates.every((item) => item.pass), JSON.stringify(predicates)).toBe(true);
      if (result.outcome.kind === "supported" || result.outcome.kind === "simplified") {
        expect(result.outcome.source.intent.referenceBrief.map((item) => item.relationship)).toEqual(candidate.expectedRelationships);
        expect(result.outcome.source.semanticProvenance.providerUsage).toBeNull();
        expect(result.planning.kind === "planned" && result.planning.selected.compiled?.compiled.document.provenance.runtimeApplicationApiCalls).toBe(0);
      }
    }
  }, 30_000);

  it("accepts only ledger-proved preferred simplification for ambiguous reference wording", async () => {
    const corpus = await manifest();
    const inspiration = corpus.cases.find((item) => item.id === "ornate-inspiration")!;
    const context = corpus.cases.find((item) => item.id === "ornate-context-only")!;
    const conceptOnly = corpus.cases.find((item) => item.id === "ornate-reproduce-mismatch")!;
    const [simplifiedResult, contextResult, conceptOnlyResult] = await Promise.all([
      runCase(inspiration, corpus.references),
      runCase(context, corpus.references),
      runCase(conceptOnly, corpus.references)
    ]);
    const truthfulPreferredContract: Case = {
      ...inspiration,
      expectedOutcome: "supported",
      outcomeAcceptance: "supported-or-disclosed-simplified",
      relationshipAcceptance: ["non-context"]
    };
    expect(scoreReferenceFidelityCase({
      contract: truthfulPreferredContract,
      outcome: simplifiedResult.outcome
    }).pass).toBe(true);
    expect(scoreReferenceFidelityCase({
      contract: { ...truthfulPreferredContract, outcomeAcceptance: "exact" },
      outcome: simplifiedResult.outcome
    }).outcomeAcceptancePass).toBe(false);
    expect(scoreReferenceFidelityCase({
      contract: truthfulPreferredContract,
      outcome: contextResult.outcome
    }).relationshipAcceptancePass).toBe(false);
    expect(scoreReferenceFidelityCase({
      contract: truthfulPreferredContract,
      outcome: conceptOnlyResult.outcome
    }).outcomeAcceptancePass).toBe(false);
  });

  it("changes supported canonical construction for the same text and is byte-stable on replay", async () => {
    const corpus = await manifest();
    const openCase = corpus.cases.find((item) => item.id === "same-text-open-counterfactual")!;
    const coveredCase = corpus.cases.find((item) => item.id === "same-text-covered-counterfactual")!;
    const [open, covered, replay] = await Promise.all([
      runCase(openCase, corpus.references),
      runCase(coveredCase, corpus.references),
      runCase(openCase, corpus.references)
    ]);
    if (open.outcome.kind !== "supported" || covered.outcome.kind !== "supported" || replay.outcome.kind !== "supported") {
      throw new Error("REFERENCE_COUNTERFACTUAL_NOT_SUPPORTED");
    }
    expect(open.outcome.source.selectedPlan.topology.access).toBe("open-top");
    expect(covered.outcome.source.selectedPlan.topology.access).toBe("covered");
    expect(open.outcome.canonicalResult.geometryHash).not.toBe(covered.outcome.canonicalResult.geometryHash);
    expect(await hashCanonical(open.outcome.source.intent)).toBe(await hashCanonical(replay.outcome.source.intent));
    expect(open.outcome.canonicalResult.geometryHash).toBe(replay.outcome.canonicalResult.geometryHash);
    expect(open.outcome.canonicalResult.svgGroupHash).toBe(replay.outcome.canonicalResult.svgGroupHash);
  });
});
