import type OpenAI from "openai";
import { describe, expect, it } from "vitest";

import { sha256 } from "../../src/domain/hash.js";
import { basicSemanticCandidate } from "../helpers/semantic-interpretation.js";
import {
  CURRENT_PROMPT_IDENTITY,
  prepareSemanticGenerationRequest
} from "../../src/interpretation/semantic-request.js";
import { OpenAITransport } from "../../src/server/generation/openai-transport.js";

const MODEL_CONFIGURATION = {
  modelId: "gpt-5.6-sol",
  reasoningEffort: "medium" as const,
  imageDetailPolicy: "high" as const,
  promptLayoutVersion: "stable-prefix-current-v4" as const,
  maxOutputTokens: 6_000,
  serviceTier: "default" as const,
  store: false as const
};

async function request() {
  return prepareSemanticGenerationRequest({
    brief: "Make a rigid open container.",
    references: [],
    roleConstraints: [],
    promptIdentity: CURRENT_PROMPT_IDENTITY,
    promptHash: await sha256("structured-transport-test"),
    modelConfiguration: MODEL_CONFIGURATION
  });
}

function usage() {
  return {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: 20,
    output_tokens_details: { reasoning_tokens: 5 },
    total_tokens: 120
  };
}

describe("OpenAI structured semantic transport", () => {
  it("uses the SDK parser once and consumes output_parsed without a parallel JSON parser", async () => {
    const prepared = await request();
    const candidate = basicSemanticCandidate({ sourceEvidenceIndex: prepared.sourceEvidenceIndex });
    const calls: unknown[] = [];
    const client = {
      responses: {
        parse: (body: unknown) => {
          calls.push(body);
          return Promise.resolve({
            _request_id: "provider-request",
            id: "response-id",
            model: "gpt-5.6-sol",
            status: "completed",
            error: null,
            incomplete_details: null,
            output: [],
            output_parsed: candidate,
            usage: usage()
          });
        }
      }
    } as unknown as OpenAI;
    const transport = new OpenAITransport({
      apiKey: "test-key",
      prompt: "Interpret only irreducible semantic choices.",
      references: [],
      client
    });
    const outcome = await transport.dispatch({
      request: prepared.request,
      clientRequestId: "structured-transport-client-request"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      text: {
        format: {
          type: "json_schema",
          strict: true,
          name: "sketchycut_semantic_interpretation"
        }
      }
    });
    expect(outcome).toMatchObject({
      kind: "completed",
      interpretationCandidate: candidate,
      providerRequestId: "provider-request"
    });
  });

  it("turns an explicit provider refusal into a single recorded model failure", async () => {
    const prepared = await request();
    let calls = 0;
    const client = {
      responses: {
        parse: () => {
          calls += 1;
          return Promise.resolve({
            _request_id: "provider-request-refusal",
            id: "response-refusal",
            model: "gpt-5.6-sol",
            status: "completed",
            error: null,
            incomplete_details: null,
            output: [{
              type: "message",
              content: [{ type: "refusal", refusal: "Unable to comply." }]
            }],
            output_parsed: null,
            usage: usage()
          });
        }
      }
    } as unknown as OpenAI;
    const transport = new OpenAITransport({
      apiKey: "test-key",
      prompt: "Interpret only irreducible semantic choices.",
      references: [],
      client
    });
    const outcome = await transport.dispatch({
      request: prepared.request,
      clientRequestId: "structured-transport-refusal-request"
    });
    expect(calls).toBe(1);
    expect(outcome).toMatchObject({
      kind: "model-failure",
      errorCode: "MODEL_RESPONSE_REFUSAL"
    });
  });
});
