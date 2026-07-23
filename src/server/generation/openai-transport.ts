import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { createHash } from "node:crypto";

import { CAPABILITY_CATALOG } from "../../interpretation/capability-catalog.js";
import {
  SEMANTIC_INTERPRETATION_JSON_SCHEMA,
  semanticInterpretationCandidateSchema,
  semanticInterpretationProviderSchema
} from "../../interpretation/semantic-model-contract.js";
import { CURRENT_SEMANTIC_SCHEMA_ID, type SemanticGenerationRequest } from "../../interpretation/semantic-request.js";
import type {
  SemanticInterpretationTransport,
  SemanticTransportOutcome
} from "../../interpretation/semantic-transport.js";
import {
  CURRENT_IMAGE_DETAIL_POLICY,
  CURRENT_PROMPT_LAYOUT_VERSION,
  CURRENT_REASONING_EFFORT,
  type SemanticModelConfiguration
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
  SEMANTIC_EVIDENCE_POLICY,
  instructionsForPromptLayout,
  stablePrefixInstructions
} from "./semantic-interpretation-prompt.js";

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

function semanticPayload(request: SemanticGenerationRequest) {
  return {
    evidencePolicy: SEMANTIC_EVIDENCE_POLICY,
    semanticBrief: request.semanticBrief,
    sourceEvidenceIndex: request.sourceEvidenceIndex,
    references: request.references,
    roleConstraints: request.roleConstraints
  };
}

export function generationPromptCacheKey(
  prompt: string,
  configuration: Pick<SemanticGenerationRequest["modelConfiguration"], "reasoningEffort" | "imageDetailPolicy" | "promptLayoutVersion"> = {
    reasoningEffort: CURRENT_REASONING_EFFORT,
    imageDetailPolicy: CURRENT_IMAGE_DETAIL_POLICY,
    promptLayoutVersion: CURRENT_PROMPT_LAYOUT_VERSION
  },
): string {
  const instructionPrefix = stablePrefixInstructions(prompt);
  const responseAffectingConfiguration = {
    reasoningEffort: configuration.reasoningEffort,
    imageDetailPolicy: configuration.imageDetailPolicy,
    promptLayoutVersion: configuration.promptLayoutVersion
  };
  const digest = createHash("sha256").update(JSON.stringify({
    model: GENERATION_OPENAI_MODEL,
    configuration: responseAffectingConfiguration,
    instructionPrefix,
    capabilityCatalog: CAPABILITY_CATALOG,
    semanticSchemaId: CURRENT_SEMANTIC_SCHEMA_ID,
    semanticSchema: SEMANTIC_INTERPRETATION_JSON_SCHEMA
  })).digest("hex");
  return `sketchycut-generation-${digest.slice(0, 32)}`;
}

export class OpenAITransport implements SemanticInterpretationTransport {
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
    request: SemanticGenerationRequest;
    clientRequestId: string;
  }): Promise<SemanticTransportOutcome> {
    try {
      const semantic = semanticPayload(input.request);
      const instructions = instructionsForPromptLayout(
        this.#basePrompt
      );
      const candidateSchema = semanticInterpretationCandidateSchema(input.request.sourceEvidenceIndex);
      const providerSchema = semanticInterpretationProviderSchema(input.request.sourceEvidenceIndex);
      const payload = semantic;
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
      return await this.#dispatchStructured({
        clientRequestId: input.clientRequestId,
        instructions,
        content,
        candidateSchema,
        formatName: "sketchycut_semantic_interpretation",
        formatDescription: "Irreducible open semantic choices only; deterministic code derives all authority and projection records.",
        promptCacheKey: this.#promptCacheKeyOverride ?? generationPromptCacheKey(
          this.#basePrompt,
          input.request.modelConfiguration,
        ),
        modelConfiguration: input.request.modelConfiguration,
        metadataIdentity: input.request.promptIdentity
      });
    } catch {
      return { kind: "pre-dispatch-failure", errorCode: "LOCAL_TRANSPORT_PREPARATION_FAILED" };
    }
  }

  async #dispatchStructured(input: {
    clientRequestId: string;
    instructions: string;
    content: OpenAI.Responses.ResponseInputContent[];
    candidateSchema: ReturnType<typeof semanticInterpretationCandidateSchema>;
    formatName: string;
    formatDescription: string;
    promptCacheKey: string;
    modelConfiguration: SemanticModelConfiguration;
    metadataIdentity: string;
  }): Promise<SemanticTransportOutcome> {
    const startedAt = performance.now();
    let handedOff = false;
    try {
      handedOff = true;
      const response = await this.#client.responses.parse({
        model: GENERATION_OPENAI_MODEL,
        prompt_cache_key: input.promptCacheKey,
        instructions: input.instructions,
        input: [{ role: "user", content: input.content }],
        max_output_tokens: GENERATION_OPENAI_OUTPUT_TOKEN_LIMIT,
        reasoning: { effort: input.modelConfiguration.reasoningEffort },
        service_tier: "default",
        store: false,
        text: {
          verbosity: "low",
          format: zodTextFormat(input.candidateSchema, input.formatName, {
            description: input.formatDescription
          })
        },
        metadata: {
          client_request_id: input.clientRequestId,
          prompt_identity: input.metadataIdentity
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
      const refused = response.output.some((item) =>
        item.type === "message" && item.content.some((content) => content.type === "refusal")
      );
      if (response.status !== "completed" || response.error !== null || refused ||
          response.output_parsed === null) {
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
      return { kind: "completed", ...common, interpretationCandidate: response.output_parsed };
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
