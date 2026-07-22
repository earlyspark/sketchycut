import type OpenAI from "openai";
import { describe, expect, it } from "vitest";

import { sha256 } from "../../src/domain/hash.js";
import { prepareSemanticGenerationRequestV2 } from "../../src/interpretation/semantic-request-v2.js";
import {
  GENERATION_OPENAI_MAX_RETRIES,
  GENERATION_OPENAI_MODEL
} from "../../src/server/generation/cost-envelope.js";
import { OpenAITransportV2 } from "../../src/server/generation/openai-transport-v2.js";
import { generationPromptCacheKey } from "../../src/server/generation/openai-transport-v2.js";
import { stablePrefixInstructions } from "../../src/server/generation/reference-interpretation-prompt.js";

function clientWith(create: (...args: unknown[]) => Promise<unknown>): OpenAI {
  return { responses: { create } } as unknown as OpenAI;
}

async function request(reference = false, overrides: Partial<{
  reasoningEffort: "medium" | "high";
  imageDetailPolicy: "low" | "high" | "mixed-first-high";
  promptLayoutVersion: "stable-prefix-v2" | "request-local-control-v1";
}> = {}) {
  return (await prepareSemanticGenerationRequestV2({
    brief: "Make an open-top catchall.",
    references: reference ? [{ referenceId: "reference-one", sha256: "a".repeat(64), mediaType: "image/png", width: 16, height: 12 }] : [],
    roleConstraints: reference ? [{ referenceId: "reference-one", roles: ["motif"] }] : [],
    promptIdentity: "current-neutral-prompt",
    promptHash: await sha256("fixture-prompt"),
    modelConfiguration: { modelId: GENERATION_OPENAI_MODEL, reasoningEffort: "medium", imageDetailPolicy: "low", promptLayoutVersion: "stable-prefix-v2", maxOutputTokens: 6_000, serviceTier: "default", store: false, ...overrides }
  })).request;
}

describe("current production semantic transport", () => {
  it("dispatches exactly one strict text-only request with no SDK retry or storage", async () => {
    expect(GENERATION_OPENAI_MAX_RETRIES).toBe(0);
    const calls: unknown[][] = [];
    const transport = new OpenAITransportV2({
      apiKey: "test-only", prompt: "Interpret only semantic intent.", references: [],
      client: clientWith((...args) => {
        calls.push(args);
        return Promise.resolve({
          status: "completed", error: null, incomplete_details: null,
          output_text: JSON.stringify({ schemaVersion: "2.4" }), id: "response-v2", _request_id: "provider-request-v2", model: "gpt-5.6-sol",
          usage: { input_tokens: 1_000, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 0 }, output_tokens: 100, output_tokens_details: { reasoning_tokens: 30 }, total_tokens: 1_100 }
        });
      })
    });
    const semanticRequest = await request();
    const result = await transport.dispatch({ request: semanticRequest, clientRequestId: "client-request-v2" });
    expect(calls).toHaveLength(1);
    const [body, options] = calls[0]! as [{
      model: string; input: { content: unknown[] }[]; store: boolean; prompt_cache_key: string;
      max_output_tokens: number;
      reasoning: { effort: string }; text: { format: { strict: boolean; schema: unknown } };
      metadata: Record<string, string>;
    }, { headers: Record<string, string> }];
    expect(body).toMatchObject({
      model: GENERATION_OPENAI_MODEL, store: false, max_output_tokens: 6_000,
      reasoning: { effort: "medium" },
      prompt_cache_key: generationPromptCacheKey("Interpret only semantic intent.", {
        reasoningEffort: "medium",
        imageDetailPolicy: "low",
        promptLayoutVersion: "stable-prefix-v2"
      }),
      text: { format: { type: "json_schema", strict: true } },
      metadata: { client_request_id: "client-request-v2", prompt_identity: "current-neutral-prompt" }
    });
    expect(body.input[0]?.content).toHaveLength(1);
    expect(options.headers).toEqual({ "X-Client-Request-Id": "client-request-v2" });
    expect(JSON.stringify(body.text.format.schema)).not.toContain("$schema");
    expect(body.text.format.schema).toMatchObject({
      $defs: {
        authorizedEvidenceId: {
          type: "string",
          enum: semanticRequest.sourceEvidenceIndex.spans.map((item) => item.evidenceId)
        }
      },
      properties: { referenceBrief: { minItems: 0, maxItems: 0 } }
    });
    expect(result).toMatchObject({ kind: "completed", providerRequestId: "provider-request-v2", responseId: "response-v2", usage: { totalTokens: 1_100 } });
  });

  it("keeps the cache key stable for an exact static prefix and invalidates it on prompt changes", () => {
    const first = generationPromptCacheKey("Interpret semantic intent.");
    expect(first).toBe(generationPromptCacheKey("Interpret semantic intent."));
    expect(first).not.toBe(generationPromptCacheKey("Interpret semantic intent exactly."));
    expect(first).toMatch(/^sketchycut-generation-[a-f0-9]{32}$/);
  });

  it("separates design commitments from contextual entities without lexical object heuristics", () => {
    const instructions = stablePrefixInstructions("Interpret semantic intent.");
    expect(instructions).toContain("requirements contains design commitments only");
    expect(instructions).toContain("A mentioned or pictured entity is not automatically a requirement");
    expect(instructions).toContain("Use thermal-source only when operating with heat or combustion is itself a design commitment");
    expect(instructions).not.toContain("unspecified-tea-light");
    expect(instructions).not.toContain("A bare tea-light");
  });

  it("uses low-detail images and fails locally when referenced bytes are missing", async () => {
    const withReference = await request(true);
    let calls = 0;
    const missing = new OpenAITransportV2({
      apiKey: "test-only", prompt: "Semantic only.", references: [],
      client: clientWith(() => { calls += 1; return Promise.reject(new Error("must not dispatch")); })
    });
    await expect(missing.dispatch({ request: withReference, clientRequestId: "missing" })).resolves.toEqual({
      kind: "pre-dispatch-failure", errorCode: "REFERENCE_PAYLOAD_MISSING"
    });
    expect(calls).toBe(0);

    const bodies: unknown[] = [];
    const present = new OpenAITransportV2({
      apiKey: "test-only", prompt: "Semantic only.", references: [{ referenceId: "reference-one", dataUrl: "data:image/png;base64,YQ==" }],
      client: clientWith((body) => {
        bodies.push(body);
        return Promise.resolve({ status: "completed", error: null, incomplete_details: null, output_text: "{}", id: "response", _request_id: "provider", model: "gpt-5.6-sol", usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 } });
      })
    });
    await present.dispatch({ request: withReference, clientRequestId: "present" });
    expect(JSON.stringify(bodies[0])).toContain('"detail":"low"');
    const referenceEvidenceId = withReference.sourceEvidenceIndex.references[0]!.evidenceId;
    expect(bodies[0]).toMatchObject({
      text: {
        format: {
          schema: {
            $defs: {
              referenceEvidenceId: { type: "string", enum: [referenceEvidenceId] }
            },
            properties: { referenceBrief: { minItems: 1, maxItems: 1 } }
          }
        }
      }
    });
    expect(JSON.stringify(bodies[0])).not.toContain(`${referenceEvidenceId}-open-top`);
  });

  it("honors predeclared high detail and request-local control layout without extra calls", async () => {
    const bodies: unknown[] = [];
    const transport = new OpenAITransportV2({
      apiKey: "test-only", prompt: "Semantic only.",
      references: [{ referenceId: "reference-one", dataUrl: "data:image/png;base64,YQ==" }],
      client: clientWith((body) => {
        bodies.push(body);
        return Promise.resolve({ status: "completed", error: null, incomplete_details: null, output_text: "{}", id: "response", _request_id: "provider", model: "gpt-5.6-sol", usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 } });
      })
    });
    await transport.dispatch({
      request: await request(true, { imageDetailPolicy: "high", promptLayoutVersion: "request-local-control-v1" }),
      clientRequestId: "high-control"
    });
    expect(bodies).toHaveLength(1);
    const serialized = JSON.stringify(bodies[0]);
    expect(serialized).toContain('"detail":"high"');
    const body = bodies[0] as { input: { content: { type: string; text?: string }[] }[] };
    const controlPayload = JSON.parse(body.input[0]!.content[0]!.text!) as Record<string, unknown>;
    expect(controlPayload.promptLayout).toBe("request-local-control-v1");
    expect(controlPayload.abstractCapabilityCatalog).toBeDefined();
  });

  it("distinguishes authoritative rejection from potentially billed ambiguity", async () => {
    const authoritative = new OpenAITransportV2({
      apiKey: "test-only", prompt: "Semantic only.", references: [],
      client: clientWith(() => Promise.reject(Object.assign(new Error("rejected"), { status: 400, request_id: "provider-rejected" })))
    });
    await expect(authoritative.dispatch({ request: await request(), clientRequestId: "authoritative" })).resolves.toMatchObject({ kind: "provider-not-accepted", providerRequestId: "provider-rejected" });

    const ambiguous = new OpenAITransportV2({
      apiKey: "test-only", prompt: "Semantic only.", references: [],
      client: clientWith(() => Promise.reject(Object.assign(new Error("socket timeout"), { name: "TimeoutError" })))
    });
    await expect(ambiguous.dispatch({ request: await request(), clientRequestId: "ambiguous" })).resolves.toMatchObject({ kind: "ambiguous-transport", providerRequestId: null, errorCode: "OPENAI_TRANSPORT_TIMEOUT", requestBudgetUpperBoundUsd: 0.65 });
  });
});
