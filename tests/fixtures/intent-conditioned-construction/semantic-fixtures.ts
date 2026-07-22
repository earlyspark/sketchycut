import type { IntentGraphV2 } from "../../../src/interpretation/intent-graph-v2.js";
import type { SourceEvidenceIndexV1 } from "../../../src/interpretation/source-evidence.js";
import { FROZEN_CONSTRUCTION_CORPUS } from "./corpus.js";

type CaseId = typeof FROZEN_CONSTRUCTION_CORPUS[number]["id"];
type Axis = "width" | "depth" | "height";

type ScaleRecipe = {
  objectId: string;
  label: string;
  quantity: number | null;
  long: readonly [number, number];
  short: readonly [number, number];
  height: readonly [number, number];
  evidence: "brief" | "reference";
};

type FixtureRecipe = {
  access?: "open-top" | "open-front" | "covered";
  accessPriority?: "must" | "prefer";
  spaces?: 1 | 2 | 4;
  organizationPriority?: "must" | "prefer";
  motion?: "retained" | "captured";
  compoundMotion?: boolean;
  shape?: "orthogonal-shell" | "angled" | "freeform";
  fitCriticalObject?: { id: string; label: string };
  scale?: ScaleRecipe;
  proportion?: {
    numerator: Axis;
    denominator: Axis;
    strength: "moderate" | "strong" | "extreme";
    priority?: "must" | "prefer";
  };
  textWinsConflict?: boolean;
};

const RECIPES: Record<CaseId, FixtureRecipe> = {
  "unanchored-compact-catchall": { access: "open-top", proportion: { numerator: "width", denominator: "depth", strength: "moderate" } },
  "fit-critical-unmeasured-camera": { access: "covered", fitCriticalObject: { id: "camera", label: "camera" } },
  "long-pencil-enclosure": {
    access: "covered",
    scale: { objectId: "pencils", label: "pencils", quantity: 6, long: [180_000, 210_000], short: [8_000, 12_000], height: [8_000, 12_000], evidence: "brief" },
    proportion: { numerator: "width", denominator: "depth", strength: "strong" }
  },
  "flat-wide-tray": { access: "open-top", proportion: { numerator: "width", denominator: "height", strength: "extreme" } },
  "tall-narrow-container": { access: "open-top", proportion: { numerator: "height", denominator: "width", strength: "moderate" } },
  "open-top-catchall": { access: "open-top" },
  "open-front-cubby": {
    access: "open-front",
    scale: { objectId: "notebook", label: "notebook", quantity: 1, long: [130_000, 170_000], short: [80_000, 120_000], height: [8_000, 20_000], evidence: "brief" }
  },
  "divided-organizer": { access: "open-top", spaces: 2 },
  "four-sd-card-compartments": {
    access: "open-top",
    spaces: 4,
    scale: { objectId: "sd-cards", label: "SD cards", quantity: null, long: [32_000, 34_000], short: [23_000, 25_000], height: [2_000, 4_000], evidence: "brief" }
  },
  "one-compartment-control": {
    access: "open-top",
    spaces: 1,
    scale: { objectId: "sd-cards", label: "SD cards", quantity: null, long: [32_000, 34_000], short: [23_000, 25_000], height: [2_000, 4_000], evidence: "brief" }
  },
  "retained-pin-keepsake-enclosure": { access: "covered", motion: "retained" },
  "captured-sliding-card-enclosure": {
    access: "covered",
    motion: "captured",
    scale: { objectId: "cards", label: "cards", quantity: null, long: [88_000, 92_000], short: [58_000, 62_000], height: [10_000, 20_000], evidence: "brief" }
  },
  "generic-named-contents": {
    access: "covered",
    scale: { objectId: "tea-bags", label: "tea bags", quantity: null, long: [65_000, 85_000], short: [55_000, 75_000], height: [6_000, 14_000], evidence: "brief" }
  },
  "prompt-reference-disagreement": { access: "open-front", textWinsConflict: true },
  "image-only-scale": {
    access: "open-top",
    scale: { objectId: "reference-object", label: "reference object", quantity: 1, long: [90_000, 130_000], short: [60_000, 90_000], height: [40_000, 70_000], evidence: "reference" }
  },
  "text-only-zero-reference": { access: "open-top" },
  "feasible-exact-external": { access: "open-top" },
  "feasible-exact-internal": { access: "covered" },
  "partial-exact-hybrid": {
    access: "covered",
    scale: { objectId: "pencils", label: "pencils", quantity: null, long: [150_000, 190_000], short: [18_000, 28_000], height: [14_000, 24_000], evidence: "brief" },
    proportion: { numerator: "width", denominator: "depth", strength: "strong" }
  },
  "advanced-overrides-parsed": { access: "open-top" },
  "contained-card-width": { access: "open-top", fitCriticalObject: { id: "cards", label: "cards" } },
  "approximate-project-width": { access: "open-top", proportion: { numerator: "width", denominator: "depth", strength: "moderate" } },
  "ranged-project-width": { access: "open-top", proportion: { numerator: "width", denominator: "depth", strength: "moderate" } },
  "hard-constraint-infeasible": { access: "open-top" },
  "evidence-backed-feature-preference": { access: "open-front", accessPriority: "prefer", spaces: 2, organizationPriority: "prefer" },
  "unsupported-angled-phone-stand": { access: "open-front", shape: "angled" },
  "unsupported-freeform-compound-motion": { access: "covered", shape: "freeform", compoundMotion: true },
  "deliberate-search-budget-exhaustion": { access: "open-top", spaces: 2, organizationPriority: "prefer" }
};

function evidence(index: SourceEvidenceIndexV1, kind: "brief" | "reference" = "brief"): string {
  if (kind === "reference" && index.references[0] !== undefined) return index.references[0].evidenceId;
  const first = index.spans[0]?.evidenceId;
  if (first === undefined) throw new Error("FROZEN_SEMANTIC_FIXTURE_BRIEF_EVIDENCE_MISSING");
  return first;
}

export function frozenSemanticFixture(input: {
  caseId: CaseId;
  sourceEvidenceIndex: SourceEvidenceIndexV1;
}): IntentGraphV2 {
  const recipe = RECIPES[input.caseId];
  const briefEvidence = evidence(input.sourceEvidenceIndex);
  const access = recipe.access ?? "open-top";
  const accessPriority = recipe.accessPriority ?? "must";
  const organizationPriority = recipe.organizationPriority ?? "must";
  const requirements: IntentGraphV2["requirements"] = [
    { id: "containment-required", priority: "must", kind: "containment", semanticSummary: "Preserve the evidenced containment purpose.", evidenceIds: [briefEvidence] },
    { id: "access-request", priority: accessPriority, kind: "access", semanticSummary: `Use ${access} access.`, evidenceIds: [briefEvidence] },
    ...(recipe.spaces === undefined ? [] : [{
      id: "organization-request",
      priority: organizationPriority,
      kind: "organization" as const,
      semanticSummary: `Provide ${String(recipe.spaces)} canonical spaces.`,
      evidenceIds: [briefEvidence]
    }]),
    ...(recipe.motion === undefined ? [] : [{
      id: "motion-required",
      priority: "must" as const,
      kind: recipe.motion === "retained" ? "revolute-interface" as const : "prismatic-interface" as const,
      semanticSummary: recipe.motion === "retained" ? "Retain a hinged cover." : "Capture a sliding cover.",
      evidenceIds: [briefEvidence]
    }]),
    ...(recipe.compoundMotion ? [{
      id: "compound-motion-required",
      priority: "must" as const,
      kind: "compound-motion" as const,
      semanticSummary: "Preserve two independent moving interfaces.",
      evidenceIds: [briefEvidence]
    }] : [])
  ];
  const fitObject = recipe.fitCriticalObject;
  const scaleObject = recipe.scale;
  const object = fitObject ?? (scaleObject === undefined ? null : { id: scaleObject.objectId, label: scaleObject.label });
  const primaryRequirementIds = requirements.map((item) => item.id);
  const movingBodies: IntentGraphV2["constructionBodies"] = recipe.compoundMotion
    ? [
        { id: "moving-cover-one", role: "cover", shapeClass: "curved", requirementIds: ["compound-motion-required"], evidenceIds: [briefEvidence] },
        { id: "moving-cover-two", role: "cover", shapeClass: "curved", requirementIds: ["compound-motion-required"], evidenceIds: [briefEvidence] }
      ]
    : recipe.motion === undefined ? [] : [{
        id: "moving-cover",
        role: "cover",
        shapeClass: "planar",
        requirementIds: ["motion-required"],
        evidenceIds: [briefEvidence]
      }];
  const interfaces: IntentGraphV2["interfaces"] = recipe.compoundMotion
    ? [
        { id: "moving-interface-one", betweenBodyIds: ["primary-body", "moving-cover-one"], behavior: "revolute", axis: "width", requirementIds: ["compound-motion-required"], evidenceIds: [briefEvidence] },
        { id: "moving-interface-two", betweenBodyIds: ["primary-body", "moving-cover-two"], behavior: "prismatic", axis: "depth", requirementIds: ["compound-motion-required"], evidenceIds: [briefEvidence] }
      ]
    : recipe.motion === undefined ? [] : [{
        id: "moving-interface",
        betweenBodyIds: ["primary-body", "moving-cover"],
        behavior: recipe.motion === "retained" ? "revolute" : "prismatic",
        axis: recipe.motion === "retained" ? "width" : "depth",
        requirementIds: ["motion-required"],
        evidenceIds: [briefEvidence]
      }];
  return {
    schemaVersion: "2.4",
    title: `Frozen fixture ${input.caseId}`,
    purpose: "Exercise current intent-conditioned construction from strict fixture semantics.",
    requirements,
    constructionBodies: [{
      id: "primary-body",
      role: "primary-enclosure",
      shapeClass: recipe.shape ?? "orthogonal-shell",
      requirementIds: primaryRequirementIds,
      evidenceIds: [briefEvidence]
    }, ...movingBodies],
    objects: object === null ? [] : [{
      id: object.id,
      role: "contained",
      engagement: "full-envelope",
      semanticLabel: object.label,
      quantity: scaleObject?.quantity ?? 1,
      fitCritical: fitObject !== undefined,
      evidenceIds: [briefEvidence]
    }],
    interfaces,
    access: [{
      bodyId: "primary-body",
      kind: access,
      direction: access === "open-front" ? "front" : "top",
      priority: accessPriority,
      requirementId: "access-request",
      evidenceIds: [briefEvidence]
    }],
    organization: recipe.spaces === undefined ? [] : [{
      bodyId: "primary-body",
      desiredSpaceCount: recipe.spaces,
      rows: null,
      columns: null,
      priority: organizationPriority,
      requirementId: "organization-request",
      evidenceIds: [briefEvidence]
    }],
    scaleEvidence: scaleObject === undefined ? [] : [{
      id: "model-prior-object-scale",
      objectId: scaleObject.objectId,
      long: { minimumUm: scaleObject.long[0], maximumUm: scaleObject.long[1] },
      short: { minimumUm: scaleObject.short[0], maximumUm: scaleObject.short[1] },
      height: { minimumUm: scaleObject.height[0], maximumUm: scaleObject.height[1] },
      confidence: "medium",
      basis: "model-prior",
      evidenceIds: [evidence(input.sourceEvidenceIndex, scaleObject.evidence)]
    }],
    proportions: recipe.proportion === undefined ? [] : [{
      id: "semantic-proportion",
      targetBodyId: "primary-body",
      numeratorAxis: recipe.proportion.numerator,
      denominatorAxis: recipe.proportion.denominator,
      strength: recipe.proportion.strength,
      priority: recipe.proportion.priority ?? "prefer",
      confidence: "medium",
      evidenceIds: [briefEvidence]
    }],
    clearance: scaleObject === undefined ? [] : [{ objectId: scaleObject.objectId, kind: "ordinary-access", priority: "prefer", evidenceIds: [briefEvidence] }],
    rankedGoals: [{ id: "compactness-goal", kind: "compactness", rank: 1, evidenceIds: [briefEvidence] }],
    motif: null,
    cutThrough: [],
    referenceBrief: input.sourceEvidenceIndex.references.map((reference, index) => ({
      referenceEvidenceId: reference.evidenceId,
      relationship: "context",
      observations: [{
        id: `reference-${String(index + 1)}-primary-subject`,
        kind: "primary-subject",
        value: "unknown",
        targetBodyRole: null,
        targetFaceRole: "unspecified",
        salience: "secondary",
        confidence: "low",
        visibility: "uncertain",
        evidenceIds: [reference.evidenceId]
      }]
    })),
    assumptions: [],
    conflicts: recipe.textWinsConflict ? [{
      id: "text-reference-conflict",
      attribute: "access",
      textEvidenceIds: [briefEvidence],
      observationIds: ["reference-1-primary-subject"],
      resolution: "explicit-text-wins"
    }] : [],
    unresolvedNeeds: []
  };
}
