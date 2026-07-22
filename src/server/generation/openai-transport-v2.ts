import OpenAI from "openai";
import { createHash } from "node:crypto";

import { CAPABILITY_CATALOG_V1 } from "../../interpretation/capability-catalog.js";
import { INTENT_GRAPH_V2_JSON_SCHEMA, intentGraphV2ProviderSchema } from "../../interpretation/intent-graph-v2.js";
import { CURRENT_INTENT_SCHEMA_ID, type SemanticGenerationRequestV2 } from "../../interpretation/semantic-request-v2.js";
import type {
  SemanticInterpretationTransportV2,
  SemanticTransportOutcome
} from "../../interpretation/semantic-transport.js";
import {
  CURRENT_IMAGE_DETAIL_POLICY,
  CURRENT_PROMPT_LAYOUT_VERSION,
  CURRENT_REASONING_EFFORT
} from "../../interpretation/semantic-input-contracts.js";
import {
  GENERATION_OPENAI_MAX_RETRIES,
  GENERATION_OPENAI_MODEL,
  GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT,
  GENERATION_OPENAI_PRICE,
  estimateGenerationCostUsd,
  evaluateGenerationCostEnvelope
} from "./cost-envelope.js";
import {
  instructionsForPromptLayout,
  REFERENCE_CONFLICT_POLICY,
  requestLocalControlPayload,
  stablePrefixInstructions
} from "./reference-interpretation-prompt.js";

type ReferencePayload = { referenceId: string; dataUrl: string };

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
  if (error instanceof Error && /timeout/i.test(error.name + error.message)) return "OPENAI_TRANSPORT_TIMEOUT";
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

function semanticPayload(request: SemanticGenerationRequestV2) {
  return {
    conflictPolicy: REFERENCE_CONFLICT_POLICY,
    semanticBrief: request.semanticBrief,
    sourceEvidenceIndex: request.sourceEvidenceIndex,
    references: request.references,
    roleConstraints: request.roleConstraints
  };
}

export function generationPromptCacheKey(
  prompt: string,
  configuration: Pick<SemanticGenerationRequestV2["modelConfiguration"], "reasoningEffort" | "imageDetailPolicy" | "promptLayoutVersion"> = {
    reasoningEffort: CURRENT_REASONING_EFFORT,
    imageDetailPolicy: CURRENT_IMAGE_DETAIL_POLICY,
    promptLayoutVersion: CURRENT_PROMPT_LAYOUT_VERSION
  },
): string {
  const instructionPrefix = configuration.promptLayoutVersion === "stable-prefix-v2"
    ? stablePrefixInstructions(prompt)
    : prompt.trim();
  const responseAffectingConfiguration = {
    reasoningEffort: configuration.reasoningEffort,
    imageDetailPolicy: configuration.imageDetailPolicy,
    promptLayoutVersion: configuration.promptLayoutVersion
  };
  const digest = createHash("sha256").update(JSON.stringify({
    model: GENERATION_OPENAI_MODEL,
    configuration: responseAffectingConfiguration,
    instructionPrefix,
    capabilityCatalog: CAPABILITY_CATALOG_V1,
    intentSchemaId: CURRENT_INTENT_SCHEMA_ID,
    intentSchema: INTENT_GRAPH_V2_JSON_SCHEMA
  })).digest("hex");
  return `sketchycut-generation-${digest.slice(0, 32)}`;
}

export class OpenAITransportV2 implements SemanticInterpretationTransportV2 {
  readonly #client: OpenAI;
  readonly #basePrompt: string;
  readonly #references: readonly ReferencePayload[];
  readonly #promptCacheKeyOverride: string | undefined;

  constructor(input: { apiKey: string; prompt: string; references: readonly ReferencePayload[]; promptCacheKey?: string; client?: OpenAI }) {
    if (process.env.SKETCHYCUT_TEST_MODE === "1") throw new Error("GENERATION_TEST_LIVE_TRANSPORT_FORBIDDEN");
    this.#client = input.client ?? new OpenAI({ apiKey: input.apiKey, maxRetries: GENERATION_OPENAI_MAX_RETRIES });
    this.#basePrompt = input.prompt;
    this.#references = input.references.map((item) => ({ ...item }));
    this.#promptCacheKeyOverride = input.promptCacheKey;
  }

  async dispatch(input: {
    request: SemanticGenerationRequestV2;
    clientRequestId: string;
  }): Promise<SemanticTransportOutcome> {
    const startedAt = performance.now();
    let handedOff = false;
    try {
      const semantic = semanticPayload(input.request);
      const stableLayout = input.request.modelConfiguration.promptLayoutVersion === "stable-prefix-v2";
      const instructions = instructionsForPromptLayout(
        this.#basePrompt,
        input.request.modelConfiguration.promptLayoutVersion,
      );
      const providerSchema = intentGraphV2ProviderSchema(input.request.sourceEvidenceIndex);
      const payload = stableLayout ? semantic : requestLocalControlPayload(semantic);
      const envelope = evaluateGenerationCostEnvelope({
        modelTextInput: `${instructions}\n${JSON.stringify(payload)}\n${JSON.stringify(providerSchema)}`,
        referenceCount: input.request.references.length,
        imageDetailPolicy: input.request.modelConfiguration.imageDetailPolicy
      });
      if (!envelope.withinDeclaredEnvelope) {
        return { kind: "pre-dispatch-failure", errorCode: "GENERATION_COST_ENVELOPE_EXCEEDED" };
      }
      const referenceById = new Map(this.#references.map((item) => [item.referenceId, item]));
      const content: OpenAI.Responses.ResponseInputContent[] = [{ type: "input_text", text: JSON.stringify(payload) }];
      for (const descriptor of input.request.references) {
        const reference = referenceById.get(descriptor.referenceId);
        if (reference === undefined) return { kind: "pre-dispatch-failure", errorCode: "REFERENCE_PAYLOAD_MISSING" };
        content.push({ type: "input_text", text: `Reference ${descriptor.referenceId}. Apply its declared role constraint exactly when one is present.` });
        const policy = input.request.modelConfiguration.imageDetailPolicy;
        const detail = policy === "mixed-first-high"
          ? descriptor.referenceId === input.request.references[0]?.referenceId ? "high" : "low"
          : policy;
        content.push({ type: "input_image", detail, image_url: reference.dataUrl });
      }
      handedOff = true;
      const response = await this.#client.responses.create({
        model: GENERATION_OPENAI_MODEL,
        prompt_cache_key: this.#promptCacheKeyOverride ?? generationPromptCacheKey(
          this.#basePrompt,
          input.request.modelConfiguration,
        ),
        instructions,
        input: [{ role: "user", content }],
        max_output_tokens: GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT,
        reasoning: { effort: input.request.modelConfiguration.reasoningEffort },
        service_tier: "default",
        store: false,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "sketchycut_intent_graph_v2",
            description: "Semantic fabrication intent without project dimensions, CAD geometry, or fabrication claims.",
            strict: true,
            schema: providerSchema
          }
        },
        metadata: {
          client_request_id: input.clientRequestId,
          prompt_identity: input.request.promptIdentity
        }
      }, { headers: { "X-Client-Request-Id": input.clientRequestId } });
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const usage = response.usage;
      if (usage === undefined || response._request_id === undefined || response._request_id === null) {
        throw Object.assign(new Error("OPENAI_RESPONSE_PROVENANCE_INCOMPLETE"), { _request_id: response._request_id });
      }
      const reportedUsage = {
        inputTokens: usage.input_tokens,
        cachedInputTokens: usage.input_tokens_details.cached_tokens,
        cacheWriteInputTokens: usage.input_tokens_details.cache_write_tokens,
        reasoningTokens: usage.output_tokens_details.reasoning_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens
      };
      const common = {
        providerRequestId: response._request_id,
        providerModelId: response.model,
        responseId: response.id,
        finishState: response.status === "completed" ? "completed" as const
          : response.status === "incomplete" ? "incomplete" as const
          : response.status === "failed" ? "failed" as const
          : response.status === "cancelled" ? "cancelled" as const
          : "unknown" as const,
        latencyMs,
        usage: reportedUsage,
        estimatedCostUsd: estimateGenerationCostUsd({
          inputTokens: reportedUsage.inputTokens,
          cachedInputTokens: reportedUsage.cachedInputTokens,
          cacheWriteInputTokens: reportedUsage.cacheWriteInputTokens,
          outputTokens: reportedUsage.outputTokens
        }),
        requestBudgetUpperBoundUsd: GENERATION_OPENAI_PRICE.requestBudgetUpperBoundUsd,
        priceSnapshotId: GENERATION_OPENAI_PRICE.id
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
      try { intentCandidate = JSON.parse(response.output_text) as unknown; }
      catch { intentCandidate = response.output_text; }
      return { kind: "completed", ...common, intentCandidate };
    } catch (error) {
      if (!handedOff) return { kind: "pre-dispatch-failure", errorCode: "LOCAL_TRANSPORT_PREPARATION_FAILED" };
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
            requestBudgetUpperBoundUsd: GENERATION_OPENAI_PRICE.requestBudgetUpperBoundUsd,
            priceSnapshotId: GENERATION_OPENAI_PRICE.id
          };
    }
  }
}
