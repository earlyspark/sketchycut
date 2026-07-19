import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";
import { StableIdSchema } from "../domain/contracts.js";
import { capabilityCatalogHash } from "./capability-catalog.js";
import { deterministicCompilationFailureCode } from "./compilation-error.js";
import { INTENT_GRAPH_V1_JSON_SCHEMA, IntentGraphV1Schema } from "./intent-graph.js";
import { removeRawBriefCopiesFromIntent } from "./intent-privacy.js";
import type { LiveCallAttempt, LiveCallRuntimeOrigin } from "./live-ledger.js";
import { mapIntentGraph, type CapabilityMappingOutcome } from "./mapper.js";
import type { SemanticCache } from "./semantic-cache.js";
import {
  SemanticGenerationRequestV1Schema,
  semanticRequestDigest,
  type SemanticGenerationRequestV1
} from "./semantic-request.js";

const ReportedUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative()
  })
  .strict();

const ConfirmedResponseFieldsSchema = z.object({
  providerRequestId: z.string().min(1).max(512),
  responseId: z.string().min(1).max(512).nullable(),
  latencyMs: z.number().int().nonnegative(),
  usage: ReportedUsageSchema,
  estimatedCostUsd: z.number().nonnegative(),
  requestBudgetUpperBoundUsd: z.number().nonnegative(),
  priceSnapshotId: z.string().min(1).max(120)
});

export const SemanticTransportOutcomeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("pre-dispatch-failure"),
      errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/)
    })
    .strict(),
  ConfirmedResponseFieldsSchema.extend({
    kind: z.literal("completed"),
    intentCandidate: z.unknown()
  }).strict(),
  ConfirmedResponseFieldsSchema.extend({
    kind: z.literal("model-failure"),
    errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/)
  }).strict(),
  z
    .object({
      kind: z.literal("provider-not-accepted"),
      providerRequestId: z.string().min(1).max(512).nullable(),
      latencyMs: z.number().int().nonnegative(),
      errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/)
    })
    .strict(),
  z
    .object({
      kind: z.literal("ambiguous-transport"),
      providerRequestId: z.string().min(1).max(512).nullable(),
      latencyMs: z.number().int().nonnegative().nullable(),
      requestBudgetUpperBoundUsd: z.number().nonnegative(),
      priceSnapshotId: z.string().min(1).max(120),
      errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/)
    })
    .strict()
]);

export type SemanticTransportOutcome = z.infer<typeof SemanticTransportOutcomeSchema>;
type CompletedTransportOutcome = Extract<SemanticTransportOutcome, { kind: "completed" }>;

export type SemanticInterpretationTransport = {
  dispatch(input: {
    request: SemanticGenerationRequestV1;
    clientRequestId: string;
  }): Promise<SemanticTransportOutcome>;
};

type RetryContext = {
  priorAttemptId: string;
  retryChainId: string;
  attemptOrdinal: number;
};

type CompilationCallback<TCompiled> = (input: {
  request: SemanticGenerationRequestV1;
  intent: z.infer<typeof IntentGraphV1Schema>;
  mapping: Exclude<CapabilityMappingOutcome, { kind: "concept-only" }>;
  cacheResult: "miss" | "hit" | "singleflight-hit";
}) => Promise<TCompiled>;

type OrchestratorResult<TCompiled> =
  | {
      kind: "supported";
      intent: z.infer<typeof IntentGraphV1Schema>;
      mapping: Extract<CapabilityMappingOutcome, { kind: "supported" }>;
      compiled: TCompiled;
      cacheResult: "miss" | "hit" | "singleflight-hit";
      attempt: LiveCallAttempt;
    }
  | {
      kind: "simplified";
      intent: z.infer<typeof IntentGraphV1Schema>;
      mapping: Extract<CapabilityMappingOutcome, { kind: "simplified" }>;
      compiled: TCompiled;
      cacheResult: "miss" | "hit" | "singleflight-hit";
      attempt: LiveCallAttempt;
    }
  | {
      kind: "concept-only";
      intent: z.infer<typeof IntentGraphV1Schema>;
      mapping: Extract<CapabilityMappingOutcome, { kind: "concept-only" }>;
      exportAllowed: false;
      cacheResult: "miss" | "hit" | "singleflight-hit";
      attempt: LiveCallAttempt;
    }
  | {
      kind: "failure";
      stage: "input" | "transport" | "schema" | "model" | "compilation";
      code: string;
      retryable: boolean;
      preservedRequest: SemanticGenerationRequestV1 | null;
      attempt: LiveCallAttempt | null;
    };

class TransportOutcomeError extends Error {
  readonly outcome: Exclude<SemanticTransportOutcome, { kind: "completed" }>;

  constructor(outcome: Exclude<SemanticTransportOutcome, { kind: "completed" }>) {
    super(outcome.kind);
    this.name = "TransportOutcomeError";
    this.outcome = outcome;
  }
}

class StrictSchemaError extends Error {
  readonly response: Extract<SemanticTransportOutcome, { kind: "completed" }>;
  readonly issues: readonly { code: string; path: string }[];

  constructor(
    response: Extract<SemanticTransportOutcome, { kind: "completed" }>,
    issues: readonly { code: string; path: string }[],
  ) {
    super("STRICT_INTENT_SCHEMA_FAILURE");
    this.name = "StrictSchemaError";
    this.response = response;
    this.issues = issues;
  }
}

function opaqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "")}`;
}

function unavailable(reason: LiveCallAttempt["usage"] extends infer T
  ? T extends { status: "unavailable"; reason: infer R } ? R : never
  : never): LiveCallAttempt["usage"] {
  return { status: "unavailable", reason };
}

type AttemptContext = {
  attemptId: string;
  submissionId: string;
  retryChainId: string;
  retryOfAttemptId: string | null;
  initiatedBy: LiveCallAttempt["initiatedBy"];
  runtimeOrigin: LiveCallRuntimeOrigin;
  attemptOrdinal: number;
  semanticRequestDigest: string;
  promptHash: string;
  schemaHash: string;
  capabilityCatalogHash: string;
  modelConfigurationHash: string;
  modelId: string | null;
  reasoningEffort: string | null;
  clientRequestId: string;
  occurredAt: string;
};

function baseAttempt(
  context: AttemptContext,
  fields: Omit<LiveCallAttempt,
    | "schemaVersion"
    | "attemptId"
    | "submissionId"
    | "retryChainId"
    | "retryOfAttemptId"
    | "initiatedBy"
    | "runtimeOrigin"
    | "attemptOrdinal"
    | "semanticRequestDigest"
    | "promptHash"
    | "schemaHash"
    | "capabilityCatalogHash"
    | "modelConfigurationHash"
    | "modelId"
    | "reasoningEffort"
    | "clientRequestId"
    | "occurredAt"
  >,
): LiveCallAttempt {
  return {
    schemaVersion: "1.0",
    ...context,
    ...fields
  };
}

function confirmedBilling(
  response: Extract<SemanticTransportOutcome, { kind: "completed" | "model-failure" }>,
): LiveCallAttempt["billing"] {
  return {
    state: "confirmed-billed",
    estimatedCostUsd: response.estimatedCostUsd,
    requestBudgetUpperBoundUsd: response.requestBudgetUpperBoundUsd,
    priceSnapshotId: response.priceSnapshotId
  };
}

function requireCompletedResponse(
  response: CompletedTransportOutcome | undefined,
): CompletedTransportOutcome {
  if (response === undefined) throw new Error("TRANSPORT_RESPONSE_CAPTURE_MISSING");
  return response;
}

function completedAttemptFields(
  response: CompletedTransportOutcome,
  deterministicCompile: LiveCallAttempt["deterministicCompile"],
  supportStateCorrect: boolean | null,
): Omit<LiveCallAttempt,
  | "schemaVersion"
  | keyof AttemptContext
> {
  return {
    providerRequestId: response.providerRequestId,
    responseId: response.responseId,
    dispatchState: "response-observed",
    outcome: "completed",
    latencyMs: response.latencyMs,
    cacheResult: "miss",
    errorCode: null,
    networkDispatchCount: 1,
    strictParse: "passed",
    supportStateCorrect,
    deterministicCompile,
    usage: { status: "reported", ...response.usage },
    billing: confirmedBilling(response)
  };
}

export class GeneratedProjectOrchestrator<TCompiled> {
  readonly #cache: SemanticCache;
  readonly #transport: SemanticInterpretationTransport;
  readonly #compile: CompilationCallback<TCompiled>;
  readonly #appendAttempt: (attempt: LiveCallAttempt) => Promise<void>;
  readonly #promptHash: string;
  readonly #runtimeOrigin: LiveCallRuntimeOrigin;
  readonly #dispatchExposure: {
    requestBudgetUpperBoundUsd: number;
    priceSnapshotId: string;
  };

  constructor(input: {
    cache: SemanticCache;
    transport: SemanticInterpretationTransport;
    compile: CompilationCallback<TCompiled>;
    appendAttempt: (attempt: LiveCallAttempt) => Promise<void>;
    promptHash: string;
    runtimeOrigin: LiveCallRuntimeOrigin;
    dispatchExposure: {
      requestBudgetUpperBoundUsd: number;
      priceSnapshotId: string;
    };
  }) {
    this.#cache = input.cache;
    this.#transport = input.transport;
    this.#compile = input.compile;
    this.#appendAttempt = input.appendAttempt;
    this.#promptHash = z.string().regex(/^[0-9a-f]{64}$/).parse(input.promptHash);
    this.#runtimeOrigin = input.runtimeOrigin;
    this.#dispatchExposure = z.object({
      requestBudgetUpperBoundUsd: z.number().positive(),
      priceSnapshotId: StableIdSchema
    }).strict().parse(input.dispatchExposure);
  }

  async generate(input: {
    request: unknown;
    initiatedBy?: "initial-submit" | "live-eval";
    retry?: RetryContext;
    expectedOutcomeKind?: "supported" | "simplified" | "concept-only";
  }): Promise<OrchestratorResult<TCompiled>> {
    const parsedRequest = SemanticGenerationRequestV1Schema.safeParse(input.request);
    if (!parsedRequest.success) {
      return {
        kind: "failure",
        stage: "input",
        code: "GENERATION_INPUT_INVALID",
        retryable: false,
        preservedRequest: null,
        attempt: null
      };
    }
    const request = parsedRequest.data;
    if (request.promptHash !== this.#promptHash) {
      return {
        kind: "failure",
        stage: "input",
        code: "GENERATION_PROMPT_IDENTITY_MISMATCH",
        retryable: false,
        preservedRequest: request,
        attempt: null
      };
    }
    const [requestDigest, schemaHash, catalogHash, modelConfigurationHash] =
      await Promise.all([
        semanticRequestDigest(request),
        hashCanonical(INTENT_GRAPH_V1_JSON_SCHEMA),
        capabilityCatalogHash(),
        hashCanonical(request.modelConfiguration)
      ]);
    const context: AttemptContext = {
      attemptId: opaqueId("attempt"),
      submissionId: opaqueId("submission"),
      retryChainId: input.retry?.retryChainId ?? opaqueId("retry-chain"),
      retryOfAttemptId: input.retry?.priorAttemptId ?? null,
      initiatedBy: input.retry === undefined
        ? input.initiatedBy ?? "initial-submit"
        : "explicit-user-retry",
      runtimeOrigin: this.#runtimeOrigin,
      attemptOrdinal: input.retry?.attemptOrdinal ?? 1,
      semanticRequestDigest: requestDigest,
      promptHash: this.#promptHash,
      schemaHash,
      capabilityCatalogHash: catalogHash,
      modelConfigurationHash,
      modelId: request.modelConfiguration.modelId,
      reasoningEffort: request.modelConfiguration.reasoningEffort,
      clientRequestId: opaqueId("client-request"),
      occurredAt: new Date().toISOString()
    };
    const dispatchCapture: {
      completed?: CompletedTransportOutcome;
      transportEntered: boolean;
    } = { transportEntered: false };
    let resolution;
    try {
      resolution = await this.#cache.resolve(request, async (cacheRequest) => {
        dispatchCapture.transportEntered = true;
        const outcome = SemanticTransportOutcomeSchema.parse(await this.#transport.dispatch({
          request: cacheRequest,
          clientRequestId: context.clientRequestId
        }));
        if (outcome.kind !== "completed") throw new TransportOutcomeError(outcome);
        dispatchCapture.completed = outcome;
        const parsedIntent = IntentGraphV1Schema.safeParse(outcome.intentCandidate);
        if (!parsedIntent.success) {
          throw new StrictSchemaError(outcome, parsedIntent.error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path.map(String).join(".")
          })));
        }
        const privacySafeIntent = removeRawBriefCopiesFromIntent(
          parsedIntent.data,
          cacheRequest.normalizedBrief,
        );
        return {
          schemaVersion: "1.0",
          intent: privacySafeIntent,
          provenance: {
            modelId: request.modelConfiguration.modelId,
            responseId: outcome.responseId,
            outputDigest: await hashCanonical(privacySafeIntent),
            promptVersion: request.promptVersion,
            promptHash: request.promptHash,
            intentSchemaVersion: request.intentSchemaVersion,
            capabilityCatalogVersion: request.capabilityCatalogVersion
          }
        };
      });
    } catch (error) {
      let attempt: LiveCallAttempt;
      let stage: Extract<OrchestratorResult<TCompiled>, { kind: "failure" }>["stage"];
      let retryable = true;
      if (error instanceof StrictSchemaError) {
        const response = error.response;
        stage = "schema";
        attempt = baseAttempt(context, {
          providerRequestId: response.providerRequestId,
          responseId: response.responseId,
          dispatchState: "response-observed",
          outcome: "schema-failure",
          latencyMs: response.latencyMs,
          cacheResult: "miss",
          errorCode: "STRICT_INTENT_SCHEMA_FAILURE",
          networkDispatchCount: 1,
          strictParse: "failed",
          schemaFailureIssues: [...error.issues],
          supportStateCorrect: null,
          deterministicCompile: "not-run",
          usage: { status: "reported", ...response.usage },
          billing: confirmedBilling(response)
        });
      } else if (error instanceof TransportOutcomeError) {
        const outcome = error.outcome;
        if (outcome.kind === "pre-dispatch-failure") {
          stage = "input";
          retryable = false;
          attempt = baseAttempt(context, {
            providerRequestId: null,
            responseId: null,
            dispatchState: "not-dispatched",
            outcome: "pre-dispatch-failure",
            latencyMs: null,
            cacheResult: "miss",
            errorCode: outcome.errorCode,
            networkDispatchCount: 0,
            strictParse: "not-attempted",
            supportStateCorrect: null,
            deterministicCompile: "not-run",
            usage: unavailable("not-dispatched"),
            billing: {
              state: "not-applicable",
              estimatedCostUsd: 0,
              requestBudgetUpperBoundUsd: null,
              priceSnapshotId: null
            }
          });
        } else if (outcome.kind === "ambiguous-transport") {
          stage = "transport";
          attempt = baseAttempt(context, {
            providerRequestId: outcome.providerRequestId,
            responseId: null,
            dispatchState: "transport-handoff",
            outcome: "ambiguous-transport",
            latencyMs: outcome.latencyMs,
            cacheResult: "miss",
            errorCode: outcome.errorCode,
            networkDispatchCount: 1,
            strictParse: "not-attempted",
            supportStateCorrect: null,
            deterministicCompile: "not-run",
            usage: unavailable("no-response"),
            billing: {
              state: "potentially-billed",
              estimatedCostUsd: null,
              requestBudgetUpperBoundUsd: outcome.requestBudgetUpperBoundUsd,
              priceSnapshotId: outcome.priceSnapshotId
            }
          });
        } else if (outcome.kind === "provider-not-accepted") {
          stage = "transport";
          attempt = baseAttempt(context, {
            providerRequestId: outcome.providerRequestId,
            responseId: null,
            dispatchState: "response-observed",
            outcome: "provider-not-accepted",
            latencyMs: outcome.latencyMs,
            cacheResult: "miss",
            errorCode: outcome.errorCode,
            networkDispatchCount: 1,
            strictParse: "not-attempted",
            supportStateCorrect: null,
            deterministicCompile: "not-run",
            usage: unavailable("authoritative-not-accepted"),
            billing: {
              state: "confirmed-not-billed",
              estimatedCostUsd: 0,
              requestBudgetUpperBoundUsd: null,
              priceSnapshotId: null
            }
          });
        } else {
          stage = "model";
          attempt = baseAttempt(context, {
            providerRequestId: outcome.providerRequestId,
            responseId: outcome.responseId,
            dispatchState: "response-observed",
            outcome: "model-failure",
            latencyMs: outcome.latencyMs,
            cacheResult: "miss",
            errorCode: outcome.errorCode,
            networkDispatchCount: 1,
            strictParse: "not-attempted",
            supportStateCorrect: false,
            deterministicCompile: "not-run",
            usage: { status: "reported", ...outcome.usage },
            billing: confirmedBilling(outcome)
          });
        }
      } else {
        retryable = false;
        if (dispatchCapture.completed !== undefined) {
          const response = dispatchCapture.completed;
          stage = "schema";
          attempt = baseAttempt(context, {
            providerRequestId: response.providerRequestId,
            responseId: response.responseId,
            dispatchState: "response-observed",
            outcome: "schema-failure",
            latencyMs: response.latencyMs,
            cacheResult: "miss",
            errorCode: "LOCAL_CACHE_VALIDATION_FAILURE",
            networkDispatchCount: 1,
            strictParse: "failed",
            supportStateCorrect: null,
            deterministicCompile: "not-run",
            usage: { status: "reported", ...response.usage },
            billing: confirmedBilling(response)
          });
        } else if (dispatchCapture.transportEntered) {
          stage = "transport";
          retryable = true;
          attempt = baseAttempt(context, {
            providerRequestId: null,
            responseId: null,
            dispatchState: "transport-handoff",
            outcome: "ambiguous-transport",
            latencyMs: null,
            cacheResult: "miss",
            errorCode: "UNCLASSIFIED_POST_HANDOFF_FAILURE",
            networkDispatchCount: 1,
            strictParse: "not-attempted",
            supportStateCorrect: null,
            deterministicCompile: "not-run",
            usage: unavailable("no-response"),
            billing: {
              state: "potentially-billed",
              estimatedCostUsd: null,
              ...this.#dispatchExposure
            }
          });
        } else {
          stage = "schema";
          attempt = baseAttempt(context, {
            providerRequestId: null,
            responseId: null,
            dispatchState: "not-dispatched",
            outcome: "pre-dispatch-failure",
            latencyMs: null,
            cacheResult: "miss",
            errorCode: "LOCAL_ORCHESTRATION_FAILURE",
            networkDispatchCount: 0,
            strictParse: "not-attempted",
            supportStateCorrect: null,
            deterministicCompile: "not-run",
            usage: unavailable("not-dispatched"),
            billing: {
              state: "not-applicable",
              estimatedCostUsd: 0,
              requestBudgetUpperBoundUsd: null,
              priceSnapshotId: null
            }
          });
        }
      }
      await this.#appendAttempt(attempt);
      return {
        kind: "failure",
        stage,
        code: attempt.errorCode ?? "GENERATION_FAILED",
        retryable,
        preservedRequest: request,
        attempt
      };
    }

    const intent = IntentGraphV1Schema.parse(resolution.value.intent);
    const mapping = await mapIntentGraph(intent);
    const supportStateCorrect = input.expectedOutcomeKind === undefined
      ? null
      : mapping.kind === input.expectedOutcomeKind;
    if (mapping.kind === "concept-only") {
      const cacheHit = resolution.cacheResult !== "miss";
      const attempt = baseAttempt(context, cacheHit ? {
        providerRequestId: null,
        responseId: null,
        dispatchState: "not-dispatched",
        outcome: "cache-hit",
        latencyMs: 0,
        cacheResult: "hit",
        errorCode: null,
        networkDispatchCount: 0,
        strictParse: "passed",
        supportStateCorrect,
        deterministicCompile: "not-run",
        usage: unavailable("not-dispatched"),
        billing: {
          state: "not-applicable",
          estimatedCostUsd: 0,
          requestBudgetUpperBoundUsd: null,
          priceSnapshotId: null
        }
      } : completedAttemptFields(
        requireCompletedResponse(dispatchCapture.completed),
        "not-run",
        supportStateCorrect,
      ));
      await this.#appendAttempt(attempt);
      return {
        kind: "concept-only",
        intent,
        mapping,
        exportAllowed: false,
        cacheResult: resolution.cacheResult,
        attempt
      };
    }

    let compiled: TCompiled;
    try {
      compiled = await this.#compile({
        request,
        intent,
        mapping,
        cacheResult: resolution.cacheResult
      });
    } catch (error) {
      const cacheHit = resolution.cacheResult !== "miss";
      const attempt = baseAttempt(context, cacheHit ? {
        providerRequestId: null,
        responseId: null,
        dispatchState: "not-dispatched",
        outcome: "cache-hit",
        latencyMs: 0,
        cacheResult: "hit",
        errorCode: null,
        networkDispatchCount: 0,
        strictParse: "passed",
        supportStateCorrect,
        deterministicCompile: "failed",
        usage: unavailable("not-dispatched"),
        billing: {
          state: "not-applicable",
          estimatedCostUsd: 0,
          requestBudgetUpperBoundUsd: null,
          priceSnapshotId: null
        }
      } : completedAttemptFields(
        requireCompletedResponse(dispatchCapture.completed),
        "failed",
        supportStateCorrect,
      ));
      await this.#appendAttempt(attempt);
      return {
        kind: "failure",
        stage: "compilation",
        code: deterministicCompilationFailureCode(error),
        retryable: false,
        preservedRequest: request,
        attempt
      };
    }
    const cacheHit = resolution.cacheResult !== "miss";
    const attempt = baseAttempt(context, cacheHit ? {
      providerRequestId: null,
      responseId: null,
      dispatchState: "not-dispatched",
      outcome: "cache-hit",
      latencyMs: 0,
      cacheResult: "hit",
      errorCode: null,
      networkDispatchCount: 0,
      strictParse: "passed",
      supportStateCorrect,
      deterministicCompile: "passed",
      usage: unavailable("not-dispatched"),
      billing: {
        state: "not-applicable",
        estimatedCostUsd: 0,
        requestBudgetUpperBoundUsd: null,
        priceSnapshotId: null
      }
    } : completedAttemptFields(
      requireCompletedResponse(dispatchCapture.completed),
      "passed",
      supportStateCorrect,
    ));
    await this.#appendAttempt(attempt);
    if (mapping.kind === "simplified") {
      return {
        kind: "simplified",
        intent,
        mapping,
        compiled,
        cacheResult: resolution.cacheResult,
        attempt
      };
    }
    return {
      kind: "supported",
      intent,
      mapping,
      compiled,
      cacheResult: resolution.cacheResult,
      attempt
    };
  }
}

export type GeneratedProjectOrchestratorResult<TCompiled> = OrchestratorResult<TCompiled>;
