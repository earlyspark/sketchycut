import { z } from "zod";

import { Sha256Schema, StableIdSchema } from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import { REGISTERED_OPERATORS } from "../operators/registry.js";
import { GENERATOR_VERSION } from "../version.js";
import { CAPABILITY_CATALOG_V1, CURRENT_CAPABILITY_CATALOG_VERSION } from "./capability-catalog.js";
import {
  CONSTRAINT_SIZING_SOLVER_VERSION,
  SIZING_POLICY_VERSION,
  SizingDecisionV1Schema,
  sizingPolicyHash
} from "./constraint-sizing-solver.js";
import { CONSTRUCTION_COMPOSITION_VERSION, constructionCompositionPolicyHash } from "./construction-composition.js";
import { ConstructionFindingV1Schema, ConstructionPlanV1Schema } from "./construction-contracts.js";
import {
  CONSTRUCTION_PLANNER_VERSION,
  constructionPlannerPolicyHash,
  type ConstructionPlannerOutcomeV1,
  type PlanningCandidateRecordV1
} from "./construction-planner.js";
import { ExplicitSizingConstraintsV1Schema, type ExplicitSizingConstraintsV1 } from "./explicit-sizing.js";
import {
  CURRENT_INTENT_GRAPH_SCHEMA_VERSION,
  IntentGraphV2Schema,
  type IntentGraphV2
} from "./intent-graph-v2.js";
import { EXACT_MEASUREMENT_GRAMMAR_VERSION } from "./source-evidence.js";
import { TOPOLOGY_SYNTHESIS_VERSION, topologySynthesisPolicyHash } from "./topology-synthesis.js";

export const GENERATION_OUTCOME_V2_VERSION = "2.0" as const;
export const CURRENT_CONSTRUCTION_COMPILER_VERSION = "construction-plan-compiler-v1" as const;
export const CURRENT_CONSTRUCTION_VALIDATOR_VERSION = "canonical-validation-v1" as const;

const StableFindingCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]+$/);

export const CurrentComponentManifestV2Schema = z.object({
  schemaVersion: z.literal("1.0"),
  intentSchemaVersion: z.literal(CURRENT_INTENT_GRAPH_SCHEMA_VERSION),
  exactMeasurementGrammarVersion: z.literal(EXACT_MEASUREMENT_GRAMMAR_VERSION),
  sizingSolverVersion: z.literal(CONSTRAINT_SIZING_SOLVER_VERSION),
  sizingPolicyVersion: z.literal(SIZING_POLICY_VERSION),
  sizingPolicyHash: Sha256Schema,
  topologyVersion: z.literal(TOPOLOGY_SYNTHESIS_VERSION),
  topologyPolicyHash: Sha256Schema,
  compositionVersion: z.literal(CONSTRUCTION_COMPOSITION_VERSION),
  compositionPolicyHash: Sha256Schema,
  plannerVersion: z.literal(CONSTRUCTION_PLANNER_VERSION),
  plannerPolicyHash: Sha256Schema,
  capabilityCatalogVersion: z.literal(CURRENT_CAPABILITY_CATALOG_VERSION),
  capabilityCatalogHash: Sha256Schema,
  operatorRegistryHash: Sha256Schema,
  compilerVersion: z.literal(CURRENT_CONSTRUCTION_COMPILER_VERSION),
  validatorVersion: z.literal(CURRENT_CONSTRUCTION_VALIDATOR_VERSION),
  generatorVersion: z.literal(GENERATOR_VERSION),
  manifestHash: Sha256Schema
}).strict();

const CandidateEvidenceSummaryV1Schema = z.object({
  candidateId: StableIdSchema,
  enumerationIndex: z.number().int().nonnegative(),
  status: z.enum(["sizing-infeasible", "compile-rejected", "complexity-rejected", "feasible"]),
  sizingDecisionHash: Sha256Schema.nullable(),
  planId: StableIdSchema.nullable(),
  geometryHash: Sha256Schema.nullable(),
  findingCodes: z.array(StableFindingCodeSchema),
  everySheetWithinImportBudget: z.boolean().nullable()
}).strict();

const SemanticAttemptProvenanceV2Schema = z.object({
  semanticRequestDigest: Sha256Schema,
  sourceEvidenceIndexDigest: Sha256Schema,
  promptIdentity: z.string().min(1).max(160),
  promptHash: Sha256Schema,
  modelId: z.string().min(1).max(120),
  cacheResult: z.enum(["miss", "hit", "singleflight-hit"]),
  attemptId: z.string().min(1).max(512).nullable(),
  providerRequestId: z.string().min(1).max(512).nullable()
}).strict();

const LastVerifiedHashesV2Schema = z.object({
  documentHash: Sha256Schema,
  geometryHash: Sha256Schema,
  projectionBundleHash: Sha256Schema,
  svgGroupHash: Sha256Schema
}).strict();

export const CanonicalGenerationSourceV2Schema = z.object({
  schemaVersion: z.literal("2.0"),
  intent: IntentGraphV2Schema,
  explicitSizing: ExplicitSizingConstraintsV1Schema,
  selectedSizing: SizingDecisionV1Schema,
  selectedPlan: ConstructionPlanV1Schema,
  candidateEvidence: z.array(CandidateEvidenceSummaryV1Schema).min(1),
  satisfiedRequirementIds: z.array(StableIdSchema),
  simplifiedRequirementIds: z.array(StableIdSchema),
  conflictingRequirementIds: z.array(StableIdSchema),
  unresolvedRequirementIds: z.array(StableIdSchema),
  componentManifest: CurrentComponentManifestV2Schema,
  semanticProvenance: SemanticAttemptProvenanceV2Schema,
  lastVerifiedHashes: LastVerifiedHashesV2Schema
}).strict();

const CanonicalResultSummaryV2Schema = z.object({
  sourceRecordHash: Sha256Schema,
  documentHash: Sha256Schema,
  geometryHash: Sha256Schema,
  projectionBundleHash: Sha256Schema,
  svgGroupHash: Sha256Schema,
  validationStatus: z.literal("pass"),
  fabricationCandidate: z.literal(true),
  exportAllowed: z.literal(true),
  physicalVerification: z.literal("required")
}).strict();

const GenerationResultBaseV2Schema = z.object({
  schemaVersion: z.literal(GENERATION_OUTCOME_V2_VERSION),
  transportMode: z.enum(["fixture", "live"]),
  requestId: z.string().min(1).max(512),
  source: CanonicalGenerationSourceV2Schema,
  canonicalResult: CanonicalResultSummaryV2Schema,
  findingCodes: z.array(StableFindingCodeSchema),
  fabricationCandidate: z.literal(true),
  exportAllowed: z.literal(true)
});

export const GenerationOutcomeV2Schema = z.discriminatedUnion("kind", [
  GenerationResultBaseV2Schema.extend({
    kind: z.literal("supported"),
    changedRequirementIds: z.array(StableIdSchema).length(0),
    simplificationDisclosures: z.array(z.string()).length(0)
  }).strict(),
  GenerationResultBaseV2Schema.extend({
    kind: z.literal("simplified"),
    changedRequirementIds: z.array(StableIdSchema).min(1),
    simplificationDisclosures: z.array(z.string().min(1).max(500)).min(1)
  }).strict(),
  z.object({
    schemaVersion: z.literal(GENERATION_OUTCOME_V2_VERSION),
    kind: z.literal("concept-only"),
    transportMode: z.enum(["fixture", "live"]),
    requestId: z.string().min(1).max(512),
    intent: IntentGraphV2Schema,
    explicitSizing: ExplicitSizingConstraintsV1Schema,
    findings: z.array(ConstructionFindingV1Schema).min(1),
    findingCodes: z.array(StableFindingCodeSchema).min(1),
    unresolvedNeeds: z.array(z.string().min(1).max(240)),
    blockedRequirementIds: z.array(StableIdSchema),
    source: z.null(),
    canonicalResult: z.null(),
    fabricationCandidate: z.literal(false),
    exportAllowed: z.literal(false)
  }).strict(),
  z.object({
    schemaVersion: z.literal(GENERATION_OUTCOME_V2_VERSION),
    kind: z.literal("failure"),
    transportMode: z.enum(["fixture", "live"]),
    requestId: z.string().min(1).max(512),
    semanticRequestDigest: Sha256Schema,
    stage: z.enum(["input", "transport", "schema", "interpretation", "planning", "compilation", "validation", "persistence"]),
    code: StableFindingCodeSchema,
    retryable: z.boolean(),
    attemptId: z.string().min(1).max(512).nullable(),
    inputState: z.literal("preserved-by-caller"),
    source: z.null(),
    canonicalResult: z.null(),
    fabricationCandidate: z.literal(false),
    exportAllowed: z.literal(false)
  }).strict()
]);

export type CurrentComponentManifestV2 = z.infer<typeof CurrentComponentManifestV2Schema>;
export type CanonicalGenerationSourceV2 = z.infer<typeof CanonicalGenerationSourceV2Schema>;
export type GenerationOutcomeV2 = z.infer<typeof GenerationOutcomeV2Schema>;
export type SemanticAttemptProvenanceV2 = z.infer<typeof SemanticAttemptProvenanceV2Schema>;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function semanticFindingCodes(input: {
  intent: IntentGraphV2;
  explicitSizing: ExplicitSizingConstraintsV1;
  selectedSizing?: z.infer<typeof SizingDecisionV1Schema>;
}): string[] {
  return uniqueSorted([
    ...input.explicitSizing.findings.map((item) => item.code),
    ...input.intent.conflicts.flatMap((item) =>
      item.resolution === "text-wins" ? ["SEMANTIC_EVIDENCE_CONFLICT_TEXT_WINS"] : []
    ),
    ...(input.selectedSizing?.scaleNormalizations.flatMap((item) =>
      item.findingCode === null ? [] : [item.findingCode]
    ) ?? []),
    ...(input.selectedSizing?.supportEngagement.used === true
      ? ["SUPPORTED_OBJECT_PARTIAL_ENGAGEMENT_APPLIED"]
      : [])
  ]);
}

export async function currentComponentManifestV2(): Promise<CurrentComponentManifestV2> {
  const provisional = {
    schemaVersion: "1.0" as const,
    intentSchemaVersion: CURRENT_INTENT_GRAPH_SCHEMA_VERSION,
    exactMeasurementGrammarVersion: EXACT_MEASUREMENT_GRAMMAR_VERSION,
    sizingSolverVersion: CONSTRAINT_SIZING_SOLVER_VERSION,
    sizingPolicyVersion: SIZING_POLICY_VERSION,
    sizingPolicyHash: await sizingPolicyHash(),
    topologyVersion: TOPOLOGY_SYNTHESIS_VERSION,
    topologyPolicyHash: await topologySynthesisPolicyHash(),
    compositionVersion: CONSTRUCTION_COMPOSITION_VERSION,
    compositionPolicyHash: await constructionCompositionPolicyHash(),
    plannerVersion: CONSTRUCTION_PLANNER_VERSION,
    plannerPolicyHash: await constructionPlannerPolicyHash(),
    capabilityCatalogVersion: CURRENT_CAPABILITY_CATALOG_VERSION,
    capabilityCatalogHash: await hashCanonical(CAPABILITY_CATALOG_V1),
    operatorRegistryHash: await hashCanonical(REGISTERED_OPERATORS),
    compilerVersion: CURRENT_CONSTRUCTION_COMPILER_VERSION,
    validatorVersion: CURRENT_CONSTRUCTION_VALIDATOR_VERSION,
    generatorVersion: GENERATOR_VERSION
  };
  return CurrentComponentManifestV2Schema.parse({
    ...provisional,
    manifestHash: await hashCanonical(provisional)
  });
}

function summarizeCandidate(candidate: PlanningCandidateRecordV1): z.infer<typeof CandidateEvidenceSummaryV1Schema> {
  return CandidateEvidenceSummaryV1Schema.parse({
    candidateId: candidate.candidateId,
    enumerationIndex: candidate.enumerationIndex,
    status: candidate.status,
    sizingDecisionHash: candidate.sizing.kind === "solved" ? candidate.sizing.decisionHash : null,
    planId: candidate.plan?.planId ?? null,
    geometryHash: candidate.compiled?.compiled.geometryHash ?? null,
    findingCodes: uniqueSorted(candidate.findings.map((item) => item.code)),
    everySheetWithinImportBudget: candidate.compiled === null
      ? null
      : candidate.compiled.importComplexity.every((item) => item.withinCurrentLimit)
  });
}

export async function generationOutcomeV2FromPlanner(input: {
  requestId: string;
  transportMode: "fixture" | "live";
  semanticRequestDigest: string;
  sourceEvidenceIndexDigest: string;
  promptIdentity: string;
  promptHash: string;
  modelId: string;
  cacheResult: "miss" | "hit" | "singleflight-hit";
  attemptId: string | null;
  providerRequestId: string | null;
  intent: IntentGraphV2;
  explicitSizing: ExplicitSizingConstraintsV1;
  planning: ConstructionPlannerOutcomeV1;
}): Promise<GenerationOutcomeV2> {
  const intent = IntentGraphV2Schema.parse(input.intent);
  const explicitSizing = ExplicitSizingConstraintsV1Schema.parse(input.explicitSizing);
  const provenance = SemanticAttemptProvenanceV2Schema.parse({
    semanticRequestDigest: input.semanticRequestDigest,
    sourceEvidenceIndexDigest: input.sourceEvidenceIndexDigest,
    promptIdentity: input.promptIdentity,
    promptHash: input.promptHash,
    modelId: input.modelId,
    cacheResult: input.cacheResult,
    attemptId: input.attemptId,
    providerRequestId: input.providerRequestId
  });
  if (input.planning.kind === "failure") {
    return GenerationOutcomeV2Schema.parse({
      schemaVersion: "2.0",
      kind: "failure",
      transportMode: input.transportMode,
      requestId: input.requestId,
      semanticRequestDigest: input.semanticRequestDigest,
      stage: "planning",
      code: input.planning.failureCode,
      retryable: false,
      attemptId: input.attemptId,
      inputState: "preserved-by-caller",
      source: null,
      canonicalResult: null,
      fabricationCandidate: false,
      exportAllowed: false
    });
  }
  if (input.planning.kind === "concept-only") {
    return GenerationOutcomeV2Schema.parse({
      schemaVersion: "2.0",
      kind: "concept-only",
      transportMode: input.transportMode,
      requestId: input.requestId,
      intent,
      explicitSizing,
      findings: input.planning.findings,
      findingCodes: uniqueSorted([
        ...semanticFindingCodes({ intent, explicitSizing }),
        ...input.planning.findings.map((item) => item.code)
      ]),
      unresolvedNeeds: input.planning.unresolvedNeeds,
      blockedRequirementIds: uniqueSorted(input.planning.blockedRequirementIds),
      source: null,
      canonicalResult: null,
      fabricationCandidate: false,
      exportAllowed: false
    });
  }
  const selected = input.planning.selected;
  if (selected.plan === null || selected.compiled === null || selected.sizing.kind !== "solved") {
    throw new Error("GENERATION_OUTCOME_SELECTED_CANDIDATE_INCOMPLETE");
  }
  const compiled = selected.compiled.compiled;
  if (compiled.document.validation.status !== "pass" || selected.compiled.importComplexity.some((item) => !item.withinCurrentLimit)) {
    throw new Error("GENERATION_OUTCOME_SELECTED_CANDIDATE_NOT_EXPORTABLE");
  }
  const verified = LastVerifiedHashesV2Schema.parse({
    documentHash: await hashCanonical(compiled.document),
    geometryHash: compiled.geometryHash,
    projectionBundleHash: await hashCanonical(compiled.bundle),
    svgGroupHash: await hashCanonical(compiled.svgs.map((item) => ({ sheetId: item.sheetId, sha256: item.sha256 })))
  });
  const simplifiedRequirementIds = uniqueSorted(selected.plan.simplifications.map((item) => item.requirementId));
  const requiredIds = intent.requirements.filter((item) => item.priority === "must").map((item) => item.id);
  const conflictingEvidenceIds = new Set(intent.conflicts.flatMap((item) =>
    item.resolution === "unresolved" ? item.evidenceIds : []
  ));
  const source = CanonicalGenerationSourceV2Schema.parse({
    schemaVersion: "2.0",
    intent,
    explicitSizing,
    selectedSizing: selected.sizing,
    selectedPlan: selected.plan,
    candidateEvidence: input.planning.candidates.map(summarizeCandidate),
    satisfiedRequirementIds: uniqueSorted(requiredIds.filter((id) => !simplifiedRequirementIds.includes(id))),
    simplifiedRequirementIds,
    conflictingRequirementIds: uniqueSorted(intent.requirements.filter((item) =>
      item.evidenceIds.some((id) => conflictingEvidenceIds.has(id))
    ).map((item) => item.id)),
    unresolvedRequirementIds: uniqueSorted(intent.unresolvedNeeds.flatMap((item) => item.requirementIds)),
    componentManifest: await currentComponentManifestV2(),
    semanticProvenance: provenance,
    lastVerifiedHashes: verified
  });
  const canonicalResult = CanonicalResultSummaryV2Schema.parse({
    sourceRecordHash: await hashCanonical(source),
    ...verified,
    validationStatus: "pass",
    fabricationCandidate: true,
    exportAllowed: true,
    physicalVerification: "required"
  });
  const simplifications = selected.plan.simplifications;
  return GenerationOutcomeV2Schema.parse({
    schemaVersion: "2.0",
    kind: simplifications.length === 0 ? "supported" : "simplified",
    transportMode: input.transportMode,
    requestId: input.requestId,
    source,
    canonicalResult,
    findingCodes: uniqueSorted([
      ...semanticFindingCodes({ intent, explicitSizing, selectedSizing: selected.sizing }),
      ...input.planning.findings.map((item) => item.code)
    ]),
    changedRequirementIds: simplifiedRequirementIds,
    simplificationDisclosures: simplifications.map((item) => item.disclosure),
    fabricationCandidate: true,
    exportAllowed: true
  });
}

export function generationFailureV2(input: {
  requestId: string;
  transportMode: "fixture" | "live";
  semanticRequestDigest: string;
  stage: "input" | "transport" | "schema" | "interpretation" | "planning" | "compilation" | "validation" | "persistence";
  code: string;
  retryable: boolean;
  attemptId: string | null;
}): GenerationOutcomeV2 {
  return GenerationOutcomeV2Schema.parse({
    schemaVersion: "2.0",
    kind: "failure",
    transportMode: input.transportMode,
    requestId: input.requestId,
    semanticRequestDigest: input.semanticRequestDigest,
    stage: input.stage,
    code: input.code,
    retryable: input.retryable,
    attemptId: input.attemptId,
    inputState: "preserved-by-caller",
    source: null,
    canonicalResult: null,
    fabricationCandidate: false,
    exportAllowed: false
  });
}
