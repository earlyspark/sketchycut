import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import { normalizeSemanticGenerationRequest } from "../../src/interpretation/semantic-request.js";
import {
  M5LiveOpenAITransport,
  OPENAI_SDK_MAX_RETRIES
} from "../../tools/m5-live-openai-adapter.js";

const semanticRequest = normalizeSemanticGenerationRequest({
  brief: "A fixed multimodal evaluation brief.",
  references: [{
    referenceId: "reference-1",
    sha256: "a".repeat(64),
    mediaType: "image/jpeg",
    width: 100,
    height: 80
  }],
  roleConstraints: [],
  modelConfiguration: {
    modelId: "candidate-model",
    reasoningEffort: "low",
    maxOutputTokens: 2_500,
    serviceTier: "default",
    store: false
  }
});

const price = {
  id: "test-price-snapshot",
  uncachedInputUsdPerMillion: 1,
  cachedInputUsdPerMillion: 0.1,
  outputUsdPerMillion: 5,
  requestBudgetUpperBoundUsd: 0.2
};

function clientWith(create: (...input: unknown[]) => unknown): OpenAI {
  return { responses: { create } } as unknown as OpenAI;
}

describe("tools-only OpenAI live adapter", () => {
  it("uses one strict Responses dispatch, low reasoning, store false, and no SDK retries", async () => {
    const create = vi.fn((..._params: unknown[]) => {
      void _params;
      return Promise.resolve({
        _request_id: "provider-request-1",
        id: "response-1",
        status: "completed",
        error: null,
        incomplete_details: null,
        output_text: "{}",
        usage: {
          input_tokens: 10,
          input_tokens_details: { cached_tokens: 2, cache_write_tokens: 0 },
          output_tokens: 5,
          output_tokens_details: { reasoning_tokens: 1 },
          total_tokens: 15
        }
      });
    });
    const transport = new M5LiveOpenAITransport({
      apiKey: "test-only-key",
      prompt: "Interpret semantic intent only.",
      references: [{ referenceId: "reference-1", dataUrl: "data:image/jpeg;base64,AA==" }],
      price,
      client: clientWith(create)
    });
    const outcome = await transport.dispatch({
      request: semanticRequest,
      clientRequestId: "client-request-1"
    });
    expect(OPENAI_SDK_MAX_RETRIES).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: "candidate-model",
      max_output_tokens: 2_500,
      reasoning: { effort: "low" },
      store: false,
      text: { format: { type: "json_schema", strict: true } }
    });
    expect(create.mock.calls[0]?.[1]).toEqual({
      headers: { "X-Client-Request-Id": "client-request-1" }
    });
    const requestBody = create.mock.calls[0]?.[0] as {
      text?: { format?: { schema?: Record<string, unknown> } };
    };
    const providerSchema = requestBody.text?.format?.schema;
    expect(providerSchema).toBeDefined();
    expect(providerSchema).not.toHaveProperty("$schema");
    const serializedSchema = JSON.stringify(providerSchema);
    expect(serializedSchema).not.toMatch(/"items":\s*\[/);
    expect(JSON.stringify(create.mock.calls[0]?.[0])).not.toContain("filename");
    expect(outcome).toMatchObject({
      kind: "completed",
      providerRequestId: "provider-request-1",
      usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5 }
    });
  });

  it("returns a local pre-dispatch failure when an image payload is absent", async () => {
    const create = vi.fn();
    const transport = new M5LiveOpenAITransport({
      apiKey: "test-only-key",
      prompt: "Interpret semantic intent only.",
      references: [],
      price,
      client: clientWith(create)
    });
    await expect(transport.dispatch({
      request: semanticRequest,
      clientRequestId: "client-request-missing-image"
    })).resolves.toEqual({
      kind: "pre-dispatch-failure",
      errorCode: "REFERENCE_PAYLOAD_MISSING"
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("classifies a response-free exception conservatively and an authoritative 400 separately", async () => {
    const ambiguous = new M5LiveOpenAITransport({
      apiKey: "test-only-key",
      prompt: "Interpret semantic intent only.",
      references: [{ referenceId: "reference-1", dataUrl: "data:image/jpeg;base64,AA==" }],
      price,
      client: clientWith(vi.fn(() => Promise.reject(new Error("socket closed"))))
    });
    await expect(ambiguous.dispatch({
      request: semanticRequest,
      clientRequestId: "client-request-2"
    })).resolves.toMatchObject({
      kind: "ambiguous-transport",
      providerRequestId: null,
      requestBudgetUpperBoundUsd: 0.2
    });

    const rejected = new M5LiveOpenAITransport({
      apiKey: "test-only-key",
      prompt: "Interpret semantic intent only.",
      references: [{ referenceId: "reference-1", dataUrl: "data:image/jpeg;base64,AA==" }],
      price,
      client: clientWith(vi.fn(() => Promise.reject(
        Object.assign(new Error("bad request"), {
          status: 400,
          request_id: "provider-request-400",
          code: "invalid_json_schema"
        }),
      )))
    });
    await expect(rejected.dispatch({
      request: semanticRequest,
      clientRequestId: "client-request-3"
    })).resolves.toMatchObject({
      kind: "provider-not-accepted",
      providerRequestId: "provider-request-400",
      errorCode: "OPENAI_INVALID_JSON_SCHEMA"
    });
  });
});
