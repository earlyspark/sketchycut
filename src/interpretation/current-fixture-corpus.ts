import type { IntentGraphV2 } from "./intent-graph-v2.js";
import type { SemanticGenerationRequestV2 } from "./semantic-request-v2.js";

export type CurrentFixtureScenario = {
  id: string;
  brief: string;
  access: "open-top" | "covered";
  mechanism: "rigid" | "retained-pin" | "captured-slide";
  motif: boolean;
  unsupportedCompoundMotion: boolean;
  invalidOutput: boolean;
};

export const CURRENT_FIXTURE_SCENARIOS: readonly CurrentFixtureScenario[] = Object.freeze([
  { id: "open-access-rigid", brief: "Make an open-top desktop catchall.", access: "open-top", mechanism: "rigid", motif: false, unsupportedCompoundMotion: false, invalidOutput: false },
  { id: "covered-revolute", brief: "Make a covered keepsake container with one retained hinged cover.", access: "covered", mechanism: "retained-pin", motif: false, unsupportedCompoundMotion: false, invalidOutput: false },
  { id: "covered-prismatic", brief: "Make a covered card container with one captured sliding cover.", access: "covered", mechanism: "captured-slide", motif: false, unsupportedCompoundMotion: false, invalidOutput: false },
  { id: "surface-treatment", brief: "Make an open-top catchall with a sparse bilateral scored border.", access: "open-top", mechanism: "rigid", motif: true, unsupportedCompoundMotion: false, invalidOutput: false },
  { id: "unsupported-compound-motion", brief: "Make a required object with two independently moving covers.", access: "covered", mechanism: "rigid", motif: false, unsupportedCompoundMotion: true, invalidOutput: false },
  { id: "strict-output-failure", brief: "Interpret an intentionally invalid current structured fixture.", access: "open-top", mechanism: "rigid", motif: false, unsupportedCompoundMotion: false, invalidOutput: true }
]);

export function findCurrentFixtureScenario(semanticBrief: string): CurrentFixtureScenario | null {
  return CURRENT_FIXTURE_SCENARIOS.find((item) => item.brief === semanticBrief) ?? null;
}

function firstBriefEvidence(request: SemanticGenerationRequestV2): string {
  const id = request.sourceEvidenceIndex.spans[0]?.evidenceId;
  if (id === undefined) throw new Error("CURRENT_FIXTURE_BRIEF_EVIDENCE_MISSING");
  return id;
}

export function buildCurrentFixtureIntent(
  request: SemanticGenerationRequestV2,
  scenario: CurrentFixtureScenario,
): unknown {
  if (scenario.invalidOutput) return { schemaVersion: "2.1", unknownField: true };
  const evidenceId = firstBriefEvidence(request);
  const moving = scenario.mechanism === "rigid" ? [] : [{
    id: "moving-cover", role: "cover" as const, shapeClass: "planar" as const,
    requirementIds: ["motion-required"], evidenceIds: [evidenceId]
  }];
  const compoundMoving = scenario.unsupportedCompoundMotion ? [
    { id: "moving-cover-one", role: "cover" as const, shapeClass: "planar" as const, requirementIds: ["compound-motion-required"], evidenceIds: [evidenceId] },
    { id: "moving-cover-two", role: "cover" as const, shapeClass: "planar" as const, requirementIds: ["compound-motion-required"], evidenceIds: [evidenceId] }
  ] : [];
  const requirements: IntentGraphV2["requirements"] = [
    { id: "containment-required", priority: "must", kind: "containment", semanticSummary: "Contain the requested contents.", evidenceIds: [evidenceId] },
    { id: "access-required", priority: "must", kind: "access", semanticSummary: `Provide ${scenario.access} access.`, evidenceIds: [evidenceId] },
    ...(scenario.mechanism === "rigid" ? [] : [{
      id: "motion-required", priority: "must" as const,
      kind: scenario.mechanism === "retained-pin" ? "revolute-interface" as const : "prismatic-interface" as const,
      semanticSummary: scenario.mechanism === "retained-pin" ? "Retain one revolute cover." : "Capture one sliding cover.", evidenceIds: [evidenceId]
    }]),
    ...(scenario.motif ? [{ id: "surface-treatment", priority: "must" as const, kind: "visual-treatment" as const, semanticSummary: "Apply a sparse bilateral scored border.", evidenceIds: [evidenceId] }] : []),
    ...(scenario.unsupportedCompoundMotion ? [{ id: "compound-motion-required", priority: "must" as const, kind: "compound-motion" as const, semanticSummary: "Preserve two independently moving covers.", evidenceIds: [evidenceId] }] : [])
  ];
  const interfaces: IntentGraphV2["interfaces"] = scenario.unsupportedCompoundMotion ? [
    { id: "motion-one", betweenBodyIds: ["primary-body", "moving-cover-one"], behavior: "revolute", axis: "width", requirementIds: ["compound-motion-required"], evidenceIds: [evidenceId] },
    { id: "motion-two", betweenBodyIds: ["primary-body", "moving-cover-two"], behavior: "prismatic", axis: "depth", requirementIds: ["compound-motion-required"], evidenceIds: [evidenceId] }
  ] : scenario.mechanism === "rigid" ? [] : [{
    id: "moving-interface", betweenBodyIds: ["primary-body", "moving-cover"],
    behavior: scenario.mechanism === "retained-pin" ? "revolute" : "prismatic",
    axis: scenario.mechanism === "retained-pin" ? "width" : "depth",
    requirementIds: ["motion-required"], evidenceIds: [evidenceId]
  }];
  return {
    schemaVersion: "2.1",
    title: "Current semantic fixture",
    purpose: "Exercise current intent-conditioned construction without a model call.",
    requirements,
    constructionBodies: [{
      id: "primary-body", role: "primary-enclosure", shapeClass: "orthogonal-shell",
      requirementIds: requirements.map((item) => item.id), evidenceIds: [evidenceId]
    }, ...moving, ...compoundMoving],
    objects: [], interfaces,
    access: [{ bodyId: "primary-body", kind: scenario.access, direction: "top", priority: "must", requirementId: "access-required", evidenceIds: [evidenceId] }],
    organization: [], scaleEvidence: [], proportions: [], clearance: [],
    rankedGoals: [{ id: "compactness-goal", kind: "compactness", rank: 1, evidenceIds: [evidenceId] }],
    motif: scenario.motif ? {
      vocabulary: ["geometric border"], composition: "border", density: "sparse", symmetry: "bilateral",
      primitiveFamilies: ["inset-score-frame", "corner-score-ticks"], preferredOperations: ["score"],
      preferredBodyRoles: ["primary-enclosure"], evidenceIds: [evidenceId]
    } : null,
    assumptions: [], conflicts: [],
    unresolvedNeeds: scenario.unsupportedCompoundMotion ? [{
      id: "compound-motion-unresolved", semanticSummary: "The current construction vocabulary does not realize two independent moving covers.",
      requirementIds: ["compound-motion-required"], evidenceIds: [evidenceId]
    }] : []
  } satisfies IntentGraphV2;
}
