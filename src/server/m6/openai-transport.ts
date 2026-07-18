import OpenAI from "openai";

import { CAPABILITY_CATALOG_V1 } from "../../interpretation/capability-catalog.js";
import { INTENT_GRAPH_V1_JSON_SCHEMA } from "../../interpretation/intent-graph.js";
import type {
  SemanticInterpretationTransport,
  SemanticTransportOutcome
} from "../../interpretation/orchestrator.js";
import type { SemanticGenerationRequestV1 } from "../../interpretation/semantic-request.js";

export const M6_OPENAI_MODEL = "gpt-5.6-terra" as const;
export const M6_PROMPT_VERSION = "m5-interpretation-prompt@1.0.2" as const;
export const M6_OPENAI_MAX_RETRIES = 0 as const;
export const M6_TERRA_PRICE = {
  id: "openai-public-pricing-2026-07-17-gpt-5-6-terra",
  uncachedInputUsdPerMillion: 2.5,
  cachedInputUsdPerMillion: 0.25,
  outputUsdPerMillion: 15,
  requestBudgetUpperBoundUsd: 0.25
} as const;

type ReferencePayload = { referenceId: string; dataUrl: string };

function estimatedCost(input: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}): number {
  const uncachedInput = Math.max(0, input.inputTokens - input.cachedInputTokens);
  return Number((
    uncachedInput * M6_TERRA_PRICE.uncachedInputUsdPerMillion / 1_000_000 +
    input.cachedInputTokens * M6_TERRA_PRICE.cachedInputUsdPerMillion / 1_000_000 +
    input.outputTokens * M6_TERRA_PRICE.outputUsdPerMillion / 1_000_000
  ).toFixed(8));
}

function privacySafeErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as { code?: unknown; error?: { code?: unknown }; status?: unknown };
    const source = typeof record.code === "string" ? record.code : record.error?.code;
    if (typeof source === "string") {
      const normalized = source.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")
        .replaceAll(/^_+|_+$/g, "").slice(0, 80);
      if (normalized.length > 0) return `OPENAI_${normalized}`;
    }
    if (typeof record.status === "number") return `OPENAI_HTTP_${String(record.status)}`;
  }
  if (error instanceof Error && /timeout/i.test(error.name + error.message)) {
    return "OPENAI_TRANSPORT_TIMEOUT";
  }
  return "OPENAI_TRANSPORT_FAILURE";
}

function providerRequestId(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  for (const key of ["request_id", "requestID", "_request_id"] as const) {
    const candidate = (error as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function authoritativeProviderRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 400 && status < 500;
}

export class M6OpenAITransport implements SemanticInterpretationTransport {
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
      throw new Error("M61_TEST_LIVE_TRANSPORT_FORBIDDEN");
    }
    this.#client = input.client ?? new OpenAI({
      apiKey: input.apiKey,
      maxRetries: M6_OPENAI_MAX_RETRIES
    });
    this.#prompt = input.prompt;
    this.#references = input.references.map((reference) => ({ ...reference }));
  }

  async dispatch(input: {
    request: SemanticGenerationRequestV1;
    clientRequestId: string;
  }): Promise<SemanticTransportOutcome> {
    const startedAt = performance.now();
    let handedOff = false;
    try {
      const referenceById = new Map(this.#references.map((item) => [item.referenceId, item]));
      const content: OpenAI.Responses.ResponseInputContent[] = [{
        type: "input_text",
        text: JSON.stringify({
          normalizedBrief: input.request.normalizedBrief,
          references: input.request.references,
          roleConstraints: input.request.roleConstraints,
          capabilityCatalog: CAPABILITY_CATALOG_V1,
          conflictPolicy: "Explicit text requirements override conflicting reference observations."
        })
      }];
      for (const descriptor of input.request.references) {
        const reference = referenceById.get(descriptor.referenceId);
        if (reference === undefined) {
          return { kind: "pre-dispatch-failure", errorCode: "REFERENCE_PAYLOAD_MISSING" };
        }
        content.push({
          type: "input_text",
          text: `Reference ${descriptor.referenceId}. Apply any explicit role constraint exactly.`
        });
        content.push({ type: "input_image", detail: "low", image_url: reference.dataUrl });
      }
      handedOff = true;
      const response = await this.#client.responses.create({
        model: M6_OPENAI_MODEL,
        instructions: this.#prompt,
        input: [{ role: "user", content }],
        max_output_tokens: 4_000,
        reasoning: { effort: "low" },
        service_tier: "default",
        store: false,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "sketchycut_intent_graph_v1",
            description: "Semantic fabrication intent without CAD coordinates or contours.",
            strict: true,
            schema: INTENT_GRAPH_V1_JSON_SCHEMA
          }
        },
        metadata: {
          client_request_id: input.clientRequestId,
          prompt_version: input.request.promptVersion
        }
      }, { headers: { "X-Client-Request-Id": input.clientRequestId } });
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const usage = response.usage;
      if (usage === undefined || response._request_id === undefined || response._request_id === null) {
        throw Object.assign(new Error("OPENAI_RESPONSE_PROVENANCE_INCOMPLETE"), {
          _request_id: response._request_id
        });
      }
      const reportedUsage = {
        inputTokens: usage.input_tokens,
        cachedInputTokens: usage.input_tokens_details.cached_tokens,
        reasoningTokens: usage.output_tokens_details.reasoning_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens
      };
      const common = {
        providerRequestId: response._request_id,
        responseId: response.id,
        latencyMs,
        usage: reportedUsage,
        estimatedCostUsd: estimatedCost(reportedUsage),
        requestBudgetUpperBoundUsd: M6_TERRA_PRICE.requestBudgetUpperBoundUsd,
        priceSnapshotId: M6_TERRA_PRICE.id
      };
      if (response.status !== "completed" || response.error !== null || response.output_text.length === 0) {
        return {
          kind: "model-failure",
          ...common,
          errorCode: response.incomplete_details?.reason === "max_output_tokens"
            ? "MODEL_OUTPUT_TOKEN_LIMIT"
            : response.error === null ? "MODEL_RESPONSE_INCOMPLETE" : "MODEL_RESPONSE_ERROR"
        };
      }
      let intentCandidate: unknown;
      try {
        intentCandidate = JSON.parse(response.output_text) as unknown;
      } catch {
        intentCandidate = response.output_text;
      }
      return { kind: "completed", ...common, intentCandidate };
    } catch (error) {
      if (!handedOff) return { kind: "pre-dispatch-failure", errorCode: "REFERENCE_PAYLOAD_MISSING" };
      const common = {
        providerRequestId: providerRequestId(error),
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        errorCode: privacySafeErrorCode(error)
      };
      return authoritativeProviderRejection(error)
        ? { kind: "provider-not-accepted", ...common }
        : {
            kind: "ambiguous-transport",
            ...common,
            requestBudgetUpperBoundUsd: M6_TERRA_PRICE.requestBudgetUpperBoundUsd,
            priceSnapshotId: M6_TERRA_PRICE.id
          };
    }
  }
}
