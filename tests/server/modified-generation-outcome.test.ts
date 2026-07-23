import { describe, expect, it, vi } from "vitest";

import { CURRENT_FIXTURE_SCENARIOS } from "../../src/interpretation/current-fixture-corpus.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
  GenerationSubmissionSchema
} from "../../src/interpretation/generation-submission.js";
import { GenerationOutcomeSchema } from "../../src/interpretation/generation-outcome.js";
import type { RuntimeConfig } from "../../src/server/generation/config.js";
import { executeCurrentGeneration } from "../../src/server/generation/generation-service.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import { DEFAULT_GENERATED_FABRICATION_CONTROLS } from "../../src/ui/content/generated-setup.js";

const fixtureConfig: RuntimeConfig = {
  security: {
    accessCodeDigest: Buffer.alloc(32),
    signingSecret: Buffer.alloc(32),
    secureCookies: false
  },
  storeMode: "memory",
  upstash: null,
  generationEnabled: true,
  quotaUnlimited: false,
  generationMode: "fixture",
  generationExperience: "fixture",
  liveTransport: null
};

async function generateModifiedFixture() {
  const scenario = CURRENT_FIXTURE_SCENARIOS.find((candidate) =>
    candidate.id === "modified-fixed-aperture-enclosure"
  );
  if (scenario === undefined) throw new Error("Missing modified-outcome fixture.");
  return executeCurrentGeneration({
    config: fixtureConfig,
    authenticated: {
      session: {
        schemaVersion: "1.0",
        sessionId: "modified-outcome-owner",
        issuedAtMs: 1,
        expiresAtMs: 20_000,
        generationDispatches: 0,
        reservedExposureMicrousd: 0,
        lastDispatchAtMs: null,
        lastProjectId: null
      },
      clientIdentifier: "modified-outcome-client"
    },
    submission: GenerationSubmissionSchema.parse({
      schemaVersion: "4.0",
      brief: scenario.brief,
      references: [],
      roleConstraints: [],
      deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
      fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
      retry: null
    }),
    store: new MemoryGenerationStore(),
    runtimeOrigin: "test-recorded"
  });
}

describe("modified generation outcome", () => {
  it("preserves a validated supported project while disclosing an unregistered essential capability", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const response = await generateModifiedFixture();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.outcome.kind).toBe("modified");
    expect(response.compiled?.document.validation.status).toBe("pass");
    expect(response.compiled?.svgs.length).toBeGreaterThan(0);
    expect(response.project).not.toBeNull();
    if (response.outcome.kind !== "modified") throw new Error("Expected a modified outcome.");
    expect(response.outcome.exportAllowed).toBe(true);
    expect(response.outcome.canonicalResult.exportAllowed).toBe(response.outcome.exportAllowed);
    expect(response.outcome.includedSemanticIds).toContain("inventory-item-1");
    expect(response.outcome.omittedSemanticIds).toEqual(["inventory-item-4"]);
    expect(response.outcome.findingCodes).toContain(
      "MODIFIED_OUTPUT_OMITS_UNREGISTERED_CAPABILITY"
    );
    expect(response.outcome.source.requestCoverage).toEqual({
      status: "modified",
      includedSemanticIds: response.outcome.includedSemanticIds,
      changedSemanticIds: response.outcome.changedSemanticIds,
      omittedSemanticIds: response.outcome.omittedSemanticIds,
      disclosures: response.outcome.modificationDisclosures
    });
    expect(response.outcome.source.inventoryRealization.records.find((record) =>
      record.itemId === "inventory-item-4"
    )).toMatchObject({
      importance: "essential",
      accountingState: "unbound",
      realizationState: "unsupported",
      reason: "CAPABILITY_NOT_REGISTERED"
    });
    fetchSpy.mockRestore();
  });

  it("rejects caller-authored coverage that hides an omitted semantic item", async () => {
    const response = await generateModifiedFixture();
    if (response.outcome.kind !== "modified") throw new Error("Expected a modified outcome.");
    expect(GenerationOutcomeSchema.safeParse({
      ...response.outcome,
      omittedSemanticIds: ["inventory-item-1"]
    }).success).toBe(false);
    expect(GenerationOutcomeSchema.safeParse({
      ...response.outcome,
      source: {
        ...response.outcome.source,
        requestCoverage: {
          ...response.outcome.source.requestCoverage,
          status: "complete",
          omittedSemanticIds: []
        }
      }
    }).success).toBe(false);
    expect(GenerationOutcomeSchema.safeParse({
      ...response.outcome,
      fabricationCandidate: false,
      exportAllowed: false,
      canonicalResult: {
        ...response.outcome.canonicalResult,
        fabricationCandidate: false,
        exportAllowed: false
      }
    }).success).toBe(false);
  });
});
