import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { sha256 } from "../../src/domain/hash.js";
import { DispatchOnlySemanticCache } from "../../src/evaluation/dispatch-only-semantic-cache.js";
import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION
} from "../../src/interpretation/semantic-atom-registry.js";
import {
  CURRENT_PROMPT_LAYOUT_VERSION
} from "../../src/interpretation/semantic-input-contracts.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  SemanticInterpretationCandidateSchema,
  expandSemanticInterpretationCandidate,
  type SemanticInterpretationCandidate
} from "../../src/interpretation/semantic-model-contract.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
  GenerationSubmissionSchema
} from "../../src/interpretation/generation-submission.js";
import {
  enumerateRetainedScopeCandidates
} from "../../src/interpretation/retained-scope.js";
import {
  CURRENT_PROMPT_IDENTITY,
  prepareSemanticGenerationRequest
} from "../../src/interpretation/semantic-request.js";
import type {
  SemanticTransportOutcome
} from "../../src/interpretation/semantic-transport.js";
import type { RuntimeConfig } from "../../src/server/generation/config.js";
import {
  executeCurrentGeneration
} from "../../src/server/generation/generation-service.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import {
  buildFabricationPackage
} from "../../src/server/generation/package-builder.js";
import {
  readCurrentPersistedProject
} from "../../src/server/generation/project-persistence.js";
import {
  DEFAULT_GENERATED_FABRICATION_CONTROLS
} from "../../src/ui/content/generated-setup.js";

const SemanticFixtureSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-retained-scope-anti-overfit@1.0.0",
  ),
  caseId: z.string().min(1),
  mechanism: z.enum([
    "deep-reverse-dependency-closure",
    "shared-record-multiple-retained-owners",
    "stable-identity-tie-break"
  ]),
  items: z.array(z.object({
    semanticKey: z.string().min(1),
    kind: z.enum(["anchor", "proportion", "unsupported"]),
    importance: z.enum(["essential", "preference"]),
    dependsOn: z.array(z.string().min(1))
  }).strict()).min(2),
  expected: z.record(z.string(), z.unknown())
}).strict();

const BoundaryFixtureSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-retained-scope-anti-overfit@1.0.0",
  ),
  caseId: z.literal("retained-scope-finite-domain-boundary"),
  mechanism: z.literal("finite-domain-completeness-and-fail-closed"),
  withinBound: z.object({
    eligibleBranchCount: z.literal(4),
    maximumOmissionDepth: z.literal(3),
    expectedRootCombinationCount: z.literal(14)
  }).strict(),
  aboveBound: z.object({
    eligibleBranchCount: z.literal(5),
    expectedDisposition: z.literal("fail-closed-concept-only")
  }).strict()
}).strict();

const UncertaintyBoundaryFixtureSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-retained-scope-anti-overfit@1.0.0",
  ),
  caseId: z.literal("retained-scope-whole-branch-uncertainty-boundary"),
  mechanism: z.literal("whole-branch-evidence-insufficient-boundary"),
  cases: z.array(z.object({
    semanticKey: z.string().min(1),
    state: z.literal("uncertain"),
    reason: z.enum([
      "EVIDENCE_INSUFFICIENT",
      "EVIDENCE_CONFLICT",
      "PROJECTION_COVERAGE_MISMATCH"
    ]),
    ownership: z.enum([
      "independent-noncore",
      "usable-access",
      "exact-measurement",
      "anchor"
    ]),
    dependsOn: z.array(z.string().min(1)),
    protectedDependentSemanticKey: z.string().min(1).optional(),
    expectedDisposition: z.enum([
      "eligible-whole-branch-omission",
      "protected",
      "protected-by-reverse-closure"
    ])
  }).strict()).length(7),
  metamorphicRequirements: z.array(z.enum([
    "stable-under-item-reordering",
    "stable-under-claim-renaming",
    "stable-with-unrelated-context"
  ])).length(3)
}).strict();

type SemanticFixture = z.infer<typeof SemanticFixtureSchema>;
type UncertaintyBoundaryFixture = z.infer<
  typeof UncertaintyBoundaryFixtureSchema
>;
type CandidateItem = SemanticInterpretationCandidate["items"][number];

const MODEL_CONFIGURATION = {
  modelId: "gpt-5.6-sol",
  reasoningEffort: "medium" as const,
  imageDetailPolicy: "high" as const,
  promptLayoutVersion: CURRENT_PROMPT_LAYOUT_VERSION,
  maxOutputTokens: 6_000,
  serviceTier: "default" as const,
  store: false as const
};

const LIVE_CONFIG: RuntimeConfig = {
  security: {
    accessCodeDigest: Buffer.alloc(32),
    signingSecret: Buffer.alloc(32),
    secureCookies: false
  },
  storeMode: "memory",
  upstash: null,
  generationEnabled: true,
  quotaUnlimited: true,
  generationMode: "live",
  generationExperience: "live",
  liveTransport: {
    apiKey: "offline-not-used",
    interpretationPrompt: "offline-not-used"
  }
};

async function fixture(name: string): Promise<SemanticFixture> {
  const bytes = await readFile(new URL(
    `../fixtures/anti-overfit/retained-scope/${name}.json`,
    import.meta.url,
  ));
  return SemanticFixtureSchema.parse(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
}

async function boundaryFixture() {
  const bytes = await readFile(new URL(
    "../fixtures/anti-overfit/retained-scope/finite-domain-boundary.json",
    import.meta.url,
  ));
  return BoundaryFixtureSchema.parse(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
}

async function uncertaintyBoundaryFixture() {
  const bytes = await readFile(new URL(
    "../fixtures/anti-overfit/retained-scope/uncertainty-boundary.json",
    import.meta.url,
  ));
  return UncertaintyBoundaryFixtureSchema.parse(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
}

function completed(
  candidate: SemanticInterpretationCandidate,
): SemanticTransportOutcome {
  return {
    kind: "completed",
    providerRequestId: "offline-retained-scope-provider-request",
    providerModelId: MODEL_CONFIGURATION.modelId,
    responseId: "offline-retained-scope-response",
    finishState: "completed",
    interpretationCandidate: candidate,
    usage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    },
    latencyMs: 0,
    estimatedCostUsd: 0,
    requestBudgetUpperBoundUsd: 0.65,
    priceSnapshotId: "offline-no-charge"
  };
}

function candidateForFixture(
  input: SemanticFixture,
  evidenceId: string,
): SemanticInterpretationCandidate {
  const ordinalByKey = new Map(
    input.items.map((item, index) => [item.semanticKey, index + 1]),
  );
  const items: CandidateItem[] = input.items.map((item) => {
    const relationships = item.dependsOn.map((semanticKey) => ({
      kind: "depends-on" as const,
      targetItemOrdinal: ordinalByKey.get(semanticKey)!
    }));
    if (item.kind === "anchor") {
      return {
        claim: `Typed anchor ${item.semanticKey}.`,
        importance: item.importance,
        evidenceBindings: [{
          evidenceId,
          aspect: "structure",
          support: "direct"
        }],
        relationships,
        measurements: [],
        state: "bound",
        atoms: [{
          kind: "primary-enclosure",
          enclosure: {
            quantity: null,
            priority: "must",
            evidenceIds: [evidenceId]
          },
          access: {
            kind: "open-top",
            priority: "must",
            evidenceIds: [evidenceId]
          },
          space: {
            layout: "unspecified",
            priority: "must",
            evidenceIds: [evidenceId]
          }
        }]
      };
    }
    if (item.kind === "proportion") {
      return {
        claim: `Typed proportion ${item.semanticKey}.`,
        importance: item.importance,
        evidenceBindings: [{
          evidenceId,
          aspect: "structure",
          support: "direct"
        }],
        relationships,
        measurements: [],
        state: "bound",
        atoms: [{
          kind: "qualitative-proportion",
          targetBodyRole: "primary-enclosure",
          numeratorAxis: "width",
          denominatorAxis: "height",
          strength: "moderate",
          priority: "prefer",
          confidence: "medium"
        }]
      };
    }
    return {
      claim: `Typed unsupported branch ${item.semanticKey}.`,
      importance: item.importance,
      evidenceBindings: [{
        evidenceId,
        aspect: "surface",
        support: "direct"
      }],
      relationships,
      measurements: [],
      state: "unbound",
      reason: "CAPABILITY_NOT_REGISTERED",
      unsupportedSignatureIds: []
    };
  });
  return SemanticInterpretationCandidateSchema.parse({
    schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    items
  });
}

function boundaryCandidate(
  eligibleBranchCount: number,
  evidenceId: string,
): SemanticInterpretationCandidate {
  return SemanticInterpretationCandidateSchema.parse({
    schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    items: [{
      claim: "Typed non-omittable primary anchor.",
      importance: "essential",
      evidenceBindings: [{
        evidenceId,
        aspect: "structure",
        support: "direct"
      }],
      relationships: [],
      measurements: [],
      state: "bound",
      atoms: [{
        kind: "primary-enclosure",
        enclosure: {
          quantity: null,
          priority: "must",
          evidenceIds: [evidenceId]
        },
        access: {
          kind: "open-top",
          priority: "must",
          evidenceIds: [evidenceId]
        },
        space: {
          layout: "unspecified",
          priority: "must",
          evidenceIds: [evidenceId]
        }
      }]
    }, ...Array.from({ length: eligibleBranchCount }, (_, index) => ({
      claim: `Typed independent unsupported branch ${String(index + 1)}.`,
      importance: "preference" as const,
      evidenceBindings: [{
        evidenceId,
        aspect: "surface" as const,
        support: "direct" as const
      }],
      relationships: [],
      measurements: [],
      state: "unbound" as const,
      reason: "CAPABILITY_NOT_REGISTERED" as const,
      unsupportedSignatureIds: []
    }))]
  });
}

function uncertaintyBoundaryCandidate(input: {
  selected: UncertaintyBoundaryFixture["cases"][number];
  evidenceId: string;
  brief: string;
}): SemanticInterpretationCandidate {
  const unresolvedRelationships = input.selected.ownership ===
      "independent-noncore"
    ? [{ kind: "depends-on" as const, targetItemOrdinal: 1 }]
    : [];
  const unresolved: CandidateItem = {
    claim: `Typed unresolved branch ${input.selected.semanticKey}.`,
    importance: "essential",
    evidenceBindings: [{
      evidenceId: input.evidenceId,
      aspect: input.selected.ownership === "independent-noncore"
        ? "surface"
        : "structure",
      support: "direct"
    }],
    relationships: unresolvedRelationships,
    measurements: input.selected.ownership === "exact-measurement"
      ? [{
          target: {
            subject: "project",
            envelope: "external",
            axis: "width"
          },
          interpretation: "ambiguous",
          literal: {
            evidenceId: input.evidenceId,
            start: input.brief.indexOf("80 mm"),
            end: input.brief.indexOf("80 mm") + "80 mm".length
          }
        }]
      : [],
    state: input.selected.state,
    reason: input.selected.reason,
    rationale: "The typed evidence intentionally leaves this branch unresolved.",
    unsupportedSignatureIds: []
  };
  const anchorDependsOnUnresolved = input.selected.ownership === "anchor";
  const items: CandidateItem[] = [{
    claim: "A typed retained primary enclosure remains the fabrication anchor.",
    importance: "essential",
    evidenceBindings: [{
      evidenceId: input.evidenceId,
      aspect: "structure",
      support: "direct"
    }],
    relationships: anchorDependsOnUnresolved
      ? [{ kind: "depends-on", targetItemOrdinal: 2 }]
      : [],
    measurements: [],
    state: "bound",
    atoms: [{
      kind: "primary-enclosure",
      enclosure: {
        quantity: null,
        priority: "must",
        evidenceIds: [input.evidenceId]
      },
      access: {
        kind: "open-top",
        priority: "must",
        evidenceIds: [input.evidenceId]
      },
      space: {
        layout: "unspecified",
        priority: "must",
        evidenceIds: [input.evidenceId]
      }
    }]
  }, unresolved];
  if (
    input.selected.ownership === "usable-access" ||
    input.selected.protectedDependentSemanticKey !== undefined
  ) {
    items.push({
      claim: "A required access aperture depends on the unresolved branch.",
      importance: "essential",
      evidenceBindings: [{
        evidenceId: input.evidenceId,
        aspect: "structure",
        support: "direct"
      }],
      relationships: [{
        kind: "depends-on",
        targetItemOrdinal: 2
      }],
      measurements: [],
      state: "bound",
      atoms: [{
        kind: "structural-aperture",
        targetBodyRole: "primary-enclosure",
        targetFaceRoles: ["cover"],
        patternFamily: "ring-aperture",
        purpose: "access",
        density: "sparse",
        symmetry: "radial",
        repetition: "single-face",
        priority: "must"
      }]
    });
  }
  return SemanticInterpretationCandidateSchema.parse({
    schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    items
  });
}

async function preparedInput(caseId: string, briefOverride?: string) {
  const brief = briefOverride ??
    `Independent abstract retained-scope proof ${caseId}.`;
  const promptHash = await sha256("retained-scope-anti-overfit");
  const submission = GenerationSubmissionSchema.parse({
    schemaVersion: "4.0",
    brief,
    references: [],
    roleConstraints: [],
    deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
    fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
    retry: null
  });
  const prepared = await prepareSemanticGenerationRequest({
    brief,
    references: [],
    roleConstraints: [],
    promptIdentity: CURRENT_PROMPT_IDENTITY,
    promptHash,
    modelConfiguration: MODEL_CONFIGURATION
  });
  return { submission, prepared, promptHash };
}

async function executeCandidate(
  caseId: string,
  candidate: SemanticInterpretationCandidate,
  briefOverride?: string,
) {
  const { submission, prepared, promptHash } = await preparedInput(
    caseId,
    briefOverride,
  );
  const store = new MemoryGenerationStore();
  const session = {
    schemaVersion: "1.0" as const,
    sessionId: `retained-scope-${caseId}`,
    issuedAtMs: 1,
    expiresAtMs: 20_000,
    generationDispatches: 0,
    reservedExposureMicrousd: 0,
    lastDispatchAtMs: null,
    lastProjectId: null
  };
  await store.createSession(session, 60);
  const response = await executeCurrentGeneration({
    config: LIVE_CONFIG,
    authenticated: {
      session,
      clientIdentifier: `retained-scope-client-${caseId}`
    },
    submission,
    store,
    runtimeOrigin: "test-recorded",
    interpretationTransport: {
      dispatch: () => Promise.resolve(completed(candidate))
    },
    semanticCache: new DispatchOnlySemanticCache(),
    initiatedBy: "live-eval",
    promptHash,
    evaluationModelConfiguration: MODEL_CONFIGURATION
  });
  if (response.project !== null) {
    const project = await readCurrentPersistedProject({
      store,
      ownerSessionId: session.sessionId,
      projectId: response.project.projectId
    });
    const packageResult = await buildFabricationPackage(project);
    expect(packageResult.manifest.requestCoverage.result).toBe(
      response.outcome.kind,
    );
    expect(packageResult.manifest.sourceDocumentHash).toBe(
      response.outcome.kind === "supported" ||
        response.outcome.kind === "simplified" ||
        response.outcome.kind === "modified"
        ? response.outcome.source.lastVerifiedHashes.documentHash
        : "",
    );
  }
  return { response, prepared };
}

function omittedDecisions(
  result: ReturnType<typeof enumerateRetainedScopeCandidates>,
): string[][] {
  return result.kind === "complete"
    ? result.candidates.map((candidate) =>
        candidate.decision.omittedInventoryItemIds
      )
    : [];
}

describe("frozen retained-scope anti-overfit proofs", () => {
  beforeAll(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network disabled"),
    );
  });

  afterAll(() => {
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("closes dependencies deeper than one edge and reaches the only coherent package", async () => {
    const selected = await fixture("deep-reverse-closure");
    const input = await preparedInput(selected.caseId);
    const evidenceId =
      input.prepared.request.sourceEvidenceIndex.spans[0]!.evidenceId;
    const candidate = candidateForFixture(selected, evidenceId);
    const interpretation = expandSemanticInterpretationCandidate(
      candidate,
      input.prepared.request.sourceEvidenceIndex,
    );
    const enumeration = enumerateRetainedScopeCandidates({ interpretation });
    expect(enumeration.kind).toBe("complete");
    if (enumeration.kind !== "complete") return;
    expect(enumeration.candidates.find((item) =>
      item.decision.omittedInventoryItemIds.includes("inventory-item-2")
    )?.decision.omittedInventoryItemIds).toEqual([
      "inventory-item-2",
      "inventory-item-3",
      "inventory-item-4"
    ]);
    const { response } = await executeCandidate(selected.caseId, candidate);
    expect(response.outcome.kind).toBe("simplified");
    expect(response.outcome.exportAllowed).toBe(true);
    if (response.outcome.kind !== "simplified") return;
    expect(response.outcome.source.requestCoverage.changedSemanticIds).toEqual([
      "inventory-item-2",
      "inventory-item-3",
      "inventory-item-4"
    ]);
  });

  it("retains a shared record when one of multiple semantic owners is omitted", async () => {
    const selected = await fixture("shared-record-retention");
    const input = await preparedInput(selected.caseId);
    const evidenceId =
      input.prepared.request.sourceEvidenceIndex.spans[0]!.evidenceId;
    const candidate = candidateForFixture(selected, evidenceId);
    const interpretation = expandSemanticInterpretationCandidate(
      candidate,
      input.prepared.request.sourceEvidenceIndex,
    );
    expect(
      interpretation.projection.constructionBodies[0]!.inventoryItemIds,
    ).toEqual(["inventory-item-1", "inventory-item-2"]);
    const enumeration = enumerateRetainedScopeCandidates({ interpretation });
    expect(enumeration.kind).toBe("complete");
    if (enumeration.kind !== "complete") return;
    const omittedProportion = enumeration.candidates.find((item) =>
      item.decision.omittedInventoryItemIds.length === 1 &&
      item.decision.omittedInventoryItemIds[0] === "inventory-item-2"
    )!;
    expect(
      omittedProportion.planningProjection.constructionBodies[0]!
        .inventoryItemIds,
    ).toEqual(["inventory-item-1"]);
    const { response } = await executeCandidate(selected.caseId, candidate);
    expect(response.outcome.kind).toBe("simplified");
    expect(response.outcome.exportAllowed).toBe(true);
  });

  it("uses stable identity only after substantive ties and is metamorphically stable", async () => {
    const selected = await fixture("stable-substantive-tie");
    const input = await preparedInput(selected.caseId);
    const evidenceId =
      input.prepared.request.sourceEvidenceIndex.spans[0]!.evidenceId;
    const candidate = candidateForFixture(selected, evidenceId);
    const interpretation = expandSemanticInterpretationCandidate(
      candidate,
      input.prepared.request.sourceEvidenceIndex,
    );
    const baseline = enumerateRetainedScopeCandidates({ interpretation });
    expect(baseline.kind).toBe("complete");
    if (baseline.kind !== "complete") return;
    expect(baseline.candidates.slice(0, 2).map((item) =>
      item.decision.omittedInventoryItemIds
    )).toEqual([
      ["inventory-item-2"],
      ["inventory-item-3"]
    ]);

    const reordered = structuredClone(interpretation);
    reordered.inventory.items.reverse();
    reordered.inventory.relationships.reverse();
    const reorderedResult = enumerateRetainedScopeCandidates({
      interpretation: reordered
    });
    expect(omittedDecisions(reorderedResult)).toEqual(
      omittedDecisions(baseline),
    );

    const renamed = structuredClone(interpretation);
    const rename = new Map([
      ["inventory-item-1", "semantic-anchor-1"],
      ["inventory-item-2", "semantic-branch-2"],
      ["inventory-item-3", "semantic-branch-3"]
    ]);
    for (const item of renamed.inventory.items) {
      item.id = rename.get(item.id) ?? item.id;
    }
    for (const relationship of renamed.inventory.relationships) {
      relationship.fromItemId =
        rename.get(relationship.fromItemId) ?? relationship.fromItemId;
      relationship.toItemId =
        rename.get(relationship.toItemId) ?? relationship.toItemId;
    }
    for (const record of renamed.projection.accounting) {
      record.itemId = rename.get(record.itemId) ?? record.itemId;
    }
    const inventoryOwned = [
      ...renamed.projection.requirements,
      ...renamed.projection.constructionBodies,
      ...renamed.projection.objects,
      ...renamed.projection.interfaces,
      ...renamed.projection.access,
      ...renamed.projection.organization,
      ...renamed.projection.scaleEvidence,
      ...renamed.projection.proportions,
      ...renamed.projection.clearance,
      ...renamed.projection.rankedGoals,
      ...renamed.projection.cutThrough
    ];
    for (const record of inventoryOwned) {
      record.inventoryItemIds = record.inventoryItemIds.map((id) =>
        rename.get(id) ?? id
      );
    }
    if (renamed.projection.motif !== null) {
      renamed.projection.motif.inventoryItemIds =
        renamed.projection.motif.inventoryItemIds.map((id) =>
          rename.get(id) ?? id
        );
    }
    const renamedResult = enumerateRetainedScopeCandidates({
      interpretation: renamed
    });
    expect(renamedResult.kind).toBe("complete");
    if (renamedResult.kind !== "complete") return;
    const inverse = new Map([...rename].map(([before, after]) =>
      [after, before]
    ));
    expect(renamedResult.candidates.map((item) =>
      item.decision.omittedInventoryItemIds.map((id) =>
        inverse.get(id) ?? id
      )
    )).toEqual(omittedDecisions(baseline));

    const withContext = SemanticInterpretationCandidateSchema.parse({
      ...candidate,
      items: [...candidate.items, {
        claim: "Irrelevant operating context remains outside retained scope.",
        evidenceBindings: [{
          evidenceId,
          aspect: "context",
          support: "direct"
        }],
        relationships: [],
        measurements: [],
        state: "context"
      }]
    });
    const contextInterpretation = expandSemanticInterpretationCandidate(
      withContext,
      input.prepared.request.sourceEvidenceIndex,
    );
    expect(omittedDecisions(enumerateRetainedScopeCandidates({
      interpretation: contextInterpretation
    }))).toEqual(omittedDecisions(baseline));

    const { response } = await executeCandidate(selected.caseId, candidate);
    expect(response.outcome.kind).toBe("simplified");
    expect(response.outcome.exportAllowed).toBe(true);
  });

  it("enumerates the complete boundary and fails closed above it", async () => {
    const selected = await boundaryFixture();
    const input = await preparedInput(selected.caseId);
    const evidenceId =
      input.prepared.request.sourceEvidenceIndex.spans[0]!.evidenceId;
    const withinCandidate = boundaryCandidate(
      selected.withinBound.eligibleBranchCount,
      evidenceId,
    );
    const withinInterpretation = expandSemanticInterpretationCandidate(
      withinCandidate,
      input.prepared.request.sourceEvidenceIndex,
    );
    const within = enumerateRetainedScopeCandidates({
      interpretation: withinInterpretation
    });
    expect(within).toMatchObject({
      kind: "complete",
      rootCombinationCount:
        selected.withinBound.expectedRootCombinationCount
    });
    if (within.kind === "complete") {
      expect(within.candidates).toHaveLength(14);
    }
    const withinRunId = `${selected.caseId}-within`;
    const withinRunInput = await preparedInput(withinRunId);
    const withinRunCandidate = boundaryCandidate(
      selected.withinBound.eligibleBranchCount,
      withinRunInput.prepared.request.sourceEvidenceIndex.spans[0]!.evidenceId,
    );
    const withinRun = await executeCandidate(withinRunId, withinRunCandidate);
    expect(withinRun.response.outcome.kind).toBe("concept-only");
    expect(withinRun.response.outcome.exportAllowed).toBe(false);
    if (withinRun.response.outcome.kind === "concept-only") {
      expect(withinRun.response.outcome.findingCodes).toContain(
        "RETAINED_SCOPE_NO_COHERENT_CANDIDATE",
      );
    }

    const aboveCandidate = boundaryCandidate(
      selected.aboveBound.eligibleBranchCount,
      evidenceId,
    );
    const aboveInterpretation = expandSemanticInterpretationCandidate(
      aboveCandidate,
      input.prepared.request.sourceEvidenceIndex,
    );
    expect(enumerateRetainedScopeCandidates({
      interpretation: aboveInterpretation
    })).toMatchObject({
      kind: "fail-closed",
      code: "RETAINED_SCOPE_ELIGIBLE_DOMAIN_EXCEEDED",
      maximumEligibleItemCount: 4,
      maximumRootCombinationCount: 14
    });
    const aboveRunId = `${selected.caseId}-above`;
    const aboveRunInput = await preparedInput(aboveRunId);
    const aboveRunCandidate = boundaryCandidate(
      selected.aboveBound.eligibleBranchCount,
      aboveRunInput.prepared.request.sourceEvidenceIndex.spans[0]!.evidenceId,
    );
    const aboveRun = await executeCandidate(aboveRunId, aboveRunCandidate);
    expect(aboveRun.response.outcome.kind).toBe("concept-only");
    expect(aboveRun.response.outcome.exportAllowed).toBe(false);
    if (aboveRun.response.outcome.kind === "concept-only") {
      expect(aboveRun.response.outcome.findingCodes).toContain(
        "RETAINED_SCOPE_DOMAIN_EXCEEDED",
      );
    }
  });

  it("omits only a whole directly evidenced insufficient branch and protects every core boundary", async () => {
    const selected = await uncertaintyBoundaryFixture();
    const brief =
      "Abstract unresolved retained-scope proof with the literal 80 mm evidence span.";
    const base = await preparedInput(`${selected.caseId}-base`, brief);
    const evidenceId =
      base.prepared.request.sourceEvidenceIndex.spans[0]!.evidenceId;
    for (const [index, proof] of selected.cases.entries()) {
      const candidate = uncertaintyBoundaryCandidate({
        selected: proof,
        evidenceId,
        brief
      });
      const interpretation = expandSemanticInterpretationCandidate(
        candidate,
        base.prepared.request.sourceEvidenceIndex,
      );
      const enumeration = enumerateRetainedScopeCandidates({
        interpretation
      });
      expect(enumeration.kind).toBe("complete");
      if (enumeration.kind !== "complete") continue;
      const targetId = "inventory-item-2";
      const targetEligible = enumeration.eligibleItemIds.includes(targetId);
      const targetOmittable = enumeration.candidates.some((item) =>
        item.decision.omittedInventoryItemIds.includes(targetId)
      );
      if (
        proof.expectedDisposition ===
          "eligible-whole-branch-omission"
      ) {
        expect(targetEligible, proof.semanticKey).toBe(true);
        expect(targetOmittable, proof.semanticKey).toBe(true);
      } else {
        expect(targetOmittable, proof.semanticKey).toBe(false);
      }
      const runId = `${selected.caseId}-${String(index + 1)}`;
      const runInput = await preparedInput(runId, brief);
      const runBrief = runInput.submission.brief;
      const runCandidate = uncertaintyBoundaryCandidate({
        selected: proof,
        evidenceId:
          runInput.prepared.request.sourceEvidenceIndex.spans[0]!.evidenceId,
        brief: runBrief
      });
      const run = await executeCandidate(runId, runCandidate, brief);
      if (
        proof.expectedDisposition ===
          "eligible-whole-branch-omission"
      ) {
        expect(run.response.outcome.kind).toBe("modified");
        expect(run.response.outcome.exportAllowed).toBe(true);
      } else {
        expect(run.response.outcome.kind).toBe("concept-only");
        expect(run.response.outcome.exportAllowed).toBe(false);
      }
    }

    const independent = selected.cases[0]!;
    const candidate = uncertaintyBoundaryCandidate({
      selected: independent,
      evidenceId,
      brief
    });
    const interpretation = expandSemanticInterpretationCandidate(
      candidate,
      base.prepared.request.sourceEvidenceIndex,
    );
    const baseline = enumerateRetainedScopeCandidates({ interpretation });
    const reordered = structuredClone(interpretation);
    reordered.inventory.items.reverse();
    reordered.inventory.relationships.reverse();
    expect(omittedDecisions(enumerateRetainedScopeCandidates({
      interpretation: reordered
    }))).toEqual(omittedDecisions(baseline));
    const renamed = structuredClone(interpretation);
    renamed.inventory.items[1]!.claim =
      "A lexically unrelated unresolved noncore branch.";
    expect(omittedDecisions(enumerateRetainedScopeCandidates({
      interpretation: renamed
    }))).toEqual(omittedDecisions(baseline));
    const withContext = SemanticInterpretationCandidateSchema.parse({
      ...candidate,
      items: [...candidate.items, {
        claim: "Unrelated operating context remains non-authoritative.",
        evidenceBindings: [{
          evidenceId,
          aspect: "context",
          support: "direct"
        }],
        relationships: [],
        measurements: [],
        state: "context"
      }]
    });
    expect(omittedDecisions(enumerateRetainedScopeCandidates({
      interpretation: expandSemanticInterpretationCandidate(
        withContext,
        base.prepared.request.sourceEvidenceIndex,
      )
    }))).toEqual(omittedDecisions(baseline));
  });
});
