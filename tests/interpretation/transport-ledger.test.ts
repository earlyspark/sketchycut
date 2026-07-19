import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import { IntentGraphV1Schema } from "../../src/interpretation/intent-graph.js";
import { appendAttempt } from "../../src/interpretation/ledger-append.js";
import {
  LiveCallLedgerV1Schema,
  type LiveCallAttempt,
  type LiveCallLedgerV1
} from "../../src/interpretation/live-ledger.js";
import { GeneratedProjectOrchestrator } from "../../src/interpretation/orchestrator.js";
import { ExactSemanticCache } from "../../src/interpretation/semantic-cache.js";
import { normalizeSemanticGenerationRequest } from "../../src/interpretation/semantic-request.js";
import {
  GENERATION_TERRA_PRICE,
  OpenAITransport
} from "../../src/server/generation/openai-transport.js";

const supportedIntent = IntentGraphV1Schema.parse({
  schemaVersion: "1.0",
  title: "Rigid support",
  coreIntent: "Build a rigid planar support.",
  requirements: [{
    id: "rigid-function",
    priority: "must",
    kind: "rigid-assembly",
    statement: "The support must remain rigid.",
    evidence: [{
      evidenceId: "brief-rigid",
      source: "text",
      referenceId: null,
      statement: "The brief requires a rigid support."
    }]
  }],
  references: [],
  topology: {
    bodies: [
      {
        id: "base-body",
        role: "support",
        quantity: 1,
        shapeClass: "planar",
        attachmentRole: "base",
        orientationRole: "horizontal"
      },
      {
        id: "wall-body",
        role: "support",
        quantity: 1,
        shapeClass: "planar",
        attachmentRole: "side",
        orientationRole: "vertical"
      }
    ],
    interfaces: [{
      id: "base-wall-interface",
      between: ["base-body", "wall-body"],
      behavior: "rigid",
      relativeOrientation: "orthogonal",
      axisRole: "unspecified",
      function: "Join the supporting planes."
    }]
  },
  motif: null,
  conflicts: [],
  assumptions: [],
  capabilityAssessment: { coreIntentRepresentable: true, unresolvedNeeds: [] }
});

function semanticRequest() {
  return normalizeSemanticGenerationRequest({
    brief: "Build a rigid support.",
    promptHash: "b".repeat(64),
    references: [{
      referenceId: "reference-1",
      sha256: "a".repeat(64),
      mediaType: "image/png",
      width: 64,
      height: 64
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
}

function providerResponse(outputText: string, status: "completed" | "incomplete" = "completed") {
  return {
    _request_id: `provider-${crypto.randomUUID()}`,
    id: `response-${crypto.randomUUID()}`,
    status,
    error: null,
    incomplete_details: status === "incomplete" ? { reason: "max_output_tokens" } : null,
    output_text: outputText,
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 150
    }
  };
}

function clientWith(create: unknown): OpenAI {
  return { responses: { create } } as unknown as OpenAI;
}

function harness(
  create: ReturnType<typeof vi.fn>,
  options: { referencePayloadPresent?: boolean } = {},
) {
  let ledger: LiveCallLedgerV1 | null = null;
  const transport = new OpenAITransport({
    apiKey: "test-only-key",
    prompt: "Private prompt marker that must not enter the ledger.",
    references: options.referencePayloadPresent === false ? [] : [{
      referenceId: "reference-1",
      dataUrl: "data:image/png;base64,AA=="
    }],
    client: clientWith(create)
  });
  const orchestrator = new GeneratedProjectOrchestrator({
    cache: new ExactSemanticCache(),
    transport,
    compile: () => Promise.resolve({ ok: true }),
    appendAttempt: (attempt: LiveCallAttempt) => {
      ledger = appendAttempt(ledger, "transport-ledger", attempt);
      return Promise.resolve();
    },
    promptHash: "b".repeat(64),
    runtimeOrigin: "test-recorded",
    dispatchExposure: {
      requestBudgetUpperBoundUsd: GENERATION_TERRA_PRICE.requestBudgetUpperBoundUsd,
      priceSnapshotId: GENERATION_TERRA_PRICE.id
    }
  });
  return {
    orchestrator,
    get ledger() { return LiveCallLedgerV1Schema.parse(ledger); },
    observedNetworkDispatches: () => create.mock.calls.length
  };
}

function expectDispatchParity(test: ReturnType<typeof harness>): void {
  expect(test.ledger.attempts.reduce(
    (total, attempt) => total + attempt.networkDispatchCount,
    0,
  )).toBe(test.observedNetworkDispatches());
}

describe("live transport/network/ledger outcome matrix", () => {
  it.each([
    {
      label: "completed",
      create: () => vi.fn(() => Promise.resolve(providerResponse(JSON.stringify(supportedIntent)))),
      expectedResult: "supported",
      expectedAttempt: "completed",
      expectedNetwork: 1
    },
    {
      label: "model failure",
      create: () => vi.fn(() => Promise.resolve(providerResponse("", "incomplete"))),
      expectedResult: "failure",
      expectedAttempt: "model-failure",
      expectedNetwork: 1
    },
    {
      label: "strict schema failure",
      create: () => vi.fn(() => Promise.resolve(providerResponse('{"schemaVersion":"1.0"}'))),
      expectedResult: "failure",
      expectedAttempt: "schema-failure",
      expectedNetwork: 1
    },
    {
      label: "authoritative provider rejection",
      create: () => vi.fn(() => Promise.reject(Object.assign(
        new Error("provider rejected the request"),
        { status: 400, request_id: "provider-rejected-400" },
      ))),
      expectedResult: "failure",
      expectedAttempt: "provider-not-accepted",
      expectedNetwork: 1
    },
    {
      label: "ambiguous post-handoff failure",
      create: () => vi.fn(() => Promise.reject(new Error("socket closed after handoff"))),
      expectedResult: "failure",
      expectedAttempt: "ambiguous-transport",
      expectedNetwork: 1
    }
  ])("cross-checks $label", async ({ create, expectedResult, expectedAttempt, expectedNetwork }) => {
    const test = harness(create());
    const result = await test.orchestrator.generate({ request: semanticRequest() });
    expect(result.kind).toBe(expectedResult);
    expect(test.ledger.attempts[0]!.outcome).toBe(expectedAttempt);
    expect(test.observedNetworkDispatches()).toBe(expectedNetwork);
    expectDispatchParity(test);
  });

  it("cross-checks a local pre-dispatch failure at zero network activity", async () => {
    const create = vi.fn();
    const test = harness(create, { referencePayloadPresent: false });
    const result = await test.orchestrator.generate({ request: semanticRequest() });
    expect(result).toMatchObject({ kind: "failure", stage: "input" });
    expect(test.ledger.attempts[0]!.outcome).toBe("pre-dispatch-failure");
    expect(test.observedNetworkDispatches()).toBe(0);
    expectDispatchParity(test);
  });

  it("cross-checks a completed miss plus exact cache hit at one total dispatch", async () => {
    const create = vi.fn(() => Promise.resolve(providerResponse(JSON.stringify(supportedIntent))));
    const test = harness(create);
    await test.orchestrator.generate({ request: semanticRequest() });
    await test.orchestrator.generate({ request: semanticRequest() });
    expect(test.ledger.attempts.map((attempt) => attempt.outcome)).toEqual([
      "completed",
      "cache-hit"
    ]);
    expect(test.observedNetworkDispatches()).toBe(1);
    expectDispatchParity(test);
  });

  it("cross-checks one explicit linked retry with no automatic redispatch", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("socket closed after handoff"))
      .mockResolvedValueOnce(providerResponse(JSON.stringify(supportedIntent)));
    const test = harness(create);
    const first = await test.orchestrator.generate({ request: semanticRequest() });
    if (first.kind !== "failure" || first.attempt === null) throw new Error("Expected failure.");
    expect(test.observedNetworkDispatches()).toBe(1);
    const second = await test.orchestrator.generate({
      request: semanticRequest(),
      retry: {
        priorAttemptId: first.attempt.attemptId,
        retryChainId: first.attempt.retryChainId,
        attemptOrdinal: 2
      }
    });
    expect(second.kind).toBe("supported");
    expect(test.observedNetworkDispatches()).toBe(2);
    expect(test.ledger.attempts[1]!.retryOfAttemptId).toBe(first.attempt.attemptId);
    expect(test.ledger.attempts[1]!.clientRequestId).not.toBe(first.attempt.clientRequestId);
    expectDispatchParity(test);
  });
});
