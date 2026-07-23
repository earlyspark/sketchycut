import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/domain/fabrication-setup.js";
import { CURRENT_FIXTURE_SCENARIOS } from "../../src/interpretation/current-fixture-corpus.js";
import { DEFAULT_GENERATION_DETERMINISTIC_CONTROLS, GenerationSubmissionSchema } from "../../src/interpretation/generation-submission.js";
import type { RuntimeConfig } from "../../src/server/generation/config.js";
import { executeCurrentGeneration } from "../../src/server/generation/generation-service.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import { DEFAULT_GENERATED_FABRICATION_CONTROLS } from "../../src/ui/content/generated-setup.js";
import {
  DEFAULT_GUIDED_EXAMPLE,
  buildGuidedProductCompileRequest
} from "../../src/ui/content/guided-examples.js";
import { compileProductRequest } from "../../src/workers/compile-service.js";

function withoutSourceHashes(candidate: unknown): unknown {
  if (Array.isArray(candidate)) return candidate.map(withoutSourceHashes);
  if (typeof candidate !== "object" || candidate === null) return candidate;
  return Object.fromEntries(
    Object.entries(candidate)
      .filter(([key]) => key !== "sourceDocumentHash")
      .map(([key, value]) => [key, withoutSourceHashes(value)]),
  );
}

describe("route-neutral canonical workspace parity", () => {
  it("keeps example and generated canonical data on the same projection and export contract", async () => {
    const setup = resolveFabricationSetup(createPublicFabricationSetup());
    const profiles = {
      material: setup.material,
      machine: setup.machine,
      processRecipe: setup.processRecipe,
      fabricationContext: setup.fabricationContext,
      fit: setup.fit
    };
    const guided = await compileProductRequest(buildGuidedProductCompileRequest(
      DEFAULT_GUIDED_EXAMPLE,
      {
        requestId: "shared-workspace-guided",
        presetId: "medium",
        profiles,
        inputPolicyEvaluation: setup.inputPolicyEvaluation,
        retainedPin: createStarterPinSetup()
      },
    ));
    const config: RuntimeConfig = {
      security: { accessCodeDigest: Buffer.alloc(32), signingSecret: Buffer.alloc(32), secureCookies: false },
      storeMode: "memory", upstash: null, generationEnabled: true, quotaUnlimited: false,
      generationMode: "fixture", generationExperience: "fixture", liveTransport: null
    };
    const response = await executeCurrentGeneration({
      config,
      authenticated: {
        session: { schemaVersion: "1.0", sessionId: "shared-workspace-session", issuedAtMs: 1, expiresAtMs: 10_000, generationDispatches: 0, reservedExposureMicrousd: 0, lastDispatchAtMs: null, lastProjectId: null },
        clientIdentifier: "shared-workspace-client"
      },
      submission: GenerationSubmissionSchema.parse({
        schemaVersion: "4.0", brief: CURRENT_FIXTURE_SCENARIOS[0]!.brief,
        references: [], roleConstraints: [], deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
        fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS, retry: null
      }),
      store: new MemoryGenerationStore(), runtimeOrigin: "test-recorded"
    });
    const generated = response.compiled;
    if (generated === null) throw new Error("Expected current generated output.");

    for (const candidate of [guided, generated]) {
      expect(candidate.document.validation.status).toBe("pass");
      expect(candidate.bundle.sourceDocumentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(candidate.bundle.fabrication.sourceDocumentHash).toBe(candidate.bundle.sourceDocumentHash);
      expect(candidate.bundle.scene.sourceDocumentHash).toBe(candidate.bundle.sourceDocumentHash);
      expect(candidate.bundle.bom).toBeDefined();
      expect(candidate.bundle.legend).toBeDefined();
      expect(candidate.bundle.instructions).toBeDefined();
      expect(candidate.svgs).toHaveLength(candidate.bundle.fabrication.sheets.length);
      expect(withoutSourceHashes(candidate.bundle)).toMatchObject({ schemaVersion: "2.0" });
    }
  });

  it("imports the same workspace component without an origin or layout-mode branch", async () => {
    const [guidedSource, generatedSource, workspaceSource] = await Promise.all([
      readFile(path.resolve("src/ui/components/guided-examples-controller.tsx"), "utf8"),
      readFile(path.resolve("src/ui/components/generated-project-controller.tsx"), "utf8"),
      readFile(path.resolve("src/ui/components/canonical-project-workspace.tsx"), "utf8")
    ]);
    expect(guidedSource).toContain("CanonicalProjectWorkspace");
    expect(generatedSource).toContain("CanonicalProjectWorkspace");
    expect(workspaceSource).not.toMatch(/layoutMode|originRoute|generatedMode|exampleMode/);
  });
});
