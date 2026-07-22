import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";
import { CAPABILITY_CATALOG_V1 } from "./capability-catalog.js";
import { createElicitationTelemetryV1 } from "./elicitation-telemetry.js";
import {
  GenerationOutcomeV2Schema,
  generationFailureV2,
  type GenerationOutcomeV2
} from "./generation-outcome-v2.js";
import { authorizeIntentGraphV2Evidence, intentGraphV2ProviderSchema, type IntentGraphV2 } from "./intent-graph-v2.js";
import { LiveCallAttemptSchema, type LiveCallAttempt, type LiveCallRuntimeOrigin } from "./live-ledger.js";
import type { SemanticCacheV2 } from "./semantic-cache-v2.js";
import type { CachedSemanticValueV2 } from "./semantic-cache-v2.js";
import {
  SemanticGenerationRequestV2Schema,
  semanticRequestDigestV2,
  type SemanticGenerationRequestV2
} from "./semantic-request-v2.js";
import {
  SemanticTransportOutcomeSchema,
  type SemanticInterpretationTransportV2,
  type SemanticTransportOutcome
} from "./semantic-transport.js";
import { reconcileIntentAtInterpretationBoundary } from "./intent-boundary-reconciliation.js";

type Completed = Extract<SemanticTransportOutcome, { kind: "completed" }>;
type RetryContext = { priorAttemptId: string; retryChainId: string; attemptOrdinal: number };
type CacheResult = "miss" | "hit" | "singleflight-hit";
type DeterministicProcessor = (input: {
  request: SemanticGenerationRequestV2;
  intent: IntentGraphV2;
  cacheResult: CacheResult;
  attemptId: string;
  providerRequestId: string | null;
  providerProvenance: CachedSemanticValueV2["provenance"];
}) => Promise<GenerationOutcomeV2>;

export type CurrentSemanticOrchestratorResult = {
  outcome: GenerationOutcomeV2;
  intent: IntentGraphV2 | null;
  cacheResult: CacheResult | "not-checked";
  attempt: LiveCallAttempt | null;
};

class TransportError extends Error {
  constructor(readonly outcome: Exclude<SemanticTransportOutcome, { kind: "completed" }>) {
    super(outcome.kind);
  }
}

class StrictIntentError extends Error {
  constructor(readonly response: Completed, readonly issues: readonly { code: string; path: string }[]) {
    super("STRICT_INTENT_SCHEMA_FAILURE");
  }
}

function opaqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "")}`;
}

const unavailable = (reason: "not-dispatched" | "no-response" | "authoritative-not-accepted") =>
  ({ status: "unavailable" as const, reason });

function confirmedBilling(response: Extract<SemanticTransportOutcome, { kind: "completed" | "model-failure" }>) {
  return {
    state: "confirmed-billed" as const,
    estimatedCostUsd: response.estimatedCostUsd,
    requestBudgetUpperBoundUsd: response.requestBudgetUpperBoundUsd,
    priceSnapshotId: response.priceSnapshotId
  };
}

type Context = Pick<LiveCallAttempt,
  "attemptId" | "submissionId" | "retryChainId" | "retryOfAttemptId" | "initiatedBy" |
  "runtimeOrigin" | "attemptOrdinal" | "semanticRequestDigest" | "promptHash" | "schemaHash" |
  "capabilityCatalogHash" | "modelConfigurationHash" | "modelId" | "reasoningEffort" |
  "imageDetailPolicy" | "promptLayoutVersion" |
  "clientRequestId" | "occurredAt"
>;

function attempt(context: Context, fields: Omit<LiveCallAttempt, "schemaVersion" | keyof Context>): LiveCallAttempt {
  return LiveCallAttemptSchema.parse({ schemaVersion: "1.0", ...context, ...fields });
}

export class CurrentSemanticOrchestrator {
  readonly #cache: SemanticCacheV2;
  readonly #transport: SemanticInterpretationTransportV2;
  readonly #process: DeterministicProcessor;
  readonly #appendAttempt: (value: LiveCallAttempt) => Promise<void>;
  readonly #promptHash: string;
  readonly #runtimeOrigin: LiveCallRuntimeOrigin;
  readonly #transportMode: "fixture" | "live";
  readonly #dispatchExposure: { requestBudgetUpperBoundUsd: number; priceSnapshotId: string };

  constructor(input: {
    cache: SemanticCacheV2;
    transport: SemanticInterpretationTransportV2;
    process: DeterministicProcessor;
    appendAttempt: (value: LiveCallAttempt) => Promise<void>;
    promptHash: string;
    runtimeOrigin: LiveCallRuntimeOrigin;
    transportMode: "fixture" | "live";
    dispatchExposure: { requestBudgetUpperBoundUsd: number; priceSnapshotId: string };
  }) {
    this.#cache = input.cache;
    this.#transport = input.transport;
    this.#process = input.process;
    this.#appendAttempt = input.appendAttempt;
    this.#promptHash = z.string().regex(/^[0-9a-f]{64}$/).parse(input.promptHash);
    this.#runtimeOrigin = input.runtimeOrigin;
    this.#transportMode = input.transportMode;
    this.#dispatchExposure = z.object({
      requestBudgetUpperBoundUsd: z.number().positive(),
      priceSnapshotId: z.string().min(1).max(120)
    }).strict().parse(input.dispatchExposure);
  }

  async generate(input: {
    request: unknown;
    initiatedBy?: "initial-submit" | "live-eval";
    retry?: RetryContext;
  }): Promise<CurrentSemanticOrchestratorResult> {
    const parsed = SemanticGenerationRequestV2Schema.safeParse(input.request);
    if (!parsed.success) {
      return {
        outcome: generationFailureV2({
          requestId: opaqueId("request"), transportMode: this.#transportMode,
          semanticRequestDigest: "0".repeat(64), stage: "input",
          code: "GENERATION_INPUT_INVALID", retryable: false, attemptId: null
        }),
        intent: null, cacheResult: "not-checked", attempt: null
      };
    }
    const request = parsed.data;
    const requestId = opaqueId("request");
    let requestDigest: string;
    try {
      requestDigest = await semanticRequestDigestV2(request);
    } catch {
      return {
        outcome: generationFailureV2({
          requestId, transportMode: this.#transportMode, semanticRequestDigest: "0".repeat(64),
          stage: "input", code: "GENERATION_SOURCE_EVIDENCE_INVALID", retryable: false, attemptId: null
        }),
        intent: null, cacheResult: "not-checked", attempt: null
      };
    }
    if (request.promptHash !== this.#promptHash) {
      return {
        outcome: generationFailureV2({
          requestId, transportMode: this.#transportMode, semanticRequestDigest: requestDigest,
          stage: "input", code: "GENERATION_PROMPT_IDENTITY_MISMATCH", retryable: false, attemptId: null
        }),
        intent: null, cacheResult: "not-checked", attempt: null
      };
    }
    const context: Context = {
      attemptId: opaqueId("attempt"), submissionId: opaqueId("submission"),
      retryChainId: input.retry?.retryChainId ?? opaqueId("retry-chain"),
      retryOfAttemptId: input.retry?.priorAttemptId ?? null,
      initiatedBy: input.retry === undefined ? input.initiatedBy ?? "initial-submit" : "explicit-user-retry",
      runtimeOrigin: this.#runtimeOrigin, attemptOrdinal: input.retry?.attemptOrdinal ?? 1,
      semanticRequestDigest: requestDigest, promptHash: request.promptHash,
      schemaHash: await hashCanonical(intentGraphV2ProviderSchema(request.sourceEvidenceIndex)),
      capabilityCatalogHash: await hashCanonical(CAPABILITY_CATALOG_V1),
      modelConfigurationHash: await hashCanonical(request.modelConfiguration),
      modelId: request.modelConfiguration.modelId, reasoningEffort: request.modelConfiguration.reasoningEffort,
      imageDetailPolicy: request.modelConfiguration.imageDetailPolicy,
      promptLayoutVersion: request.modelConfiguration.promptLayoutVersion,
      clientRequestId: opaqueId("client-request"), occurredAt: new Date().toISOString()
    };
    let completed: Completed | undefined;
    let transportEntered = false;
    let resolution;
    try {
      resolution = await this.#cache.resolve(request, async (cacheRequest) => {
        transportEntered = true;
        const result = SemanticTransportOutcomeSchema.parse(await this.#transport.dispatch({
          request: cacheRequest, clientRequestId: context.clientRequestId
        }));
        if (result.kind !== "completed") throw new TransportError(result);
        completed = result;
        const authorization = authorizeIntentGraphV2Evidence({
          intent: result.intentCandidate,
          sourceEvidenceIndex: cacheRequest.sourceEvidenceIndex,
          semanticBrief: cacheRequest.semanticBrief
        });
        if (!authorization.success) {
          throw new StrictIntentError(result, [
            ...authorization.schemaIssues.map((path) => ({ code: "SCHEMA", path })),
            ...authorization.unknownEvidenceIds.map((path) => ({ code: "UNKNOWN_EVIDENCE_ID", path }))
          ].slice(0, 32));
        }
        const reconciledIntent = reconcileIntentAtInterpretationBoundary({
          intent: authorization.intent,
          sourceEvidenceIndex: cacheRequest.sourceEvidenceIndex
        });
        return {
          schemaVersion: "2.0",
          intent: reconciledIntent,
          provenance: {
            modelId: cacheRequest.modelConfiguration.modelId,
            providerModelId: result.providerModelId,
            providerRequestId: result.providerRequestId,
            modelConfigurationHash: await hashCanonical(cacheRequest.modelConfiguration),
            responseId: result.responseId,
            finishState: result.finishState,
            usage: result.usage,
            latencyMs: result.latencyMs,
            estimatedCostUsd: result.estimatedCostUsd,
            requestBudgetUpperBoundUsd: result.requestBudgetUpperBoundUsd,
            priceSnapshotId: result.priceSnapshotId,
            outputDigest: await hashCanonical(reconciledIntent),
            promptIdentity: cacheRequest.promptIdentity,
            promptHash: cacheRequest.promptHash,
            intentSchemaId: cacheRequest.intentSchemaId,
            capabilityCatalogVersion: cacheRequest.capabilityCatalogVersion
          }
        };
      });
    } catch (error) {
      const built = this.#failureAttempt({ error, context, completed, transportEntered });
      await this.#appendAttempt(built.attempt);
      return {
        outcome: generationFailureV2({
          requestId, transportMode: this.#transportMode, semanticRequestDigest: requestDigest,
          stage: built.stage, code: built.attempt.errorCode ?? "GENERATION_FAILED",
          retryable: built.retryable, attemptId: context.attemptId
        }),
        intent: null, cacheResult: "not-checked", attempt: built.attempt
      };
    }

    const intent = reconcileIntentAtInterpretationBoundary({
      intent: resolution.value.intent,
      sourceEvidenceIndex: request.sourceEvidenceIndex
    });
    let outcome: GenerationOutcomeV2;
    try {
      outcome = GenerationOutcomeV2Schema.parse(await this.#process({
        request, intent, cacheResult: resolution.cacheResult, attemptId: context.attemptId,
        providerRequestId: resolution.cacheResult === "miss" ? completed?.providerRequestId ?? null : null,
        providerProvenance: resolution.value.provenance
      }));
    } catch {
      outcome = generationFailureV2({
        requestId, transportMode: this.#transportMode, semanticRequestDigest: requestDigest,
        stage: "planning", code: "DETERMINISTIC_PLANNING_FAILED", retryable: false,
        attemptId: context.attemptId
      });
    }
    const cacheHit = resolution.cacheResult !== "miss";
    const compileState = outcome.kind === "supported" || outcome.kind === "simplified"
      ? "passed" as const
      : outcome.kind === "failure" ? "failed" as const : "not-run" as const;
    const base = cacheHit ? {
      providerRequestId: null, providerModelId: null, responseId: null, finishState: "not-observed" as const, dispatchState: "not-dispatched" as const,
      outcome: "cache-hit" as const, latencyMs: 0, cacheResult: "hit" as const,
      networkDispatchCount: 0 as const, usage: unavailable("not-dispatched"),
      billing: { state: "not-applicable" as const, estimatedCostUsd: 0, requestBudgetUpperBoundUsd: null, priceSnapshotId: null }
    } : {
      providerRequestId: completed!.providerRequestId, providerModelId: completed!.providerModelId, responseId: completed!.responseId,
      finishState: completed!.finishState,
      dispatchState: "response-observed" as const, outcome: "completed" as const,
      latencyMs: completed!.latencyMs, cacheResult: "miss" as const, networkDispatchCount: 1 as const,
      usage: { status: "reported" as const, ...completed!.usage }, billing: confirmedBilling(completed!)
    };
    const recorded = attempt(context, {
      ...base, errorCode: outcome.kind === "failure" ? outcome.code : null,
      strictParse: "passed", supportStateCorrect: null, deterministicCompile: compileState,
      elicitationTelemetry: createElicitationTelemetryV1({
        semanticSource: cacheHit ? "cache-hit" : "fresh-dispatch",
        referenceCount: request.references.length, intent, outcome
      })
    });
    await this.#appendAttempt(recorded);
    return { outcome, intent, cacheResult: resolution.cacheResult, attempt: recorded };
  }

  #failureAttempt(input: {
    error: unknown; context: Context; completed: Completed | undefined; transportEntered: boolean;
  }): { attempt: LiveCallAttempt; stage: "input" | "transport" | "schema"; retryable: boolean } {
    if (input.error instanceof StrictIntentError) {
      return {
        stage: "schema", retryable: true,
        attempt: attempt(input.context, {
          providerRequestId: input.error.response.providerRequestId, providerModelId: input.error.response.providerModelId, responseId: input.error.response.responseId,
          finishState: input.error.response.finishState,
          dispatchState: "response-observed", outcome: "schema-failure", latencyMs: input.error.response.latencyMs,
          cacheResult: "miss", errorCode: "STRICT_INTENT_SCHEMA_FAILURE", networkDispatchCount: 1,
          strictParse: "failed", schemaFailureIssues: [...input.error.issues], supportStateCorrect: null,
          deterministicCompile: "not-run", usage: { status: "reported", ...input.error.response.usage },
          billing: confirmedBilling(input.error.response)
        })
      };
    }
    if (input.error instanceof TransportError) {
      const value = input.error.outcome;
      if (value.kind === "pre-dispatch-failure") return {
        stage: "input", retryable: false,
        attempt: attempt(input.context, {
          providerRequestId: null, providerModelId: null, responseId: null, finishState: "not-observed", dispatchState: "not-dispatched",
          outcome: "pre-dispatch-failure", latencyMs: null, cacheResult: "miss", errorCode: value.errorCode,
          networkDispatchCount: 0, strictParse: "not-attempted", supportStateCorrect: null,
          deterministicCompile: "not-run", usage: unavailable("not-dispatched"),
          billing: { state: "not-applicable", estimatedCostUsd: 0, requestBudgetUpperBoundUsd: null, priceSnapshotId: null }
        })
      };
      if (value.kind === "ambiguous-transport") return {
        stage: "transport", retryable: true,
        attempt: attempt(input.context, {
          providerRequestId: value.providerRequestId, providerModelId: null, responseId: null, finishState: "not-observed", dispatchState: "transport-handoff",
          outcome: "ambiguous-transport", latencyMs: value.latencyMs, cacheResult: "miss", errorCode: value.errorCode,
          networkDispatchCount: 1, strictParse: "not-attempted", supportStateCorrect: null,
          deterministicCompile: "not-run", usage: unavailable("no-response"),
          billing: { state: "potentially-billed", estimatedCostUsd: null, requestBudgetUpperBoundUsd: value.requestBudgetUpperBoundUsd, priceSnapshotId: value.priceSnapshotId }
        })
      };
      if (value.kind === "provider-not-accepted") return {
        stage: "transport", retryable: true,
        attempt: attempt(input.context, {
          providerRequestId: value.providerRequestId, providerModelId: null, responseId: null, finishState: "failed", dispatchState: "response-observed",
          outcome: "provider-not-accepted", latencyMs: value.latencyMs, cacheResult: "miss", errorCode: value.errorCode,
          networkDispatchCount: 1, strictParse: "not-attempted", supportStateCorrect: null,
          deterministicCompile: "not-run", usage: unavailable("authoritative-not-accepted"),
          billing: { state: "confirmed-not-billed", estimatedCostUsd: 0, requestBudgetUpperBoundUsd: null, priceSnapshotId: null }
        })
      };
      return {
        stage: "transport", retryable: true,
        attempt: attempt(input.context, {
          providerRequestId: value.providerRequestId, providerModelId: value.providerModelId, responseId: value.responseId, finishState: value.finishState, dispatchState: "response-observed",
          outcome: "model-failure", latencyMs: value.latencyMs, cacheResult: "miss", errorCode: value.errorCode,
          networkDispatchCount: 1, strictParse: "not-attempted", supportStateCorrect: false,
          deterministicCompile: "not-run", usage: { status: "reported", ...value.usage }, billing: confirmedBilling(value)
        })
      };
    }
    if (input.completed !== undefined) {
      return {
        stage: "schema", retryable: false,
        attempt: attempt(input.context, {
          providerRequestId: input.completed.providerRequestId, providerModelId: input.completed.providerModelId, responseId: input.completed.responseId,
          finishState: input.completed.finishState,
          dispatchState: "response-observed", outcome: "schema-failure", latencyMs: input.completed.latencyMs,
          cacheResult: "miss", errorCode: "LOCAL_CACHE_VALIDATION_FAILURE", networkDispatchCount: 1,
          strictParse: "failed", supportStateCorrect: null, deterministicCompile: "not-run",
          usage: { status: "reported", ...input.completed.usage }, billing: confirmedBilling(input.completed)
        })
      };
    }
    return {
      stage: input.transportEntered ? "transport" : "schema", retryable: input.transportEntered,
      attempt: attempt(input.context, input.transportEntered ? {
        providerRequestId: null, providerModelId: null, responseId: null, finishState: "not-observed", dispatchState: "transport-handoff",
        outcome: "ambiguous-transport", latencyMs: null, cacheResult: "miss",
        errorCode: "UNCLASSIFIED_POST_HANDOFF_FAILURE", networkDispatchCount: 1,
        strictParse: "not-attempted", supportStateCorrect: null, deterministicCompile: "not-run",
        usage: unavailable("no-response"),
        billing: { state: "potentially-billed", estimatedCostUsd: null, ...this.#dispatchExposure }
      } : {
        providerRequestId: null, providerModelId: null, responseId: null, finishState: "not-observed", dispatchState: "not-dispatched",
        outcome: "pre-dispatch-failure", latencyMs: null, cacheResult: "miss",
        errorCode: "LOCAL_ORCHESTRATION_FAILURE", networkDispatchCount: 0,
        strictParse: "not-attempted", supportStateCorrect: null, deterministicCompile: "not-run",
        usage: unavailable("not-dispatched"),
        billing: { state: "not-applicable", estimatedCostUsd: 0, requestBudgetUpperBoundUsd: null, priceSnapshotId: null }
      })
    };
  }
}
