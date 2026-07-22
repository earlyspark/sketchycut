import { sha256, hashCanonical } from "../../domain/hash.js";
import { planIntentConditionedConstruction } from "../../interpretation/construction-planner.js";
import { buildCurrentFixtureIntent, findCurrentFixtureScenario } from "../../interpretation/current-fixture-corpus.js";
import { reconcileExplicitSizingConstraints } from "../../interpretation/explicit-sizing.js";
import { generationFailureV2, generationOutcomeV2FromPlanner, type GenerationOutcomeV2 } from "../../interpretation/generation-outcome-v2.js";
import type { GenerationSubmissionV2 } from "../../interpretation/generation-submission-v2.js";
import { authorizeIntentGraphV2Evidence } from "../../interpretation/intent-graph-v2.js";
import type { IntentGraphV2 } from "../../interpretation/intent-graph-v2.js";
import { reconcileIntentAtInterpretationBoundary } from "../../interpretation/intent-boundary-reconciliation.js";
import type { LiveCallRuntimeOrigin } from "../../interpretation/live-ledger.js";
import { CurrentSemanticOrchestrator } from "../../interpretation/orchestrator-v2.js";
import type { SemanticCacheV2 } from "../../interpretation/semantic-cache-v2.js";
import type { CachedSemanticValueV2 } from "../../interpretation/semantic-cache-v2.js";
import {
  CURRENT_PROMPT_IDENTITY,
  prepareSemanticGenerationRequestV2,
  type PreparedSemanticGenerationRequestV2,
  type SemanticGenerationRequestV2
} from "../../interpretation/semantic-request-v2.js";
import type { SemanticInterpretationTransportV2 } from "../../interpretation/semantic-transport.js";
import { resolveGeneratedFabricationControls } from "../../interpretation/generated-fabrication.js";
import { CurrentGenerationResponseSchema, type CurrentGenerationResponse } from "./api-contracts-v2.js";
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
import { instructionsForPromptLayout } from "./reference-interpretation-prompt.js";
import { DurableSemanticCacheV2 } from "./durable-semantic-cache-v2.js";
import type { AuthenticatedRequest } from "./http-security.js";
import {
  compiledFromCurrentPlanning,
  createCurrentPersistedProject
} from "./project-persistence-v2.js";
import { QuotaTransportV2 } from "./quota-transport-v2.js";

async function deterministicOutcome(input: {
  submission: GenerationSubmissionV2;
  prepared: PreparedSemanticGenerationRequestV2;
  request: SemanticGenerationRequestV2;
  intent: IntentGraphV2;
  cacheResult: "miss" | "hit" | "singleflight-hit";
  attemptId: string | null;
  providerRequestId: string | null;
  providerProvenance: CachedSemanticValueV2["provenance"];
  transportMode: "fixture" | "live";
  requestId: string;
}) {
  const intent = reconcileIntentAtInterpretationBoundary({
    intent: input.intent,
    sourceEvidenceIndex: input.request.sourceEvidenceIndex
  });
  const explicitSizing = await reconcileExplicitSizingConstraints({
    advancedSizing: input.submission.deterministicControls.advancedSizing,
    parsedConstraints: input.prepared.parsedConstraints,
    parserFindings: input.prepared.parserFindings
  });
  const fabrication = resolveGeneratedFabricationControls(input.submission.fabricationControls);
  const planning = await planIntentConditionedConstruction({
    intent,
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
      runtimeApplicationApiCalls: input.transportMode === "live" && input.cacheResult === "miss" ? 1 : 0
    }
  });
  const outcome = await generationOutcomeV2FromPlanner({
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
    requestBudgetUpperBoundUsd: input.providerProvenance.requestBudgetUpperBoundUsd,
    priceSnapshotId: input.providerProvenance.priceSnapshotId,
    intent,
    explicitSizing,
    planning
  });
  return {
    outcome,
    compiled: outcome.kind === "supported" || outcome.kind === "simplified"
      ? compiledFromCurrentPlanning(planning)
      : null
  };
}

export async function executeCurrentGeneration(input: {
  config: RuntimeConfig;
  authenticated: AuthenticatedRequest;
  submission: GenerationSubmissionV2;
  store: GenerationStore;
  runtimeOrigin: LiveCallRuntimeOrigin;
  interpretationTransport?: SemanticInterpretationTransportV2;
  semanticCache?: SemanticCacheV2;
  quotaClock?: () => number;
  initiatedBy?: "initial-submit" | "live-eval";
  promptHash?: string;
  evaluationModelConfiguration?: SemanticModelConfiguration;
}): Promise<CurrentGenerationResponse> {
  const mode = input.config.generationMode;
  if (mode === "live" && input.promptHash === undefined) throw new Error("GENERATION_LIVE_PROMPT_HASH_MISSING");
  if (input.evaluationModelConfiguration !== undefined &&
      (mode !== "live" || input.initiatedBy !== "live-eval")) {
    throw new Error("GENERATION_EVALUATION_CONFIGURATION_FORBIDDEN");
  }
  const modelConfiguration = SemanticModelConfigurationSchema.parse(
    input.evaluationModelConfiguration ?? {
      modelId: mode === "live" ? GENERATION_OPENAI_MODEL : "strict-current-fixture-intent",
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
  const prepared = await prepareSemanticGenerationRequestV2({
    brief: input.submission.brief,
    references: input.submission.references.map((item) => item.descriptor),
    roleConstraints: input.submission.roleConstraints,
    promptIdentity: CURRENT_PROMPT_IDENTITY,
    promptHash,
    modelConfiguration
  });
  const cache = input.semanticCache ?? new DurableSemanticCacheV2({ store: input.store });
  let outcome: GenerationOutcomeV2;
  let compiled: ReturnType<typeof compiledFromCurrentPlanning> | null = null;
  let runtimeApplicationApiCalls: 0 | 1 = 0;
  let retryContext: { priorAttemptId: string; retryChainId: string; attemptOrdinal: number } | null = null;
  if (mode === "fixture") {
    const scenario = findCurrentFixtureScenario(prepared.request.semanticBrief);
    if (scenario === null) {
      outcome = generationFailureV2({
        requestId: `fixture-${crypto.randomUUID()}`, transportMode: "fixture",
        semanticRequestDigest: prepared.requestDigest, stage: "input", code: "FIXTURE_NOT_FOUND",
        retryable: false, attemptId: null
      });
    } else {
      try {
        const resolution = await cache.resolve(prepared.request, async (request) => {
          const authorization = authorizeIntentGraphV2Evidence({
            intent: buildCurrentFixtureIntent(request, scenario),
            sourceEvidenceIndex: request.sourceEvidenceIndex,
            semanticBrief: request.semanticBrief
          });
          if (!authorization.success) throw new Error("STRICT_INTENT_SCHEMA_FAILURE");
          const reconciledIntent = reconcileIntentAtInterpretationBoundary({
            intent: authorization.intent,
            sourceEvidenceIndex: request.sourceEvidenceIndex
          });
          return {
            schemaVersion: "2.0" as const,
            intent: reconciledIntent,
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
              outputDigest: await hashCanonical(reconciledIntent),
              promptIdentity: request.promptIdentity,
              promptHash: request.promptHash,
              intentSchemaId: request.intentSchemaId,
              capabilityCatalogVersion: request.capabilityCatalogVersion
            }
          };
        });
        const result = await deterministicOutcome({
          submission: input.submission, prepared, request: prepared.request, intent: resolution.value.intent,
          cacheResult: resolution.cacheResult, attemptId: null, providerRequestId: null,
          providerProvenance: resolution.value.provenance,
          transportMode: "fixture", requestId: `fixture-result-${crypto.randomUUID()}`
        });
        outcome = result.outcome;
        compiled = result.compiled;
      } catch {
        outcome = generationFailureV2({
          requestId: `fixture-${crypto.randomUUID()}`, transportMode: "fixture",
          semanticRequestDigest: prepared.requestDigest, stage: "schema", code: "STRICT_INTENT_SCHEMA_FAILURE",
          retryable: true, attemptId: null
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
        : new QuotaTransportV2({
            store: input.store,
            sessionId: input.authenticated.session.sessionId,
            clientIdentifier: input.authenticated.clientIdentifier,
            transport: input.interpretationTransport,
            ...(input.quotaClock === undefined ? {} : { now: input.quotaClock })
          }),
      process: async ({ request, intent, cacheResult, attemptId, providerRequestId, providerProvenance }) => {
        const result = await deterministicOutcome({
          submission: input.submission, prepared, request, intent, cacheResult, attemptId, providerRequestId,
          providerProvenance,
          transportMode: "live", requestId: `live-result-${crypto.randomUUID()}`
        });
        processedCompiled = result.compiled;
        return result.outcome;
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
  const project = (outcome.kind === "supported" || outcome.kind === "simplified") && compiled !== null
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
    schemaVersion: "2.0", outcome, compiled, retryContext,
    project: project === null ? null : {
      projectId: project.projectId, revision: project.revision, updatedAtMs: project.updatedAtMs,
      lastDocumentHash: project.lastDocumentHash, lastGeometryHash: project.lastGeometryHash
    }
  });
}

export async function currentProductionPromptHash(
  config: RuntimeConfig,
  configuration: Pick<SemanticModelConfiguration, "promptLayoutVersion"> = {
    promptLayoutVersion: CURRENT_PROMPT_LAYOUT_VERSION
  },
): Promise<string> {
  if (config.liveTransport === null) throw new Error("GENERATION_LIVE_TRANSPORT_UNAVAILABLE");
  return sha256(instructionsForPromptLayout(
    config.liveTransport.interpretationPrompt,
    configuration.promptLayoutVersion,
  ));
}
