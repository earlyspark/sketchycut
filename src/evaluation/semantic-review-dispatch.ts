import { randomUUID } from "node:crypto";

import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";
import { CAPABILITY_CATALOG } from "../interpretation/capability-catalog.js";
import {
  LiveCallAttemptSchema,
  type LiveCallAttempt,
  type LiveCallRuntimeOrigin
} from "../interpretation/live-ledger.js";
import type { SemanticGenerationRequest } from "../interpretation/semantic-request.js";
import {
  SemanticInterpretationCandidateSchema,
  type SemanticInterpretationCandidate
} from "../interpretation/semantic-model-contract.js";
import type {
  GenerationStore,
  SessionRecord
} from "../server/generation/contracts.js";
import { GENERATION_OPENAI_PRICE } from "../server/generation/cost-envelope.js";
import { generationKeys } from "../server/generation/keys.js";
import { GENERATION_POLICY } from "../server/generation/policy.js";
import {
  semanticReviewPatchSchema,
  SemanticReviewTriggerDecisionSchema,
  type SemanticReviewPatch,
  type SemanticReviewTriggerDecision
} from "./bounded-semantic-review.js";
import {
  SemanticReviewTransportOutcomeSchema,
  type SemanticReviewTransportOutcome
} from "./openai-semantic-review-transport.js";

export const SemanticReviewDispatchResultSchema = z.object({
  status: z.enum(["skipped", "completed", "failed"]),
  patch: z.unknown().nullable(),
  attempt: LiveCallAttemptSchema.nullable()
}).strict();

export type SemanticReviewDispatchResult = {
  status: "skipped" | "completed" | "failed";
  patch: SemanticReviewPatch | null;
  attempt: LiveCallAttempt | null;
};

function opaqueId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll("-", "")}`;
}

function unavailable(
  reason:
    | "not-dispatched"
    | "no-response"
    | "provider-omitted"
    | "authoritative-not-accepted",
) {
  return { status: "unavailable" as const, reason };
}

export async function dispatchEvaluationSemanticReview(input: {
  store: GenerationStore;
  session: SessionRecord;
  clientIdentifier: string;
  request: SemanticGenerationRequest;
  callARequestDigest: string;
  candidate: SemanticInterpretationCandidate;
  triggerDecision: SemanticReviewTriggerDecision;
  deterministicDiagnostics: unknown;
  transport: {
    dispatch(reviewInput: {
      request: SemanticGenerationRequest;
      candidate: SemanticInterpretationCandidate;
      triggerDecision: SemanticReviewTriggerDecision;
      deterministicDiagnostics: unknown;
      clientRequestId: string;
    }): Promise<SemanticReviewTransportOutcome>;
  };
  reviewPromptHash: string;
  runtimeOrigin: LiveCallRuntimeOrigin;
  now?: () => number;
}): Promise<SemanticReviewDispatchResult> {
  const candidate = SemanticInterpretationCandidateSchema.parse(
    input.candidate,
  );
  const triggerDecision = SemanticReviewTriggerDecisionSchema.parse(
    input.triggerDecision,
  );
  if (!triggerDecision.eligible) {
    return {
      status: "skipped",
      patch: null,
      attempt: null
    };
  }
  const patchSchema = semanticReviewPatchSchema({
    candidate,
    sourceEvidenceIndex: input.request.sourceEvidenceIndex
  });
  const reviewRequestDigest = await hashCanonical({
    callARequestDigest: input.callARequestDigest,
    callACandidateDigest: await hashCanonical(candidate),
    triggerDecision
  });
  const context = {
    attemptId: opaqueId("attempt-review"),
    submissionId: opaqueId("submission-review"),
    retryChainId: opaqueId("retry-chain-review"),
    clientRequestId: opaqueId("client-request-review"),
    occurredAt: new Date(input.now?.() ?? Date.now()).toISOString(),
    schemaHash: await hashCanonical(z.toJSONSchema(patchSchema, {
      target: "draft-7"
    })),
    modelConfigurationHash: await hashCanonical({
      ...input.request.modelConfiguration,
      reviewContract: "bounded-semantic-review-current"
    })
  };
  const base = {
    schemaVersion: "1.0" as const,
    attemptId: context.attemptId,
    submissionId: context.submissionId,
    retryChainId: context.retryChainId,
    retryOfAttemptId: null,
    initiatedBy: "live-eval" as const,
    runtimeOrigin: input.runtimeOrigin,
    attemptOrdinal: 1,
    semanticRequestDigest: reviewRequestDigest,
    promptHash: input.reviewPromptHash,
    schemaHash: context.schemaHash,
    capabilityCatalogHash: await hashCanonical(CAPABILITY_CATALOG),
    modelConfigurationHash: context.modelConfigurationHash,
    modelId: input.request.modelConfiguration.modelId,
    reasoningEffort: input.request.modelConfiguration.reasoningEffort,
    imageDetailPolicy: input.request.modelConfiguration.imageDetailPolicy,
    promptLayoutVersion: "bounded-semantic-review-current-v1",
    clientRequestId: context.clientRequestId,
    occurredAt: context.occurredAt,
    cacheResult: "miss" as const,
    supportStateCorrect: null,
    elicitationTelemetry: undefined
  };
  const record = async (
    fields: Omit<z.input<typeof LiveCallAttemptSchema>, keyof typeof base>,
  ): Promise<LiveCallAttempt> => {
    const attempt = LiveCallAttemptSchema.parse({ ...base, ...fields });
    await input.store.appendLedgerAttempt(attempt);
    return attempt;
  };
  let reservation;
  try {
    reservation = await input.store.reserveGeneration({
      sessionId: input.session.sessionId,
      clientKey: generationKeys.generationClient(
        `${input.clientIdentifier}-review`,
      ),
      nowMs: input.now?.() ?? Date.now(),
      minimumIntervalMs: 0,
      maximumSessionDispatches:
        GENERATION_POLICY.generation.maximumDispatchesPerSession,
      requestExposureMicrousd:
        GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd,
      maximumSessionExposureMicrousd:
        GENERATION_POLICY.generation.maximumSessionExposureMicrousd,
      clientWindowMs: GENERATION_POLICY.generation.clientWindowMs,
      maximumClientDispatches:
        GENERATION_POLICY.generation.maximumDispatchesPerClientPerHour
    });
  } catch {
    reservation = null;
  }
  if (reservation?.allowed !== true) {
    const attempt = await record({
      providerRequestId: null,
      providerModelId: null,
      responseId: null,
      finishState: "not-observed",
      dispatchState: "not-dispatched",
      outcome: "pre-dispatch-failure",
      latencyMs: 0,
      errorCode: reservation === null
        ? "SEMANTIC_REVIEW_RESERVATION_UNAVAILABLE"
        : `SEMANTIC_REVIEW_${reservation.reason
            .replaceAll("-", "_")
            .toUpperCase()}`,
      networkDispatchCount: 0,
      strictParse: "not-attempted",
      deterministicCompile: "not-run",
      usage: unavailable("not-dispatched"),
      billing: {
        state: "not-applicable",
        estimatedCostUsd: 0,
        requestBudgetUpperBoundUsd: null,
        priceSnapshotId: null
      }
    });
    return { status: "failed", patch: null, attempt };
  }
  const outcome = SemanticReviewTransportOutcomeSchema.parse(
    await input.transport.dispatch({
      request: input.request,
      candidate,
      triggerDecision,
      deterministicDiagnostics: input.deterministicDiagnostics,
      clientRequestId: context.clientRequestId
    }),
  );
  if (outcome.kind === "completed") {
    const parsedPatch = patchSchema.safeParse(outcome.reviewPatch);
    if (!parsedPatch.success) {
      const attempt = await record({
        providerRequestId: outcome.providerRequestId,
        providerModelId: outcome.providerModelId,
        responseId: outcome.responseId,
        finishState: outcome.finishState,
        dispatchState: "response-observed",
        outcome: "schema-failure",
        latencyMs: outcome.latencyMs,
        errorCode: "STRICT_SEMANTIC_REVIEW_PATCH_SCHEMA_FAILURE",
        networkDispatchCount: 1,
        strictParse: "failed",
        schemaFailureIssues: parsedPatch.error.issues.slice(0, 32).map(
          (issue) => ({
            code: issue.code,
            path: issue.path.join(".")
          }),
        ),
        deterministicCompile: "not-run",
        usage: { status: "reported", ...outcome.usage },
        billing: {
          state: "confirmed-billed",
          estimatedCostUsd: outcome.estimatedCostUsd,
          requestBudgetUpperBoundUsd:
            outcome.requestBudgetUpperBoundUsd,
          priceSnapshotId: outcome.priceSnapshotId
        }
      });
      return { status: "failed", patch: null, attempt };
    }
    const attempt = await record({
      providerRequestId: outcome.providerRequestId,
      providerModelId: outcome.providerModelId,
      responseId: outcome.responseId,
      finishState: outcome.finishState,
      dispatchState: "response-observed",
      outcome: "completed",
      latencyMs: outcome.latencyMs,
      errorCode: null,
      networkDispatchCount: 1,
      strictParse: "passed",
      deterministicCompile: "not-run",
      usage: { status: "reported", ...outcome.usage },
      billing: {
        state: "confirmed-billed",
        estimatedCostUsd: outcome.estimatedCostUsd,
        requestBudgetUpperBoundUsd:
          outcome.requestBudgetUpperBoundUsd,
        priceSnapshotId: outcome.priceSnapshotId
      }
    });
    return {
      status: "completed",
      patch: parsedPatch.data,
      attempt
    };
  }
  if (outcome.kind === "pre-dispatch-failure") {
    const attempt = await record({
      providerRequestId: null,
      providerModelId: null,
      responseId: null,
      finishState: "not-observed",
      dispatchState: "not-dispatched",
      outcome: "pre-dispatch-failure",
      latencyMs: 0,
      errorCode: outcome.errorCode,
      networkDispatchCount: 0,
      strictParse: "not-attempted",
      deterministicCompile: "not-run",
      usage: unavailable("not-dispatched"),
      billing: {
        state: "not-applicable",
        estimatedCostUsd: 0,
        requestBudgetUpperBoundUsd: null,
        priceSnapshotId: null
      }
    });
    return { status: "failed", patch: null, attempt };
  }
  if (outcome.kind === "provider-not-accepted") {
    const attempt = await record({
      providerRequestId: outcome.providerRequestId,
      providerModelId: null,
      responseId: null,
      finishState: "not-observed",
      dispatchState: "transport-handoff",
      outcome: "provider-not-accepted",
      latencyMs: outcome.latencyMs,
      errorCode: outcome.errorCode,
      networkDispatchCount: 1,
      strictParse: "not-attempted",
      deterministicCompile: "not-run",
      usage: unavailable("authoritative-not-accepted"),
      billing: {
        state: "confirmed-not-billed",
        estimatedCostUsd: 0,
        requestBudgetUpperBoundUsd: null,
        priceSnapshotId: null
      }
    });
    return { status: "failed", patch: null, attempt };
  }
  if (outcome.kind === "ambiguous-transport") {
    const attempt = await record({
      providerRequestId: outcome.providerRequestId,
      providerModelId: null,
      responseId: null,
      finishState: "unknown",
      dispatchState: "transport-handoff",
      outcome: "ambiguous-transport",
      latencyMs: outcome.latencyMs,
      errorCode: outcome.errorCode,
      networkDispatchCount: 1,
      strictParse: "not-attempted",
      deterministicCompile: "not-run",
      usage: unavailable("no-response"),
      billing: {
        state: "potentially-billed",
        estimatedCostUsd: null,
        requestBudgetUpperBoundUsd:
          outcome.requestBudgetUpperBoundUsd,
        priceSnapshotId: outcome.priceSnapshotId
      }
    });
    return { status: "failed", patch: null, attempt };
  }
  const attempt = await record({
    providerRequestId: outcome.providerRequestId,
    providerModelId: outcome.providerModelId,
    responseId: outcome.responseId,
    finishState: outcome.finishState,
    dispatchState: "response-observed",
    outcome: "model-failure",
    latencyMs: outcome.latencyMs,
    errorCode: outcome.errorCode,
    networkDispatchCount: 1,
    strictParse: "not-attempted",
    deterministicCompile: "not-run",
    usage: { status: "reported", ...outcome.usage },
    billing: {
      state: "confirmed-billed",
      estimatedCostUsd: outcome.estimatedCostUsd,
      requestBudgetUpperBoundUsd: outcome.requestBudgetUpperBoundUsd,
      priceSnapshotId: outcome.priceSnapshotId
    }
  });
  return { status: "failed", patch: null, attempt };
}

export const SEMANTIC_REVIEW_DISPATCH_EXPOSURE = {
  requestBudgetUpperBoundUsd:
    GENERATION_OPENAI_PRICE.requestBudgetUpperBoundUsd,
  requestBudgetUpperBoundMicrousd:
    GENERATION_POLICY.generation.requestBudgetUpperBoundMicrousd,
  automaticRetry: false,
  candidateFanOut: false,
  fallbackModel: false,
  maximumCallBPerCase: 1
} as const;
