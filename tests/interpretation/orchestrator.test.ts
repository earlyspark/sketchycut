import { describe, expect, it } from "vitest";

import { DeterministicCompilationError } from "../../src/interpretation/compilation-error.js";
import { IntentGraphV1Schema, type IntentGraphV1 } from "../../src/interpretation/intent-graph.js";
import { appendAttempt } from "../../src/interpretation/ledger-append.js";
import { LiveCallLedgerV1Schema, type LiveCallLedgerV1 } from "../../src/interpretation/live-ledger.js";
import {
  GeneratedProjectOrchestrator,
  type SemanticInterpretationTransport,
  type SemanticTransportOutcome
} from "../../src/interpretation/orchestrator.js";
import { ExactSemanticCache } from "../../src/interpretation/semantic-cache.js";
import { normalizeSemanticGenerationRequest } from "../../src/interpretation/semantic-request.js";

function supportedIntent(): IntentGraphV1 {
  return IntentGraphV1Schema.parse({
    schemaVersion: "1.0",
    title: "Reference holder",
    coreIntent: "Make a rigid planar holder.",
    requirements: [{
      id: "rigid-function",
      priority: "must",
      kind: "rigid-assembly",
      statement: "The holder must remain rigid.",
      evidence: [{
        evidenceId: "brief-rigid",
        source: "text",
        referenceId: null,
        statement: "The brief requires a rigid holder."
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
        id: "rigid-interface",
        between: ["base-body", "wall-body"],
        behavior: "rigid",
        relativeOrientation: "orthogonal",
        axisRole: "unspecified",
        function: "Retain the upright."
      }]
    },
    motif: null,
    conflicts: [],
    assumptions: [],
    capabilityAssessment: { coreIntentRepresentable: true, unresolvedNeeds: [] }
  });
}

function request() {
  return normalizeSemanticGenerationRequest({
    brief: "Build a rigid holder.",
    references: [{
      referenceId: "reference-one",
      sha256: "a".repeat(64),
      mediaType: "image/png",
      width: 900,
      height: 600
    }],
    roleConstraints: [],
    modelConfiguration: {
      modelId: "candidate-model",
      reasoningEffort: "low",
      maxOutputTokens: 4_000,
      serviceTier: "default",
      store: false
    }
  });
}

function completed(candidate: unknown): SemanticTransportOutcome {
  return {
    kind: "completed",
    intentCandidate: candidate,
    providerRequestId: `provider-${crypto.randomUUID()}`,
    responseId: `response-${crypto.randomUUID()}`,
    latencyMs: 120,
    usage: {
      inputTokens: 100,
      cachedInputTokens: 0,
      reasoningTokens: 20,
      outputTokens: 50,
      totalTokens: 150
    },
    estimatedCostUsd: 0.01,
    requestBudgetUpperBoundUsd: 0.25,
    priceSnapshotId: "pricing-snapshot"
  };
}

class QueueTransport implements SemanticInterpretationTransport {
  dispatchCount = 0;
  readonly #outcomes: SemanticTransportOutcome[];

  constructor(outcomes: SemanticTransportOutcome[]) {
    this.#outcomes = [...outcomes];
  }

  dispatch(): Promise<SemanticTransportOutcome> {
    this.dispatchCount += 1;
    const next = this.#outcomes.shift();
    if (next === undefined) throw new Error("Unexpected dispatch.");
    return Promise.resolve(next);
  }
}

function harness(
  outcomes: SemanticTransportOutcome[],
  compilationError: DeterministicCompilationError | null = null,
) {
  const transport = new QueueTransport(outcomes);
  let compileCount = 0;
  let ledger: LiveCallLedgerV1 | null = null;
  const orchestrator = new GeneratedProjectOrchestrator({
    cache: new ExactSemanticCache(),
    transport,
    compile: ({ mapping }) => {
      compileCount += 1;
      if (compilationError !== null) return Promise.reject(compilationError);
      return Promise.resolve({ graphId: mapping.operatorGraph.graphId, compileCount });
    },
    appendAttempt: (attempt) => {
      ledger = appendAttempt(ledger, "m5-live-ledger", attempt);
      return Promise.resolve();
    },
    promptHash: "b".repeat(64),
    dispatchExposure: {
      requestBudgetUpperBoundUsd: 0.25,
      priceSnapshotId: "pricing-snapshot"
    }
  });
  return {
    orchestrator,
    transport,
    get compileCount() { return compileCount; },
    get ledger() { return ledger; }
  };
}

describe("generated-project orchestration", () => {
  it("proves one dispatch with network spy and ledger, then recompiles on an exact cache hit", async () => {
    const test = harness([completed(supportedIntent())]);
    const first = await test.orchestrator.generate({ request: request() });
    const second = await test.orchestrator.generate({ request: request() });
    expect(first.kind).toBe("supported");
    expect(second.kind).toBe("supported");
    expect(test.transport.dispatchCount).toBe(1);
    expect(test.compileCount).toBe(2);
    const ledger = LiveCallLedgerV1Schema.parse(test.ledger);
    expect(ledger.attempts.map((attempt) => attempt.networkDispatchCount)).toEqual([1, 0]);
    expect(ledger.attempts.reduce((sum, attempt) => sum + attempt.networkDispatchCount, 0)).toBe(
      test.transport.dispatchCount,
    );
    expect(ledger.attempts[1]!.outcome).toBe("cache-hit");
    expect(ledger.attempts[1]!.deterministicCompile).toBe("passed");
    expect(ledger.attempts[0]!.promptHash).toBe("b".repeat(64));
    expect(ledger.attempts[0]!.supportStateCorrect).toBeNull();
  });

  it("records an ambiguous post-handoff failure without zero-filling cost or usage", async () => {
    const test = harness([{
      kind: "ambiguous-transport",
      providerRequestId: null,
      latencyMs: 30_000,
      requestBudgetUpperBoundUsd: 0.25,
      priceSnapshotId: "pricing-snapshot",
      errorCode: "MODEL_CONNECTION_ERROR"
    }]);
    const result = await test.orchestrator.generate({ request: request() });
    expect(result.kind).toBe("failure");
    if (result.kind !== "failure") throw new Error("Expected failure.");
    expect(result.stage).toBe("transport");
    expect(result.preservedRequest).toEqual(request());
    expect(result.attempt?.clientRequestId).toMatch(/^client-request-/);
    expect(result.attempt?.providerRequestId).toBeNull();
    expect(result.attempt?.usage).toEqual({ status: "unavailable", reason: "no-response" });
    expect(result.attempt?.billing).toMatchObject({
      state: "potentially-billed",
      estimatedCostUsd: null
    });
  });

  it("ledgers a local pre-dispatch failure with zero network and billing exposure", async () => {
    const test = harness([{
      kind: "pre-dispatch-failure",
      errorCode: "REFERENCE_PAYLOAD_MISSING"
    }]);
    const result = await test.orchestrator.generate({ request: request() });
    expect(result).toMatchObject({
      kind: "failure",
      stage: "input",
      retryable: false,
      attempt: {
        outcome: "pre-dispatch-failure",
        dispatchState: "not-dispatched",
        networkDispatchCount: 0,
        billing: { state: "not-applicable", estimatedCostUsd: 0 }
      }
    });
    expect(test.transport.dispatchCount).toBe(1);
    const ledger = LiveCallLedgerV1Schema.parse(test.ledger);
    expect(ledger.attempts[0]!.networkDispatchCount).toBe(0);
  });

  it("records support-state correctness only against an explicit frozen rubric", async () => {
    const test = harness([completed(supportedIntent())]);
    const result = await test.orchestrator.generate({
      request: request(),
      initiatedBy: "live-eval",
      expectedOutcomeKind: "supported"
    });
    expect(result.kind).toBe("supported");
    expect(LiveCallLedgerV1Schema.parse(test.ledger).attempts[0]!.supportStateCorrect).toBe(true);
  });

  it("dispatches an explicit unchanged retry once with linked immutable identities", async () => {
    const test = harness([
      {
        kind: "ambiguous-transport",
        providerRequestId: null,
        latencyMs: 30_000,
        requestBudgetUpperBoundUsd: 0.25,
        priceSnapshotId: "pricing-snapshot",
        errorCode: "MODEL_CONNECTION_ERROR"
      },
      completed(supportedIntent())
    ]);
    const first = await test.orchestrator.generate({ request: request() });
    if (first.kind !== "failure" || first.attempt === null) throw new Error("Expected first failure.");
    const second = await test.orchestrator.generate({
      request: request(),
      retry: {
        priorAttemptId: first.attempt.attemptId,
        retryChainId: first.attempt.retryChainId,
        attemptOrdinal: 2
      }
    });
    expect(second.kind).toBe("supported");
    expect(test.transport.dispatchCount).toBe(2);
    const ledger = LiveCallLedgerV1Schema.parse(test.ledger);
    expect(ledger.attempts).toHaveLength(2);
    expect(ledger.attempts[1]!.retryOfAttemptId).toBe(ledger.attempts[0]!.attemptId);
    expect(ledger.attempts[1]!.semanticRequestDigest).toBe(
      ledger.attempts[0]!.semanticRequestDigest,
    );
    expect(ledger.attempts[1]!.modelConfigurationHash).toBe(
      ledger.attempts[0]!.modelConfigurationHash,
    );
    expect(ledger.attempts[1]!.clientRequestId).not.toBe(
      ledger.attempts[0]!.clientRequestId,
    );
  });

  it("does not cache invalid model output and withholds deterministic compilation", async () => {
    const test = harness([
      completed({ ...supportedIntent(), unexpectedGeometry: { x: 1, y: 2 } }),
      completed(supportedIntent())
    ]);
    const first = await test.orchestrator.generate({ request: request() });
    const second = await test.orchestrator.generate({ request: request() });
    expect(first.kind).toBe("failure");
    if (first.kind !== "failure") throw new Error("Expected schema failure.");
    expect(first.stage).toBe("schema");
    expect(second.kind).toBe("supported");
    expect(test.transport.dispatchCount).toBe(2);
    expect(test.compileCount).toBe(1);
  });

  it("returns concept-only without invoking fabrication compilation", async () => {
    const graph = supportedIntent();
    const concept = IntentGraphV1Schema.parse({
      ...graph,
      requirements: [...graph.requirements, {
        id: "compound-function",
        priority: "must",
        kind: "compound-motion",
        statement: "Two panels must move independently.",
        evidence: [{
          evidenceId: "brief-compound",
          source: "text",
          referenceId: null,
          statement: "The brief requires two moving panels."
        }]
      }]
    });
    const test = harness([completed(concept)]);
    const result = await test.orchestrator.generate({ request: request() });
    expect(result.kind).toBe("concept-only");
    expect(test.compileCount).toBe(0);
    if (result.kind === "concept-only") expect(result.exportAllowed).toBe(false);
  });

  it("preserves a privacy-safe deterministic finding code while keeping the model attempt complete", async () => {
    const test = harness(
      [completed(supportedIntent())],
      new DeterministicCompilationError(
        "ENGRAVE_REGION_OVERLAP",
        "Engrave areas must not overlap.",
      ),
    );
    const result = await test.orchestrator.generate({ request: request() });
    expect(result).toMatchObject({
      kind: "failure",
      stage: "compilation",
      code: "ENGRAVE_REGION_OVERLAP",
      retryable: false,
      attempt: {
        outcome: "completed",
        deterministicCompile: "failed",
        networkDispatchCount: 1
      }
    });
  });
});
