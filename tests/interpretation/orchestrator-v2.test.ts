import { describe, expect, it } from "vitest";

import { createPublicFabricationSetup, createStarterPinSetup, resolveFabricationSetup } from "../../src/domain/fabrication-setup.js";
import { hashCanonical, sha256 } from "../../src/domain/hash.js";
import { planIntentConditionedConstruction } from "../../src/interpretation/construction-planner.js";
import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import { generationOutcomeV2FromPlanner } from "../../src/interpretation/generation-outcome-v2.js";
import { intentGraphV2ProviderSchema } from "../../src/interpretation/intent-graph-v2.js";
import type { LiveCallAttempt } from "../../src/interpretation/live-ledger.js";
import { CurrentSemanticOrchestrator } from "../../src/interpretation/orchestrator-v2.js";
import { ExactSemanticCacheV2 } from "../../src/interpretation/semantic-cache-v2.js";
import { prepareSemanticGenerationRequestV2 } from "../../src/interpretation/semantic-request-v2.js";
import type { SemanticInterpretationTransportV2, SemanticTransportOutcome } from "../../src/interpretation/semantic-transport.js";
import { frozenSemanticFixture } from "../fixtures/intent-conditioned-construction/semantic-fixtures.js";

class QueueTransport implements SemanticInterpretationTransportV2 {
  count = 0;
  constructor(readonly outcomes: SemanticTransportOutcome[]) {}
  dispatch(): Promise<SemanticTransportOutcome> {
    this.count += 1;
    const next = this.outcomes.shift();
    if (next === undefined) throw new Error("UNEXPECTED_DISPATCH");
    return Promise.resolve(next);
  }
}

function completed(candidate: unknown): SemanticTransportOutcome {
  return {
    kind: "completed", intentCandidate: candidate, providerRequestId: "provider-v2", providerModelId: "fixture-model", responseId: "response-v2", finishState: "completed",
    latencyMs: 10,
    usage: { inputTokens: 100, cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningTokens: 20, outputTokens: 50, totalTokens: 150 },
    estimatedCostUsd: 0.01, requestBudgetUpperBoundUsd: 0.25, priceSnapshotId: "pricing-snapshot"
  };
}

async function harness(outcomes: SemanticTransportOutcome[]) {
  const promptHash = await sha256("fixture-prompt");
  const prepared = await prepareSemanticGenerationRequestV2({
    brief: "Make an open-top catchall.", references: [], roleConstraints: [],
    promptIdentity: "current-neutral-prompt", promptHash,
    modelConfiguration: { modelId: "fixture-model", reasoningEffort: "low", imageDetailPolicy: "low", promptLayoutVersion: "stable-prefix-v2", maxOutputTokens: 6_000, serviceTier: "default", store: false }
  });
  const intent = frozenSemanticFixture({ caseId: "text-only-zero-reference", sourceEvidenceIndex: prepared.sourceEvidenceIndex });
  const transport = new QueueTransport(outcomes);
  const attempts: LiveCallAttempt[] = [];
  const orchestrator = new CurrentSemanticOrchestrator({
    cache: new ExactSemanticCacheV2(), transport, promptHash, runtimeOrigin: "test-recorded", transportMode: "fixture",
    dispatchExposure: { requestBudgetUpperBoundUsd: 0.25, priceSnapshotId: "pricing-snapshot" },
    appendAttempt: (attempt) => { attempts.push(attempt); return Promise.resolve(); },
    process: async ({ request, intent: parsedIntent, cacheResult, attemptId, providerRequestId }) => {
      const explicitSizing = await reconcileExplicitSizingConstraints({
        advancedSizing: { basis: "auto" }, parsedConstraints: prepared.parsedConstraints, parserFindings: prepared.parserFindings
      });
      const setup = resolveFabricationSetup(createPublicFabricationSetup());
      const planning = await planIntentConditionedConstruction({
        intent: parsedIntent, explicitConstraints: explicitSizing,
        profiles: { material: setup.material, machine: setup.machine, processRecipe: setup.processRecipe, fabricationContext: setup.fabricationContext, fit: setup.fit },
        inputPolicyEvaluation: setup.inputPolicyEvaluation, pin: createStarterPinSetup()
      });
      return generationOutcomeV2FromPlanner({
        requestId: "orchestrator-result", transportMode: "fixture",
        semanticRequestDigest: await hashCanonical(request), sourceEvidenceIndexDigest: request.sourceEvidenceIndex.digest,
        promptIdentity: request.promptIdentity, promptHash: request.promptHash, modelId: request.modelConfiguration.modelId,
        cacheResult, attemptId, providerRequestId, intent: parsedIntent, explicitSizing, planning
      });
    }
  });
  return { prepared, intent, transport, attempts, orchestrator };
}

describe("current semantic orchestrator", () => {
  it("dispatches once, recompiles on cache hit, and appends categorical telemetry", async () => {
    const test = await harness([]);
    test.transport.outcomes.push(completed(test.intent));
    const first = await test.orchestrator.generate({ request: test.prepared.request });
    const second = await test.orchestrator.generate({ request: test.prepared.request });
    expect(first.outcome.kind).toBe("supported");
    expect(second.outcome.kind).toBe("supported");
    expect(test.transport.count).toBe(1);
    expect(test.attempts).toHaveLength(2);
    expect(test.attempts[0]).toMatchObject({
      networkDispatchCount: 1,
      outcome: "completed",
      schemaHash: await hashCanonical(intentGraphV2ProviderSchema(test.prepared.sourceEvidenceIndex)),
      elicitationTelemetry: { semanticSource: "fresh-dispatch", referenceCountBucket: "zero" }
    });
    expect(test.attempts[1]).toMatchObject({
      networkDispatchCount: 0,
      outcome: "cache-hit",
      elicitationTelemetry: { semanticSource: "cache-hit", referenceCountBucket: "zero" }
    });
  });

  it("rejects unknown evidence as a billed strict-schema failure", async () => {
    const test = await harness([]);
    const invalid = structuredClone(test.intent);
    invalid.requirements[0]!.evidenceIds = ["invented-evidence"];
    test.transport.outcomes.push(completed(invalid));
    const result = await test.orchestrator.generate({ request: test.prepared.request });
    expect(result.outcome).toMatchObject({ kind: "failure", stage: "schema", code: "STRICT_INTENT_SCHEMA_FAILURE", retryable: true });
    expect(result.attempt).toMatchObject({ outcome: "schema-failure", billing: { state: "confirmed-billed" }, networkDispatchCount: 1 });
  });

  it("retains potential billing exposure after an ambiguous handoff", async () => {
    const test = await harness([{ kind: "ambiguous-transport", providerRequestId: null, latencyMs: 5, requestBudgetUpperBoundUsd: 0.25, priceSnapshotId: "pricing-snapshot", errorCode: "OPENAI_TRANSPORT_TIMEOUT" }]);
    const result = await test.orchestrator.generate({ request: test.prepared.request });
    expect(result.outcome).toMatchObject({ kind: "failure", stage: "transport", retryable: true });
    expect(result.attempt).toMatchObject({ outcome: "ambiguous-transport", billing: { state: "potentially-billed", estimatedCostUsd: null, requestBudgetUpperBoundUsd: 0.25 } });
  });

  it("uses a new client request identity for one explicit linked retry and never retries automatically", async () => {
    const test = await harness([
      { kind: "ambiguous-transport", providerRequestId: null, latencyMs: 5, requestBudgetUpperBoundUsd: 0.25, priceSnapshotId: "pricing-snapshot", errorCode: "OPENAI_TRANSPORT_TIMEOUT" }
    ]);
    const first = await test.orchestrator.generate({ request: test.prepared.request });
    expect(test.transport.count).toBe(1);
    if (first.attempt === null) throw new Error("EXPECTED_RECORDED_ATTEMPT");
    test.transport.outcomes.push(completed(test.intent));
    const second = await test.orchestrator.generate({
      request: test.prepared.request,
      retry: {
        priorAttemptId: first.attempt.attemptId,
        retryChainId: first.attempt.retryChainId,
        attemptOrdinal: 2
      }
    });
    expect(second.outcome.kind).toBe("supported");
    expect(test.transport.count).toBe(2);
    expect(second.attempt).toMatchObject({
      initiatedBy: "explicit-user-retry",
      retryOfAttemptId: first.attempt.attemptId,
      retryChainId: first.attempt.retryChainId,
      attemptOrdinal: 2
    });
    expect(second.attempt?.clientRequestId).not.toBe(first.attempt.clientRequestId);
  });
});
