import { z } from "zod";

import { Sha256Schema, StableIdSchema } from "../domain/contracts.js";
import { fabricationReleaseForMechanism } from "../domain/fabrication-release.js";
import { hashCanonical } from "../domain/hash.js";
import { REGISTERED_OPERATORS } from "../operators/registry.js";
import { GENERATOR_VERSION } from "../version.js";
import { CAPABILITY_CATALOG, CURRENT_CAPABILITY_CATALOG_VERSION } from "./capability-catalog.js";
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
  INVENTORY_REALIZATION_POLICY_VERSION,
  InventoryRealizationLedgerSchema,
  evaluateInventoryRealization
} from "./inventory-realization.js";
import {
  CURRENT_SEMANTIC_INTERPRETATION_SCHEMA_VERSION,
  SemanticInterpretationSchema,
  type SemanticInterpretation
} from "./semantic-interpretation.js";
import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
  semanticAtomTemplateRegistryHash
} from "./semantic-atom-registry.js";
import { EVIDENCE_BOUND_MEASUREMENT_POLICY_VERSION } from "./measurement-binding.js";
import { TOPOLOGY_SYNTHESIS_VERSION, topologySynthesisPolicyHash } from "./topology-synthesis.js";
import {
  evaluateUnplannedRequirementRealization,
  RequirementRealizationLedgerV1Schema,
  REQUIREMENT_REALIZATION_POLICY_VERSION
} from "./realization-ledger.js";
import { SEMANTIC_BOUNDARY_RECONCILIATION_POLICY_VERSION } from "./semantic-boundary-reconciliation.js";
import {
  CURRENT_SUBSTITUTION_GRAPH_VERSION,
  SubstitutionSearchTraceSchema,
  initialSubstitutionSearchTrace,
  normalizeSubstitutionTraceForRequirementRealization,
  substitutionGraphRegistryHash,
  type SubstitutionSearchTrace
} from "./substitution-graph.js";
import {
  CURRENT_UNSUPPORTED_SEMANTIC_SIGNATURE_REGISTRY_VERSION,
  unsupportedSemanticSignatureRegistryHash
} from "./unsupported-semantic-signatures.js";
import {
  CURRENT_RETAINED_SCOPE_POLICY_VERSION,
  RetainedScopeDecisionSchema,
  initialRetainedScopeDecision,
  planningProjectionForRetainedScope,
  retainedScopePolicyHash,
  type RetainedScopeDecision
} from "./retained-scope.js";

export const GENERATION_OUTCOME_VERSION = "5.0" as const;
export const CURRENT_CONSTRUCTION_COMPILER_VERSION = "construction-plan-compiler-current" as const;
export const CURRENT_CONSTRUCTION_VALIDATOR_VERSION = "canonical-validation-current" as const;

const StableFindingCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]+$/);

export const CurrentComponentManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  semanticInterpretationSchemaVersion: z.literal(CURRENT_SEMANTIC_INTERPRETATION_SCHEMA_VERSION),
  semanticAtomTemplateVersion: z.literal(CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION),
  semanticAtomTemplateRegistryHash: Sha256Schema,
  semanticBoundaryReconciliationPolicyVersion: z.literal(SEMANTIC_BOUNDARY_RECONCILIATION_POLICY_VERSION),
  evidenceBoundMeasurementPolicyVersion: z.literal(EVIDENCE_BOUND_MEASUREMENT_POLICY_VERSION),
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
  requirementRealizationPolicyVersion: z.literal(REQUIREMENT_REALIZATION_POLICY_VERSION),
  inventoryRealizationPolicyVersion: z.literal(INVENTORY_REALIZATION_POLICY_VERSION),
  retainedScopePolicyVersion: z.literal(
    CURRENT_RETAINED_SCOPE_POLICY_VERSION,
  ),
  retainedScopePolicyHash: Sha256Schema,
  unsupportedSemanticSignatureRegistryVersion: z.literal(
    CURRENT_UNSUPPORTED_SEMANTIC_SIGNATURE_REGISTRY_VERSION,
  ),
  unsupportedSemanticSignatureRegistryHash: Sha256Schema,
  substitutionGraphVersion: z.literal(CURRENT_SUBSTITUTION_GRAPH_VERSION),
  substitutionGraphRegistryHash: Sha256Schema,
  operatorRegistryHash: Sha256Schema,
  compilerVersion: z.literal(CURRENT_CONSTRUCTION_COMPILER_VERSION),
  validatorVersion: z.literal(CURRENT_CONSTRUCTION_VALIDATOR_VERSION),
  generatorVersion: z.literal(GENERATOR_VERSION),
  manifestHash: Sha256Schema
}).strict();

const CandidateEvidenceSummarySchema = z.object({
  candidateId: StableIdSchema,
  enumerationIndex: z.number().int().nonnegative(),
  status: z.enum(["sizing-infeasible", "compile-rejected", "complexity-rejected", "feasible"]),
  sizingDecisionHash: Sha256Schema.nullable(),
  planId: StableIdSchema.nullable(),
  geometryHash: Sha256Schema.nullable(),
  findingCodes: z.array(StableFindingCodeSchema),
  everySheetWithinImportBudget: z.boolean().nullable()
}).strict();

const SemanticAttemptProvenanceSchema = z.object({
  semanticRequestDigest: Sha256Schema,
  sourceEvidenceIndexDigest: Sha256Schema,
  promptIdentity: z.string().min(1).max(160),
  promptHash: Sha256Schema,
  modelId: z.string().min(1).max(120),
  providerModelId: z.string().min(1).max(120).nullable(),
  providerResponseId: z.string().min(1).max(512).nullable(),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh"]),
  imageDetailPolicy: z.enum(["low", "high", "auto", "mixed-first-high"]),
  promptLayoutVersion: z.literal("stable-prefix-current-v5"),
  modelConfigurationHash: Sha256Schema,
  cacheResult: z.enum(["miss", "hit", "singleflight-hit"]),
  attemptId: z.string().min(1).max(512).nullable(),
  providerRequestId: z.string().min(1).max(512).nullable(),
  providerFinishState: z.enum(["completed", "incomplete", "failed", "cancelled", "unknown", "not-observed"]),
  providerUsage: z.object({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    cacheWriteInputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative()
  }).strict().nullable(),
  providerLatencyMs: z.number().int().nonnegative().nullable(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
  requestBudgetUpperBoundUsd: z.number().nonnegative().nullable(),
  priceSnapshotId: z.string().min(1).max(120).nullable(),
  semanticCallCount: z.literal(1)
}).strict();

const LastVerifiedHashesSchema = z.object({
  documentHash: Sha256Schema,
  geometryHash: Sha256Schema,
  projectionBundleHash: Sha256Schema,
  svgGroupHash: Sha256Schema
}).strict();

const RequestCoverageBaseSchema = z.object({
  includedSemanticIds: z.array(StableIdSchema),
  changedSemanticIds: z.array(StableIdSchema),
  disclosures: z.array(z.string().min(1).max(900))
});

export const CanonicalRequestCoverageSchema = z.discriminatedUnion("status", [
  RequestCoverageBaseSchema.extend({
    status: z.literal("complete"),
    omittedSemanticIds: z.array(StableIdSchema).length(0)
  }).strict(),
  RequestCoverageBaseSchema.extend({
    status: z.literal("modified"),
    includedSemanticIds: z.array(StableIdSchema).min(1),
    omittedSemanticIds: z.array(StableIdSchema),
    disclosures: z.array(z.string().min(1).max(900)).min(1)
  }).strict()
]).superRefine((coverage, context) => {
  for (const ids of [
    coverage.includedSemanticIds,
    coverage.changedSemanticIds,
    coverage.omittedSemanticIds
  ]) {
    if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) {
      context.addIssue({
        code: "custom",
        message: "Request coverage semantic ID arrays must be uniquely sorted."
      });
    }
  }
  const allIds = [
    ...coverage.includedSemanticIds,
    ...coverage.changedSemanticIds,
    ...coverage.omittedSemanticIds
  ];
  if (new Set(allIds).size !== allIds.length) {
    context.addIssue({
      code: "custom",
      message: "Request coverage semantic IDs must be unique and mutually exclusive."
    });
  }
  if (
    coverage.status === "modified" &&
    coverage.changedSemanticIds.length + coverage.omittedSemanticIds.length === 0
  ) {
    context.addIssue({
      code: "custom",
      message: "Modified request coverage requires at least one exact changed or omitted semantic ID."
    });
  }
});

export const CanonicalGenerationSourceSchema = z.object({
  schemaVersion: z.literal("5.0"),
  interpretation: SemanticInterpretationSchema,
  explicitSizing: ExplicitSizingConstraintsV1Schema,
  selectedSizing: SizingDecisionV1Schema,
  selectedPlan: ConstructionPlanV1Schema,
  candidateEvidence: z.array(CandidateEvidenceSummarySchema).min(1),
  requirementRealization: RequirementRealizationLedgerV1Schema,
  inventoryRealization: InventoryRealizationLedgerSchema,
  retainedScopeDecision: RetainedScopeDecisionSchema,
  substitutionTrace: SubstitutionSearchTraceSchema,
  satisfiedRequirementIds: z.array(StableIdSchema),
  simplifiedRequirementIds: z.array(StableIdSchema),
  conflictingInventoryItemIds: z.array(StableIdSchema),
  unresolvedInventoryItemIds: z.array(StableIdSchema),
  requestCoverage: CanonicalRequestCoverageSchema,
  componentManifest: CurrentComponentManifestSchema,
  semanticProvenance: SemanticAttemptProvenanceSchema,
  lastVerifiedHashes: LastVerifiedHashesSchema
}).strict().superRefine((source, context) => {
  if (!InventoryRealizationLedgerSchema.safeParse(
    source.inventoryRealization,
  ).success) {
    return;
  }
  const expectedSatisfiedRequirementIds = uniqueSorted(
    source.requirementRealization.records.flatMap((record) =>
      record.state === "realized" || record.state === "conflict-resolved"
        ? [record.requirementId]
        : []
    ),
  );
  const expectedSimplifiedRequirementIds = uniqueSorted(
    source.requirementRealization.records.flatMap((record) =>
      record.state === "simplified" ? [record.requirementId] : []
    ),
  );
  const expectedConflictingInventoryItemIds = uniqueSorted(
    source.interpretation.inventory.relationships.flatMap((relationship) =>
      relationship.kind === "contradicts"
        ? [relationship.fromItemId, relationship.toItemId]
        : []
    ),
  );
  const expectedUnresolvedInventoryItemIds = uniqueSorted(
    source.interpretation.projection.accounting.flatMap((record) =>
      record.state === "unbound" || record.state === "uncertain"
        ? [record.itemId]
        : []
    ),
  );
  for (const exact of [
    {
      actual: source.satisfiedRequirementIds,
      expected: expectedSatisfiedRequirementIds,
      label: "Satisfied requirement"
    },
    {
      actual: source.simplifiedRequirementIds,
      expected: expectedSimplifiedRequirementIds,
      label: "Simplified requirement"
    },
    {
      actual: source.conflictingInventoryItemIds,
      expected: expectedConflictingInventoryItemIds,
      label: "Conflicting inventory item"
    },
    {
      actual: source.unresolvedInventoryItemIds,
      expected: expectedUnresolvedInventoryItemIds,
      label: "Unresolved inventory item"
    }
  ]) {
    if (JSON.stringify(exact.actual) !== JSON.stringify(exact.expected)) {
      context.addIssue({
        code: "custom",
        message: `${exact.label} IDs must derive exactly from canonical evidence.`
      });
    }
  }
  try {
    planningProjectionForRetainedScope({
      interpretation: source.interpretation,
      decision: source.retainedScopeDecision,
      substitutionTrace: source.substitutionTrace
    });
  } catch {
    context.addIssue({
      code: "custom",
      message: "Retained-scope decision is not an authorized bounded candidate."
    });
  }
  if (source.substitutionTrace.appliedSubstitutions.length > 0) {
    const realizationById = new Map(
      source.requirementRealization.records.map((record) => [
        record.requirementId,
        record
      ]),
    );
    const baseApplications =
      source.substitutionTrace.appliedSubstitutions.map((application) => {
        const expectedPreEdgeMustRequirementIds = uniqueSorted(
          source.interpretation.projection.requirements.flatMap(
            (requirement) =>
              requirement.priority === "must" &&
              !application.derivedRequirementIds.includes(requirement.id)
                ? [requirement.id]
                : [],
          ),
        );
        if (
          JSON.stringify(application.preEdgeMustRequirementIds) !==
            JSON.stringify(expectedPreEdgeMustRequirementIds)
        ) {
          context.addIssue({
            code: "custom",
            message: "Substitution pre-edge must requirements must derive exactly from the interpretation."
          });
        }
        for (const requirementId of [
          ...application.preservedMustRequirementIds,
          ...application.derivedRequirementIds
        ]) {
          const realization = realizationById.get(requirementId);
          if (
            realization === undefined ||
            !["realized", "conflict-resolved"].includes(realization.state) ||
            realization.evidenceLinks.length === 0
          ) {
            context.addIssue({
              code: "custom",
              message: "Preserved and derived substitution requirements require positive realization evidence."
            });
          }
        }
        return {
          ...application,
          preEdgeMustRequirementIds: expectedPreEdgeMustRequirementIds,
          preservedMustRequirementIds: expectedPreEdgeMustRequirementIds,
          changedMustRequirementIds: [],
          omittedMustRequirementIds: [],
          relaxedPreservationObligations: []
        };
      });
    const baseTrace = SubstitutionSearchTraceSchema.safeParse({
      ...source.substitutionTrace,
      appliedSubstitutions: baseApplications
    });
    const expectedTrace = baseTrace.success
      ? normalizeSubstitutionTraceForRequirementRealization({
          interpretation: source.interpretation,
          trace: baseTrace.data,
          requirementRealization: source.requirementRealization,
          omittedRequirementIds:
            source.retainedScopeDecision.omittedRequirementIds
        })
      : null;
    if (
      expectedTrace === null ||
      JSON.stringify(expectedTrace.appliedSubstitutions) !==
        JSON.stringify(source.substitutionTrace.appliedSubstitutions)
    ) {
      context.addIssue({
        code: "custom",
        message: "Substitution requirement partitions and relaxed obligations must derive exactly from outcome evidence."
      });
    }
  }
  const includedSemanticIds = uniqueSorted(source.inventoryRealization.records.flatMap((record) =>
    record.realizationState === "realized" ? [record.itemId] : []
  ));
  const changedInventoryItemIds = uniqueSorted(source.inventoryRealization.records.flatMap((record) =>
    record.realizationState === "substituted" ||
      record.realizationState === "simplified" ||
      record.realizationState === "deferred"
      ? [record.itemId]
      : []
  ));
  const changedSemanticIds = uniqueSorted([
    ...source.simplifiedRequirementIds,
    ...changedInventoryItemIds
  ]);
  const requirementDisclosures = source.requirementRealization.records.flatMap((record) =>
    record.state === "simplified" && record.disclosure !== null ? [record.disclosure] : []
  );
  const changedInventoryDisclosures = source.inventoryRealization.records.flatMap((record) =>
    (record.realizationState === "substituted" ||
      record.realizationState === "simplified" ||
      record.realizationState === "deferred") &&
      record.disclosure !== null
      ? [record.disclosure]
      : []
  );
  const modifiedCoverage = modifiedCoverageFromInventoryRealization(source.inventoryRealization);
  const retainedOmissionIds =
    source.inventoryRealization.records.flatMap((record) =>
      record.reason === "DETERMINISTIC_RETAINED_SCOPE_OMISSION"
        ? [record.itemId]
        : []
    ).sort();
  if (
    JSON.stringify(retainedOmissionIds) !==
      JSON.stringify(source.retainedScopeDecision.omittedInventoryItemIds)
  ) {
    context.addIssue({
      code: "custom",
      message: "Retained-scope decision and deterministic omission realization must agree exactly."
    });
  }
  const omittedItemIdSet = new Set(
    source.retainedScopeDecision.omittedInventoryItemIds,
  );
  const omittedRequirementIds = source.interpretation.projection.requirements
    .flatMap((requirement) =>
      requirement.inventoryItemIds.every((itemId) =>
        omittedItemIdSet.has(itemId)
      )
        ? [requirement.id]
        : []
    ).sort();
  if (
    JSON.stringify(omittedRequirementIds) !==
      JSON.stringify(source.retainedScopeDecision.omittedRequirementIds)
  ) {
    context.addIssue({
      code: "custom",
      message: "Retained-scope omitted requirements must derive from exclusively omitted inventory owners."
    });
  }
  const expectedCoverage = source.requestCoverage.status === "modified" && modifiedCoverage !== null
    ? {
        includedSemanticIds: modifiedCoverage.includedSemanticIds,
        changedSemanticIds,
        omittedSemanticIds: modifiedCoverage.omittedSemanticIds,
        disclosures: [...requirementDisclosures, ...modifiedCoverage.inventoryDisclosures]
      }
    : {
        includedSemanticIds,
        changedSemanticIds,
        omittedSemanticIds: [],
        disclosures: [...requirementDisclosures, ...changedInventoryDisclosures]
      };
  if (source.requestCoverage.status === "complete" &&
      source.inventoryRealization.blockingItemIds.length > 0) {
    context.addIssue({
      code: "custom",
      message: "Complete request coverage cannot retain blocking inventory items."
    });
  }
  if (source.requestCoverage.status === "modified" && modifiedCoverage === null) {
    context.addIssue({
      code: "custom",
      message: "Modified request coverage requires an eligible registered substitution or unregistered-capability omission."
    });
  }
  const appliedAffectedIds = uniqueSorted(
    source.substitutionTrace.appliedSubstitutions.flatMap(
      (application) => application.affectedSemanticIds,
    ),
  );
  if (
    JSON.stringify(appliedAffectedIds) !==
      JSON.stringify(source.inventoryRealization.substitutedItemIds)
  ) {
    context.addIssue({
      code: "custom",
      message: "Substitution trace and substituted inventory realization must agree exactly."
    });
  }
  if (source.requestCoverage.status === "modified" &&
      !fabricationReleaseForMechanism(source.selectedPlan.topology.mechanism).exportAllowed) {
    context.addIssue({
      code: "custom",
      message: "Modified request coverage requires an export-authorized deterministic construction."
    });
  }
  if (JSON.stringify(source.requestCoverage.includedSemanticIds) !==
        JSON.stringify(expectedCoverage.includedSemanticIds) ||
      JSON.stringify(source.requestCoverage.changedSemanticIds) !==
        JSON.stringify(expectedCoverage.changedSemanticIds) ||
      JSON.stringify(source.requestCoverage.omittedSemanticIds) !==
        JSON.stringify(expectedCoverage.omittedSemanticIds) ||
      JSON.stringify(source.requestCoverage.disclosures) !==
        JSON.stringify(expectedCoverage.disclosures)) {
    context.addIssue({
      code: "custom",
      message: "Canonical request coverage must be derived exactly from realization evidence."
    });
  }
});

const CanonicalResultSummarySchema = z.object({
  sourceRecordHash: Sha256Schema,
  documentHash: Sha256Schema,
  geometryHash: Sha256Schema,
  projectionBundleHash: Sha256Schema,
  svgGroupHash: Sha256Schema,
  validationStatus: z.literal("pass"),
  fabricationCandidate: z.boolean(),
  exportAllowed: z.boolean(),
  physicalVerification: z.literal("required")
}).strict();

const GenerationResultBaseSchema = z.object({
  schemaVersion: z.literal(GENERATION_OUTCOME_VERSION),
  transportMode: z.enum(["fixture", "live"]),
  requestId: z.string().min(1).max(512),
  source: CanonicalGenerationSourceSchema,
  canonicalResult: CanonicalResultSummarySchema,
  findingCodes: z.array(StableFindingCodeSchema),
  fabricationCandidate: z.boolean(),
  exportAllowed: z.boolean()
});

export const GenerationOutcomeSchema = z.discriminatedUnion("kind", [
  GenerationResultBaseSchema.extend({
    kind: z.literal("supported"),
    changedSemanticIds: z.array(StableIdSchema).length(0),
    simplificationDisclosures: z.array(z.string()).length(0)
  }).strict(),
  GenerationResultBaseSchema.extend({
    kind: z.literal("simplified"),
    changedSemanticIds: z.array(StableIdSchema).min(1),
    simplificationDisclosures: z.array(z.string().min(1).max(900)).min(1)
  }).strict(),
  GenerationResultBaseSchema.extend({
    kind: z.literal("modified"),
    includedSemanticIds: z.array(StableIdSchema).min(1),
    changedSemanticIds: z.array(StableIdSchema),
    omittedSemanticIds: z.array(StableIdSchema),
    modificationDisclosures: z.array(z.string().min(1).max(900)).min(1),
    fabricationCandidate: z.literal(true),
    exportAllowed: z.literal(true)
  }).strict(),
  z.object({
    schemaVersion: z.literal(GENERATION_OUTCOME_VERSION),
    kind: z.literal("concept-only"),
    transportMode: z.enum(["fixture", "live"]),
    requestId: z.string().min(1).max(512),
    interpretation: SemanticInterpretationSchema,
    explicitSizing: ExplicitSizingConstraintsV1Schema,
    findings: z.array(ConstructionFindingV1Schema).min(1),
    findingCodes: z.array(StableFindingCodeSchema).min(1),
    unresolvedNeeds: z.array(z.string().min(1).max(900)),
    blockedRequirementIds: z.array(StableIdSchema),
    blockedInventoryItemIds: z.array(StableIdSchema),
    requirementRealization: RequirementRealizationLedgerV1Schema.nullable(),
    inventoryRealization: InventoryRealizationLedgerSchema,
    substitutionTrace: SubstitutionSearchTraceSchema,
    source: z.null(),
    canonicalResult: z.null(),
    fabricationCandidate: z.literal(false),
    exportAllowed: z.literal(false)
  }).strict(),
  z.object({
    schemaVersion: z.literal(GENERATION_OUTCOME_VERSION),
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
]).superRefine((value, context) => {
  if (value.kind !== "supported" && value.kind !== "simplified" && value.kind !== "modified") return;
  if (value.fabricationCandidate !== value.exportAllowed ||
      value.canonicalResult.fabricationCandidate !== value.fabricationCandidate ||
      value.canonicalResult.exportAllowed !== value.exportAllowed) {
    context.addIssue({ code: "custom", message: "Canonical and top-level fabrication authority must agree." });
  }
  if (value.kind !== "modified") {
    if (value.source.requestCoverage.status !== "complete") {
      context.addIssue({
        code: "custom",
        message: "Only modified outcomes may carry modified request coverage."
      });
    }
    return;
  }
  if (value.source.requestCoverage.status !== "modified") {
    context.addIssue({
      code: "custom",
      message: "Modified outcomes require modified canonical request coverage."
    });
    return;
  }
  if (!InventoryRealizationLedgerSchema.safeParse(
    value.source.inventoryRealization,
  ).success) {
    return;
  }
  const coverage = modifiedCoverageFromInventoryRealization(value.source.inventoryRealization);
  if (coverage === null) {
    context.addIssue({
      code: "custom",
      message: "Modified outcomes require a registered substitution or only essential unbound CAPABILITY_NOT_REGISTERED omissions."
    });
    return;
  }
  if (value.source.requirementRealization.unsupportedMustRequirementIds.length > 0 ||
      value.source.requirementRealization.unresolvedMustRequirementIds.length > 0) {
    context.addIssue({
      code: "custom",
      message: "Modified outcomes cannot omit unsupported or unresolved mandatory requirements."
    });
  }
  if (JSON.stringify(value.includedSemanticIds) !== JSON.stringify(coverage.includedSemanticIds) ||
      JSON.stringify(value.omittedSemanticIds) !== JSON.stringify(coverage.omittedSemanticIds) ||
      JSON.stringify(value.source.requestCoverage.includedSemanticIds) !== JSON.stringify(value.includedSemanticIds) ||
      JSON.stringify(value.source.requestCoverage.omittedSemanticIds) !== JSON.stringify(value.omittedSemanticIds)) {
    context.addIssue({
      code: "custom",
      message: "Modified outcome coverage must agree with the canonical inventory-realization ledger."
    });
  }
  const expectedChangedSemanticIds = uniqueSorted([
    ...value.source.simplifiedRequirementIds,
    ...coverage.changedInventoryItemIds
  ]);
  const requirementDisclosures = value.source.requirementRealization.records.flatMap((record) =>
    record.state === "simplified" && record.disclosure !== null ? [record.disclosure] : []
  );
  if (JSON.stringify(value.changedSemanticIds) !== JSON.stringify(expectedChangedSemanticIds) ||
      JSON.stringify(value.source.requestCoverage.changedSemanticIds) !== JSON.stringify(value.changedSemanticIds) ||
      JSON.stringify(value.modificationDisclosures) !== JSON.stringify([
        ...requirementDisclosures,
        ...coverage.inventoryDisclosures
      ]) ||
      JSON.stringify(value.source.requestCoverage.disclosures) !== JSON.stringify(value.modificationDisclosures)) {
    context.addIssue({
      code: "custom",
      message: "Modified outcome changes and disclosures must agree with deterministic realization evidence."
    });
  }
});

export type CurrentComponentManifest = z.infer<typeof CurrentComponentManifestSchema>;
export type CanonicalRequestCoverage = z.infer<typeof CanonicalRequestCoverageSchema>;
export type CanonicalGenerationSource = z.infer<typeof CanonicalGenerationSourceSchema>;
export type GenerationOutcome = z.infer<typeof GenerationOutcomeSchema>;
export type SemanticAttemptProvenance = z.infer<typeof SemanticAttemptProvenanceSchema>;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

type InventoryRealizationLedger = z.infer<typeof InventoryRealizationLedgerSchema>;

export function modifiedCoverageFromInventoryRealization(
  inventoryRealization: InventoryRealizationLedger,
): {
  includedSemanticIds: string[];
  changedInventoryItemIds: string[];
  omittedSemanticIds: string[];
  inventoryDisclosures: string[];
} | null {
  const ledger = InventoryRealizationLedgerSchema.parse(inventoryRealization);
  const recordById = new Map(ledger.records.map((record) => [record.itemId, record]));
  const omittedRecords = ledger.blockingItemIds.map((itemId) => recordById.get(itemId));
  if (omittedRecords.some((record) =>
    record?.importance !== "essential" ||
    record.realizationState !== "unsupported" ||
    !(
      (
        record.accountingState === "unbound" &&
        record.reason === "CAPABILITY_NOT_REGISTERED"
      ) ||
      record.reason === "DETERMINISTIC_RETAINED_SCOPE_OMISSION"
    )
  )) {
    return null;
  }
  const changedRecords = ledger.records.filter((record) =>
    record.realizationState === "substituted" ||
    record.realizationState === "simplified" ||
    record.realizationState === "deferred"
  );
  const hasRegisteredSubstitution = changedRecords.some((record) =>
    record.realizationState === "substituted"
  );
  if (omittedRecords.length === 0 && !hasRegisteredSubstitution) return null;
  const includedSemanticIds = uniqueSorted(ledger.records.flatMap((record) =>
    record.realizationState === "realized" ? [record.itemId] : []
  ));
  if (includedSemanticIds.length === 0) return null;
  return {
    includedSemanticIds,
    changedInventoryItemIds: uniqueSorted(changedRecords.map((record) => record.itemId)),
    omittedSemanticIds: uniqueSorted(omittedRecords.flatMap((record) =>
      record === undefined ? [] : [record.itemId]
    )),
    inventoryDisclosures: [
      ...changedRecords.flatMap((record) => record.disclosure === null ? [] : [record.disclosure]),
      ...omittedRecords.flatMap((record) =>
        record?.disclosure === null || record?.disclosure === undefined ? [] : [record.disclosure]
      )
    ]
  };
}

function semanticFindingCodes(input: {
  interpretation: SemanticInterpretation;
  explicitSizing: ExplicitSizingConstraintsV1;
  selectedSizing?: z.infer<typeof SizingDecisionV1Schema>;
}): string[] {
  return uniqueSorted([
    ...input.explicitSizing.findings.map((item) => item.code),
    ...input.interpretation.inventory.relationships.flatMap((item) =>
      item.kind === "contradicts" && item.resolution !== "unresolved"
        ? ["SEMANTIC_EVIDENCE_CONFLICT_RESOLVED"]
        : []
    ),
    ...(input.selectedSizing?.scaleNormalizations.flatMap((item) =>
      item.findingCode === null ? [] : [item.findingCode]
    ) ?? []),
    ...(input.selectedSizing?.supportEngagement.used === true
      ? ["SUPPORTED_OBJECT_PARTIAL_ENGAGEMENT_APPLIED"]
      : [])
  ]);
}

export async function currentComponentManifest(): Promise<CurrentComponentManifest> {
  const provisional = {
    schemaVersion: "1.0" as const,
    semanticInterpretationSchemaVersion: CURRENT_SEMANTIC_INTERPRETATION_SCHEMA_VERSION,
    semanticAtomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    semanticAtomTemplateRegistryHash: await semanticAtomTemplateRegistryHash(),
    semanticBoundaryReconciliationPolicyVersion: SEMANTIC_BOUNDARY_RECONCILIATION_POLICY_VERSION,
    evidenceBoundMeasurementPolicyVersion: EVIDENCE_BOUND_MEASUREMENT_POLICY_VERSION,
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
    capabilityCatalogHash: await hashCanonical(CAPABILITY_CATALOG),
    requirementRealizationPolicyVersion: REQUIREMENT_REALIZATION_POLICY_VERSION,
    inventoryRealizationPolicyVersion: INVENTORY_REALIZATION_POLICY_VERSION,
    retainedScopePolicyVersion: CURRENT_RETAINED_SCOPE_POLICY_VERSION,
    retainedScopePolicyHash: await retainedScopePolicyHash(),
    unsupportedSemanticSignatureRegistryVersion:
      CURRENT_UNSUPPORTED_SEMANTIC_SIGNATURE_REGISTRY_VERSION,
    unsupportedSemanticSignatureRegistryHash:
      await unsupportedSemanticSignatureRegistryHash(),
    substitutionGraphVersion: CURRENT_SUBSTITUTION_GRAPH_VERSION,
    substitutionGraphRegistryHash: await substitutionGraphRegistryHash(),
    operatorRegistryHash: await hashCanonical(REGISTERED_OPERATORS),
    compilerVersion: CURRENT_CONSTRUCTION_COMPILER_VERSION,
    validatorVersion: CURRENT_CONSTRUCTION_VALIDATOR_VERSION,
    generatorVersion: GENERATOR_VERSION
  };
  return CurrentComponentManifestSchema.parse({
    ...provisional,
    manifestHash: await hashCanonical(provisional)
  });
}

function summarizeCandidate(candidate: PlanningCandidateRecordV1): z.infer<typeof CandidateEvidenceSummarySchema> {
  return CandidateEvidenceSummarySchema.parse({
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

type ProvenanceInput = {
  semanticRequestDigest: string;
  sourceEvidenceIndexDigest: string;
  promptIdentity: string;
  promptHash: string;
  modelId: string;
  providerModelId?: string | null;
  providerResponseId?: string | null;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  imageDetailPolicy?: "low" | "high" | "auto" | "mixed-first-high";
  promptLayoutVersion?: "stable-prefix-current-v5";
  modelConfigurationHash?: string;
  cacheResult: "miss" | "hit" | "singleflight-hit";
  attemptId: string | null;
  providerRequestId: string | null;
  providerFinishState?: "completed" | "incomplete" | "failed" | "cancelled" | "unknown" | "not-observed";
  providerUsage?: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteInputTokens: number;
    reasoningTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
  providerLatencyMs?: number | null;
  estimatedCostUsd?: number | null;
  requestBudgetUpperBoundUsd?: number | null;
  priceSnapshotId?: string | null;
};

async function provenance(input: ProvenanceInput): Promise<SemanticAttemptProvenance> {
  return SemanticAttemptProvenanceSchema.parse({
    semanticRequestDigest: input.semanticRequestDigest,
    sourceEvidenceIndexDigest: input.sourceEvidenceIndexDigest,
    promptIdentity: input.promptIdentity,
    promptHash: input.promptHash,
    modelId: input.modelId,
    providerModelId: input.providerModelId ?? null,
    providerResponseId: input.providerResponseId ?? null,
    reasoningEffort: input.reasoningEffort ?? "medium",
    imageDetailPolicy: input.imageDetailPolicy ?? "low",
    promptLayoutVersion: input.promptLayoutVersion ?? "stable-prefix-current-v5",
    modelConfigurationHash: input.modelConfigurationHash ?? await hashCanonical({
      modelId: input.modelId,
      reasoningEffort: input.reasoningEffort ?? "medium",
      imageDetailPolicy: input.imageDetailPolicy ?? "low",
      promptLayoutVersion: input.promptLayoutVersion ?? "stable-prefix-current-v5"
    }),
    cacheResult: input.cacheResult,
    attemptId: input.attemptId,
    providerRequestId: input.providerRequestId,
    providerFinishState: input.providerFinishState ?? "not-observed",
    providerUsage: input.providerUsage ?? null,
    providerLatencyMs: input.providerLatencyMs ?? null,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    requestBudgetUpperBoundUsd: input.requestBudgetUpperBoundUsd ?? null,
    priceSnapshotId: input.priceSnapshotId ?? null,
    semanticCallCount: 1
  });
}

function conceptFindings(
  inventoryRealization: z.infer<typeof InventoryRealizationLedgerSchema>,
) {
  const recordById = new Map(inventoryRealization.records.map((record) => [record.itemId, record]));
  return inventoryRealization.blockingItemIds.map((itemId) => {
    const record = recordById.get(itemId)!;
    return ConstructionFindingV1Schema.parse({
      code: record.realizationState === "uncertain"
        ? "ESSENTIAL_SEMANTIC_ITEM_UNCERTAIN"
        : "ESSENTIAL_SEMANTIC_ITEM_UNBOUND",
      phase: "semantic",
      blocking: true,
      relatedSemanticIds: [itemId],
      relatedConstraintIds: [],
      candidateId: null,
      message: (record.disclosure ?? `Essential semantic item ${itemId} is not bound.`).slice(0, 500)
    });
  });
}

export function generationConceptOnlyFromInterpretation(input: {
  requestId: string;
  transportMode: "fixture" | "live";
  interpretation: SemanticInterpretation;
  explicitSizing: ExplicitSizingConstraintsV1;
  planningFindings?: readonly z.infer<typeof ConstructionFindingV1Schema>[];
  blockedRequirementIds?: readonly string[];
  requirementRealization?: z.infer<typeof RequirementRealizationLedgerV1Schema>;
  substitutionTrace?: SubstitutionSearchTrace;
  retainedScopeDecision?: RetainedScopeDecision;
}): GenerationOutcome {
  const interpretation = SemanticInterpretationSchema.parse(input.interpretation);
  const requirementRealization = input.requirementRealization === undefined
    ? evaluateUnplannedRequirementRealization({ projection: interpretation.projection })
    : RequirementRealizationLedgerV1Schema.parse(input.requirementRealization);
  const substitutionTrace = input.substitutionTrace ??
    initialSubstitutionSearchTrace(interpretation);
  const retainedScopeDecision = input.retainedScopeDecision ??
    initialRetainedScopeDecision();
  const inventoryRealization = evaluateInventoryRealization({
    interpretation,
    requirementRealization,
    substitutionTrace,
    retainedScopeDecision
  });
  const semanticFindings = conceptFindings(inventoryRealization);
  const findings = [...(input.planningFindings ?? []), ...semanticFindings];
  if (findings.length === 0) throw new Error("CONCEPT_ONLY_REQUIRES_FINDING");
  return GenerationOutcomeSchema.parse({
    schemaVersion: GENERATION_OUTCOME_VERSION,
    kind: "concept-only",
    transportMode: input.transportMode,
    requestId: input.requestId,
    interpretation,
    explicitSizing: input.explicitSizing,
    findings,
    findingCodes: uniqueSorted([
      ...semanticFindingCodes({ interpretation, explicitSizing: input.explicitSizing }),
      ...findings.map((item) => item.code)
    ]),
    unresolvedNeeds: inventoryRealization.records.flatMap((record) =>
      record.importance === "essential" && ["unsupported", "uncertain"].includes(record.realizationState) && record.disclosure !== null
        ? [record.disclosure]
        : []
    ),
    blockedRequirementIds: uniqueSorted([
      ...(input.blockedRequirementIds ?? []),
      ...requirementRealization.unsupportedMustRequirementIds,
      ...requirementRealization.unresolvedMustRequirementIds
    ]),
    blockedInventoryItemIds: inventoryRealization.blockingItemIds,
    requirementRealization,
    inventoryRealization,
    substitutionTrace,
    source: null,
    canonicalResult: null,
    fabricationCandidate: false,
    exportAllowed: false
  });
}

export async function generationOutcomeFromPlanner(input: ProvenanceInput & {
  requestId: string;
  transportMode: "fixture" | "live";
  interpretation: SemanticInterpretation;
  explicitSizing: ExplicitSizingConstraintsV1;
  planning: ConstructionPlannerOutcomeV1;
  substitutionTrace?: SubstitutionSearchTrace;
  retainedScopeDecision?: RetainedScopeDecision;
}): Promise<GenerationOutcome> {
  const interpretation = SemanticInterpretationSchema.parse(input.interpretation);
  const substitutionTrace = input.substitutionTrace ??
    initialSubstitutionSearchTrace(interpretation);
  const retainedScopeDecision = input.retainedScopeDecision ??
    initialRetainedScopeDecision();
  const explicitSizing = ExplicitSizingConstraintsV1Schema.parse(input.explicitSizing);
  if (input.planning.kind === "failure") {
    return generationFailure({
      requestId: input.requestId,
      transportMode: input.transportMode,
      semanticRequestDigest: input.semanticRequestDigest,
      stage: "planning",
      code: input.planning.failureCode,
      retryable: false,
      attemptId: input.attemptId
    });
  }
  if (input.planning.kind === "concept-only") {
    return generationConceptOnlyFromInterpretation({
      requestId: input.requestId,
      transportMode: input.transportMode,
      interpretation,
      explicitSizing,
      planningFindings: input.planning.findings,
      blockedRequirementIds: input.planning.blockedRequirementIds,
      substitutionTrace,
      retainedScopeDecision
    });
  }
  const selected = input.planning.selected;
  if (selected.plan === null || selected.compiled === null || selected.sizing.kind !== "solved") {
    throw new Error("GENERATION_OUTCOME_SELECTED_CANDIDATE_INCOMPLETE");
  }
  const compiled = selected.compiled.compiled;
  if (compiled.document.validation.status !== "pass" ||
      selected.compiled.importComplexity.some((item) => !item.withinCurrentLimit)) {
    throw new Error("GENERATION_OUTCOME_SELECTED_CANDIDATE_NOT_EXPORTABLE");
  }
  const verified = LastVerifiedHashesSchema.parse({
    documentHash: await hashCanonical(compiled.document),
    geometryHash: compiled.geometryHash,
    projectionBundleHash: await hashCanonical(compiled.bundle),
    svgGroupHash: await hashCanonical(compiled.svgs.map((item) => ({ sheetId: item.sheetId, sha256: item.sha256 })))
  });
  const requirementRealization = selected.compiled.requirementRealization;
  const inventoryRealization = evaluateInventoryRealization({
    interpretation,
    requirementRealization,
    substitutionTrace,
    retainedScopeDecision
  });
  const unsupportedMustIds = uniqueSorted([
    ...requirementRealization.unsupportedMustRequirementIds,
    ...requirementRealization.unresolvedMustRequirementIds
  ]);
  if (unsupportedMustIds.length > 0) {
    const requirementFindings = unsupportedMustIds.map((requirementId) => ConstructionFindingV1Schema.parse({
      code: "MANDATORY_REQUIREMENT_REALIZATION_MISSING",
      phase: "validate",
      blocking: true,
      relatedSemanticIds: [requirementId],
      relatedConstraintIds: [],
      candidateId: selected.candidateId,
      message: `Mandatory requirement ${requirementId} has no deterministic realization evidence.`
    }));
    return generationConceptOnlyFromInterpretation({
      requestId: input.requestId,
      transportMode: input.transportMode,
      interpretation,
      explicitSizing,
      planningFindings: requirementFindings,
      blockedRequirementIds: unsupportedMustIds,
      requirementRealization,
      substitutionTrace,
      retainedScopeDecision
    });
  }
  const modifiedCoverage = modifiedCoverageFromInventoryRealization(inventoryRealization);
  if (inventoryRealization.blockingItemIds.length > 0 && modifiedCoverage === null) {
    return generationConceptOnlyFromInterpretation({
      requestId: input.requestId,
      transportMode: input.transportMode,
      interpretation,
      explicitSizing,
      requirementRealization,
      substitutionTrace,
      retainedScopeDecision
    });
  }
  const release = fabricationReleaseForMechanism(selected.plan.topology.mechanism);
  if (modifiedCoverage !== null && !release.exportAllowed) {
    const releaseFinding = ConstructionFindingV1Schema.parse({
      code: release.findingCode,
      phase: "validate",
      blocking: true,
      relatedSemanticIds: uniqueSorted([
        ...modifiedCoverage.changedInventoryItemIds,
        ...modifiedCoverage.omittedSemanticIds
      ]),
      relatedConstraintIds: [],
      candidateId: selected.candidateId,
      message: release.reason
    });
    return generationConceptOnlyFromInterpretation({
      requestId: input.requestId,
      transportMode: input.transportMode,
      interpretation,
      explicitSizing,
      planningFindings: [releaseFinding],
      requirementRealization,
      substitutionTrace,
      retainedScopeDecision
    });
  }

  const simplifiedRequirementIds = uniqueSorted(requirementRealization.records.filter((item) =>
    item.state === "simplified"
  ).map((item) => item.requirementId));
  const conflictingInventoryItemIds = uniqueSorted(interpretation.inventory.relationships.flatMap((item) =>
    item.kind === "contradicts" ? [item.fromItemId, item.toItemId] : []
  ));
  const requirementSimplifications = requirementRealization.records.filter((item) => item.state === "simplified");
  const inventoryDisclosures = inventoryRealization.records.filter((item) =>
    item.realizationState === "substituted" ||
    item.realizationState === "simplified" ||
    item.realizationState === "deferred"
  );
  const changedSemanticIds = uniqueSorted([
    ...simplifiedRequirementIds,
    ...inventoryDisclosures.map((item) => item.itemId)
  ]);
  const includedSemanticIds = modifiedCoverage?.includedSemanticIds ?? uniqueSorted(
    inventoryRealization.records.flatMap((record) =>
      record.realizationState === "realized" ? [record.itemId] : []
    )
  );
  const requestDisclosures = [
    ...requirementSimplifications.flatMap((item) => item.disclosure === null ? [] : [item.disclosure]),
    ...(modifiedCoverage?.inventoryDisclosures ??
      inventoryDisclosures.flatMap((item) => item.disclosure === null ? [] : [item.disclosure]))
  ];
  const requestCoverage = CanonicalRequestCoverageSchema.parse(modifiedCoverage === null ? {
    status: "complete",
    includedSemanticIds,
    changedSemanticIds,
    omittedSemanticIds: [],
    disclosures: requestDisclosures
  } : {
    status: "modified",
    includedSemanticIds,
    changedSemanticIds,
    omittedSemanticIds: modifiedCoverage.omittedSemanticIds,
    disclosures: requestDisclosures
  });
  const source = CanonicalGenerationSourceSchema.parse({
    schemaVersion: "5.0",
    interpretation,
    explicitSizing,
    selectedSizing: selected.sizing,
    selectedPlan: selected.plan,
    candidateEvidence: input.planning.candidates.map(summarizeCandidate),
    requirementRealization,
    inventoryRealization,
    retainedScopeDecision,
    substitutionTrace,
    satisfiedRequirementIds: uniqueSorted(requirementRealization.records.filter((item) =>
      item.state === "realized" || item.state === "conflict-resolved"
    ).map((item) => item.requirementId)),
    simplifiedRequirementIds,
    conflictingInventoryItemIds,
    unresolvedInventoryItemIds: uniqueSorted(interpretation.projection.accounting.flatMap((item) =>
      item.state === "unbound" || item.state === "uncertain" ? [item.itemId] : []
    )),
    requestCoverage,
    componentManifest: await currentComponentManifest(),
    semanticProvenance: await provenance(input),
    lastVerifiedHashes: verified
  });
  const canonicalResult = CanonicalResultSummarySchema.parse({
    sourceRecordHash: await hashCanonical(source),
    ...verified,
    validationStatus: "pass",
    fabricationCandidate: release.exportAllowed,
    exportAllowed: release.exportAllowed,
    physicalVerification: "required"
  });
  const findingCodes = uniqueSorted([
    ...semanticFindingCodes({ interpretation, explicitSizing, selectedSizing: selected.sizing }),
    ...input.planning.findings.map((item) => item.code),
    ...(modifiedCoverage === null
      ? []
      : retainedScopeDecision.omittedInventoryItemIds.length > 0
        ? ["MODIFIED_OUTPUT_OMITS_REJECTED_FEATURE"]
        : modifiedCoverage.omittedSemanticIds.length > 0
          ? ["MODIFIED_OUTPUT_OMITS_UNREGISTERED_CAPABILITY"]
        : ["MODIFIED_OUTPUT_USES_REGISTERED_SUBSTITUTION"]),
    ...(release.findingCode === null ? [] : [release.findingCode])
  ]);
  if (modifiedCoverage !== null) {
    return GenerationOutcomeSchema.parse({
      schemaVersion: GENERATION_OUTCOME_VERSION,
      kind: "modified",
      transportMode: input.transportMode,
      requestId: input.requestId,
      source,
      canonicalResult,
      findingCodes,
      includedSemanticIds: modifiedCoverage.includedSemanticIds,
      changedSemanticIds,
      omittedSemanticIds: modifiedCoverage.omittedSemanticIds,
      modificationDisclosures: requestDisclosures,
      fabricationCandidate: release.exportAllowed,
      exportAllowed: release.exportAllowed
    });
  }
  return GenerationOutcomeSchema.parse({
    schemaVersion: GENERATION_OUTCOME_VERSION,
    kind: changedSemanticIds.length === 0 ? "supported" : "simplified",
    transportMode: input.transportMode,
    requestId: input.requestId,
    source,
    canonicalResult,
    findingCodes,
    changedSemanticIds,
    simplificationDisclosures: [
      ...requirementSimplifications.flatMap((item) => item.disclosure === null ? [] : [item.disclosure]),
      ...inventoryDisclosures.flatMap((item) => item.disclosure === null ? [] : [item.disclosure])
    ],
    fabricationCandidate: release.exportAllowed,
    exportAllowed: release.exportAllowed
  });
}

export function generationFailure(input: {
  requestId: string;
  transportMode: "fixture" | "live";
  semanticRequestDigest: string;
  stage: "input" | "transport" | "schema" | "interpretation" | "planning" | "compilation" | "validation" | "persistence";
  code: string;
  retryable: boolean;
  attemptId: string | null;
}): GenerationOutcome {
  return GenerationOutcomeSchema.parse({
    schemaVersion: GENERATION_OUTCOME_VERSION,
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
