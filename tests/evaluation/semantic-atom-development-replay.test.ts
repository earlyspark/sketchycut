import { describe, expect, it, vi } from "vitest";

import { sha256 } from "../../src/domain/hash.js";
import { SEMANTIC_GENERALIZATION_CORPUS } from "../../src/evaluation/semantic-generalization.js";
import { scoreSemanticCaseOracle } from "../../src/evaluation/semantic-generalization-oracle.js";
import { DispatchOnlySemanticCache } from "../../src/evaluation/dispatch-only-semantic-cache.js";
import {
  summarizeSemanticEvaluationDiagnostics
} from "../../src/evaluation/semantic-live-evaluator.js";
import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
  SemanticAtomSchema,
  type SemanticAtom
} from "../../src/interpretation/semantic-atom-registry.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  SemanticInterpretationCandidateSchema,
  type SemanticInterpretationCandidate
} from "../../src/interpretation/semantic-model-contract.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
  GenerationSubmissionSchema,
  type GenerationSubmission
} from "../../src/interpretation/generation-submission.js";
import {
  CURRENT_PROMPT_IDENTITY,
  prepareSemanticGenerationRequest,
  type SemanticGenerationRequest
} from "../../src/interpretation/semantic-request.js";
import {
  CURRENT_PROMPT_LAYOUT_VERSION
} from "../../src/interpretation/semantic-input-contracts.js";
import type { SemanticTransportOutcome } from "../../src/interpretation/semantic-transport.js";
import type { RuntimeConfig } from "../../src/server/generation/config.js";
import { executeCurrentGeneration } from "../../src/server/generation/generation-service.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import { DEFAULT_GENERATED_FABRICATION_CONTROLS } from "../../src/ui/content/generated-setup.js";

type DevelopmentCase = (typeof SEMANTIC_GENERALIZATION_CORPUS.cases)[number];
type CandidateItem = SemanticInterpretationCandidate["items"][number];

const DEVELOPMENT_CASES = SEMANTIC_GENERALIZATION_CORPUS.cases;
const ORGANIZATION_PREDICATE_CODES: Partial<Record<DevelopmentCase["id"], string>> = {
  "paraphrase-open-access-dev": "COMMITMENT_MINIMUM_SEPARATED_ORGANIZATION",
  "functional-name-separation-dev": "COMMITMENT_MINIMUM_SEPARATED_ORGANIZATION",
  "bare-storage-name-nonorganization-dev": "COMMITMENT_DEFAULT_SINGLE_SPACE",
  "implicit-open-separation-organization-dev": "COMMITMENT_MINIMUM_SEPARATED_ORGANIZATION",
  "implicit-covered-case-organization-dev": "COMMITMENT_MINIMUM_SEPARATED_ORGANIZATION",
  "organization-count-composite-control-dev": "COMMITMENT_FOUR_SPACES_EXPLICIT_COUNT",
  "organization-grid-composite-control-dev": "COMMITMENT_TWO_BY_THREE_EXPLICIT_GRID"
};

function boundItem(input: {
  claim: string;
  evidenceId: string;
  atoms: SemanticAtom[];
  importance?: "essential" | "preference";
  aspects?: ("structure" | "surface")[];
  relationships?: CandidateItem["relationships"];
}): CandidateItem {
  const aspects = input.aspects ?? ["structure"];
  return {
    claim: input.claim,
    importance: input.importance ?? "essential",
    evidenceBindings: aspects.map((aspect) => ({ evidenceId: input.evidenceId, aspect, support: "direct" as const })),
    relationships: input.relationships ?? [],
    measurements: [],
    state: "bound",
    atoms: input.atoms
  };
}

function unboundItem(input: {
  claim: string;
  evidenceId: string;
  unsupportedSignatureIds?: (
    "kerf-flexure-corner-construction"
  )[];
  relationships?: CandidateItem["relationships"];
}): CandidateItem {
  return {
    claim: input.claim,
    importance: "essential",
    evidenceBindings: [{
      evidenceId: input.evidenceId,
      aspect: "structure",
      support: "direct"
    }],
    relationships: input.relationships ?? [],
    measurements: [],
    state: "unbound",
    reason: "CAPABILITY_NOT_REGISTERED",
    unsupportedSignatureIds: input.unsupportedSignatureIds ?? []
  };
}

function contextItem(input: { claim: string; evidenceId: string }): CandidateItem {
  return {
    claim: input.claim,
    evidenceBindings: [{ evidenceId: input.evidenceId, aspect: "context", support: "direct" }],
    relationships: [],
    measurements: [],
    state: "context"
  };
}

function deferredSurfaceItem(input: { claim: string; evidenceId: string }): CandidateItem {
  return {
    claim: input.claim,
    importance: "preference",
    evidenceBindings: [{ evidenceId: input.evidenceId, aspect: "surface", support: "direct" }],
    relationships: [],
    measurements: [],
    state: "deferred",
  };
}

type PrimaryEnclosureAtom = Extract<SemanticAtom, { kind: "primary-enclosure" }>;
type PrimaryEnclosureSpaceChoice = PrimaryEnclosureAtom["space"] extends infer Space
  ? Space extends unknown
    ? Omit<Space, "priority" | "evidenceIds">
    : never
  : never;

const primaryEnclosure = (
  evidenceId: string,
  access: PrimaryEnclosureAtom["access"]["kind"] = "open-top",
  space: PrimaryEnclosureSpaceChoice = { layout: "unspecified" },
): SemanticAtom => SemanticAtomSchema.parse({
  kind: "primary-enclosure",
  enclosure: { quantity: null, priority: "must", evidenceIds: [evidenceId] },
  access: { kind: access, priority: "must", evidenceIds: [evidenceId] },
  space: { ...space, priority: "must", evidenceIds: [evidenceId] }
});

const structuralReferenceAtoms = (evidenceId: string): SemanticAtom[] => [
  primaryEnclosure(evidenceId, "covered-top"),
  {
    kind: "qualitative-proportion", targetBodyRole: "primary-enclosure", numeratorAxis: "height",
    denominatorAxis: "width", strength: "strong", priority: "must", confidence: "medium"
  },
  {
    kind: "structural-aperture", targetBodyRole: "primary-enclosure", targetFaceRoles: ["cover"],
    patternFamily: "ring-aperture", purpose: "access", density: "sparse", symmetry: "radial",
    repetition: "single-face", priority: "must"
  }
];

function developmentReplayCandidate(input: {
  testCase: DevelopmentCase;
  request: SemanticGenerationRequest;
}): SemanticInterpretationCandidate {
  const briefEvidenceId = input.request.sourceEvidenceIndex.spans[0]!.evidenceId;
  const referenceEvidenceId = input.request.sourceEvidenceIndex.references[0]?.evidenceId;
  const items: CandidateItem[] = [];
  switch (input.testCase.id) {
    case "unfamiliar-purpose-structure-dev":
      items.push(
        boundItem({ claim: "Rigid containment remains accessible from the open top.", evidenceId: briefEvidenceId, atoms: [primaryEnclosure(briefEvidenceId, "open-top", { layout: "explicit-single-space" })] }),
        contextItem({ claim: "Qori names the seed drying purpose and packets.", evidenceId: briefEvidenceId })
      );
      break;
    case "familiar-noun-scale-dev":
      items.push(
        boundItem({ claim: "The keepsakes are contained behind covered access.", evidenceId: briefEvidenceId, atoms: [primaryEnclosure(briefEvidenceId, "covered-top")] }),
        contextItem({ claim: "The phone is only a scale cue.", evidenceId: briefEvidenceId })
      );
      break;
    case "paraphrase-open-access-dev":
      items.push(boundItem({
        claim: "Rigid organized containment is accessible from the open top.",
        evidenceId: briefEvidenceId, atoms: [primaryEnclosure(briefEvidenceId, "open-top", { layout: "minimum-separated" })]
      }));
      break;
    case "functional-name-separation-dev":
      items.push(boundItem({
        claim: "The rigid desktop sorter provides organized containment accessible from the open top.",
        evidenceId: briefEvidenceId,
        atoms: [primaryEnclosure(briefEvidenceId, "open-top", { layout: "minimum-separated" })]
      }));
      break;
    case "bare-storage-name-nonorganization-dev":
      items.push(boundItem({
        claim: "The rigid storage bin is accessible from the open top.",
        evidenceId: briefEvidenceId,
        atoms: [primaryEnclosure(briefEvidenceId, "open-top", { layout: "unspecified" })]
      }));
      break;
    case "implicit-open-separation-organization-dev":
      items.push(boundItem({
        claim: "The rigid open tray requires multiple distinct areas without an exact layout.",
        evidenceId: briefEvidenceId,
        atoms: [primaryEnclosure(briefEvidenceId, "open-top", { layout: "minimum-separated" })]
      }));
      break;
    case "implicit-covered-case-organization-dev":
      items.push(boundItem({
        claim: "The rigid covered case requires internal separation without an exact layout.",
        evidenceId: briefEvidenceId,
        atoms: [primaryEnclosure(briefEvidenceId, "covered-top", { layout: "minimum-separated" })]
      }));
      break;
    case "noun-swap-relationship-dev":
      items.push(boundItem({
        claim: "Rigid containment has covered access and three spaces.",
        evidenceId: briefEvidenceId, atoms: [primaryEnclosure(briefEvidenceId, "covered-top", { layout: "count", desiredSpaceCount: 3 })]
      }));
      break;
    case "relationship-swap-contained-dev":
      items.push(boundItem({ claim: "The object is fully enclosed.", evidenceId: briefEvidenceId, atoms: [primaryEnclosure(briefEvidenceId, "unspecified")] }));
      break;
    case "typo-colloquial-dev":
      items.push(boundItem({ claim: "Rigid containment remains accessible from the open top.", evidenceId: briefEvidenceId, atoms: [primaryEnclosure(briefEvidenceId, "open-top")] }));
      break;
    case "irrelevant-image-object-dev":
      if (referenceEvidenceId === undefined) throw new Error("DEVELOPMENT_REPLAY_REFERENCE_MISSING");
      items.push(
        boundItem({ claim: "The selected central container is rigid and open at the top.", evidenceId: referenceEvidenceId, atoms: [primaryEnclosure(referenceEvidenceId, "open-top")] }),
        contextItem({ claim: "The plant and printed label are background context.", evidenceId: briefEvidenceId })
      );
      break;
    case "reference-role-purpose-control-dev":
      if (referenceEvidenceId === undefined) throw new Error("DEVELOPMENT_REPLAY_REFERENCE_MISSING");
      items.push(
        boundItem({
          claim: "The selected structure is a proportioned rigid tray with open-top access.",
          evidenceId: referenceEvidenceId,
          atoms: [
            primaryEnclosure(referenceEvidenceId, "open-top"),
            {
              kind: "qualitative-proportion", targetBodyRole: "primary-enclosure",
              numeratorAxis: "width", denominatorAxis: "depth", strength: "moderate",
              priority: "must", confidence: "medium"
            }
          ]
        }),
        contextItem({ claim: "Display is purpose context only.", evidenceId: briefEvidenceId }),
        deferredSurfaceItem({
          claim: "Surface appearance is excluded by the maker-selected role.",
          evidenceId: referenceEvidenceId
        })
      );
      break;
    case "reference-role-purpose-control-a-dev":
    case "reference-role-exclusion-control-b-dev": {
      if (referenceEvidenceId === undefined) throw new Error("DEVELOPMENT_REPLAY_REFERENCE_MISSING");
      const contextClaim = input.testCase.id === "reference-role-purpose-control-a-dev"
        ? "Glowstone names the supported purpose only."
        : "Keepsake names the display purpose only.";
      items.push(
        boundItem({ claim: "The selected structure includes an enclosure, access aperture, proportion, and rigid joints.", evidenceId: referenceEvidenceId, atoms: structuralReferenceAtoms(referenceEvidenceId) }),
        contextItem({ claim: contextClaim, evidenceId: briefEvidenceId }),
        deferredSurfaceItem({ claim: "The decorative surface treatment is excluded by the maker-selected role.", evidenceId: referenceEvidenceId }),
        deferredSurfaceItem({ claim: "The decorative cut-through pattern is excluded by the maker-selected role.", evidenceId: referenceEvidenceId })
      );
      break;
    }
    case "reference-role-both-dev":
      if (referenceEvidenceId === undefined) throw new Error("DEVELOPMENT_REPLAY_REFERENCE_MISSING");
      items.push(
        boundItem({
          claim: "The selected reference contributes rigid open-top structure.",
          evidenceId: referenceEvidenceId,
          atoms: [primaryEnclosure(referenceEvidenceId, "open-top")]
        }),
        boundItem({
          claim: "The selected reference contributes a registered surface character.",
          evidenceId: referenceEvidenceId,
          aspects: ["surface"],
          atoms: [{
            kind: "registered-surface-treatment", composition: "border", density: "sparse", symmetry: "bilateral",
            primitiveFamilies: ["inset-score-frame", "corner-score-ticks"],
            preferredOperations: ["score"], preferredBodyRoles: ["primary-enclosure"]
          }]
        })
      );
      break;
    case "measurement-ordinary-dev": {
      const measuredItem = boundItem({ claim: "A generic rigid open construction preserves the exact project width.", evidenceId: briefEvidenceId, atoms: [primaryEnclosure(briefEvidenceId, "unspecified")] });
      const literal = "12.5 cm";
      const start = input.testCase.brief.indexOf(literal);
      measuredItem.measurements.push({
        target: { subject: "project", envelope: "external", axis: "width" },
        interpretation: "exact",
        literal: { evidenceId: briefEvidenceId, start, end: start + literal.length }
      });
      items.push(measuredItem);
      break;
    }
    case "measurement-ambiguous-dev": {
      const literal = "80 mm";
      const start = input.testCase.brief.indexOf(literal);
      items.push({
        claim: "The requested size relationship remains ambiguous.",
        importance: "essential",
        evidenceBindings: [{ evidenceId: briefEvidenceId, aspect: "structure", support: "direct" }],
        relationships: [],
        measurements: [{
          target: { subject: "project", envelope: "external", axis: "width" },
          interpretation: "ambiguous",
          literal: { evidenceId: briefEvidenceId, start, end: start + literal.length }
        }],
        state: "uncertain",
        reason: "EVIDENCE_INSUFFICIENT",
        rationale: "The brief supplies multiple non-equivalent measurements.",
        unsupportedSignatureIds: []
      });
      break;
    }
    case "supported-unfamiliar-style-dev":
      items.push(
        boundItem({ claim: "Rigid containment remains accessible from the open top.", evidenceId: briefEvidenceId, atoms: [primaryEnclosure(briefEvidenceId, "open-top")] }),
        {
          claim: "The moon-market visual mood is preferred.",
          importance: "preference",
          evidenceBindings: [{ evidenceId: briefEvidenceId, aspect: "surface", support: "direct" }],
          relationships: [],
          measurements: [],
          state: "unbound",
          reason: "CAPABILITY_NOT_REGISTERED",
          unsupportedSignatureIds: []
        }
      );
      break;
    case "review-correctable-coverage-dev":
      items.push(boundItem({ claim: "Rigid containment remains accessible from the open top.", evidenceId: briefEvidenceId, atoms: [primaryEnclosure(briefEvidenceId, "open-top")] }));
      break;
    case "covered-access-context-control-a-dev":
      items.push(
        boundItem({ claim: "Rigid containment is accessible behind a front cover.", evidenceId: briefEvidenceId, atoms: [primaryEnclosure(briefEvidenceId, "covered-front")] }),
        contextItem({ claim: "The ruler is only a scale cue.", evidenceId: briefEvidenceId })
      );
      break;
    case "covered-access-context-control-b-dev":
      items.push(
        boundItem({ claim: "Rigid containment is accessible behind a removable top cover.", evidenceId: briefEvidenceId, atoms: [primaryEnclosure(briefEvidenceId, "covered-top")] }),
        contextItem({ claim: "The mug is only a scale cue.", evidenceId: briefEvidenceId })
      );
      break;
    case "organization-count-composite-control-dev":
      items.push(
        boundItem({
          claim: "The covered rigid case has four separate wells.",
          evidenceId: briefEvidenceId,
          atoms: [primaryEnclosure(briefEvidenceId, "covered-top", { layout: "count", desiredSpaceCount: 4 })]
        }),
        contextItem({ claim: "The lab archive is only the finished case's destination.", evidenceId: briefEvidenceId })
      );
      break;
    case "organization-grid-composite-control-dev":
      items.push(
        boundItem({
          claim: "The rigid open tray has a two-row by three-column divider grid.",
          evidenceId: briefEvidenceId,
          atoms: [primaryEnclosure(briefEvidenceId, "open-top", { layout: "grid", rows: 2, columns: 3 })]
        }),
        contextItem({ claim: "Closet storage after play is only usage context.", evidenceId: briefEvidenceId })
      );
      break;
    case "storage-purpose-nonorganization-control-dev":
      items.push(
        boundItem({
          claim: "One undivided rigid bin remains open at the top.",
          evidenceId: briefEvidenceId,
          atoms: [primaryEnclosure(briefEvidenceId, "open-top", { layout: "explicit-single-space" })]
        }),
        contextItem({ claim: "Yarn storage names the bin's purpose only.", evidenceId: briefEvidenceId })
      );
      break;
    case "storage-context-nonorganization-control-dev":
      items.push(
        boundItem({
          claim: "One uninterrupted rigid folio case has covered access.",
          evidenceId: briefEvidenceId,
          atoms: [primaryEnclosure(briefEvidenceId, "covered-top", { layout: "explicit-single-space" })]
        }),
        contextItem({ claim: "The records room and archiving are destination context only.", evidenceId: briefEvidenceId })
      );
      break;
    case "substitution-lossy-flexure-positive-dev":
      items.push(
        boundItem({
          claim: "The construction is a fixed-top rigid primary enclosure.",
          evidenceId: briefEvidenceId,
          atoms: [primaryEnclosure(briefEvidenceId, "covered-top")]
        }),
        boundItem({
          claim: "The fixed top retains one circular access aperture.",
          evidenceId: briefEvidenceId,
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
        }),
        boundItem({
          claim: "Registered lattice openings occupy the eligible walls.",
          evidenceId: briefEvidenceId,
          aspects: ["surface"],
          atoms: [{
            kind: "structural-aperture",
            targetBodyRole: "primary-enclosure",
            targetFaceRoles: ["rear", "left", "right", "front"],
            patternFamily: "lattice-grid",
            purpose: "illumination-ventilation",
            density: "dense",
            symmetry: "translational",
            repetition: "matched-faces",
            priority: "must"
          }]
        }),
        unboundItem({
          claim: "The primary enclosure corners specifically use kerf-flexure construction.",
          evidenceId: briefEvidenceId,
          unsupportedSignatureIds: ["kerf-flexure-corner-construction"]
        })
      );
      break;
    case "substitution-partitioned-flexure-positive-dev":
      items.push(
        boundItem({
          claim: "The open rigid primary enclosure has two separate spaces.",
          evidenceId: briefEvidenceId,
          atoms: [
            primaryEnclosure(
              briefEvidenceId,
              "open-top",
              { layout: "count", desiredSpaceCount: 2 },
            )
          ]
        }),
        unboundItem({
          claim: "The primary enclosure corners specifically use kerf-flexure construction.",
          evidenceId: briefEvidenceId,
          unsupportedSignatureIds: ["kerf-flexure-corner-construction"]
        })
      );
      break;
    case "substitution-refusal-omission-dev":
      items.push(
        boundItem({
          claim: "The surviving project is one useful undivided open rigid primary enclosure.",
          evidenceId: briefEvidenceId,
          atoms: [
            primaryEnclosure(
              briefEvidenceId,
              "open-top",
              { layout: "explicit-single-space" },
            )
          ]
        }),
        unboundItem({
          claim: "The corners specifically use kerf-flexure construction.",
          evidenceId: briefEvidenceId,
          unsupportedSignatureIds: ["kerf-flexure-corner-construction"],
          relationships: [{ kind: "depends-on", targetItemOrdinal: 3 }]
        }),
        unboundItem({
          claim: "The flexure depends on a separate unsupported structural profile.",
          evidenceId: briefEvidenceId
        })
      );
      break;
    case "substitution-refusal-concept-only-dev":
      items.push(unboundItem({
        claim: "The only requested shell specifically requires kerf-flexure corner construction.",
        evidenceId: briefEvidenceId,
        unsupportedSignatureIds: ["kerf-flexure-corner-construction"]
      }));
      break;
    case "substitution-direct-support-wins-dev":
      items.push(boundItem({
        claim: "One undivided rigid orthogonal enclosure remains open at the top.",
        evidenceId: briefEvidenceId,
        atoms: [
          primaryEnclosure(
            briefEvidenceId,
            "open-top",
            { layout: "explicit-single-space" },
          )
        ]
      }));
      break;
    case "flexure-surface-negative-control-dev":
      items.push(
        boundItem({
          claim: "The enclosure is directly supported, rigid, orthogonal, and open at the top.",
          evidenceId: briefEvidenceId,
          atoms: [primaryEnclosure(briefEvidenceId, "open-top")]
        }),
        boundItem({
          claim: "Organic curved kerf-flexure-like language applies only to a registered score motif.",
          evidenceId: briefEvidenceId,
          aspects: ["surface"],
          atoms: [{
            kind: "registered-surface-treatment",
            composition: "field",
            density: "sparse",
            symmetry: "bilateral",
            primitiveFamilies: ["parallel-line-field"],
            preferredOperations: ["score"],
            preferredBodyRoles: ["primary-enclosure"]
          }]
        })
      );
      break;
    case "flexure-context-negative-control-dev":
      items.push(
        boundItem({
          claim: "The primary enclosure is directly supported, rigid, orthogonal, and open at the top.",
          evidenceId: briefEvidenceId,
          atoms: [primaryEnclosure(briefEvidenceId, "open-top")]
        }),
        contextItem({
          claim: "The exact phrase kerf-flexure corner construction labels only the payload.",
          evidenceId: briefEvidenceId
        })
      );
      break;
    default:
      throw new Error("DEVELOPMENT_ATOM_REPLAY_UNREGISTERED");
  }
  return SemanticInterpretationCandidateSchema.parse({
    schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    items
  });
}

async function submissionFor(testCase: DevelopmentCase): Promise<GenerationSubmission> {
  const referenceIds = "referenceIds" in testCase && Array.isArray(testCase.referenceIds)
    ? testCase.referenceIds
    : [];
  const references = await Promise.all(referenceIds.map(async (referenceId, index) => ({
    descriptor: {
      referenceId,
      sha256: await sha256(`offline-development-reference-${String(index)}-${referenceId}`),
      mediaType: "image/png" as const,
      width: 1,
      height: 1
    },
    dataUrl: "data:image/png;base64,AA=="
  })));
  const roles = "referenceRoles" in testCase && Array.isArray(testCase.referenceRoles)
    ? testCase.referenceRoles
    : [];
  return GenerationSubmissionSchema.parse({
    schemaVersion: "4.0",
    brief: testCase.brief,
    references,
    roleConstraints: references.map((reference, index) => {
      const selected = roles[index];
      if (!Array.isArray(selected) || selected.length === 0) {
        throw new Error(`DEVELOPMENT_REFERENCE_ROLE_REQUIRED:${reference.descriptor.referenceId}`);
      }
      return { referenceId: reference.descriptor.referenceId, roles: selected };
    }),
    deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
    fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
    retry: null
  });
}

function completed(candidate: SemanticInterpretationCandidate): SemanticTransportOutcome {
  return {
    kind: "completed",
    interpretationCandidate: candidate,
    providerRequestId: "offline-provider-request",
    providerModelId: "gpt-5.6-sol",
    responseId: "offline-response",
    finishState: "completed",
    latencyMs: 1,
    usage: { inputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningTokens: 0, outputTokens: 1, totalTokens: 2 },
    estimatedCostUsd: 0,
    requestBudgetUpperBoundUsd: 0.65,
    priceSnapshotId: "offline-no-charge"
  };
}

describe("development-only semantic-atom replays", () => {
  it("passes all 32 open development cases offline", async () => {
    expect(DEVELOPMENT_CASES).toHaveLength(32);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const modelConfiguration = {
      modelId: "gpt-5.6-sol",
      reasoningEffort: "medium" as const,
      imageDetailPolicy: "high" as const,
      promptLayoutVersion: CURRENT_PROMPT_LAYOUT_VERSION,
      maxOutputTokens: 6_000,
      serviceTier: "default" as const,
      store: false as const
    };
    const promptHash = await sha256("offline-semantic-atom-development-replay");
    const config: RuntimeConfig = {
      security: { accessCodeDigest: Buffer.alloc(32), signingSecret: Buffer.alloc(32), secureCookies: false },
      storeMode: "memory",
      upstash: null,
      generationEnabled: true,
      quotaUnlimited: true,
      generationMode: "live",
      generationExperience: "live",
      liveTransport: { apiKey: "offline-not-used", interpretationPrompt: "offline-not-used" }
    };
    const failures: { caseId: string; score: unknown; outcome: { kind: string; findingCodes?: readonly string[]; exportAllowed: boolean } }[] = [];
    for (const [index, testCase] of DEVELOPMENT_CASES.entries()) {
      const submission = await submissionFor(testCase);
      const prepared = await prepareSemanticGenerationRequest({
        brief: submission.brief,
        references: submission.references.map((reference) => reference.descriptor),
        roleConstraints: submission.roleConstraints,
        promptIdentity: CURRENT_PROMPT_IDENTITY,
        promptHash,
        modelConfiguration
      });
      const candidate = developmentReplayCandidate({ testCase, request: prepared.request });
      const store = new MemoryGenerationStore();
      const session = {
        schemaVersion: "1.0" as const,
        sessionId: `development-replay-${String(index + 1)}`,
        issuedAtMs: 1,
        expiresAtMs: 20_000,
        generationDispatches: 0,
        reservedExposureMicrousd: 0,
        lastDispatchAtMs: null,
        lastProjectId: null
      };
      await store.createSession(session, 60);
      const response = await executeCurrentGeneration({
        config,
        authenticated: { session, clientIdentifier: `development-replay-client-${String(index + 1)}` },
        submission,
        store,
        runtimeOrigin: "test-recorded",
        interpretationTransport: { dispatch: () => Promise.resolve(completed(candidate)) },
        semanticCache: new DispatchOnlySemanticCache(),
        initiatedBy: "live-eval",
        promptHash,
        evaluationModelConfiguration: modelConfiguration
      });
      const executeMutation = async (
        mutationCandidate: SemanticInterpretationCandidate,
        suffix: string,
      ) => {
        const mutationStore = new MemoryGenerationStore();
        const mutationSession = {
          ...session,
          sessionId:
            `development-replay-${suffix}-${String(index + 1)}`,
        };
        await mutationStore.createSession(mutationSession, 60);
        return executeCurrentGeneration({
          config,
          authenticated: {
            session: mutationSession,
            clientIdentifier:
              `development-replay-${suffix}-client-${String(index + 1)}`
          },
          submission,
          store: mutationStore,
          runtimeOrigin: "test-recorded",
          interpretationTransport: {
            dispatch: () => Promise.resolve(completed(mutationCandidate))
          },
          semanticCache: new DispatchOnlySemanticCache(),
          initiatedBy: "live-eval",
          promptHash,
          evaluationModelConfiguration: modelConfiguration
        });
      };
      const candidateUnsupportedSignatureIds = candidate.items.flatMap((item) =>
        item.state === "unbound" || item.state === "uncertain"
          ? item.unsupportedSignatureIds
          : []
      );
      const score = scoreSemanticCaseOracle({
        testCase,
        request: prepared.request,
        outcome: response.outcome,
        candidateUnsupportedSignatureIds
      });
      if (testCase.id === "substitution-lossy-flexure-positive-dev") {
        const reordered = structuredClone(candidate);
        reordered.items.unshift(contextItem({
          claim: "Use context remains separate from construction authority.",
          evidenceId: prepared.request.sourceEvidenceIndex.spans[0]!.evidenceId
        }));
        const reorderedResponse = await executeMutation(
          SemanticInterpretationCandidateSchema.parse(reordered),
          "lossy-substitution-reordered",
        );
        const reorderedSignatures = reordered.items.flatMap((item) =>
          item.state === "unbound" || item.state === "uncertain"
            ? item.unsupportedSignatureIds
            : []
        );
        const reorderedScore = scoreSemanticCaseOracle({
          testCase,
          request: prepared.request,
          outcome: reorderedResponse.outcome,
          candidateUnsupportedSignatureIds: reorderedSignatures
        });
        expect(reorderedResponse.outcome.kind).toBe("modified");
        expect(reorderedScore.primaryPass).toBe(true);

        const lossy = structuredClone(candidate);
        const latticeItem = lossy.items[2]!;
        lossy.items[2] = {
          claim: latticeItem.claim,
          importance: "essential",
          evidenceBindings: latticeItem.evidenceBindings,
          relationships: latticeItem.relationships,
          measurements: latticeItem.measurements,
          state: "unbound",
          reason: "CAPABILITY_NOT_REGISTERED",
          unsupportedSignatureIds: []
        };
        const lossyResponse = await executeMutation(
          SemanticInterpretationCandidateSchema.parse(lossy),
          "lossy-substitution-omission",
        );
        const lossyScore = scoreSemanticCaseOracle({
          testCase,
          request: prepared.request,
          outcome: lossyResponse.outcome,
          candidateUnsupportedSignatureIds: [
            "kerf-flexure-corner-construction"
          ]
        });
        expect(lossyResponse.outcome.kind).toBe("modified");
        expect(lossyResponse.outcome.exportAllowed).toBe(true);
        expect(lossyScore.primaryPass).toBe(true);
        if (lossyResponse.outcome.kind === "modified") {
          expect(lossyResponse.outcome.omittedSemanticIds.length)
            .toBeGreaterThan(0);
          expect(lossyResponse.outcome.source.substitutionTrace.appliedEdgeIds)
            .toEqual([
              "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners"
            ]);
        }
      }
      if (testCase.id === "substitution-refusal-omission-dev") {
        const preferenceFallback = structuredClone(candidate);
        for (const item of preferenceFallback.items) {
          if (item.state === "unbound") {
            item.importance = "preference";
            item.unsupportedSignatureIds = [];
          }
        }
        const preferenceResponse = await executeMutation(
          SemanticInterpretationCandidateSchema.parse(preferenceFallback),
          "preference-fallback",
        );
        const preferenceScore = scoreSemanticCaseOracle({
          testCase,
          request: prepared.request,
          outcome: preferenceResponse.outcome,
          candidateUnsupportedSignatureIds: []
        });
        expect(preferenceResponse.outcome.kind).toBe("simplified");
        expect(preferenceResponse.outcome.exportAllowed).toBe(true);
        expect(
          preferenceScore.primaryPass,
          JSON.stringify(preferenceScore),
        ).toBe(true);
        if (preferenceResponse.outcome.kind === "simplified") {
          expect(preferenceResponse.outcome.source.substitutionTrace)
            .toMatchObject({
              selectedUnsupportedSignatureIds: [],
              substitutionSearchEntered: false,
              substitutionSearchAttemptCount: 0,
              consideredEdgeIds: [],
              refusedEdgeIds: [],
              appliedEdgeIds: []
            });
        }
      }
      if (testCase.id === "flexure-surface-negative-control-dev") {
        const omittedSurface = structuredClone(candidate);
        const surfaceItem = omittedSurface.items[1]!;
        omittedSurface.items[1] = {
          claim: surfaceItem.claim,
          importance: "preference",
          evidenceBindings: surfaceItem.evidenceBindings,
          relationships: surfaceItem.relationships,
          measurements: surfaceItem.measurements,
          state: "unbound",
          reason: "CAPABILITY_NOT_REGISTERED",
          unsupportedSignatureIds: []
        };
        const omittedSurfaceResponse = await executeMutation(
          SemanticInterpretationCandidateSchema.parse(omittedSurface),
          "surface-omitted",
        );
        const omittedSurfaceScore = scoreSemanticCaseOracle({
          testCase,
          request: prepared.request,
          outcome: omittedSurfaceResponse.outcome,
          candidateUnsupportedSignatureIds: []
        });
        expect(omittedSurfaceResponse.outcome.kind).toBe("simplified");
        expect(omittedSurfaceResponse.outcome.exportAllowed).toBe(true);
        expect(omittedSurfaceScore.primaryPass).toBe(true);
        expect(summarizeSemanticEvaluationDiagnostics(
          omittedSurfaceResponse.outcome,
        )?.inventoryItems[1]).toMatchObject({
          realizationState: "simplified",
          coverageDisposition: "changed",
          substitutionEdgeIds: [],
          hasDisclosure: true
        });
        expect(omittedSurfaceScore.prohibitedBindingPredicates).toEqual([
          {
            code: "PROHIBITED_NONSTRUCTURAL_FLEXURE_SIGNATURE",
            pass: false
          },
          {
            code: "PROHIBITED_NONSTRUCTURAL_SUBSTITUTION_ACTIVITY",
            pass: false
          }
        ]);
      }
      const organizationPredicateCode = ORGANIZATION_PREDICATE_CODES[testCase.id];
      if (organizationPredicateCode !== undefined) {
        const removedOrganization = structuredClone(candidate);
        for (const item of removedOrganization.items) {
          if (item.state === "bound") {
            item.atoms = item.atoms.map((atom) => atom.kind === "primary-enclosure"
              ? {
                  ...atom,
                  space: {
                    layout: "explicit-single-space" as const,
                    priority: atom.space.priority,
                    evidenceIds: atom.space.evidenceIds
                  }
                }
              : atom);
          }
        }
        const mutationStore = new MemoryGenerationStore();
        const mutationSession = {
          ...session,
          sessionId: `development-replay-organization-mutation-${String(index + 1)}`
        };
        await mutationStore.createSession(mutationSession, 60);
        const mutationResponse = await executeCurrentGeneration({
          config,
          authenticated: {
            session: mutationSession,
            clientIdentifier: `development-replay-organization-mutation-${String(index + 1)}`
          },
          submission,
          store: mutationStore,
          runtimeOrigin: "test-recorded",
          interpretationTransport: {
            dispatch: () => Promise.resolve(completed(removedOrganization))
          },
          semanticCache: new DispatchOnlySemanticCache(),
          initiatedBy: "live-eval",
          promptHash,
          evaluationModelConfiguration: modelConfiguration
        });
        const mutationScore = scoreSemanticCaseOracle({
          testCase,
          request: prepared.request,
          outcome: mutationResponse.outcome
        });
        expect(mutationScore.primaryPass).toBe(false);
        if (mutationResponse.outcome.kind === "failure") {
          expect(mutationResponse.outcome.exportAllowed).toBe(false);
        } else {
          expect(mutationScore.commitmentPredicates).toEqual(expect.arrayContaining([
            expect.objectContaining({
              code: organizationPredicateCode,
              pass: false
            })
          ]));
        }
      }
      if (testCase.id === "storage-purpose-nonorganization-control-dev" ||
          testCase.id === "storage-context-nonorganization-control-dev") {
        const defaultedSingleSpace = structuredClone(response.outcome);
        const interpretation = defaultedSingleSpace.kind === "supported" ||
          defaultedSingleSpace.kind === "simplified" ||
          defaultedSingleSpace.kind === "modified"
          ? defaultedSingleSpace.source.interpretation
          : defaultedSingleSpace.kind === "concept-only"
            ? defaultedSingleSpace.interpretation
            : null;
        if (interpretation === null) {
          throw new Error(`DEVELOPMENT_REPLAY_SINGLE_SPACE_BASELINE_FAILED:${testCase.id}`);
        }
        interpretation.projection.organization = interpretation.projection.organization.map((item) =>
          item.basis === "explicit-single-space"
            ? { ...item, basis: "default-single-space-policy" as const }
            : item
        );
        const mutationScore = scoreSemanticCaseOracle({
          testCase,
          request: prepared.request,
          outcome: defaultedSingleSpace
        });
        expect(mutationScore.primaryPass).toBe(false);
        expect(mutationScore.commitmentPredicates).toEqual(expect.arrayContaining([
          expect.objectContaining({
            code: "COMMITMENT_EXPLICIT_SINGLE_SPACE",
            pass: false
          })
        ]));
        expect(mutationScore.prohibitedBindingPredicates).toEqual(expect.arrayContaining([
          expect.objectContaining({ pass: false })
          ]));
      }
      if (testCase.id === "reference-role-purpose-control-a-dev" ||
          testCase.id === "reference-role-exclusion-control-b-dev") {
        expect(score.commitmentPredicates).toEqual(expect.arrayContaining([
          expect.objectContaining({
            code: "COMMITMENT_ACCESS_OPENING",
            pass: true
          })
        ]));
        const apertureDeleted = structuredClone(response.outcome);
        const interpretation = apertureDeleted.kind === "supported" ||
          apertureDeleted.kind === "simplified" ||
          apertureDeleted.kind === "modified"
          ? apertureDeleted.source.interpretation
          : apertureDeleted.kind === "concept-only"
            ? apertureDeleted.interpretation
            : null;
        if (interpretation === null) {
          throw new Error(`DEVELOPMENT_REPLAY_ACCESS_APERTURE_BASELINE_FAILED:${testCase.id}`);
        }
        const matchingAperture = interpretation.projection.cutThrough.find((item) =>
          item.purpose === "access" && item.fixedTopAccess
        );
        const matchingAccess = interpretation.projection.access.find((item) =>
          item.kind === "covered" && item.direction === "top"
        );
        expect(matchingAperture?.requirementId).toBe(matchingAccess?.requirementId);
        expect(interpretation.projection.requirements.filter((item) =>
          item.kind === "access" || item.kind === "functional-aperture"
        )).toEqual([
          expect.objectContaining({
            id: matchingAccess?.requirementId,
            kind: "access"
          })
        ]);
        expect(candidate.items.flatMap((item) =>
          item.state === "bound" ? item.atoms.map((atom) => atom.kind) : []
        )).not.toContain("open-access");
        interpretation.projection.cutThrough = interpretation.projection.cutThrough.filter(
          (item) => item.purpose !== "access",
        );
        const mutationScore = scoreSemanticCaseOracle({
          testCase,
          request: prepared.request,
          outcome: apertureDeleted
        });
        expect(mutationScore.primaryPass).toBe(false);
        expect(mutationScore.commitmentPredicates).toEqual(expect.arrayContaining([
          expect.objectContaining({
            code: "COMMITMENT_ACCESS_OPENING",
            pass: false
          })
        ]));
      }
      if (testCase.id === "flexure-surface-negative-control-dev" ||
          testCase.id === "flexure-context-negative-control-dev") {
        expect(candidateUnsupportedSignatureIds).toEqual([]);
        expect(score.prohibitedBindingPredicates).toEqual([
          {
            code: "PROHIBITED_NONSTRUCTURAL_FLEXURE_SIGNATURE",
            pass: false
          },
          {
            code: "PROHIBITED_NONSTRUCTURAL_SUBSTITUTION_ACTIVITY",
            pass: false
          }
        ]);
        const candidateSignatureMutation = scoreSemanticCaseOracle({
          testCase,
          request: prepared.request,
          outcome: response.outcome,
          candidateUnsupportedSignatureIds: [
            "kerf-flexure-corner-construction"
          ]
        });
        expect(candidateSignatureMutation.primaryPass).toBe(false);
        expect(candidateSignatureMutation.prohibitedBindingPredicates).toContainEqual({
          code: "PROHIBITED_NONSTRUCTURAL_FLEXURE_SIGNATURE",
          pass: true
        });
        for (const mutation of [
          {
            key: "selectedUnsupportedSignatureIds" as const,
            value: ["kerf-flexure-corner-construction"]
          },
          {
            key: "substitutionSearchEntered" as const,
            value: true
          },
          {
            key: "substitutionSearchAttemptCount" as const,
            value: 1
          },
          {
            key: "consideredEdgeIds" as const,
            value: [
              "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners"
            ]
          },
          {
            key: "refusedEdgeIds" as const,
            value: [
              "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners"
            ]
          },
          {
            key: "appliedEdgeIds" as const,
            value: [
              "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners"
            ]
          }
        ]) {
          const mutatedOutcome = structuredClone(response.outcome);
          if (mutatedOutcome.kind !== "supported" &&
              mutatedOutcome.kind !== "simplified" &&
              mutatedOutcome.kind !== "modified") {
            throw new Error("NEGATIVE_CONTROL_REQUIRES_CANONICAL_SOURCE");
          }
          Object.assign(mutatedOutcome.source.substitutionTrace, {
            [mutation.key]: mutation.value
          });
          const mutationScore = scoreSemanticCaseOracle({
            testCase,
            request: prepared.request,
            outcome: mutatedOutcome,
            candidateUnsupportedSignatureIds: []
          });
          expect(mutationScore.primaryPass).toBe(false);
          expect(mutationScore.prohibitedBindingPredicates).toContainEqual({
            code: mutation.key === "selectedUnsupportedSignatureIds"
              ? "PROHIBITED_NONSTRUCTURAL_FLEXURE_SIGNATURE"
              : "PROHIBITED_NONSTRUCTURAL_SUBSTITUTION_ACTIVITY",
            pass: true
          });
        }
      }
      if (!score.primaryPass) failures.push({
        caseId: testCase.id,
        score,
        outcome: {
          kind: response.outcome.kind,
          ...(response.outcome.kind === "failure" ? {} : { findingCodes: response.outcome.findingCodes }),
          exportAllowed: response.outcome.exportAllowed
        }
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(failures).toEqual([]);
  }, 30_000);
});
