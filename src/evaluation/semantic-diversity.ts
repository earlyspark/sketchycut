export type SemanticOpportunityKind = "proportions" | "counts" | "scaleEvidence" | "access";

export type SemanticOpportunityObservation = {
  opportunityId: string;
  kind: SemanticOpportunityKind;
  schemaValid: boolean;
  evidenceAuthorized: boolean;
  correctlyTargeted: boolean;
  correctDirection: boolean;
};

export type SemanticTopologyFingerprint = {
  constructionBodyRoles: readonly string[];
  openingFaces: readonly string[];
  usableSpaceCount: number;
  dividerPartitionGraph: readonly string[];
  closureMechanism: "none" | "retained-pin" | "captured-slide";
};

export type ResolvedDimensionFingerprint = {
  widthMm: number;
  depthMm: number;
  heightMm: number;
};

export type DimensionAxis = keyof ResolvedDimensionFingerprint;
export type TopologyField = keyof SemanticTopologyFingerprint;

export type AspectRatioPredicate = {
  kind: "aspect-ratio";
  id: string;
  numerator: DimensionAxis;
  denominator: DimensionAxis;
  comparison: "at-least" | "at-most";
  threshold: number;
  minimumRelativeChange: number;
};

export type TopologyPredicate =
  | { kind: "opening-face-includes"; face: string }
  | { kind: "usable-space-count"; count: number }
  | { kind: "divider-partition-present" }
  | { kind: "closure-mechanism"; mechanism: SemanticTopologyFingerprint["closureMechanism"] }
  | { kind: "construction-body-role-includes"; role: string };

export type DiversityCaseProtocol = {
  id: string;
  expectedFieldOpportunities: Record<SemanticOpportunityKind, readonly string[]>;
  comparisonChannels: readonly ("dimensions" | "topology")[];
  expectedOutcome: "supported" | "simplified";
  aspectRatioPredicates: readonly AspectRatioPredicate[];
  topologyPredicates: readonly TopologyPredicate[];
  topologyDifferenceFields: readonly TopologyField[];
  forbidCanonicalDefaultProportions: boolean;
};

export type DiversityRoundPolicy = {
  expectedCaseCount: number;
  minimumMateriallyDifferentCases: number;
  minimumDimensionSensitiveCases: number;
  requireEveryTopologySensitiveCase: boolean;
  exactOpportunityTotals: Record<SemanticOpportunityKind, number>;
  pairwiseDistinctAspectCaseIds: readonly string[];
};

export type DiversityPanelProtocol = {
  schemaVersion: "sketchycut-diversity-panel@1.0.0";
  panelId: string;
  cases: readonly DiversityCaseProtocol[];
  roundPolicy: DiversityRoundPolicy;
};

const SemanticOpportunityKindSchema = z.enum(["proportions", "counts", "scaleEvidence", "access"]);
const DimensionAxisSchema = z.enum(["widthMm", "depthMm", "heightMm"]);
const TopologyFieldSchema = z.enum([
  "constructionBodyRoles",
  "openingFaces",
  "usableSpaceCount",
  "dividerPartitionGraph",
  "closureMechanism"
]);
const AspectRatioPredicateSchema = z.object({
  kind: z.literal("aspect-ratio"),
  id: z.string().trim().min(1).max(120),
  numerator: DimensionAxisSchema,
  denominator: DimensionAxisSchema,
  comparison: z.enum(["at-least", "at-most"]),
  threshold: z.number().finite().positive(),
  minimumRelativeChange: z.number().finite().min(0).max(1)
}).strict();
const TopologyPredicateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("opening-face-includes"), face: z.string().trim().min(1).max(80) }).strict(),
  z.object({ kind: z.literal("usable-space-count"), count: z.number().int().positive().max(12) }).strict(),
  z.object({ kind: z.literal("divider-partition-present") }).strict(),
  z.object({ kind: z.literal("closure-mechanism"), mechanism: z.enum(["none", "retained-pin", "captured-slide"]) }).strict(),
  z.object({ kind: z.literal("construction-body-role-includes"), role: z.string().trim().min(1).max(80) }).strict()
]);
const DiversityCaseProtocolSchema = z.object({
  id: z.string().trim().min(1).max(120),
  expectedFieldOpportunities: z.object({
    proportions: z.array(z.string().trim().min(1).max(120)),
    counts: z.array(z.string().trim().min(1).max(120)),
    scaleEvidence: z.array(z.string().trim().min(1).max(120)),
    access: z.array(z.string().trim().min(1).max(120))
  }).strict(),
  comparisonChannels: z.array(z.enum(["dimensions", "topology"])).min(1).max(2),
  expectedOutcome: z.enum(["supported", "simplified"]),
  aspectRatioPredicates: z.array(AspectRatioPredicateSchema),
  topologyPredicates: z.array(TopologyPredicateSchema),
  topologyDifferenceFields: z.array(TopologyFieldSchema),
  forbidCanonicalDefaultProportions: z.boolean()
}).strict();

export const DiversityPanelProtocolSchema = z.object({
  schemaVersion: z.literal("sketchycut-diversity-panel@1.0.0"),
  panelId: z.string().trim().min(1).max(120),
  cases: z.array(DiversityCaseProtocolSchema).min(1).max(32),
  roundPolicy: z.object({
    expectedCaseCount: z.number().int().positive().max(32),
    minimumMateriallyDifferentCases: z.number().int().nonnegative().max(32),
    minimumDimensionSensitiveCases: z.number().int().nonnegative().max(32),
    requireEveryTopologySensitiveCase: z.boolean(),
    exactOpportunityTotals: z.record(SemanticOpportunityKindSchema, z.number().int().nonnegative().max(64)),
    pairwiseDistinctAspectCaseIds: z.array(z.string().trim().min(1).max(120)).max(32)
  }).strict()
}).strict();

export type DiversityCaseObservation = {
  caseId: string;
  outcome: "supported" | "simplified" | "concept-only" | "failure";
  deterministicGatesPass: boolean;
  opportunities: readonly SemanticOpportunityObservation[];
  dimensions: ResolvedDimensionFingerprint | null;
  topology: SemanticTopologyFingerprint | null;
  canonicalDefaultProportionsUsed: boolean;
};

export type DiversityCaseScore = {
  caseId: string;
  comparisonChannels: readonly ("dimensions" | "topology")[];
  opportunityHits: Record<SemanticOpportunityKind, number>;
  opportunityTotals: Record<SemanticOpportunityKind, number>;
  aspectRatios: Readonly<Record<string, number>>;
  dimensionsMateriallyDifferent: boolean;
  topologyMateriallyDifferent: boolean;
  directionalPredicatePass: boolean;
  materialDifferencePass: boolean;
  canonicalDefaultProportionsPass: boolean;
  acceptedOutcome: boolean;
};

const OPPORTUNITY_KINDS = ["proportions", "counts", "scaleEvidence", "access"] as const;
const DIMENSION_AXES = ["widthMm", "depthMm", "heightMm"] as const;
const TOPOLOGY_FIELDS = [
  "constructionBodyRoles",
  "openingFaces",
  "usableSpaceCount",
  "dividerPartitionGraph",
  "closureMechanism"
] as const;

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`DIVERSITY_PROTOCOL_INVALID:${code}`);
}

const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

function distinct(values: readonly string[], code: string): void {
  invariant(new Set(values).size === values.length, code);
}

/**
 * Validates the closed data protocol accepted from either the public iteration
 * fixture or a sealed holdout. A holdout can select registered predicates but
 * can never provide executable scoring logic.
 */
export function validateDiversityPanelProtocol(protocol: DiversityPanelProtocol): DiversityPanelProtocol {
  DiversityPanelProtocolSchema.parse(protocol);
  invariant(protocol.schemaVersion === "sketchycut-diversity-panel@1.0.0", "SCHEMA_VERSION");
  invariant(protocol.panelId.length > 0, "PANEL_ID");
  invariant(Number.isSafeInteger(protocol.roundPolicy.expectedCaseCount), "CASE_COUNT_INTEGER");
  invariant(protocol.cases.length === protocol.roundPolicy.expectedCaseCount, "CASE_COUNT");
  distinct(protocol.cases.map((item) => item.id), "CASE_IDS_UNIQUE");
  for (const item of protocol.cases) {
    invariant(item.id.length > 0, "CASE_ID");
    invariant(item.comparisonChannels.length > 0, `${item.id}:COMPARISON_CHANNEL`);
    distinct([...item.comparisonChannels], `${item.id}:COMPARISON_CHANNEL_UNIQUE`);
    for (const kind of OPPORTUNITY_KINDS) {
      distinct([...item.expectedFieldOpportunities[kind]], `${item.id}:${kind}:OPPORTUNITY_UNIQUE`);
    }
    distinct(item.aspectRatioPredicates.map((predicate) => predicate.id), `${item.id}:ASPECT_IDS_UNIQUE`);
    for (const predicate of item.aspectRatioPredicates) {
      invariant(DIMENSION_AXES.includes(predicate.numerator), `${item.id}:${predicate.id}:NUMERATOR`);
      invariant(DIMENSION_AXES.includes(predicate.denominator), `${item.id}:${predicate.id}:DENOMINATOR`);
      invariant(predicate.numerator !== predicate.denominator, `${item.id}:${predicate.id}:DISTINCT_AXES`);
      invariant(finitePositive(predicate.threshold), `${item.id}:${predicate.id}:THRESHOLD`);
      invariant(
        Number.isFinite(predicate.minimumRelativeChange) &&
          predicate.minimumRelativeChange >= 0 && predicate.minimumRelativeChange <= 1,
        `${item.id}:${predicate.id}:RELATIVE_CHANGE`,
      );
    }
    for (const field of item.topologyDifferenceFields) {
      invariant(TOPOLOGY_FIELDS.includes(field), `${item.id}:TOPOLOGY_DIFFERENCE_FIELD`);
    }
    distinct([...item.topologyDifferenceFields], `${item.id}:TOPOLOGY_DIFFERENCE_FIELDS_UNIQUE`);
    if (item.comparisonChannels.includes("dimensions")) {
      invariant(item.aspectRatioPredicates.length > 0, `${item.id}:DIMENSION_PREDICATE_REQUIRED`);
    }
    if (item.comparisonChannels.includes("topology")) {
      invariant(item.topologyPredicates.length > 0, `${item.id}:TOPOLOGY_PREDICATE_REQUIRED`);
      invariant(item.topologyDifferenceFields.length > 0, `${item.id}:TOPOLOGY_DIFFERENCE_REQUIRED`);
    }
  }
  const policy = protocol.roundPolicy;
  invariant(
    Number.isSafeInteger(policy.minimumMateriallyDifferentCases) &&
      policy.minimumMateriallyDifferentCases >= 0 &&
      policy.minimumMateriallyDifferentCases <= policy.expectedCaseCount,
    "MATERIAL_FLOOR",
  );
  invariant(
    Number.isSafeInteger(policy.minimumDimensionSensitiveCases) && policy.minimumDimensionSensitiveCases >= 0,
    "DIMENSION_FLOOR",
  );
  for (const kind of OPPORTUNITY_KINDS) {
    invariant(
      Number.isSafeInteger(policy.exactOpportunityTotals[kind]) && policy.exactOpportunityTotals[kind] >= 0,
      `${kind}:OPPORTUNITY_TOTAL`,
    );
    const declared = protocol.cases.reduce(
      (total, item) => total + item.expectedFieldOpportunities[kind].length,
      0,
    );
    invariant(declared === policy.exactOpportunityTotals[kind], `${kind}:OPPORTUNITY_TOTAL_MISMATCH`);
  }
  distinct([...policy.pairwiseDistinctAspectCaseIds], "PAIRWISE_CASE_IDS_UNIQUE");
  for (const caseId of policy.pairwiseDistinctAspectCaseIds) {
    const item = protocol.cases.find((candidate) => candidate.id === caseId);
    invariant(item !== undefined, `PAIRWISE_CASE_UNKNOWN:${caseId}`);
    invariant(item.aspectRatioPredicates.length === 1, `PAIRWISE_CASE_ONE_ASPECT:${caseId}`);
  }
  return protocol;
}

const ratio = (numerator: number, denominator: number): number => numerator / denominator;
const relativeDifference = (current: number, baseline: number): number =>
  Math.abs(current - baseline) / baseline;

function aspectEvaluation(
  predicates: readonly AspectRatioPredicate[],
  current: ResolvedDimensionFingerprint,
  baseline: ResolvedDimensionFingerprint,
): { directional: boolean; material: boolean; ratios: Readonly<Record<string, number>> } {
  const ratios: Record<string, number> = {};
  let directional = true;
  let material = true;
  for (const predicate of predicates) {
    const currentRatio = ratio(current[predicate.numerator], current[predicate.denominator]);
    const baselineRatio = ratio(baseline[predicate.numerator], baseline[predicate.denominator]);
    ratios[predicate.id] = currentRatio;
    directional &&= predicate.comparison === "at-least"
      ? currentRatio >= predicate.threshold
      : currentRatio <= predicate.threshold;
    material &&= relativeDifference(currentRatio, baselineRatio) >= predicate.minimumRelativeChange;
  }
  return { directional, material, ratios };
}

function topologyPredicatePass(
  predicate: TopologyPredicate,
  topology: SemanticTopologyFingerprint,
): boolean {
  switch (predicate.kind) {
    case "opening-face-includes":
      return topology.openingFaces.includes(predicate.face);
    case "usable-space-count":
      return topology.usableSpaceCount === predicate.count;
    case "divider-partition-present":
      return topology.dividerPartitionGraph.length > 0;
    case "closure-mechanism":
      return topology.closureMechanism === predicate.mechanism;
    case "construction-body-role-includes":
      return topology.constructionBodyRoles.includes(predicate.role);
  }
}

const canonicalValue = (value: SemanticTopologyFingerprint[TopologyField]): string =>
  JSON.stringify(Array.isArray(value) ? [...value].sort() : value);

function topologyEvaluation(
  predicates: readonly TopologyPredicate[],
  differenceFields: readonly TopologyField[],
  current: SemanticTopologyFingerprint,
  baseline: SemanticTopologyFingerprint,
): { directional: boolean; material: boolean } {
  return {
    directional: predicates.every((predicate) => topologyPredicatePass(predicate, current)),
    material: differenceFields.every((field) =>
      canonicalValue(current[field]) !== canonicalValue(baseline[field])
    )
  };
}

export function scoreDiversityCase(input: {
  protocol: DiversityCaseProtocol;
  baselineDimensions: ResolvedDimensionFingerprint;
  baselineTopology: SemanticTopologyFingerprint;
  observation: DiversityCaseObservation;
}): DiversityCaseScore {
  const { protocol, observation } = input;
  invariant(observation.caseId === protocol.id, `${protocol.id}:OBSERVATION_CASE_ID`);
  const opportunityHits = {
    proportions: 0,
    counts: 0,
    scaleEvidence: 0,
    access: 0
  } satisfies Record<SemanticOpportunityKind, number>;
  const opportunityTotals = {
    proportions: protocol.expectedFieldOpportunities.proportions.length,
    counts: protocol.expectedFieldOpportunities.counts.length,
    scaleEvidence: protocol.expectedFieldOpportunities.scaleEvidence.length,
    access: protocol.expectedFieldOpportunities.access.length
  } satisfies Record<SemanticOpportunityKind, number>;
  for (const kind of OPPORTUNITY_KINDS) {
    opportunityHits[kind] = protocol.expectedFieldOpportunities[kind].filter((opportunityId) =>
      observation.opportunities.some((item) =>
        item.kind === kind && item.opportunityId === opportunityId && item.schemaValid &&
        item.evidenceAuthorized && item.correctlyTargeted && item.correctDirection
      )
    ).length;
  }

  const dimension = observation.dimensions === null
    ? { directional: false, material: false, ratios: {} }
    : aspectEvaluation(protocol.aspectRatioPredicates, observation.dimensions, input.baselineDimensions);
  const topology = observation.topology === null
    ? { directional: false, material: false }
    : topologyEvaluation(
        protocol.topologyPredicates,
        protocol.topologyDifferenceFields,
        observation.topology,
        input.baselineTopology,
      );
  const requiresDimensions = protocol.comparisonChannels.includes("dimensions");
  const requiresTopology = protocol.comparisonChannels.includes("topology");
  const directionalPredicatePass = (!requiresDimensions || dimension.directional) &&
    (!requiresTopology || topology.directional);
  const materialDifferencePass = (!requiresDimensions || dimension.material) &&
    (!requiresTopology || topology.material);
  const canonicalDefaultProportionsPass =
    !protocol.forbidCanonicalDefaultProportions || !observation.canonicalDefaultProportionsUsed;
  const acceptedOutcome = observation.deterministicGatesPass &&
    (observation.outcome === "supported" || observation.outcome === "simplified") &&
    observation.outcome === protocol.expectedOutcome;
  return {
    caseId: protocol.id,
    comparisonChannels: protocol.comparisonChannels,
    opportunityHits,
    opportunityTotals,
    aspectRatios: dimension.ratios,
    dimensionsMateriallyDifferent: dimension.material,
    topologyMateriallyDifferent: topology.material,
    directionalPredicatePass,
    materialDifferencePass,
    canonicalDefaultProportionsPass,
    acceptedOutcome
  };
}

function pairwiseAspectSignatures(
  panel: DiversityPanelProtocol,
  scores: readonly DiversityCaseScore[],
  caseIds: readonly string[],
): readonly string[] | null {
  const signatures = caseIds.map((caseId) => {
    const protocol = panel.cases.find((item) => item.id === caseId);
    const score = scores.find((item) => item.caseId === caseId);
    const predicate = protocol?.aspectRatioPredicates[0];
    if (protocol === undefined || score === undefined || predicate === undefined ||
      protocol.aspectRatioPredicates.length !== 1) return null;
    const value = score.aspectRatios[predicate.id];
    if (value === undefined || !Number.isFinite(value)) return null;
    return `${predicate.numerator}/${predicate.denominator}:${value.toFixed(6)}`;
  });
  return signatures.some((signature) => signature === null)
    ? null
    : signatures as readonly string[];
}

export function summarizeDiversityRound(
  panel: DiversityPanelProtocol,
  scores: readonly DiversityCaseScore[],
) {
  validateDiversityPanelProtocol(panel);
  const sum = (kind: SemanticOpportunityKind, field: "opportunityHits" | "opportunityTotals") =>
    scores.reduce((total, item) => total + item[field][kind], 0);
  const acceptedMaterial = (item: DiversityCaseScore) => item.acceptedOutcome &&
    item.directionalPredicatePass && item.materialDifferencePass && item.canonicalDefaultProportionsPass;
  const materialPasses = scores.filter(acceptedMaterial);
  const dimensionScores = scores.filter((item) => item.comparisonChannels.includes("dimensions"));
  const topologyScores = scores.filter((item) => item.comparisonChannels.includes("topology"));
  const dimensionPasses = dimensionScores.filter((item) =>
    acceptedMaterial(item) && item.dimensionsMateriallyDifferent
  );
  const topologyPasses = topologyScores.filter((item) =>
    acceptedMaterial(item) && item.topologyMateriallyDifferent
  );
  const opportunity = {
    proportions: { hits: sum("proportions", "opportunityHits"), total: sum("proportions", "opportunityTotals") },
    counts: { hits: sum("counts", "opportunityHits"), total: sum("counts", "opportunityTotals") },
    scaleEvidence: { hits: sum("scaleEvidence", "opportunityHits"), total: sum("scaleEvidence", "opportunityTotals") },
    access: { hits: sum("access", "opportunityHits"), total: sum("access", "opportunityTotals") }
  };
  const completeCaseSet = scores.length === panel.roundPolicy.expectedCaseCount &&
    new Set(scores.map((item) => item.caseId)).size === scores.length &&
    panel.cases.every((item) => scores.some((score) => score.caseId === item.id));
  const opportunityPass = OPPORTUNITY_KINDS.every((kind) =>
    opportunity[kind].total === panel.roundPolicy.exactOpportunityTotals[kind] &&
    opportunity[kind].hits === opportunity[kind].total
  );
  const topologyPass = panel.roundPolicy.requireEveryTopologySensitiveCase
    ? topologyPasses.length === topologyScores.length
    : true;
  const pairwiseAspectSignaturesValue = pairwiseAspectSignatures(
    panel,
    scores,
    panel.roundPolicy.pairwiseDistinctAspectCaseIds,
  );
  const pairwiseAspectPass = pairwiseAspectSignaturesValue !== null &&
    new Set(pairwiseAspectSignaturesValue).size === pairwiseAspectSignaturesValue.length;
  return {
    opportunity,
    materiallyDifferent: materialPasses.length,
    dimensionSensitivePasses: dimensionPasses.length,
    topologySensitivePasses: topologyPasses.length,
    pairwiseAspectPass,
    pairwiseAspectSignatures: pairwiseAspectSignaturesValue ?? [],
    completeCaseSet,
    pass: completeCaseSet && opportunityPass && topologyPass && pairwiseAspectPass &&
      materialPasses.length >= panel.roundPolicy.minimumMateriallyDifferentCases &&
      dimensionPasses.length >= panel.roundPolicy.minimumDimensionSensitiveCases
  };
}
import { z } from "zod";
