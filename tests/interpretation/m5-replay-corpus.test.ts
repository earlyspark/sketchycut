import { describe, expect, it, vi } from "vitest";

import { ExactSemanticCache } from "../../src/interpretation/semantic-cache.js";
import {
  M5_REPLAY_SCENARIOS,
  findM5ReplayScenario
} from "../../src/interpretation/m5-replay-corpus.js";
import { M5ReplayOrchestrator } from "../../src/interpretation/replay-orchestrator.js";
import { normalizeSemanticGenerationRequest } from "../../src/interpretation/semantic-request.js";

function request(brief: string, roles: ("structure" | "motif")[] = []) {
  return normalizeSemanticGenerationRequest({
    brief,
    references: [{
      referenceId: "reference-1",
      sha256: "a".repeat(64),
      mediaType: "image/jpeg",
      width: 600,
      height: 400
    }],
    roleConstraints: roles.length === 0 ? [] : [{ referenceId: "reference-1", roles }],
    modelConfiguration: {
      modelId: "m5-replay-fixture@1.0.0",
      reasoningEffort: "low",
      maxOutputTokens: 4_000,
      serviceTier: "default",
      store: false
    }
  });
}

describe("M5 replay corpus", () => {
  it("covers every required public behavior, role, conflict, scale, simplification, and failure state", async () => {
    const compile = vi.fn(({ mapping }: { mapping: { kind: string } }) => Promise.resolve({
      compiledKind: mapping.kind
    }));
    const orchestrator = new M5ReplayOrchestrator({
      cache: new ExactSemanticCache(),
      compile
    });
    for (const scenario of M5_REPLAY_SCENARIOS) {
      const result = await orchestrator.generate(request(scenario.brief));
      expect(result.kind, scenario.id).toBe(
        scenario.expectedOutcome === "schema-failure"
          ? "failure"
          : scenario.expectedOutcome,
      );
      if (scenario.expectedOutcome === "schema-failure") {
        expect(result).toMatchObject({ stage: "schema", code: "STRICT_INTENT_SCHEMA_FAILURE" });
      }
    }
    expect(M5_REPLAY_SCENARIOS.some((item) => item.behavior === "rigid")).toBe(true);
    expect(M5_REPLAY_SCENARIOS.some((item) => item.behavior === "revolute")).toBe(true);
    expect(M5_REPLAY_SCENARIOS.some((item) => item.behavior === "prismatic")).toBe(true);
    expect(M5_REPLAY_SCENARIOS.some((item) => item.missingScale)).toBe(true);
    expect(M5_REPLAY_SCENARIOS.some((item) => item.conflict)).toBe(true);
    expect(M5_REPLAY_SCENARIOS.some((item) => item.defaultRoles.join("+") === "structure+motif")).toBe(true);
  });

  it("turns maker-edited roles into exact constraints only on explicit regeneration", async () => {
    const scenario = findM5ReplayScenario(
      "Make a small rigid container using the reference for structure.",
    )!;
    const orchestrator = new M5ReplayOrchestrator({
      cache: new ExactSemanticCache(),
      compile: () => Promise.resolve({ ok: true })
    });
    const inferred = await orchestrator.generate(request(scenario.brief));
    const constrained = await orchestrator.generate(request(scenario.brief, ["structure", "motif"]));
    expect(inferred.kind).toBe("supported");
    expect(constrained.kind).toBe("supported");
    if (inferred.kind !== "supported" || constrained.kind !== "supported") return;
    expect(inferred.intent.references[0]?.inferredRoles).toEqual(["structure"]);
    expect(constrained.intent.references[0]?.inferredRoles).toEqual(["structure", "motif"]);
    expect(constrained.cacheResult).toBe("miss");
  });

  it("uses exact process-memory caching while recompiling and remapping on every hit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    let compileCount = 0;
    const orchestrator = new M5ReplayOrchestrator({
      cache: new ExactSemanticCache(),
      compile: () => Promise.resolve({ compileOrdinal: ++compileCount })
    });
    const semantic = request(M5_REPLAY_SCENARIOS[0]!.brief);
    const first = await orchestrator.generate(semantic);
    const second = await orchestrator.generate(semantic);
    expect(first).toMatchObject({ kind: "supported", cacheResult: "miss" });
    expect(second).toMatchObject({ kind: "supported", cacheResult: "hit" });
    expect(compileCount).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
