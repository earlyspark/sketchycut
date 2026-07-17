import { describe, expect, it } from "vitest";

import { hashCanonical } from "../../src/domain/hash.js";
import { IntentGraphV1Schema, type IntentGraphV1 } from "../../src/interpretation/intent-graph.js";
import { mapIntentGraph } from "../../src/interpretation/mapper.js";
import { ExactSemanticCache } from "../../src/interpretation/semantic-cache.js";
import {
  M5_CAPABILITY_CATALOG_ID,
  M5_INTENT_SCHEMA_VERSION,
  M5_PROMPT_VERSION,
  normalizeSemanticGenerationRequest,
  type SemanticGenerationRequestV1
} from "../../src/interpretation/semantic-request.js";

const firstDigest = "a".repeat(64);
const secondDigest = "b".repeat(64);

function intent(): IntentGraphV1 {
  return IntentGraphV1Schema.parse({
    schemaVersion: "1.0",
    title: "Rigid holder",
    coreIntent: "Hold an item in a rigid orthogonal sheet assembly.",
    requirements: [{
      id: "rigid-function",
      priority: "must",
      kind: "rigid-assembly",
      statement: "The assembly must remain rigid.",
      evidence: [{
        evidenceId: "brief-rigid",
        source: "text",
        referenceId: null,
        statement: "The brief asks for a rigid assembly."
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
        function: "Retain the upright support."
      }]
    },
    motif: null,
    conflicts: [],
    assumptions: [],
    capabilityAssessment: { coreIntentRepresentable: true, unresolvedNeeds: [] }
  });
}

function request(
  overrides: Partial<SemanticGenerationRequestV1> = {},
): SemanticGenerationRequestV1 {
  const normalized = normalizeSemanticGenerationRequest({
    brief: "  Build   a rigid holder. ",
    references: [
      {
        referenceId: "reference-one",
        sha256: firstDigest,
        mediaType: "image/png",
        width: 800,
        height: 600
      },
      {
        referenceId: "reference-two",
        sha256: secondDigest,
        mediaType: "image/jpeg",
        width: 600,
        height: 800
      }
    ],
    roleConstraints: [],
    modelConfiguration: {
      modelId: "candidate-model",
      reasoningEffort: "low",
      maxOutputTokens: 4_000,
      serviceTier: "default",
      store: false
    }
  });
  return { ...normalized, ...overrides };
}

async function valueFor(req: SemanticGenerationRequestV1) {
  const graph = intent();
  return {
    schemaVersion: "1.0" as const,
    intent: graph,
    provenance: {
      modelId: req.modelConfiguration.modelId,
      responseId: "response-one",
      outputDigest: await hashCanonical(graph),
      promptVersion: req.promptVersion,
      intentSchemaVersion: req.intentSchemaVersion,
      capabilityCatalogVersion: req.capabilityCatalogVersion
    }
  };
}

describe("process-memory exact semantic cache", () => {
  it("normalizes text and makes exact hits without caching fabrication authority", async () => {
    const cache = new ExactSemanticCache();
    let dispatches = 0;
    let mappings = 0;
    const run = async (candidate: SemanticGenerationRequestV1) => {
      const resolution = await cache.resolve(candidate, async (parsed) => {
        dispatches += 1;
        return valueFor(parsed);
      });
      mappings += 1;
      const mapping = await mapIntentGraph(resolution.value.intent);
      return { resolution, mapping };
    };
    const normalized = request();
    expect(normalized.normalizedBrief).toBe("Build a rigid holder.");
    expect((await run(normalized)).resolution.cacheResult).toBe("miss");
    expect((await run(normalized)).resolution.cacheResult).toBe("hit");
    expect(dispatches).toBe(1);
    expect(mappings).toBe(2);
    expect(cache.inspectPrivacySafeValues()[0]).not.toHaveProperty("geometry");
    expect(cache.inspectPrivacySafeValues()[0]).not.toHaveProperty("validation");
  });

  it("misses on text, ordered image digests, roles, every version, and model configuration", async () => {
    const cache = new ExactSemanticCache();
    let dispatches = 0;
    const dispatch = async (parsed: SemanticGenerationRequestV1) => {
      dispatches += 1;
      return valueFor(parsed);
    };
    const base = request();
    const variants: SemanticGenerationRequestV1[] = [
      { ...base, normalizedBrief: "Build a different rigid holder." },
      { ...base, references: [...base.references].reverse() },
      {
        ...base,
        references: base.references.map((item, index) =>
          index === 0 ? { ...item, sha256: "c".repeat(64) } : item,
        )
      },
      {
        ...base,
        roleConstraints: [{ referenceId: "reference-one", roles: ["motif"] }]
      },
      { ...base, promptVersion: "m5-interpretation-prompt@1.0.1" },
      { ...base, intentSchemaVersion: "intent-graph-v1@1.0.1" },
      {
        ...base,
        capabilityCatalogVersion: "sketchycut-semantic-capabilities@1.0.1"
      },
      {
        ...base,
        modelConfiguration: { ...base.modelConfiguration, reasoningEffort: "medium" }
      },
      {
        ...base,
        modelConfiguration: { ...base.modelConfiguration, modelId: "different-model" }
      },
      {
        ...base,
        modelConfiguration: { ...base.modelConfiguration, maxOutputTokens: 3_999 }
      },
      {
        ...base,
        modelConfiguration: { ...base.modelConfiguration, serviceTier: "priority" }
      }
    ];
    await cache.resolve(base, dispatch);
    for (const variant of variants) {
      expect((await cache.resolve(variant, dispatch)).cacheResult).toBe("miss");
    }
    expect(dispatches).toBe(variants.length + 1);
    expect(base.promptVersion).toBe(M5_PROMPT_VERSION);
    expect(base.intentSchemaVersion).toBe(M5_INTENT_SCHEMA_VERSION);
    expect(base.capabilityCatalogVersion).toBe(M5_CAPABILITY_CATALOG_ID);
  });

  it("singleflights an exact digest, rejects invalid values, and loses state on restart", async () => {
    const cache = new ExactSemanticCache();
    const base = request();
    let release: (() => void) | undefined;
    let dispatches = 0;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const dispatch = async (parsed: SemanticGenerationRequestV1) => {
      dispatches += 1;
      await waiting;
      return valueFor(parsed);
    };
    const first = cache.resolve(base, dispatch);
    const second = cache.resolve(base, dispatch);
    release?.();
    const results = await Promise.all([first, second]);
    expect(results.map((item) => item.cacheResult).sort()).toEqual(["miss", "singleflight-hit"]);
    expect(dispatches).toBe(1);

    const invalidCache = new ExactSemanticCache();
    await expect(invalidCache.resolve(base, async () => ({
      ...(await valueFor(base)),
      rawProviderResponse: "must never be cached"
    }))).rejects.toThrow();
    expect(invalidCache.size).toBe(0);

    const restarted = new ExactSemanticCache();
    expect((await restarted.resolve(base, async (parsed) => valueFor(parsed))).cacheResult).toBe("miss");
  });
});
