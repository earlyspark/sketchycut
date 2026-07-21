import { describe, expect, it } from "vitest";

import { CURRENT_FIXTURE_SCENARIOS } from "../../src/interpretation/current-fixture-corpus.js";
import { DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2, GenerationSubmissionV2Schema } from "../../src/interpretation/generation-submission-v2.js";
import type { RuntimeConfig } from "../../src/server/generation/config.js";
import {
  currentProductionPromptHash,
  executeCurrentGeneration
} from "../../src/server/generation/generation-service-v2.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import { DEFAULT_GENERATED_FABRICATION_CONTROLS } from "../../src/ui/content/generated-setup.js";

const config: RuntimeConfig = {
  security: { accessCodeDigest: Buffer.alloc(32), signingSecret: Buffer.alloc(32), secureCookies: false },
  storeMode: "memory", upstash: null, generationEnabled: true, quotaUnlimited: false,
  generationMode: "fixture", generationExperience: "fixture", liveTransport: null
};
const authenticated = {
  session: {
    schemaVersion: "1.0" as const, sessionId: "session-current", issuedAtMs: 1,
    expiresAtMs: 10_000, generationDispatches: 0, reservedExposureMicrousd: 0,
    lastDispatchAtMs: null, lastProjectId: null
  },
  clientIdentifier: "client-current"
};

function submission(brief: string) {
  return GenerationSubmissionV2Schema.parse({
    schemaVersion: "2.0", brief, references: [], roleConstraints: [],
    deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
    fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
    retry: null
  });
}

describe("current generation service", () => {
  it("generates and persists the zero-reference fixture using only current contracts", async () => {
    const store = new MemoryGenerationStore();
    const response = await executeCurrentGeneration({
      config, authenticated, store, runtimeOrigin: "test-recorded",
      submission: submission(CURRENT_FIXTURE_SCENARIOS[0]!.brief)
    });
    expect(response).toMatchObject({
      schemaVersion: "2.0",
      outcome: { kind: "supported", exportAllowed: true, fabricationCandidate: true },
      project: { revision: 1 },
      compiled: { document: { validation: { status: "pass" } } }
    });
    expect(response.outcome.kind === "supported" || response.outcome.kind === "simplified").toBe(true);
    if (response.outcome.kind === "supported" || response.outcome.kind === "simplified") {
      expect(response.outcome.source.semanticProvenance.cacheResult).toBe("miss");
      expect(response.outcome.source.semanticProvenance.attemptId).toBeNull();
      expect(response.compiled?.document.intent).toEqual(response.outcome.source.intent);
      expect(response.compiled?.document.provenance).toMatchObject({
        modelId: "strict-current-fixture-intent",
        promptVersion: "semantic-interpretation-current",
        semanticRequestDigest: response.outcome.source.semanticProvenance.semanticRequestDigest,
        runtimeApplicationApiCalls: 0,
        supportOutcome: response.outcome.kind
      });
      expect(response.compiled?.bundle.sourceDocumentHash).toBe(response.outcome.source.lastVerifiedHashes.documentHash);
    }
    expect(await store.readLedgerAttempts()).toEqual([]);
  });

  it("dispatches past an exhausted session quota only when quotaUnlimited is enabled", async () => {
    const liveConfig: RuntimeConfig = {
      ...config,
      generationMode: "live",
      generationExperience: "live",
      liveTransport: { apiKey: "recorded", interpretationPrompt: "recorded generic prompt" }
    };
    const store = new MemoryGenerationStore();
    const now = Date.now();
    // Session already at the 4-dispatch cap, so a reserved dispatch must fail.
    await store.createSession({
      schemaVersion: "1.0", sessionId: "session-current", issuedAtMs: now,
      expiresAtMs: now + 60_000, generationDispatches: 4, reservedExposureMicrousd: 0,
      lastDispatchAtMs: null, lastProjectId: null
    }, 60);
    let paidDispatches = 0;
    const interpretationTransport = {
      dispatch: () => {
        paidDispatches += 1;
        return Promise.resolve({ kind: "pre-dispatch-failure" as const, errorCode: "FAKE_STOP" });
      }
    };
    const blocked = await executeCurrentGeneration({
      config: liveConfig, authenticated, store, runtimeOrigin: "test-recorded",
      submission: submission("Quota-enforced live brief."),
      interpretationTransport, promptHash: "c".repeat(64)
    });
    expect(blocked.outcome).toMatchObject({ kind: "failure", code: "GENERATION_SESSION_QUOTA" });
    expect(paidDispatches).toBe(0);

    const bypassed = await executeCurrentGeneration({
      config: { ...liveConfig, quotaUnlimited: true }, authenticated, store, runtimeOrigin: "test-recorded",
      submission: submission("Quota-unlimited live brief."),
      interpretationTransport, promptHash: "c".repeat(64)
    });
    expect(bypassed.outcome).toMatchObject({ kind: "failure", code: "FAKE_STOP" });
    expect(paidDispatches).toBe(1);
  });

  it("withholds fabrication for unsupported compound motion and unknown fixture briefs", async () => {
    const unsupported = await executeCurrentGeneration({
      config, authenticated, store: new MemoryGenerationStore(), runtimeOrigin: "test-recorded",
      submission: submission(CURRENT_FIXTURE_SCENARIOS.find((item) => item.unsupportedCompoundMotion)!.brief)
    });
    expect(unsupported).toMatchObject({ outcome: { kind: "concept-only", exportAllowed: false }, project: null, compiled: null });

    const missing = await executeCurrentGeneration({
      config, authenticated, store: new MemoryGenerationStore(), runtimeOrigin: "test-recorded",
      submission: submission("This exact brief has no current fixture.")
    });
    expect(missing).toMatchObject({ outcome: { kind: "failure", code: "FIXTURE_NOT_FOUND" }, project: null, compiled: null });
  });

  it("confines predeclared model-configuration overrides to live evaluation", async () => {
    const evaluationModelConfiguration = {
      modelId: "gpt-5.6-sol" as const,
      reasoningEffort: "high" as const,
      imageDetailPolicy: "high" as const,
      promptLayoutVersion: "stable-prefix-v1" as const,
      maxOutputTokens: 4_000 as const,
      serviceTier: "default" as const,
      store: false as const
    };
    await expect(executeCurrentGeneration({
      config,
      authenticated,
      store: new MemoryGenerationStore(),
      runtimeOrigin: "test-recorded",
      submission: submission(CURRENT_FIXTURE_SCENARIOS[0]!.brief),
      evaluationModelConfiguration
    })).rejects.toThrow("GENERATION_EVALUATION_CONFIGURATION_FORBIDDEN");

    const liveConfig: RuntimeConfig = {
      ...config,
      generationMode: "live",
      generationExperience: "live",
      liveTransport: { apiKey: "recorded", interpretationPrompt: "recorded generic prompt" }
    };
    await expect(executeCurrentGeneration({
      config: liveConfig,
      authenticated,
      store: new MemoryGenerationStore(),
      runtimeOrigin: "test-recorded",
      submission: submission("Evaluation-only configuration boundary."),
      initiatedBy: "live-eval",
      promptHash: "c".repeat(64),
      interpretationTransport: { dispatch: () => Promise.resolve({ kind: "pre-dispatch-failure", errorCode: "UNREACHABLE" }) },
      evaluationModelConfiguration: { ...evaluationModelConfiguration, modelId: "another-model" }
    })).rejects.toThrow("GENERATION_EVALUATION_CONFIGURATION_OUTSIDE_FROZEN_ENVELOPE");

    const stableHash = await currentProductionPromptHash(liveConfig, evaluationModelConfiguration);
    const controlHash = await currentProductionPromptHash(liveConfig, {
      promptLayoutVersion: "request-local-control-v1"
    });
    expect(stableHash).not.toBe(controlHash);
  });
});
