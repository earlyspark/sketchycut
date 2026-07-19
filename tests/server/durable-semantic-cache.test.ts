import { describe, expect, it } from "vitest";

import { hashCanonical } from "../../src/domain/hash.js";
import { IntentGraphV1Schema } from "../../src/interpretation/intent-graph.js";
import { CachedSemanticValueV1Schema } from "../../src/interpretation/semantic-cache.js";
import {
  normalizeSemanticGenerationRequest,
  semanticRequestDigest
} from "../../src/interpretation/semantic-request.js";
import { DurableSemanticCache } from "../../src/server/generation/durable-semantic-cache.js";
import { generationKeys } from "../../src/server/generation/keys.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";

const intent = IntentGraphV1Schema.parse({
  schemaVersion: "1.0",
  title: "Rigid holder",
  coreIntent: "Hold an item in one rigid orthogonal sheet assembly.",
  requirements: [{
    id: "rigid-function",
    priority: "must",
    kind: "rigid-assembly",
    statement: "The assembly must remain rigid.",
    evidence: [{
      evidenceId: "brief-rigid",
      source: "text",
      referenceId: null,
      statement: "The brief requires a rigid assembly."
    }]
  }],
  references: [],
  topology: {
    bodies: [
      { id: "base", role: "support", quantity: 1, shapeClass: "planar", attachmentRole: "base", orientationRole: "horizontal" },
      { id: "wall", role: "support", quantity: 1, shapeClass: "planar", attachmentRole: "side", orientationRole: "vertical" }
    ],
    interfaces: [{
      id: "rigid-interface",
      between: ["base", "wall"],
      behavior: "rigid",
      relativeOrientation: "orthogonal",
      axisRole: "unspecified",
      function: "Retain the upright support."
    }]
  },
  motif: null,
  conflicts: [],
  assumptions: [],
  capabilityAssessment: { coreIntentRepresentable: true, unresolvedNeeds: [] }
});

const request = normalizeSemanticGenerationRequest({
  brief: "Build a private rigid holder brief.",
  references: [{
    referenceId: "reference-1",
    sha256: "a".repeat(64),
    mediaType: "image/jpeg",
    width: 320,
    height: 240
  }],
  roleConstraints: [],
  modelConfiguration: {
    modelId: "gpt-5.6-terra",
    reasoningEffort: "low",
    maxOutputTokens: 4_000,
    serviceTier: "default",
    store: false
  }
});

async function value() {
  return CachedSemanticValueV1Schema.parse({
    schemaVersion: "1.0",
    intent,
    provenance: {
      modelId: request.modelConfiguration.modelId,
      responseId: "response-cache",
      outputDigest: await hashCanonical(intent),
      promptVersion: request.promptVersion,
      promptHash: request.promptHash,
      intentSchemaVersion: request.intentSchemaVersion,
      capabilityCatalogVersion: request.capabilityCatalogVersion
    }
  });
}

describe("durable exact semantic cache", () => {
  it("survives a cache instance restart without storing the brief or fabrication authority", async () => {
    const store = new MemoryGenerationStore();
    let dispatches = 0;
    const first = new DurableSemanticCache({ store });
    expect((await first.resolve(request, async () => {
      dispatches += 1;
      return value();
    })).cacheResult).toBe("miss");
    const second = new DurableSemanticCache({ store });
    expect((await second.resolve(request, async () => {
      dispatches += 1;
      return value();
    })).cacheResult).toBe("hit");
    expect(dispatches).toBe(1);
    const digest = await semanticRequestDigest(request);
    const stored = await store.getValue(generationKeys.cache(digest));
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(request.normalizedBrief);
    expect(stored).not.toContain("geometry");
    expect(stored).not.toContain("validation");
    expect(stored).not.toContain("data:image");
  });

  it("singleflights simultaneous requests across cache instances", async () => {
    const store = new MemoryGenerationStore();
    let dispatches = 0;
    let release: (() => void) | undefined;
    let markEntered: (() => void) | undefined;
    let markWaiting: (() => void) | undefined;
    let continueWaiting: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const waiting = new Promise<void>((resolve) => { markWaiting = resolve; });
    const mayContinue = new Promise<void>((resolve) => { continueWaiting = resolve; });
    const first = new DurableSemanticCache({ store });
    const second = new DurableSemanticCache({
      store,
      wait: async () => {
        markWaiting?.();
        await mayContinue;
        await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      }
    });
    const initial = first.resolve(request, async () => {
      dispatches += 1;
      markEntered?.();
      await held;
      return value();
    });
    await entered;
    const follower = second.resolve(request, async () => {
      dispatches += 1;
      return value();
    });
    await waiting;
    release?.();
    continueWaiting?.();
    const results = await Promise.all([initial, follower]);
    expect(results.map((item) => item.cacheResult).sort()).toEqual(["miss", "singleflight-hit"]);
    expect(dispatches).toBe(1);
  });

  it("treats obsolete cache bytes as a miss and replaces them with the current contract", async () => {
    const store = new MemoryGenerationStore();
    const digest = await semanticRequestDigest(request);
    const key = generationKeys.cache(digest);
    await store.setValue(key, JSON.stringify({
      schemaVersion: "0.9",
      rawProviderResponse: "obsolete bytes must not be accepted"
    }), { ttlSeconds: 60 });
    let dispatches = 0;
    const resolution = await new DurableSemanticCache({ store }).resolve(request, async () => {
      dispatches += 1;
      return value();
    });
    expect(resolution.cacheResult).toBe("miss");
    expect(dispatches).toBe(1);
    expect(CachedSemanticValueV1Schema.parse(
      JSON.parse((await store.getValue(key)) ?? "null") as unknown,
    ).provenance.promptHash).toBe(request.promptHash);
  });
});
