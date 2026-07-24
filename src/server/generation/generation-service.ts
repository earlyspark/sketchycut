import { sha256, hashCanonical } from "../../domain/hash.js";
import { planIntentConditionedConstruction } from "../../interpretation/construction-planner.js";
import { buildCurrentFixtureInterpretation, findCurrentFixtureReplay } from "../../interpretation/current-fixture-corpus.js";
import { reconcileExplicitSizingConstraints } from "../../interpretation/explicit-sizing.js";
import {
  generationConceptOnlyFromInterpretation,
  generationFailure,
  generationOutcomeFromPlanner,
  type GenerationOutcome
} from "../../interpretation/generation-outcome.js";
import type { GenerationSubmission } from "../../interpretation/generation-submission.js";
import {
  authorizeSemanticInterpretation,
  type SemanticInterpretationCandidate
} from "../../interpretation/semantic-model-contract.js";
import type {
  ClosedSemanticProjection,
  SemanticInterpretation
} from "../../interpretation/semantic-interpretation.js";
import { reconcileSemanticInterpretationBoundary } from "../../interpretation/semantic-boundary-reconciliation.js";
import type {
  LiveCallAttempt,
  LiveCallRuntimeOrigin
} from "../../interpretation/live-ledger.js";
import { CurrentSemanticOrchestrator } from "../../interpretation/orchestrator.js";
import {
  CURRENT_SEMANTIC_CACHE_VALUE_VERSION,
  type CachedSemanticValue,
  type SemanticCache
} from "../../interpretation/semantic-cache.js";
import {
  CURRENT_PROMPT_IDENTITY,
  prepareSemanticGenerationRequest,
  semanticRequestDigest,
  type PreparedSemanticGenerationRequest,
  type SemanticGenerationRequest
} from "../../interpretation/semantic-request.js";
import type { SemanticInterpretationTransport } from "../../interpretation/semantic-transport.js";
import { bindEvidenceMeasurements } from "../../interpretation/measurement-binding.js";
import { resolveGeneratedFabricationControls } from "../../interpretation/generated-fabrication.js";
import { CurrentGenerationResponseSchema, type CurrentGenerationResponse } from "./api-contracts.js";
import type { RuntimeConfig } from "./config.js";
import type { GenerationStore } from "./contracts.js";
import { GENERATION_OPENAI_MODEL, GENERATION_OPENAI_PRICE } from "./cost-envelope.js";
import {
  CURRENT_IMAGE_DETAIL_POLICY,
  CURRENT_PROMPT_LAYOUT_VERSION,
  CURRENT_REASONING_EFFORT,
  SemanticModelConfigurationSchema,
  type SemanticModelConfiguration
} from "../../interpretation/semantic-input-contracts.js";
import { instructionsForPromptLayout } from "./semantic-interpretation-prompt.js";
import { DurableSemanticCache } from "./durable-semantic-cache.js";
import type { AuthenticatedRequest } from "./http-security.js";
import {
  compiledFromCurrentPlanning,
  createCurrentPersistedProject
} from "./project-persistence.js";
import { QuotaTransport } from "./quota-transport.js";
import { ConstructionFindingV1Schema } from "../../interpretation/construction-contracts.js";
import {
  initialSubstitutionSearchTrace,
  normalizeSubstitutionTraceForRequirementRealization,
  prepareFirstRegisteredSubstitution,
  refusedPostPipelineSubstitutionTrace,
  substitutionTraceForRetainedScope,
  type SubstitutionSearchTrace
} from "../../interpretation/substitution-graph.js";
import {
  enumerateRetainedScopeCandidates,
  initialRetainedScopeDecision,
  type RetainedScopeCandidate,
  type RetainedScopeDecision
} from "../../interpretation/retained-scope.js";

async function deterministicOutcome(input: {
  submission: Pick<
    GenerationSubmission,
    "deterministicControls" | "fabricationControls"
  >;
  prepared: PreparedSemanticGenerationRequest;
  request: SemanticGenerationRequest;
  interpretation: SemanticInterpretation;
  cacheResult: "miss" | "hit" | "singleflight-hit";
  attemptId: string | null;
  providerRequestId: string | null;
  providerProvenance: CachedSemanticValue["provenance"];
  transportMode: "fixture" | "live";
  requestId: string;
}) {
  const boundary = reconcileSemanticInterpretationBoundary({
    interpretation: input.interpretation,
    sourceEvidenceIndex: input.request.sourceEvidenceIndex
  });
  if (boundary.findings.length > 0) {
    throw new Error(`SEMANTIC_BOUNDARY_AUTHORIZATION_FAILED:${boundary.findings[0]!.code}`);
  }
  const interpretation = boundary.interpretation;
  const measurements = bindEvidenceMeasurements({
    semanticBrief: input.request.semanticBrief,
    sourceEvidenceIndex: input.request.sourceEvidenceIndex,
    interpretation
  });
  const explicitSizing = await reconcileExplicitSizingConstraints({
    advancedSizing: input.submission.deterministicControls.advancedSizing,
    parsedConstraints: measurements.parsedConstraints,
    parserFindings: measurements.parserFindings
  });
  if (measurements.blockingInventoryItemIds.length > 0) {
    const findings = measurements.blockingInventoryItemIds.map((itemId) =>
      ConstructionFindingV1Schema.parse({
        code: "ESSENTIAL_SEMANTIC_ITEM_UNCERTAIN",
        phase: "semantic",
        blocking: true,
        relatedSemanticIds: [itemId],
        relatedConstraintIds: [],
        candidateId: null,
        message: `The exact measurement associated with inventory item ${itemId} could not be verified from its unchanged source literal.`
      })
    );
    return {
      outcome: generationConceptOnlyFromInterpretation({
        requestId: input.requestId,
        transportMode: input.transportMode,
        interpretation,
        explicitSizing,
        planningFindings: findings
      }),
      compiled: null
    };
  }
  const fabrication = resolveGeneratedFabricationControls(input.submission.fabricationControls);
  const planAndProject = async (
    candidateInterpretation: SemanticInterpretation,
    substitutionTrace: SubstitutionSearchTrace,
    retainedScopeCandidate?: RetainedScopeCandidate,
  ) => {
    const retainedScopeDecision =
      retainedScopeCandidate?.decision ?? initialRetainedScopeDecision();
    const planningProjection: ClosedSemanticProjection =
      retainedScopeCandidate?.planningProjection ??
      candidateInterpretation.projection;
    const omittedItemIds = new Set(
      retainedScopeDecision.omittedInventoryItemIds,
    );
    const omitsEssentialItem = candidateInterpretation.inventory.items.some(
      (item) =>
        item.importance === "essential" && omittedItemIds.has(item.id),
    );
    const deterministicScopeOutcome =
      substitutionTrace.appliedSubstitutions.length > 0 ||
      omitsEssentialItem
        ? "modified" as const
        : retainedScopeDecision.omittedInventoryItemIds.length > 0
          ? "simplified" as const
          : null;
    const deterministicScopeDisclosures = [
      ...substitutionTrace.appliedSubstitutions.map(
        (application) => application.disclosure,
      ),
      ...retainedScopeDecision.disclosures.map(
        (disclosure) => disclosure.message,
      )
    ];
    const planning = await planIntentConditionedConstruction({
      projection: planningProjection,
      explicitConstraints: explicitSizing,
      profiles: fabrication.profiles,
      inputPolicyEvaluation: fabrication.inputPolicyEvaluation,
      pin: fabrication.pin,
      motifPlacement: input.submission.deterministicControls.motifPlacement,
      semanticProvenance: {
        modelId: input.request.modelConfiguration.modelId,
        promptIdentity: input.request.promptIdentity,
        promptHash: input.request.promptHash,
        semanticRequestDigest: input.prepared.requestDigest,
        runtimeApplicationApiCalls:
          input.transportMode === "live" && input.cacheResult === "miss"
            ? 1
            : 0,
        deterministicScopeOutcome,
        deterministicScopeDisclosures
      }
    });
    let effectiveTrace = substitutionTrace;
    let traceValid = true;
    if (
      effectiveTrace.appliedSubstitutions.length > 0 &&
      planning.kind === "planned" &&
      planning.selected.compiled !== null
    ) {
      const normalizedTrace =
        normalizeSubstitutionTraceForRequirementRealization({
          interpretation: candidateInterpretation,
          trace: effectiveTrace,
          requirementRealization:
            planning.selected.compiled.requirementRealization,
          omittedRequirementIds: retainedScopeDecision.omittedRequirementIds
        });
      if (normalizedTrace === null) {
        traceValid = false;
      } else {
        effectiveTrace = normalizedTrace;
      }
    }
    const outcome = await generationOutcomeFromPlanner({
        requestId: input.requestId,
        transportMode: input.transportMode,
        semanticRequestDigest: input.prepared.requestDigest,
        sourceEvidenceIndexDigest: input.prepared.sourceEvidenceIndex.digest,
        promptIdentity: input.request.promptIdentity,
        promptHash: input.request.promptHash,
        modelId: input.request.modelConfiguration.modelId,
        providerModelId: input.providerProvenance.providerModelId,
        providerResponseId: input.providerProvenance.responseId,
        reasoningEffort: input.request.modelConfiguration.reasoningEffort,
        imageDetailPolicy: input.request.modelConfiguration.imageDetailPolicy,
        promptLayoutVersion: input.request.modelConfiguration.promptLayoutVersion,
        modelConfigurationHash: input.providerProvenance.modelConfigurationHash,
        cacheResult: input.cacheResult,
        attemptId: input.attemptId,
        providerRequestId: input.providerProvenance.providerRequestId,
        providerFinishState: input.providerProvenance.finishState,
        providerUsage: input.providerProvenance.usage,
        providerLatencyMs: input.providerProvenance.latencyMs,
        estimatedCostUsd: input.providerProvenance.estimatedCostUsd,
        requestBudgetUpperBoundUsd:
          input.providerProvenance.requestBudgetUpperBoundUsd,
        priceSnapshotId: input.providerProvenance.priceSnapshotId,
        interpretation: candidateInterpretation,
        explicitSizing,
        planning,
        substitutionTrace: effectiveTrace,
        retainedScopeDecision
      });
    return {
      planning,
      outcome,
      substitutionTrace: effectiveTrace,
      retainedScopeDecision,
      traceValid
    };
  };
  const planWithRetainedScope = async (
    candidateInterpretation: SemanticInterpretation,
    substitutionTrace: SubstitutionSearchTrace,
  ) => {
    const itemImportance = new Map(
      candidateInterpretation.inventory.items.map((item) =>
        [item.id, item.importance] as const
      ),
    );
    const unresolvedRetainedItemIds =
      candidateInterpretation.projection.accounting.flatMap((record) =>
        record.state !== "bound" &&
        itemImportance.get(record.itemId) !== "context"
          ? [record.itemId]
          : []
      );
    const complete = await planAndProject(
      candidateInterpretation,
      substitutionTrace,
    );
    if (
      complete.outcome.kind !== "concept-only" &&
      unresolvedRetainedItemIds.length === 0
    ) {
      return complete;
    }
    const retainedScopeEnumeration = enumerateRetainedScopeCandidates({
      interpretation: candidateInterpretation,
      substitutionTrace
    });
    const retainedScopeConcept = (
      code:
        | "RETAINED_SCOPE_DOMAIN_EXCEEDED"
        | "RETAINED_SCOPE_NO_COHERENT_CANDIDATE",
      relatedSemanticIds: string[],
    ) => ({
      ...complete,
      outcome: generationConceptOnlyFromInterpretation({
        requestId: input.requestId,
        transportMode: input.transportMode,
        interpretation: candidateInterpretation,
        explicitSizing,
        planningFindings: [ConstructionFindingV1Schema.parse({
          code,
          phase: "rank",
          blocking: true,
          relatedSemanticIds,
          relatedConstraintIds: [],
          candidateId: null,
          message: code === "RETAINED_SCOPE_DOMAIN_EXCEEDED"
            ? "The independently omittable semantic domain exceeds the registered complete retained-scope bound."
            : "No completely enumerated retained-scope candidate passed every deterministic construction and export gate."
        })],
        substitutionTrace
      })
    });
    if (retainedScopeEnumeration.kind === "fail-closed") {
      return retainedScopeConcept(
        "RETAINED_SCOPE_DOMAIN_EXCEEDED",
        retainedScopeEnumeration.eligibleItemIds,
      );
    }
    for (const candidate of retainedScopeEnumeration.candidates) {
      if (unresolvedRetainedItemIds.some((itemId) =>
        !candidate.decision.omittedInventoryItemIds.includes(itemId)
      )) {
        continue;
      }
      const candidateTrace = substitutionTraceForRetainedScope({
        interpretation: candidateInterpretation,
        trace: substitutionTrace,
        omittedRequirementIds: candidate.decision.omittedRequirementIds
      });
      if (candidateTrace === null) continue;
      const retained = await planAndProject(
        candidateInterpretation,
        candidateTrace,
        candidate,
      );
      if (
        retained.traceValid &&
        (
          retained.outcome.kind === "supported" ||
          retained.outcome.kind === "simplified" ||
          retained.outcome.kind === "modified"
        ) &&
        retained.outcome.exportAllowed
      ) {
        return retained;
      }
    }
    return complete.outcome.kind === "concept-only"
      ? complete
      : retainedScopeConcept(
          "RETAINED_SCOPE_NO_COHERENT_CANDIDATE",
          unresolvedRetainedItemIds,
        );
  };
  const initialTrace = initialSubstitutionSearchTrace(interpretation);
  const direct = await planWithRetainedScope(interpretation, initialTrace);
  const requirementRecords = (outcome: GenerationOutcome) =>
    outcome.kind === "supported" ||
    outcome.kind === "simplified" ||
    outcome.kind === "modified"
      ? outcome.source.requirementRealization.records
      : outcome.kind === "concept-only"
        ? outcome.requirementRealization?.records ?? []
        : [];
  const preservesPreEdgeMustRequirements = (
    substitutedOutcome: GenerationOutcome,
    trace: SubstitutionSearchTrace,
    retainedScopeDecision: RetainedScopeDecision,
  ): boolean => {
    const after = new Map(requirementRecords(substitutedOutcome).map((record) =>
      [record.requirementId, record] as const
    ));
    const changedCoverage = new Set(
      substitutedOutcome.kind === "supported" ||
      substitutedOutcome.kind === "simplified" ||
      substitutedOutcome.kind === "modified"
        ? substitutedOutcome.source.requestCoverage.changedSemanticIds
        : [],
    );
    const omittedRequirementIds = new Set(
      retainedScopeDecision.omittedRequirementIds,
    );
    return trace.appliedSubstitutions.every((application) =>
      application.preservedMustRequirementIds.every((requirementId) => {
        const next = after.get(requirementId);
        return next !== undefined &&
          (next.state === "realized" ||
            next.state === "conflict-resolved") &&
          next.evidenceLinks.length > 0;
      }) &&
      application.changedMustRequirementIds.every((requirementId) => {
        const next = after.get(requirementId);
        return next?.state === "simplified" &&
          next.disclosure !== null &&
          changedCoverage.has(requirementId);
      }) &&
      application.omittedMustRequirementIds.every((requirementId) =>
        omittedRequirementIds.has(requirementId)
      ) &&
      application.derivedRequirementIds.every((requirementId) => {
        const next = after.get(requirementId);
        return next !== undefined &&
          (next.state === "realized" ||
            next.state === "conflict-resolved") &&
          next.evidenceLinks.length > 0;
      })
    );
  };
  let selected = direct;
  if (
    initialTrace.selectedUnsupportedSignatureIds.length > 0 &&
    direct.outcome.kind !== "supported" &&
    direct.outcome.kind !== "simplified" &&
    direct.outcome.kind !== "failure"
  ) {
    const preparedSubstitution = prepareFirstRegisteredSubstitution({
      interpretation
    });
    if (preparedSubstitution.kind === "candidate") {
      const substituted = await planWithRetainedScope(
        preparedSubstitution.candidate.interpretation,
        preparedSubstitution.candidate.trace,
      );
      if (substituted.traceValid &&
          substituted.outcome.kind === "modified" &&
          preservesPreEdgeMustRequirements(
            substituted.outcome,
            substituted.substitutionTrace,
            substituted.retainedScopeDecision,
          )) {
        selected = substituted;
      } else {
        const refusedTrace = refusedPostPipelineSubstitutionTrace({
          candidate: preparedSubstitution.candidate,
          findingCode: "SUBSTITUTION_POST_PIPELINE_REJECTED"
        });
        selected = await planWithRetainedScope(interpretation, refusedTrace);
      }
    } else if (preparedSubstitution.kind === "refused") {
      selected = await planWithRetainedScope(
        interpretation,
        preparedSubstitution.trace,
      );
    }
  }
  const { outcome, planning } = selected;
  return {
    outcome,
    compiled: outcome.kind === "supported" || outcome.kind === "simplified" || outcome.kind === "modified"
      ? compiledFromCurrentPlanning(planning)
      : null
  };
}

export async function evaluatePatchedSemanticCandidateForEvaluation(input: {
  submission: GenerationSubmission;
  prepared: PreparedSemanticGenerationRequest;
  candidate: SemanticInterpretationCandidate;
  callAAttempt: LiveCallAttempt;
  requestId: string;
}) {
  if (
    input.callAAttempt.initiatedBy !== "live-eval" ||
    input.callAAttempt.outcome !== "completed" ||
    input.callAAttempt.usage.status !== "reported" ||
    input.callAAttempt.billing.state !== "confirmed-billed"
  ) {
    throw new Error("SEMANTIC_REVIEW_CALL_A_PROVENANCE_INVALID");
  }
  const authorization = authorizeSemanticInterpretation({
    interpretation: input.candidate,
    sourceEvidenceIndex: input.prepared.request.sourceEvidenceIndex
  });
  if (!authorization.success) {
    throw new Error("SEMANTIC_REVIEW_PATCHED_CANDIDATE_UNAUTHORIZED");
  }
  const request = input.prepared.request;
  return deterministicOutcome({
    submission: input.submission,
    prepared: input.prepared,
    request,
    interpretation: authorization.interpretation,
    cacheResult: "miss",
    attemptId: input.callAAttempt.attemptId,
    providerRequestId: input.callAAttempt.providerRequestId,
    providerProvenance: {
      modelId: request.modelConfiguration.modelId,
      providerModelId: input.callAAttempt.providerModelId,
      providerRequestId: input.callAAttempt.providerRequestId,
      modelConfigurationHash: input.callAAttempt.modelConfigurationHash,
      responseId: input.callAAttempt.responseId,
      finishState: input.callAAttempt.finishState,
      usage: {
        inputTokens: input.callAAttempt.usage.inputTokens,
        cachedInputTokens: input.callAAttempt.usage.cachedInputTokens,
        cacheWriteInputTokens:
          input.callAAttempt.usage.cacheWriteInputTokens,
        reasoningTokens: input.callAAttempt.usage.reasoningTokens,
        outputTokens: input.callAAttempt.usage.outputTokens,
        totalTokens: input.callAAttempt.usage.totalTokens
      },
      latencyMs: input.callAAttempt.latencyMs,
      estimatedCostUsd:
        input.callAAttempt.billing.estimatedCostUsd,
      requestBudgetUpperBoundUsd:
        input.callAAttempt.billing.requestBudgetUpperBoundUsd,
      priceSnapshotId: input.callAAttempt.billing.priceSnapshotId,
      outputDigest: await hashCanonical(authorization.candidate),
      promptIdentity: request.promptIdentity,
      promptHash: request.promptHash,
      semanticSchemaId: request.semanticSchemaId,
      atomTemplateVersion: request.atomTemplateVersion,
      capabilityCatalogVersion: request.capabilityCatalogVersion,
      unsupportedSemanticSignatureRegistryVersion:
        request.unsupportedSemanticSignatureRegistryVersion
    },
    transportMode: "live",
    requestId: input.requestId
  });
}

export async function evaluateSemanticCandidateForOfflineReplay(input: {
  controls: Pick<
    GenerationSubmission,
    "deterministicControls" | "fabricationControls"
  >;
  request: SemanticGenerationRequest;
  candidate: SemanticInterpretationCandidate;
  requestId: string;
}) {
  const request = input.request;
  const prepared: PreparedSemanticGenerationRequest = {
    request,
    requestDigest: await semanticRequestDigest(request),
    sourceEvidenceIndex: request.sourceEvidenceIndex
  };
  const authorization = authorizeSemanticInterpretation({
    interpretation: input.candidate,
    sourceEvidenceIndex: request.sourceEvidenceIndex
  });
  if (!authorization.success) {
    throw new Error("PRIVATE_REPLAY_CANDIDATE_UNAUTHORIZED");
  }
  const modelConfigurationHash = await hashCanonical(
    request.modelConfiguration,
  );
  return deterministicOutcome({
    submission: input.controls,
    prepared,
    request,
    interpretation: authorization.interpretation,
    cacheResult: "hit",
    attemptId: null,
    providerRequestId: null,
    providerProvenance: {
      modelId: request.modelConfiguration.modelId,
      providerModelId: null,
      providerRequestId: null,
      modelConfigurationHash,
      responseId: null,
      finishState: "not-observed",
      usage: null,
      latencyMs: null,
      estimatedCostUsd: null,
      requestBudgetUpperBoundUsd: null,
      priceSnapshotId: null,
      outputDigest: await hashCanonical(authorization.candidate),
      promptIdentity: request.promptIdentity,
      promptHash: request.promptHash,
      semanticSchemaId: request.semanticSchemaId,
      atomTemplateVersion: request.atomTemplateVersion,
      capabilityCatalogVersion: request.capabilityCatalogVersion,
      unsupportedSemanticSignatureRegistryVersion:
        request.unsupportedSemanticSignatureRegistryVersion
    },
    transportMode: "live",
    requestId: input.requestId
  });
}

export async function executeCurrentGeneration(input: {
  config: RuntimeConfig;
  authenticated: AuthenticatedRequest;
  submission: GenerationSubmission;
  store: GenerationStore;
  runtimeOrigin: LiveCallRuntimeOrigin;
  interpretationTransport?: SemanticInterpretationTransport;
  semanticCache?: SemanticCache;
  quotaClock?: () => number;
  initiatedBy?: "initial-submit" | "live-eval";
  promptHash?: string;
  evaluationModelConfiguration?: SemanticModelConfiguration;
  onSemanticCandidate?: (
    candidate: SemanticInterpretationCandidate,
    observation: {
      attemptId: string | null;
      cacheResult: "miss" | "hit" | "singleflight-hit";
    },
  ) => void | Promise<void>;
}): Promise<CurrentGenerationResponse> {
  const mode = input.config.generationMode;
  if (mode === "live" && input.promptHash === undefined) throw new Error("GENERATION_LIVE_PROMPT_HASH_MISSING");
  if (input.evaluationModelConfiguration !== undefined &&
      (mode !== "live" || input.initiatedBy !== "live-eval")) {
    throw new Error("GENERATION_EVALUATION_CONFIGURATION_FORBIDDEN");
  }
  if (input.onSemanticCandidate !== undefined && input.initiatedBy !== "live-eval") {
    throw new Error("GENERATION_SEMANTIC_CANDIDATE_OBSERVER_FORBIDDEN");
  }
  const modelConfiguration = SemanticModelConfigurationSchema.parse(
    input.evaluationModelConfiguration ?? {
      modelId: mode === "live" ? GENERATION_OPENAI_MODEL : "strict-current-fixture-interpretation",
      reasoningEffort: CURRENT_REASONING_EFFORT,
      imageDetailPolicy: CURRENT_IMAGE_DETAIL_POLICY,
      promptLayoutVersion: CURRENT_PROMPT_LAYOUT_VERSION,
      maxOutputTokens: 6_000,
      serviceTier: "default",
      store: false
    },
  );
  if (input.evaluationModelConfiguration !== undefined &&
      (modelConfiguration.modelId !== GENERATION_OPENAI_MODEL ||
       modelConfiguration.maxOutputTokens !== 6_000 ||
       modelConfiguration.serviceTier !== "default")) {
    throw new Error("GENERATION_EVALUATION_CONFIGURATION_OUTSIDE_FROZEN_ENVELOPE");
  }
  const promptHash = mode === "live" ? input.promptHash! : await sha256("current-fixture-semantic-transport");
  const prepared = await prepareSemanticGenerationRequest({
    brief: input.submission.brief,
    references: input.submission.references.map((item) => item.descriptor),
    roleConstraints: input.submission.roleConstraints,
    promptIdentity: CURRENT_PROMPT_IDENTITY,
    promptHash,
    modelConfiguration
  });
  const cache = input.semanticCache ?? new DurableSemanticCache({ store: input.store });
  let outcome: GenerationOutcome;
  let compiled: ReturnType<typeof compiledFromCurrentPlanning> | null = null;
  let runtimeApplicationApiCalls: 0 | 1 = 0;
  let retryContext: { priorAttemptId: string; retryChainId: string; attemptOrdinal: number } | null = null;
  if (mode === "fixture") {
    const scenario = findCurrentFixtureReplay(prepared.request.sourceEvidenceIndex.semanticBriefDigest);
    if (scenario === null) {
      outcome = generationFailure({
        requestId: `fixture-${crypto.randomUUID()}`, transportMode: "fixture",
        semanticRequestDigest: prepared.requestDigest, stage: "input", code: "FIXTURE_NOT_FOUND",
        retryable: false, attemptId: null
      });
    } else {
      try {
        const resolution = await cache.resolve(prepared.request, async (request) => {
          const authorization = authorizeSemanticInterpretation({
            interpretation: buildCurrentFixtureInterpretation(request, scenario),
            sourceEvidenceIndex: request.sourceEvidenceIndex
          });
          if (!authorization.success) {
            throw new Error(
              authorization.schemaIssues.length > 0
                ? "STRICT_SEMANTIC_SCHEMA_FAILURE"
                : "SEMANTIC_AUTHORIZATION_FAILED",
            );
          }
          return {
            schemaVersion: CURRENT_SEMANTIC_CACHE_VALUE_VERSION,
            candidate: authorization.candidate,
            provenance: {
              modelId: request.modelConfiguration.modelId,
              providerModelId: null,
              providerRequestId: null,
              modelConfigurationHash: await hashCanonical(request.modelConfiguration),
              responseId: null,
              finishState: "not-observed",
              usage: null,
              latencyMs: null,
              estimatedCostUsd: null,
              requestBudgetUpperBoundUsd: null,
              priceSnapshotId: null,
              outputDigest: await hashCanonical(authorization.candidate),
              promptIdentity: request.promptIdentity,
              promptHash: request.promptHash,
              semanticSchemaId: request.semanticSchemaId,
              atomTemplateVersion: request.atomTemplateVersion,
              capabilityCatalogVersion: request.capabilityCatalogVersion,
              unsupportedSemanticSignatureRegistryVersion:
                request.unsupportedSemanticSignatureRegistryVersion
            }
          };
        });
        const cachedAuthorization = authorizeSemanticInterpretation({
          interpretation: resolution.value.candidate,
          sourceEvidenceIndex: prepared.request.sourceEvidenceIndex
        });
        if (!cachedAuthorization.success) {
          throw new Error(
            cachedAuthorization.schemaIssues.length > 0
              ? "STRICT_SEMANTIC_SCHEMA_FAILURE"
              : "SEMANTIC_AUTHORIZATION_FAILED",
          );
        }
        await input.onSemanticCandidate?.(
          cachedAuthorization.candidate,
          {
            attemptId: null,
            cacheResult: resolution.cacheResult
          },
        );
        const result = await deterministicOutcome({
          submission: input.submission, prepared, request: prepared.request, interpretation: cachedAuthorization.interpretation,
          cacheResult: resolution.cacheResult, attemptId: null, providerRequestId: null,
          providerProvenance: resolution.value.provenance,
          transportMode: "fixture", requestId: `fixture-result-${crypto.randomUUID()}`
        });
        outcome = result.outcome;
        compiled = result.compiled;
      } catch (error) {
        const semanticAuthorizationFailure =
          error instanceof Error && error.message === "SEMANTIC_AUTHORIZATION_FAILED";
        outcome = generationFailure({
          requestId: `fixture-${crypto.randomUUID()}`, transportMode: "fixture",
          semanticRequestDigest: prepared.requestDigest,
          stage: semanticAuthorizationFailure ? "interpretation" : "schema",
          code: semanticAuthorizationFailure
            ? "SEMANTIC_AUTHORIZATION_FAILED"
            : "STRICT_SEMANTIC_SCHEMA_FAILURE",
          retryable: false,
          attemptId: null
        });
      }
    }
  } else {
    if (input.interpretationTransport === undefined) throw new Error("GENERATION_LIVE_TRANSPORT_SEAM_MISSING");
    let processedCompiled: ReturnType<typeof compiledFromCurrentPlanning> | null = null;
    const orchestrator = new CurrentSemanticOrchestrator({
      cache,
      // quotaUnlimited (local development only; forbidden in production by
      // readRuntimeConfig) dispatches without reserving quota. Ledger attempts
      // still append via appendAttempt, so the attempt history stays complete.
      transport: input.config.quotaUnlimited
        ? input.interpretationTransport
        : new QuotaTransport({
            store: input.store,
            sessionId: input.authenticated.session.sessionId,
            clientIdentifier: input.authenticated.clientIdentifier,
            transport: input.interpretationTransport,
            ...(input.quotaClock === undefined ? {} : { now: input.quotaClock })
          }),
      process: async ({ request, interpretation, cacheResult, attemptId, providerRequestId, providerProvenance }) => {
        const result = await deterministicOutcome({
          submission: input.submission, prepared, request, interpretation, cacheResult, attemptId, providerRequestId,
          providerProvenance,
          transportMode: "live", requestId: `live-result-${crypto.randomUUID()}`
        });
        processedCompiled = result.compiled;
        return result.outcome;
      },
      beforeProcess: async ({ candidate, cacheResult, attemptId }) => {
        await input.onSemanticCandidate?.(candidate, {
          attemptId,
          cacheResult
        });
      },
      appendAttempt: (attempt) => input.store.appendLedgerAttempt(attempt),
      promptHash,
      runtimeOrigin: input.runtimeOrigin,
      transportMode: "live",
      dispatchExposure: {
        requestBudgetUpperBoundUsd: GENERATION_OPENAI_PRICE.requestBudgetUpperBoundUsd,
        priceSnapshotId: GENERATION_OPENAI_PRICE.id
      }
    });
    const result = await orchestrator.generate({
      request: prepared.request,
      initiatedBy: input.initiatedBy ?? "initial-submit",
      ...(input.submission.retry === null ? {} : { retry: input.submission.retry })
    });
    outcome = result.outcome;
    compiled = processedCompiled;
    runtimeApplicationApiCalls = result.cacheResult === "miss" ? 1 : 0;
    retryContext = result.outcome.kind === "failure" && result.outcome.retryable && result.attempt !== null
      ? {
          priorAttemptId: result.attempt.attemptId,
          retryChainId: result.attempt.retryChainId,
          attemptOrdinal: result.attempt.attemptOrdinal + 1
        }
      : null;
  }
  const project = (outcome.kind === "supported" || outcome.kind === "simplified" || outcome.kind === "modified") &&
    compiled !== null
    ? await createCurrentPersistedProject({
        store: input.store,
        ownerSessionId: input.authenticated.session.sessionId,
        source: outcome.source,
        deterministicControls: input.submission.deterministicControls,
        fabricationControls: input.submission.fabricationControls,
        compiled,
        runtimeApplicationApiCalls
      })
    : null;
  return CurrentGenerationResponseSchema.parse({
    schemaVersion: "3.0", outcome, compiled, retryContext,
    project: project === null ? null : {
      projectId: project.projectId, revision: project.revision, updatedAtMs: project.updatedAtMs,
      lastDocumentHash: project.lastDocumentHash, lastGeometryHash: project.lastGeometryHash
    }
  });
}

export async function currentProductionPromptHash(
  config: RuntimeConfig,
): Promise<string> {
  if (config.liveTransport === null) throw new Error("GENERATION_LIVE_TRANSPORT_UNAVAILABLE");
  return sha256(instructionsForPromptLayout(config.liveTransport.interpretationPrompt));
}
