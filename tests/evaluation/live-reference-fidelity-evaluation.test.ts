import { describe, expect, it } from "vitest";

import { executeLiveReferenceFidelityRound } from "../../src/evaluation/live-reference-fidelity-evaluation.js";
import type { ReferenceFidelityCaseContract } from "../../src/evaluation/reference-fidelity-study.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
  GenerationSubmissionV2Schema
} from "../../src/interpretation/generation-submission-v2.js";
import type { SemanticInterpretationTransportV2 } from "../../src/interpretation/semantic-transport.js";
import type { RuntimeConfig } from "../../src/server/generation/config.js";
import { GENERATION_OPENAI_PRICE } from "../../src/server/generation/cost-envelope.js";
import { currentProductionPromptHash } from "../../src/server/generation/generation-service-v2.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import { DEFAULT_GENERATED_FABRICATION_CONTROLS } from "../../src/ui/content/generated-setup.js";
import { FROZEN_LIVE_DIVERSITY_COHORT } from "../fixtures/intent-conditioned-construction/corpus.js";
import { frozenSemanticFixture } from "../fixtures/intent-conditioned-construction/semantic-fixtures.js";

const config: RuntimeConfig = {
  security: { accessCodeDigest: Buffer.alloc(32), signingSecret: Buffer.alloc(32), secureCookies: false },
  storeMode: "upstash",
  upstash: { url: "https://recorded.invalid", token: "recorded" },
  generationEnabled: true,
  quotaUnlimited: false,
  generationMode: "live",
  generationExperience: "live",
  liveTransport: { apiKey: "recorded", interpretationPrompt: "recorded generic prompt" }
};

const modelConfiguration = {
  modelId: "gpt-5.6-sol" as const,
  reasoningEffort: "medium" as const,
  imageDetailPolicy: "high" as const,
  promptLayoutVersion: "stable-prefix-v2" as const,
  maxOutputTokens: 6_000 as const,
  serviceTier: "default" as const,
  store: false as const
};

const contracts: readonly ReferenceFidelityCaseContract[] = FROZEN_LIVE_DIVERSITY_COHORT.map((item) => ({
  id: item.id,
  partition: "comparison",
  brief: item.brief,
  referenceIds: [],
  roleConstraints: [],
  expectedRelationships: [],
  relationshipAcceptance: [],
  expectedOutcome: "supported",
  outcomeAcceptance: "exact",
  predicateCodes: ["ZERO_REFERENCE_SUPPORTED"]
}));

function submission(brief: string) {
  return GenerationSubmissionV2Schema.parse({
    schemaVersion: "2.0",
    brief,
    references: [],
    roleConstraints: [],
    deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
    fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
    retry: null
  });
}

describe("M7.1 guarded live reference-fidelity evaluator", () => {
  it("scores five strict cases and persists only a privacy-safe outcome projection", async () => {
    let now = 2_000;
    let dispatches = 0;
    const store = new MemoryGenerationStore(() => now);
    const readPersistedAttempts = store.readLedgerAttempts.bind(store);
    store.readLedgerAttempts = () =>
      Promise.reject(new Error("HISTORICAL_LEDGER_READ_FORBIDDEN"));
    const promptHash = await currentProductionPromptHash(config, modelConfiguration);
    const transport: SemanticInterpretationTransportV2 = {
      dispatch({ request }) {
        dispatches += 1;
        const liveCase = FROZEN_LIVE_DIVERSITY_COHORT.find((item) =>
          item.brief === request.semanticBrief
        );
        if (liveCase === undefined) throw new Error("RECORDED_CASE_MISSING");
        return Promise.resolve({
          kind: "completed",
          providerRequestId: `provider-${String(dispatches)}`,
          providerModelId: "gpt-5.6-sol",
          responseId: `response-${String(dispatches)}`,
          finishState: "completed",
          latencyMs: 10,
          usage: {
            inputTokens: 100,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
            reasoningTokens: 10,
            outputTokens: 100,
            totalTokens: 200
          },
          estimatedCostUsd: 0.01,
          requestBudgetUpperBoundUsd: GENERATION_OPENAI_PRICE.requestBudgetUpperBoundUsd,
          priceSnapshotId: GENERATION_OPENAI_PRICE.id,
          intentCandidate: frozenSemanticFixture({
            caseId: liveCase.id,
            sourceEvidenceIndex: request.sourceEvidenceIndex
          })
        });
      }
    };
    const report = await executeLiveReferenceFidelityRound({
      roundId: "m7-1-study-fixture",
      studyConfigurationId: "high-medium-stable-prefix",
      contracts,
      cases: FROZEN_LIVE_DIVERSITY_COHORT,
      expectedExposureState: await store.readGlobalExposureState(),
      config,
      store,
      modelConfiguration,
      transportForCase: () => transport,
      promptHash,
      submissionForCase: ({ brief }) => submission(brief),
      now: () => now,
      sleep: (milliseconds) => {
        now += milliseconds;
        return Promise.resolve();
      }
    });
    expect(report.summary).toMatchObject({
      pass: true,
      strictParseRate: 1,
      outcomeAcceptanceRate: 1,
      orderedReferenceCoverageRate: 1,
      relationshipAcceptanceRate: 1,
      predicateRate: 1,
      exactDispatchCount: true
    });
    expect(report.ledgerDispatchDelta).toBe(5);
    expect(dispatches).toBe(5);
    expect(await readPersistedAttempts()).toHaveLength(5);
    expect(JSON.stringify(report)).not.toMatch(/recorded generic prompt|data:image|base64|\.png|\.svg/iu);
    expect(report.cases.every((item) =>
      !Object.hasOwn(item.result, "intent") && !Object.hasOwn(item.result, "source")
    )).toBe(true);
  }, 30_000);
});
