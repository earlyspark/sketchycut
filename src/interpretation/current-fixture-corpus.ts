import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
  type SemanticAtom
} from "./semantic-atom-registry.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  type SemanticInterpretationCandidate
} from "./semantic-model-contract.js";
import type { SemanticGenerationRequest } from "./semantic-request.js";

export type CurrentFixtureScenario = {
  id: string;
  brief: string;
  briefDigest: string;
  access: "open-top" | "covered";
  mechanism: "rigid" | "retained-pin" | "captured-slide" | "fixed-top-frame";
  surface: boolean;
  unsupportedCompoundMotion: boolean;
  unsupportedFlexureCorners?: boolean;
  ambiguousMeasurementSpan?: { start: number; end: number };
  invalidOutput: boolean;
};

function fixture(input: CurrentFixtureScenario): CurrentFixtureScenario {
  return input;
}

export const CURRENT_FIXTURE_SCENARIOS: readonly CurrentFixtureScenario[] = Object.freeze([
  fixture({ id: "open-access-rigid", brief: "Make an open-top desktop catchall.", briefDigest: "1f4c193c52c800a22880e62ca3f84c2366787cf3bef5ff3b3e189d219ae4e0bb", access: "open-top", mechanism: "rigid", surface: false, unsupportedCompoundMotion: false, invalidOutput: false }),
  fixture({ id: "covered-revolute", brief: "Make a covered keepsake container with one retained hinged cover.", briefDigest: "d7378b348818759c94c6aa2567a6e2b4149f76ec4485b873028e79e323c59ab4", access: "covered", mechanism: "retained-pin", surface: false, unsupportedCompoundMotion: false, invalidOutput: false }),
  fixture({ id: "covered-prismatic", brief: "Make a covered card container with one captured sliding cover.", briefDigest: "6d83881a642a0d0286f815941d240eec6486ea981c975719ae25a9d27b358ef0", access: "covered", mechanism: "captured-slide", surface: false, unsupportedCompoundMotion: false, invalidOutput: false }),
  fixture({ id: "surface-treatment", brief: "Make an open-top catchall with a sparse bilateral scored border.", briefDigest: "2c3676094dd9dcbe12df6b9a57f9e1457a2272917a528fc70dd9abb5e102952f", access: "open-top", mechanism: "rigid", surface: true, unsupportedCompoundMotion: false, invalidOutput: false }),
  fixture({ id: "fixed-aperture-enclosure", brief: "Make a fixed-top display enclosure with a circular access opening and repeated lattice walls.", briefDigest: "7d8637a809bf1c007479ed1aae636a7d45b6ef9fc1e7f4f99d7c838572f1c321", access: "covered", mechanism: "fixed-top-frame", surface: false, unsupportedCompoundMotion: false, invalidOutput: false }),
  fixture({ id: "modified-fixed-aperture-enclosure", brief: "Make a fixed-top lantern enclosure with a circular top opening, registered lattice walls, and flexible kerf-bent corners.", briefDigest: "a171e9913de1e8495b0b2b46a45e41a80afa9af1a3bc2f882bd449a2b6918a0b", access: "covered", mechanism: "fixed-top-frame", surface: false, unsupportedCompoundMotion: false, unsupportedFlexureCorners: true, invalidOutput: false }),
  fixture({ id: "unsupported-compound-motion", brief: "Make a required object with two independently moving covers.", briefDigest: "58374a223863325f870866d1fc530da4c86ec0a66bcfd851ebb1e7d43011a834", access: "covered", mechanism: "rigid", surface: false, unsupportedCompoundMotion: true, invalidOutput: false }),
  fixture({ id: "ambiguous-measurement", brief: "Make an open-top rigid container; make the opening about 80 mm and the whole thing 120 mm.", briefDigest: "061071bfda7636e7dcd29af56eb89522ea4e1af27d3dc3a93664a4a628999194", access: "open-top", mechanism: "rigid", surface: false, unsupportedCompoundMotion: false, ambiguousMeasurementSpan: { start: 83, end: 89 }, invalidOutput: false }),
  fixture({ id: "strict-output-failure", brief: "Interpret an intentionally invalid current structured fixture.", briefDigest: "d9fdcf40b58089cf963b50ffa3e1665bdf026e7e99f4cfa6693774574a621155", access: "open-top", mechanism: "rigid", surface: false, unsupportedCompoundMotion: false, invalidOutput: true })
]);

export function findCurrentFixtureReplay(semanticBriefDigest: string): CurrentFixtureScenario | null {
  return CURRENT_FIXTURE_SCENARIOS.find((item) => item.briefDigest === semanticBriefDigest) ?? null;
}

function firstBriefEvidence(request: SemanticGenerationRequest): string {
  const id = request.sourceEvidenceIndex.spans[0]?.evidenceId;
  if (id === undefined) throw new Error("CURRENT_FIXTURE_BRIEF_EVIDENCE_MISSING");
  return id;
}

export function buildCurrentFixtureInterpretation(
  request: SemanticGenerationRequest,
  scenario: CurrentFixtureScenario,
): unknown {
  if (scenario.invalidOutput) return { schemaVersion: "invalid", unknownField: true };
  const evidenceId = firstBriefEvidence(request);
  const item = (input: {
    claim: string;
    aspects: ("structure" | "surface" | "operation")[];
    atoms?: SemanticAtom[];
    resolution?: {
      state: "unbound";
      reason: "CAPABILITY_NOT_REGISTERED" | "EVIDENCE_INSUFFICIENT" |
        "EVIDENCE_CONFLICT" | "PROJECTION_COVERAGE_MISMATCH";
    };
    measurements?: SemanticInterpretationCandidate["items"][number]["measurements"];
  }) => ({
    claim: input.claim,
    importance: "essential" as const,
    evidenceBindings: input.aspects.map((aspect) => ({ evidenceId, aspect, support: "direct" as const })),
    relationships: [],
    measurements: input.measurements ?? [],
    ...(input.resolution ?? {
      state: "bound" as const,
      atoms: input.atoms ?? []
    })
  });
  const movingAtom = scenario.mechanism === "retained-pin"
    ? { kind: "retained-revolute-cover" as const, axis: "width" as const, priority: "must" as const }
    : { kind: "captured-prismatic-cover" as const, axis: "depth" as const, priority: "must" as const };
  const items = [
    item({
      claim: `The construction contains the requested contents with ${scenario.access} access.`,
      aspects: ["structure"],
      atoms: [{
        kind: "primary-enclosure",
        enclosure: { priority: "must", quantity: null, evidenceIds: [evidenceId] },
        access: {
          kind: scenario.access === "open-top" ? "open-top" : "covered-top",
          priority: "must",
          evidenceIds: [evidenceId]
        },
        space: { layout: "unspecified", priority: "must", evidenceIds: [evidenceId] }
      }],
      measurements: scenario.ambiguousMeasurementSpan === undefined ? [] : [{
        target: { subject: "project", envelope: "external", axis: "width" },
        interpretation: "ambiguous",
        literal: {
          evidenceId,
          start: scenario.ambiguousMeasurementSpan.start,
          end: scenario.ambiguousMeasurementSpan.end
        }
      }]
    }),
    ...(scenario.mechanism === "retained-pin" || scenario.mechanism === "captured-slide" ? [item({
      claim: scenario.mechanism === "retained-pin" ? "One cover rotates on a retained axis." : "One cover translates while captured.",
      aspects: ["structure", "operation"],
      atoms: [movingAtom]
    })] : []),
    ...(scenario.mechanism === "fixed-top-frame" ? [
      item({
        claim: "The retained top provides one access aperture.",
        aspects: ["structure"],
        atoms: [{
          kind: "structural-aperture", targetBodyRole: "primary-enclosure", targetFaceRoles: ["cover"],
          patternFamily: "ring-aperture", purpose: "access", density: "sparse", symmetry: "radial",
          repetition: "single-face", priority: "must"
        }]
      }),
      item({
        claim: "Repeated registered openings occupy the eligible walls.",
        aspects: ["surface"],
        atoms: [{
          kind: "structural-aperture", targetBodyRole: "primary-enclosure",
          targetFaceRoles: ["rear", "left", "right", "front"], patternFamily: "lattice-grid",
          purpose: "illumination-ventilation", density: "dense", symmetry: "translational",
          repetition: "matched-faces", priority: "must"
        }]
      })
    ] : []),
    ...(scenario.surface ? [item({
      claim: "A registered sparse bilateral score treatment is applied.",
      aspects: ["surface"],
      atoms: [{
        kind: "registered-surface-treatment", composition: "border", density: "sparse", symmetry: "bilateral",
        primitiveFamilies: ["inset-score-frame", "corner-score-ticks"], preferredOperations: ["score"],
        preferredBodyRoles: ["primary-enclosure"]
      }]
    })] : []),
    ...(scenario.unsupportedCompoundMotion ? [item({
      claim: "Two covers move independently through different relationships.",
      aspects: ["structure", "operation"],
      resolution: {
        state: "unbound",
        reason: "CAPABILITY_NOT_REGISTERED"
      }
    })] : []),
    ...(scenario.unsupportedFlexureCorners === true ? [item({
      claim: "The enclosure corners use flexible kerf-bent transitions.",
      aspects: ["structure"],
      resolution: {
        state: "unbound",
        reason: "CAPABILITY_NOT_REGISTERED"
      }
    })] : [])
  ];
  return {
    schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    items
  } satisfies SemanticInterpretationCandidate;
}
