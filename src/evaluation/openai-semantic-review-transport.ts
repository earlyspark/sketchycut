import { createHash } from "node:crypto";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";
import type { SemanticGenerationRequest } from "../interpretation/semantic-request.js";
import {
  SemanticInterpretationCandidateSchema,
  type SemanticInterpretationCandidate
} from "../interpretation/semantic-model-contract.js";
import {
  GENERATION_OPENAI_MAX_RETRIES,
  GENERATION_OPENAI_MODEL,
  GENERATION_OPENAI_PRICE,
  estimateGenerationCostUsd,
  evaluateGenerationCostEnvelope
} from "../server/generation/cost-envelope.js";
import {
  CURRENT_BOUNDED_SEMANTIC_REVIEW_PROMPT_IDENTITY,
  CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION,
  semanticReviewPatchSchema,
  SemanticReviewTriggerDecisionSchema,
  type SemanticReviewTriggerDecision
} from "./bounded-semantic-review.js";

type ReferencePayload = {
  referenceId: string;
  dataUrl: string;
};

const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteInputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative()
}).strict();

const ConfirmedFieldsSchema = z.object({
  providerRequestId: z.string().min(1).max(512),
  providerModelId: z.string().min(1).max(120).nullable(),
  responseId: z.string().min(1).max(512).nullable(),
  finishState: z.enum([
    "completed",
    "incomplete",
    "failed",
    "cancelled",
    "unknown"
  ]),
  latencyMs: z.number().int().nonnegative(),
  usage: UsageSchema,
  estimatedCostUsd: z.number().nonnegative(),
  requestBudgetUpperBoundUsd: z.number().nonnegative(),
  priceSnapshotId: z.string().min(1).max(120)
});

export const SemanticReviewTransportOutcomeSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("pre-dispatch-failure"),
      errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/u)
    }).strict(),
    ConfirmedFieldsSchema.extend({
      kind: z.literal("completed"),
      reviewPatch: z.unknown()
    }).strict(),
    ConfirmedFieldsSchema.extend({
      kind: z.literal("model-failure"),
      errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/u)
    }).strict(),
    z.object({
      kind: z.literal("provider-not-accepted"),
      providerRequestId: z.string().min(1).max(512).nullable(),
      latencyMs: z.number().int().nonnegative(),
      errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/u)
    }).strict(),
    z.object({
      kind: z.literal("ambiguous-transport"),
      providerRequestId: z.string().min(1).max(512).nullable(),
      latencyMs: z.number().int().nonnegative().nullable(),
      requestBudgetUpperBoundUsd: z.number().nonnegative(),
      priceSnapshotId: z.string().min(1).max(120),
      errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/u)
    }).strict()
  ],
);

export type SemanticReviewTransportOutcome = z.infer<
  typeof SemanticReviewTransportOutcomeSchema
>;

function privacySafeErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as {
      code?: unknown;
      error?: { code?: unknown };
      status?: unknown;
    };
    const source = typeof record.code === "string"
      ? record.code
      : record.error?.code;
    if (typeof source === "string") {
      const normalized = source.toUpperCase()
        .replaceAll(/[^A-Z0-9]+/gu, "_")
        .replaceAll(/^_+|_+$/gu, "")
        .slice(0, 80);
      if (normalized.length > 0) return `OPENAI_${normalized}`;
    }
    if (typeof record.status === "number") {
      return `OPENAI_HTTP_${String(record.status)}`;
    }
  }
  if (
    error instanceof Error &&
    /timeout/iu.test(error.name + error.message)
  ) {
    return "OPENAI_TRANSPORT_TIMEOUT";
  }
  return "OPENAI_TRANSPORT_FAILURE";
}
function providerRequestId(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  for (const key of ["request_id", "requestID", "_request_id"] as const) {
    const candidate = (error as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

function authoritativeProviderRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 400 && status < 500;
}

export function semanticReviewPromptCacheKey(prompt: string): string {
  const digest = createHash("sha256").update(JSON.stringify({
    model: GENERATION_OPENAI_MODEL,
    prompt,
    promptIdentity: CURRENT_BOUNDED_SEMANTIC_REVIEW_PROMPT_IDENTITY,
    contractVersion: CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION
  })).digest("hex");
  return `sketchycut-semantic-review-${digest.slice(0, 32)}`;
}

export class OpenAISemanticReviewTransport {
  readonly #client: OpenAI;
  readonly #prompt: string;
  readonly #references: readonly ReferencePayload[];

  constructor(input: {
    apiKey: string;
    prompt: string;
    references: readonly ReferencePayload[];
    client?: OpenAI;
  }) {
    if (process.env.SKETCHYCUT_TEST_MODE === "1") {
      throw new Error("GENERATION_TEST_LIVE_TRANSPORT_FORBIDDEN");
    }
    this.#client = input.client ?? new OpenAI({
      apiKey: input.apiKey,
      maxRetries: GENERATION_OPENAI_MAX_RETRIES
    });
    this.#prompt = input.prompt;
    this.#references = input.references.map((reference) => ({
      ...reference
    }));
  }

  async dispatch(input: {
    request: SemanticGenerationRequest;
    candidate: SemanticInterpretationCandidate;
    triggerDecision: SemanticReviewTriggerDecision;
    deterministicDiagnostics: unknown;
    clientRequestId: string;
  }): Promise<SemanticReviewTransportOutcome> {
    try {
      const candidate = SemanticInterpretationCandidateSchema.parse(
        input.candidate,
      );
      const triggerDecision = SemanticReviewTriggerDecisionSchema.parse(
        input.triggerDecision,
      );
      if (!triggerDecision.eligible) {
        return {
          kind: "pre-dispatch-failure",
          errorCode: "SEMANTIC_REVIEW_TRIGGER_REQUIRED"
        };
      }
      const patchSchema = semanticReviewPatchSchema({
        candidate,
        sourceEvidenceIndex: input.request.sourceEvidenceIndex
      });
      const payload = {
        semanticBrief: input.request.semanticBrief,
        sourceEvidenceIndex: input.request.sourceEvidenceIndex,
        references: input.request.references,
        roleConstraints: input.request.roleConstraints,
        callACandidate: candidate,
        callACandidateDigest: await hashCanonical(candidate),
        triggerDecision,
        deterministicDiagnostics: input.deterministicDiagnostics
      };
      const providerSchema = z.toJSONSchema(patchSchema, {
        target: "draft-7"
      });
      const envelope = evaluateGenerationCostEnvelope({
        modelTextInput:
          `${this.#prompt}\n${JSON.stringify(payload)}\n` +
          JSON.stringify(providerSchema),
        referenceCount: input.request.references.length,
        imageDetailPolicy: input.request.modelConfiguration.imageDetailPolicy
      });
      if (!envelope.withinDeclaredEnvelope) {
        return {
          kind: "pre-dispatch-failure",
          errorCode: "SEMANTIC_REVIEW_COST_ENVELOPE_EXCEEDED"
        };
      }
      const content: OpenAI.Responses.ResponseInputContent[] = [{
        type: "input_text",
        text: JSON.stringify(payload)
      }];
      const referenceById = new Map(
        this.#references.map((reference) =>
          [reference.referenceId, reference] as const
        ),
      );
      for (const descriptor of input.request.references) {
        const reference = referenceById.get(descriptor.referenceId);
        if (reference === undefined) {
          return {
            kind: "pre-dispatch-failure",
            errorCode: "REFERENCE_PAYLOAD_MISSING"
          };
        }
        content.push({
          type: "input_text",
          text:
            `Reference ${descriptor.referenceId}. Its declared role ` +
            "constraint remains authoritative."
        });
        content.push({
          type: "input_image",
          detail: input.request.modelConfiguration.imageDetailPolicy ===
            "mixed-first-high"
            ? descriptor.referenceId ===
                input.request.references[0]?.referenceId
              ? "high"
              : "low"
            : input.request.modelConfiguration.imageDetailPolicy,
          image_url: reference.dataUrl
        });
      }
      return await this.#dispatchStructured({
        request: input.request,
        candidateSchema: patchSchema,
        content,
        clientRequestId: input.clientRequestId
      });
    } catch {
      return {
        kind: "pre-dispatch-failure",
        errorCode: "SEMANTIC_REVIEW_LOCAL_PREPARATION_FAILED"
      };
    }
  }

  async #dispatchStructured(input: {
    request: SemanticGenerationRequest;
    candidateSchema: ReturnType<typeof semanticReviewPatchSchema>;
    content: OpenAI.Responses.ResponseInputContent[];
    clientRequestId: string;
  }): Promise<SemanticReviewTransportOutcome> {
    const startedAt = performance.now();
    let handedOff = false;
    try {
      handedOff = true;
      const response = await this.#client.responses.parse({
        model: GENERATION_OPENAI_MODEL,
        prompt_cache_key: semanticReviewPromptCacheKey(this.#prompt),
        instructions: this.#prompt,
        input: [{ role: "user", content: input.content }],
        max_output_tokens: input.request.modelConfiguration.maxOutputTokens,
        reasoning: {
          effort: input.request.modelConfiguration.reasoningEffort
        },
        service_tier: "default",
        store: false,
        text: {
          verbosity: "low",
          format: zodTextFormat(
            input.candidateSchema,
            "sketchycut_bounded_semantic_review",
            {
              description:
                "Atomic semantic-only patch over existing Call A items."
            },
          )
        },
        metadata: {
          client_request_id: input.clientRequestId,
          prompt_identity:
            CURRENT_BOUNDED_SEMANTIC_REVIEW_PROMPT_IDENTITY
        }
      }, {
        headers: {
          "X-Client-Request-Id": input.clientRequestId
        }
      });
      const latencyMs = Math.max(
        0,
        Math.round(performance.now() - startedAt),
      );
      const usage = response.usage;
      if (
        usage === undefined ||
        response._request_id === undefined ||
        response._request_id === null
      ) {
        throw Object.assign(
          new Error("OPENAI_RESPONSE_PROVENANCE_INCOMPLETE"),
          { _request_id: response._request_id },
        );
      }
      const reportedUsage = {
        inputTokens: usage.input_tokens,
        cachedInputTokens: usage.input_tokens_details.cached_tokens,
        cacheWriteInputTokens:
          usage.input_tokens_details.cache_write_tokens,
        reasoningTokens: usage.output_tokens_details.reasoning_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens
      };
      const common = {
        providerRequestId: response._request_id,
        providerModelId: response.model,
        responseId: response.id,
        finishState: response.status === "completed"
          ? "completed" as const
          : response.status === "incomplete"
            ? "incomplete" as const
            : response.status === "failed"
              ? "failed" as const
              : response.status === "cancelled"
                ? "cancelled" as const
                : "unknown" as const,
        latencyMs,
        usage: reportedUsage,
        estimatedCostUsd: estimateGenerationCostUsd({
          inputTokens: reportedUsage.inputTokens,
          cachedInputTokens: reportedUsage.cachedInputTokens,
          cacheWriteInputTokens: reportedUsage.cacheWriteInputTokens,
          outputTokens: reportedUsage.outputTokens
        }),
        requestBudgetUpperBoundUsd:
          GENERATION_OPENAI_PRICE.requestBudgetUpperBoundUsd,
        priceSnapshotId: GENERATION_OPENAI_PRICE.id
      };
      const refused = response.output.some((item) =>
        item.type === "message" &&
        item.content.some((content) => content.type === "refusal")
      );
      if (
        response.status !== "completed" ||
        response.error !== null ||
        refused ||
        response.output_parsed === null
      ) {
        return {
          kind: "model-failure",
          ...common,
          errorCode: refused
            ? "MODEL_RESPONSE_REFUSAL"
            : response.incomplete_details?.reason === "max_output_tokens"
              ? "MODEL_OUTPUT_TOKEN_LIMIT"
              : response.error === null
                ? response.output_parsed === null
                  ? "MODEL_PARSED_OUTPUT_MISSING"
                  : "MODEL_RESPONSE_INCOMPLETE"
                : "MODEL_RESPONSE_ERROR"
        };
      }
      return {
        kind: "completed",
        ...common,
        reviewPatch: response.output_parsed
      };
    } catch (error) {
      if (!handedOff) {
        return {
          kind: "pre-dispatch-failure",
          errorCode: "SEMANTIC_REVIEW_LOCAL_PREPARATION_FAILED"
        };
      }
      const common = {
        providerRequestId: providerRequestId(error),
        latencyMs: Math.max(
          0,
          Math.round(performance.now() - startedAt),
        ),
        errorCode: privacySafeErrorCode(error)
      };
      if (authoritativeProviderRejection(error)) {
        return {
          kind: "provider-not-accepted",
          ...common
        };
      }
      return {
        kind: "ambiguous-transport",
        ...common,
        requestBudgetUpperBoundUsd:
          GENERATION_OPENAI_PRICE.requestBudgetUpperBoundUsd,
        priceSnapshotId: GENERATION_OPENAI_PRICE.id
      };
    }
  }
}
