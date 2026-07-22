import { describe, expect, it } from "vitest";

import { sha256 } from "../../src/domain/hash.js";
import { executeLiveDiversityRound } from "../../src/evaluation/live-diversity-evaluation.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
  GenerationSubmissionV2Schema
} from "../../src/interpretation/generation-submission-v2.js";
import type { SemanticInterpretationTransportV2 } from "../../src/interpretation/semantic-transport.js";
import type { RuntimeConfig } from "../../src/server/generation/config.js";
import { GENERATION_OPENAI_PRICE } from "../../src/server/generation/cost-envelope.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import { currentProductionPromptHash } from "../../src/server/generation/generation-service-v2.js";
import { DEFAULT_GENERATED_FABRICATION_CONTROLS } from "../../src/ui/content/generated-setup.js";
import { FROZEN_LIVE_DIVERSITY_COHORT } from "../fixtures/intent-conditioned-construction/corpus.js";
import { FROZEN_ITERATION_PANEL_PROTOCOL } from "../fixtures/intent-conditioned-construction/iteration-panel-protocol.js";
import { M6_2_LIVE_COMPARISON_FINGERPRINTS } from "../fixtures/intent-conditioned-construction/m6-2-live-fingerprints.js";
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

describe("authorized live diversity round harness", () => {
  it("dispatches each frozen case exactly once through ordinary quota and ledger controls", async () => {
    let now = 1_000;
    let dispatches = 0;
    const store = new MemoryGenerationStore(() => now);
    const promptHash = await currentProductionPromptHash(config);
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
    const before = await store.readGlobalExposureState();
    const report = await executeLiveDiversityRound({
      roundId: "m6.3-iteration-1",
      protocol: FROZEN_ITERATION_PANEL_PROTOCOL,
      cases: FROZEN_LIVE_DIVERSITY_COHORT,
      baselines: M6_2_LIVE_COMPARISON_FINGERPRINTS,
      expectedExposureState: before,
      config,
      store,
      transportForCase: () => transport,
      promptHash,
      submissionForCase: ({ brief }) => submission(brief),
      now: () => now,
      sleep: (milliseconds) => {
        now += milliseconds;
        return Promise.resolve();
      }
    });
    expect(report).toMatchObject({
      roundId: "m6.3-iteration-1",
      ledgerAttemptDelta: 5,
      ledgerDispatchDelta: 5,
      summary: {
        pass: false,
        opportunity: {
          proportions: { hits: 3, total: 3 },
          counts: { hits: 1, total: 1 },
          scaleEvidence: { hits: 2, total: 2 },
          access: { hits: 1, total: 1 }
        },
        topologySensitivePasses: 2,
        completeCaseSet: true
      }
    });
    expect(report.cases.map((item) => item.cacheResult)).toEqual(Array(5).fill("miss"));
    expect(report.cases.every((item) =>
      item.result.kind === item.outcome && item.ledgerAttempt.initiatedBy === "live-eval"
    )).toBe(true);
    expect(report.exposureAfter.reservedExposureMicrousd -
      report.exposureBefore.reservedExposureMicrousd).toBe(3_250_000);
    expect(dispatches).toBe(5);
    const attempts = await store.readLedgerAttempts();
    expect(attempts).toHaveLength(5);
    expect(attempts.every((item) =>
      item.initiatedBy === "live-eval" && item.networkDispatchCount === 1
    )).toBe(true);
  }, 30_000);

  it("fails stale exposure authorization before creating a dispatch", async () => {
    const store = new MemoryGenerationStore();
    let dispatches = 0;
    await expect(executeLiveDiversityRound({
      roundId: "stale-round",
      protocol: FROZEN_ITERATION_PANEL_PROTOCOL,
      cases: FROZEN_LIVE_DIVERSITY_COHORT,
      baselines: M6_2_LIVE_COMPARISON_FINGERPRINTS,
      expectedExposureState: {
        schemaVersion: "1.0",
        authorizedCeilingMicrousd: 5_000_000,
        reservedExposureMicrousd: 650_000,
        authorizationVersion: 0
      },
      config,
      store,
      transportForCase: () => ({ dispatch: () => { dispatches += 1; throw new Error("UNREACHABLE"); } }),
      promptHash: await sha256("recorded generic prompt"),
      submissionForCase: ({ brief }) => submission(brief)
    })).rejects.toThrow("LIVE_EVALUATION_AUTHORIZED_EXPOSURE_STATE_STALE");
    expect(dispatches).toBe(0);
    expect(await store.readLedgerAttempts()).toEqual([]);
  });

  it("rejects unlimited-quota configuration before creating a session or dispatch", async () => {
    const store = new MemoryGenerationStore();
    let dispatches = 0;
    await expect(executeLiveDiversityRound({
      roundId: "quota-bypass-round",
      protocol: FROZEN_ITERATION_PANEL_PROTOCOL,
      cases: FROZEN_LIVE_DIVERSITY_COHORT,
      baselines: M6_2_LIVE_COMPARISON_FINGERPRINTS,
      expectedExposureState: await store.readGlobalExposureState(),
      config: { ...config, quotaUnlimited: true },
      store,
      transportForCase: () => ({ dispatch: () => { dispatches += 1; throw new Error("UNREACHABLE"); } }),
      promptHash: await sha256("recorded generic prompt"),
      submissionForCase: ({ brief }) => submission(brief)
    })).rejects.toThrow("LIVE_EVALUATION_DURABLE_LIVE_CONFIG_REQUIRED");
    expect(dispatches).toBe(0);
    expect(await store.readLedgerAttempts()).toEqual([]);
  });
});
