import { describe, expect, it } from "vitest";

import { GenerationSubmissionV1Schema } from "../../src/interpretation/generation-protocol.js";
import { IntentGraphV1Schema } from "../../src/interpretation/intent-graph.js";
import {
  buildFixtureIntent,
  FIXTURE_SCENARIOS
} from "../../src/interpretation/fixture-corpus.js";
import type {
  SemanticInterpretationTransport,
  SemanticTransportOutcome
} from "../../src/interpretation/orchestrator.js";
import type { SemanticGenerationRequestV1 } from "../../src/interpretation/semantic-request.js";
import type { RuntimeConfig } from "../../src/server/generation/config.js";
import type { AuthenticatedRequest } from "../../src/server/generation/http-security.js";
import { executeGeneration } from "../../src/server/generation/generation-service.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import { renderSceneSvg } from "../../src/projections/mesh/render-svg.js";
import { DEFAULT_GENERATED_CONTROLS } from "../../src/interpretation/generated-project-contracts.js";
import { DEFAULT_GENERATED_FABRICATION_CONTROLS } from "../../src/ui/content/generated-setup.js";

const promptHash = "f".repeat(64);

function config(): RuntimeConfig {
  return {
    security: {
      accessCodeDigest: Buffer.alloc(32),
      signingSecret: Buffer.alloc(32),
      secureCookies: false
    },
    storeMode: "memory",
    upstash: null,
    generationEnabled: true,
    generationMode: "live",
    generationExperience: "live",
    liveTransport: null
  };
}

function submission(brief: string) {
  return GenerationSubmissionV1Schema.parse({
    schemaVersion: "1.0",
    brief,
    references: [{
      descriptor: {
        referenceId: "reference-arbitrary",
        sha256: "a".repeat(64),
        mediaType: "image/png",
        width: 16,
        height: 12
      },
      dataUrl: "data:image/png;base64,AA=="
    }],
    roleConstraints: [],
    deterministicControls: DEFAULT_GENERATED_CONTROLS,
    fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
    retry: null
  });
}

function supportedIntent(request: SemanticGenerationRequestV1): unknown {
  return buildFixtureIntent(request, {
    ...FIXTURE_SCENARIOS[0]!,
    brief: request.normalizedBrief
  });
}

function cutoutIntent(request: SemanticGenerationRequestV1): unknown {
  const base = IntentGraphV1Schema.parse(supportedIntent(request));
  return IntentGraphV1Schema.parse({
    ...base,
    title: "Exact animal-shaped cutout template",
    coreIntent: request.normalizedBrief,
    requirements: [
      ...base.requirements,
      {
        id: "required-reference-traced-cutout",
        priority: "must",
        kind: "specific-profile",
        statement: "The outer fabrication contour must exactly trace the animal silhouette in the reference.",
        evidence: [{
          evidenceId: "brief-required-cutout",
          source: "text",
          referenceId: null,
          statement: "The maker requires an exact reference-traced cutout template."
        }]
      }
    ]
  });
}

function decorativeCoverIntent(request: SemanticGenerationRequestV1): unknown {
  return IntentGraphV1Schema.parse({
    schemaVersion: "1.0",
    title: "Decorative retained cover",
    coreIntent: "Create a contained orthogonal assembly with one retained moving cover and a similar ornamental surface treatment.",
    requirements: [
      {
        id: "decorative-containment",
        priority: "must",
        kind: "containment",
        statement: "The assembly must provide contained storage.",
        evidence: [{
          evidenceId: "decorative-containment-text",
          source: "text",
          referenceId: null,
          statement: "The recorded brief requires contained storage."
        }]
      },
      {
        id: "decorative-rigid-support",
        priority: "must",
        kind: "rigid-assembly",
        statement: "The support must use a rigid orthogonal sheet assembly.",
        evidence: [{
          evidenceId: "decorative-support-reference",
          source: "reference",
          referenceId: "reference-arbitrary",
          statement: "The recorded reference indicates an orthogonal support."
        }]
      },
      {
        id: "decorative-cover-motion",
        priority: "must",
        kind: "revolute-motion",
        statement: "The cover must rotate about one retained axis.",
        evidence: [{
          evidenceId: "decorative-motion-reference",
          source: "reference",
          referenceId: "reference-arbitrary",
          statement: "The recorded reference indicates one moving cover."
        }]
      },
      {
        id: "decorative-cover-treatment",
        priority: "must",
        kind: "visual-treatment",
        statement: "The cover must receive a similar registered ornamental treatment.",
        evidence: [{
          evidenceId: "decorative-treatment-reference",
          source: "reference",
          referenceId: "reference-arbitrary",
          statement: "The recorded motif evidence indicates framed focal ornament."
        }]
      }
    ],
    references: [{
      referenceId: "reference-arbitrary",
      inferredRoles: ["structure", "motif"],
      structuralObservations: [{
        evidenceId: "decorative-structure-observation",
        source: "reference",
        referenceId: "reference-arbitrary",
        statement: "Planar orthogonal support and one rotating cover are visible."
      }],
      motifObservations: [{
        evidenceId: "decorative-motif-observation",
        source: "reference",
        referenceId: "reference-arbitrary",
        statement: "A dense framed focal ornament is visible."
      }],
      confidence: "high"
    }],
    topology: {
      bodies: [
        {
          id: "decorative-enclosure-body",
          role: "enclosure",
          quantity: 1,
          shapeClass: "shell",
          attachmentRole: "base",
          orientationRole: "vertical"
        },
        {
          id: "decorative-cover-body",
          role: "cover",
          quantity: 1,
          shapeClass: "planar",
          attachmentRole: "top",
          orientationRole: "horizontal"
        }
      ],
      interfaces: [{
        id: "decorative-cover-interface",
        between: ["decorative-enclosure-body", "decorative-cover-body"],
        behavior: "revolute",
        relativeOrientation: "unspecified",
        axisRole: "width",
        function: "Retain the cover while permitting one-axis opening."
      }]
    },
    motif: {
      vocabulary: ["ornamental frame", "central focal accent", "repeated accents"],
      composition: "focal",
      density: "dense",
      symmetry: "bilateral",
      primitiveFamilies: [
        "inset-score-frame",
        "filled-diamond-focal",
        "filled-dot-repeat",
        "corner-score-ticks"
      ],
      preferredOperations: ["engrave", "score"],
      preferredPartRoles: ["cover"]
    },
    conflicts: [],
    assumptions: [{
      id: "decorative-size-assumption",
      statement: `Use the disclosed deterministic working size for ${request.normalizedBrief.length > 0 ? "this request" : "the request"}.`,
      source: "preset"
    }],
    capabilityAssessment: { coreIntentRepresentable: true, unresolvedNeeds: [] }
  });
}

class RecordedTransport implements SemanticInterpretationTransport {
  dispatchCount = 0;

  constructor(private readonly intent: (request: SemanticGenerationRequestV1) => unknown) {}

  dispatch(input: {
    request: SemanticGenerationRequestV1;
    clientRequestId: string;
  }): Promise<SemanticTransportOutcome> {
    this.dispatchCount += 1;
    return Promise.resolve({
      kind: "completed",
      providerRequestId: `recorded-provider-${String(this.dispatchCount)}`,
      responseId: `recorded-response-${String(this.dispatchCount)}`,
      latencyMs: 7,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 0,
        reasoningTokens: 10,
        outputTokens: 80,
        totalTokens: 180
      },
      estimatedCostUsd: 0.00145,
      requestBudgetUpperBoundUsd: 0.25,
      priceSnapshotId: "recorded-test-price",
      intentCandidate: this.intent(input.request)
    });
  }
}

async function harness(brief: string, intent: (request: SemanticGenerationRequestV1) => unknown) {
  const store = new MemoryGenerationStore();
  const nowMs = Date.now();
  const session = {
    schemaVersion: "1.0" as const,
    sessionId: `recorded-${crypto.randomUUID()}`,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 60_000,
    generationDispatches: 0,
    reservedExposureMicrousd: 0,
    lastDispatchAtMs: null,
    lastProjectId: null
  };
  await store.createSession(session, 60);
  const authenticated: AuthenticatedRequest = {
    session,
    clientIdentifier: `recorded-client-${crypto.randomUUID()}`
  };
  const transport = new RecordedTransport(intent);
  const run = () => executeGeneration({
    config: config(),
    authenticated,
    submission: submission(brief),
    store,
    runtimeOrigin: "test-recorded",
    interpretationTransport: transport,
    promptHash
  });
  return { store, transport, run };
}

describe("recorded live-mode seam", () => {
  it("interprets an arbitrary non-corpus brief once and attributes dispatch, cache, quota, and persistence", async () => {
    const brief = "Build a compact glue-free organizer for three fountain pens and a small ink bottle.";
    expect(FIXTURE_SCENARIOS.some((scenario) => scenario.brief === brief)).toBe(false);
    const test = await harness(brief, supportedIntent);
    const first = await test.run();
    expect(first.outcome.kind).toBe("supported");
    expect(first.project).not.toBeNull();
    expect(first.outcome.attempt).toMatchObject({
      runtimeOrigin: "test-recorded",
      networkDispatchCount: 1,
      strictParse: "passed",
      cacheResult: "miss",
      deterministicCompile: "passed"
    });
    expect(test.transport.dispatchCount).toBe(1);
    expect(await test.store.readGlobalExposureState()).toMatchObject({
      reservedExposureMicrousd: 250_000
    });

    const second = await test.run();
    expect(second.outcome.kind).toBe("supported");
    expect(second.outcome.attempt).toMatchObject({
      runtimeOrigin: "test-recorded",
      outcome: "cache-hit",
      networkDispatchCount: 0,
      strictParse: "passed",
      deterministicCompile: "passed"
    });
    expect(test.transport.dispatchCount).toBe(1);
    expect(await test.store.readGlobalExposureState()).toMatchObject({
      reservedExposureMicrousd: 250_000
    });
    expect(await test.store.readLedgerAttempts()).toHaveLength(2);
  });

  it("withholds an exact traced-cutout request as concept-only with stable blocked evidence", async () => {
    const brief = "Make an exact fox-silhouette cutout template traced from this reference; the outline is mandatory.";
    const test = await harness(brief, cutoutIntent);
    const result = await test.run();
    expect(result.project).toBeNull();
    expect(result.outcome.kind).toBe("concept-only");
    if (result.outcome.kind !== "concept-only") throw new Error("Expected concept-only outcome.");
    expect(result.outcome.exportAllowed).toBe(false);
    expect(result.outcome.mapping.blockedRequirementIds).toContain("required-reference-traced-cutout");
    expect(result.outcome.mapping.findings).toContainEqual(expect.objectContaining({
      code: "MANDATORY_REQUIREMENT_UNSUPPORTED",
      relatedIds: ["required-reference-traced-cutout"]
    }));
    expect(result.outcome.mapping.unresolvedNeeds).toContain(
      "The outer fabrication contour must exactly trace the animal silhouette in the reference.",
    );
    expect(test.transport.dispatchCount).toBe(1);
    expect((await test.store.readSession(result.outcome.attempt!.submissionId))).toBeNull();
  });

  it("replays the live cover-plus-focal-motif shape through disclosed zero-call construction search", async () => {
    const brief = "Create contained storage with one moving cover and similar framed focal ornament.";
    const test = await harness(brief, decorativeCoverIntent);
    const first = await test.run();
    expect(first.outcome.kind).toBe("supported");
    expect(first.project).not.toBeNull();
    if (first.outcome.kind !== "supported") throw new Error("Expected supported result.");
    expect(first.outcome.attempt).toMatchObject({
      networkDispatchCount: 1,
      strictParse: "passed",
      deterministicCompile: "passed"
    });
    expect(first.outcome.compiled.motifReport?.targetPartIds).toEqual(["cover-panel"]);
    expect(first.outcome.compiled.motifRecipe?.primitiveFamilies).toEqual([
      "corner-score-ticks",
      "filled-diamond-focal",
      "inset-score-frame"
    ]);
    expect(first.outcome.compiled.document.constructionSelections?.at(-1)).toMatchObject({
      searchPolicyId: "procedural-motif-construction-search",
      searchPolicyVersion: "1.0.0",
      preferredCandidateId: "requested-primitives",
      selectedCandidateId: "focal-primary",
      changedConstruction: true,
      attempts: [
        {
          candidateId: "requested-primitives",
          status: "rejected",
          findingCodes: ["ENGRAVE_REGION_OVERLAP"]
        },
        { candidateId: "focal-primary", status: "selected", findingCodes: [] }
      ]
    });
    expect(first.outcome.compiled.document.parts
      .filter((part) => part.features.some((feature) =>
        feature.kind === "treatment" && feature.id.startsWith("reference-motif")))
      .map((part) => part.id)).toEqual(["cover-panel"]);
    const cover = first.outcome.compiled.document.parts.find((part) => part.id === "cover-panel")!;
    const featureIds = cover.features.filter((feature) => feature.kind === "treatment")
      .map((feature) => feature.id).sort();
    const sceneTreatments = first.outcome.compiled.bundle.scene.surfaceTreatments ?? [];
    expect(sceneTreatments.map((treatment) => treatment.sourceFeatureId).sort()).toEqual(featureIds);
    expect(new Set(sceneTreatments.map((treatment) => treatment.partId))).toEqual(
      new Set(["cover-panel"]),
    );
    expect(new Set(sceneTreatments.flatMap((treatment) =>
      treatment.verticesMm.map((vertex) => vertex.zMm)
    ))).toEqual(new Set([cover.thicknessUm / 1_000]));
    expect(new Set(sceneTreatments.map((treatment) => treatment.operation))).toEqual(
      new Set(["engrave", "score"]),
    );
    expect(renderSceneSvg(first.outcome.compiled.bundle.scene, "assembled")).toContain(
      `data-source-feature-id="${featureIds[0]!}"`,
    );
    expect(first.outcome.compiled.document.validation.status).toBe("pass");
    expect(first.outcome.compiled.document.provenance.simplificationDisclosures).toContainEqual(
      expect.stringContaining("omitted filled-dot-repeat"),
    );
    expect(first.outcome.compiled.document.provenance.simplificationDisclosures).toContainEqual(
      expect.stringContaining("no reference region was traced or vectorized"),
    );

    const repeated = await test.run();
    expect(repeated.outcome.kind).toBe("supported");
    if (repeated.outcome.kind !== "supported") throw new Error("Expected cache-hit support.");
    expect(repeated.outcome.attempt).toMatchObject({
      outcome: "cache-hit",
      networkDispatchCount: 0,
      deterministicCompile: "passed"
    });
    expect(repeated.outcome.compiled.geometryHash).toBe(first.outcome.compiled.geometryHash);
    expect(test.transport.dispatchCount).toBe(1);
  });
});
