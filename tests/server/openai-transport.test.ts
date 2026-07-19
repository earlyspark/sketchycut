import type OpenAI from "openai";
import { describe, expect, it } from "vitest";

import { normalizeSemanticGenerationRequest } from "../../src/interpretation/semantic-request.js";
import {
  GENERATION_OPENAI_MAX_RETRIES,
  GENERATION_OPENAI_MODEL,
  OpenAITransport
} from "../../src/server/generation/openai-transport.js";

const request = normalizeSemanticGenerationRequest({
  brief: "Build a rigid holder.",
  references: [{
    referenceId: "reference-one",
    sha256: "a".repeat(64),
    mediaType: "image/jpeg",
    width: 16,
    height: 12
  }],
  roleConstraints: [],
  modelConfiguration: {
    modelId: GENERATION_OPENAI_MODEL,
    reasoningEffort: "low",
    maxOutputTokens: 4_000,
    serviceTier: "default",
    store: false
  }
});

function clientWith(create: (...args: unknown[]) => Promise<unknown>): OpenAI {
  return { responses: { create } } as unknown as OpenAI;
}

describe("production semantic transport", () => {
  it("dispatches exactly one strict Terra request with no SDK retry or storage", async () => {
    expect(GENERATION_OPENAI_MAX_RETRIES).toBe(0);
    const calls: unknown[][] = [];
    const transport = new OpenAITransport({
      apiKey: "test-only",
      prompt: "Interpret semantic intent only.",
      references: [{ referenceId: "reference-one", dataUrl: "data:image/jpeg;base64,YQ==" }],
      client: clientWith((...args) => {
        calls.push(args);
        return Promise.resolve({
          status: "completed",
          error: null,
          incomplete_details: null,
          output_text: JSON.stringify({ schemaVersion: "1.0" }),
          id: "response-one",
          _request_id: "provider-request-one",
          usage: {
            input_tokens: 1_000,
            input_tokens_details: { cached_tokens: 200 },
            output_tokens: 100,
            output_tokens_details: { reasoning_tokens: 30 },
            total_tokens: 1_100
          }
        });
      })
    });
    const result = await transport.dispatch({ request, clientRequestId: "client-request-one" });
    expect(calls).toHaveLength(1);
    const [body, options] = calls[0]! as [
      Record<string, unknown> & {
        reasoning: { effort: string };
        text: { format: { strict: boolean; schema: unknown } };
        metadata: Record<string, string>;
      },
      { headers: Record<string, string> }
    ];
    expect(body).toMatchObject({
      model: GENERATION_OPENAI_MODEL,
      max_output_tokens: 4_000,
      reasoning: { effort: "low" },
      service_tier: "default",
      store: false,
      text: { format: { type: "json_schema", strict: true } },
      metadata: { client_request_id: "client-request-one" }
    });
    expect(options.headers).toEqual({ "X-Client-Request-Id": "client-request-one" });
    expect(body.text.format.schema).not.toHaveProperty("$schema");
    expect(JSON.stringify(body.text.format.schema)).not.toMatch(/"items":\s*\[/);
    expect(JSON.stringify(body)).not.toContain("filename");
    expect(result).toMatchObject({
      kind: "completed",
      providerRequestId: "provider-request-one",
      responseId: "response-one",
      estimatedCostUsd: 0.00355,
      usage: { totalTokens: 1_100 }
    });
  });

  it("stops locally before dispatch when a reference payload is missing", async () => {
    let dispatches = 0;
    const transport = new OpenAITransport({
      apiKey: "test-only",
      prompt: "Semantic only.",
      references: [],
      client: clientWith(() => {
        dispatches += 1;
        return Promise.reject(new Error("must not dispatch"));
      })
    });
    await expect(transport.dispatch({
      request,
      clientRequestId: "client-request-missing-reference"
    })).resolves.toEqual({
      kind: "pre-dispatch-failure",
      errorCode: "REFERENCE_PAYLOAD_MISSING"
    });
    expect(dispatches).toBe(0);
  });

  it("separates authoritative rejection from ambiguous post-handoff failure", async () => {
    const authoritative = new OpenAITransport({
      apiKey: "test-only",
      prompt: "Semantic only.",
      references: [{ referenceId: "reference-one", dataUrl: "data:image/jpeg;base64,YQ==" }],
      client: clientWith(() => Promise.reject(Object.assign(new Error("rejected"), {
        status: 400,
        request_id: "provider-rejected"
      })))
    });
    await expect(authoritative.dispatch({
      request,
      clientRequestId: "client-request-authoritative"
    })).resolves.toMatchObject({
      kind: "provider-not-accepted",
      providerRequestId: "provider-rejected"
    });

    const ambiguous = new OpenAITransport({
      apiKey: "test-only",
      prompt: "Semantic only.",
      references: [{ referenceId: "reference-one", dataUrl: "data:image/jpeg;base64,YQ==" }],
      client: clientWith(() => Promise.reject(Object.assign(new Error("socket timeout"), {
        name: "TimeoutError"
      })))
    });
    await expect(ambiguous.dispatch({
      request,
      clientRequestId: "client-request-ambiguous"
    })).resolves.toMatchObject({
      kind: "ambiguous-transport",
      providerRequestId: null,
      errorCode: "OPENAI_TRANSPORT_TIMEOUT",
      requestBudgetUpperBoundUsd: 0.25
    });
  });
});
