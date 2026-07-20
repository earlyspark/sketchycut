import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { hashCanonical, sha256 } from "../../src/domain/hash.js";
import {
  scoreDiversityCase,
  summarizeDiversityRound,
  type DiversityCaseScore,
  type DiversityCaseObservation,
  type DiversityPanelProtocol,
  validateDiversityPanelProtocol
} from "../../src/evaluation/semantic-diversity.js";
import {
  FROZEN_CONSTRUCTION_CORPUS,
  FROZEN_LIVE_DIVERSITY_COHORT
} from "../fixtures/intent-conditioned-construction/corpus.js";
import {
  FROZEN_INTENT_CONSTRUCTION_CORPUS_HASH,
  FROZEN_LIVE_DIVERSITY_COHORT_HASH,
  FROZEN_ITERATION_PANEL_PROTOCOL_HASH,
  FROZEN_SEMANTIC_DIVERSITY_SCORER_HASH
} from "../fixtures/intent-conditioned-construction/manifest.js";
import { FROZEN_ITERATION_PANEL_PROTOCOL } from "../fixtures/intent-conditioned-construction/iteration-panel-protocol.js";
import { M6_2_LIVE_COMPARISON_FINGERPRINTS } from "../fixtures/intent-conditioned-construction/m6-2-live-fingerprints.js";

describe("frozen intent-conditioned construction evaluation", () => {
  it("pins the complete corpus, iteration protocol, cohort, and generic scorer before planner work", async () => {
    expect(FROZEN_CONSTRUCTION_CORPUS).toHaveLength(28);
    expect(await hashCanonical(FROZEN_CONSTRUCTION_CORPUS)).toBe(
      FROZEN_INTENT_CONSTRUCTION_CORPUS_HASH,
    );
    expect(await hashCanonical(FROZEN_LIVE_DIVERSITY_COHORT)).toBe(
      FROZEN_LIVE_DIVERSITY_COHORT_HASH,
    );
    expect(await hashCanonical(FROZEN_ITERATION_PANEL_PROTOCOL)).toBe(
      FROZEN_ITERATION_PANEL_PROTOCOL_HASH,
    );
    expect(validateDiversityPanelProtocol(FROZEN_ITERATION_PANEL_PROTOCOL)).toBe(
      FROZEN_ITERATION_PANEL_PROTOCOL,
    );
    const scorer = await readFile(new URL("../../src/evaluation/semantic-diversity.ts", import.meta.url));
    expect(await sha256(scorer)).toBe(FROZEN_SEMANTIC_DIVERSITY_SCORER_HASH);
    expect(Object.keys(M6_2_LIVE_COMPARISON_FINGERPRINTS).sort()).toEqual(
      FROZEN_LIVE_DIVERSITY_COHORT.map((item) => item.id).sort(),
    );
  });

  it("does not credit invalid, unauthorized, mis-targeted, or wrong-direction fields", () => {
    const protocol = FROZEN_ITERATION_PANEL_PROTOCOL.cases[0];
    const baseline = M6_2_LIVE_COMPARISON_FINGERPRINTS[
      protocol.id as keyof typeof M6_2_LIVE_COMPARISON_FINGERPRINTS
    ];
    const baseObservation = {
      caseId: protocol.id,
      outcome: "supported",
      deterministicGatesPass: true,
      dimensions: { widthMm: 220, depthMm: 80, heightMm: 45 },
      topology: baseline.topology,
      canonicalDefaultProportionsUsed: false
    } as const;
    for (const failedField of ["schemaValid", "evidenceAuthorized", "correctlyTargeted", "correctDirection"] as const) {
      const observation: DiversityCaseObservation = {
        ...baseObservation,
        opportunities: [{
          opportunityId: "project-width-to-depth",
          kind: "proportions",
          schemaValid: true,
          evidenceAuthorized: true,
          correctlyTargeted: true,
          correctDirection: true,
          [failedField]: false
        }]
      };
      expect(scoreDiversityCase({
        protocol,
        baselineDimensions: baseline.dimensions,
        baselineTopology: baseline.topology,
        observation
      }).opportunityHits.proportions).toBe(0);
    }
  });

  it("counts each expected opportunity at most once and rejects canonical-default substitution", () => {
    const protocol = FROZEN_ITERATION_PANEL_PROTOCOL.cases[0];
    const baseline = M6_2_LIVE_COMPARISON_FINGERPRINTS[protocol.id];
    const repeated = {
      opportunityId: "project-width-to-depth",
      kind: "proportions" as const,
      schemaValid: true,
      evidenceAuthorized: true,
      correctlyTargeted: true,
      correctDirection: true
    };
    const score = scoreDiversityCase({
      protocol,
      baselineDimensions: baseline.dimensions,
      baselineTopology: baseline.topology,
      observation: {
        caseId: protocol.id,
        outcome: "supported",
        deterministicGatesPass: true,
        opportunities: [repeated, repeated],
        dimensions: { widthMm: 220, depthMm: 80, heightMm: 45 },
        topology: baseline.topology,
        canonicalDefaultProportionsUsed: true
      }
    });
    expect(score.opportunityHits.proportions).toBe(1);
    expect(score.canonicalDefaultProportionsPass).toBe(false);
  });

  it("requires the complete fixed cohort and every opportunity threshold", () => {
    const scores = FROZEN_ITERATION_PANEL_PROTOCOL.cases.map((protocol) => {
      const baseline = M6_2_LIVE_COMPARISON_FINGERPRINTS[
        protocol.id
      ];
      const dimensions = protocol.id === "long-pencil-enclosure"
        ? { widthMm: 220, depthMm: 80, heightMm: 45 }
        : protocol.id === "flat-wide-tray"
        ? { widthMm: 210, depthMm: 130, heightMm: 40 }
        : protocol.id === "tall-narrow-container"
        ? { widthMm: 70, depthMm: 70, heightMm: 130 }
        : baseline.dimensions;
      const topology = protocol.id === "four-sd-card-compartments"
        ? { ...baseline.topology, usableSpaceCount: 4, dividerPartitionGraph: ["space-1|space-2", "space-2|space-3", "space-3|space-4"] }
        : protocol.id === "open-front-cubby"
        ? { ...baseline.topology, openingFaces: ["front"] }
        : baseline.topology;
      const opportunities = (Object.entries(protocol.expectedFieldOpportunities) as [
        keyof typeof protocol.expectedFieldOpportunities,
        readonly string[]
      ][]).flatMap(([kind, ids]) => ids.map((opportunityId) => ({
        opportunityId,
        kind,
        schemaValid: true,
        evidenceAuthorized: true,
        correctlyTargeted: true,
        correctDirection: true
      })));
      return scoreDiversityCase({
        protocol,
        baselineDimensions: baseline.dimensions,
        baselineTopology: baseline.topology,
        observation: {
          caseId: protocol.id,
          outcome: "supported",
          deterministicGatesPass: true,
          opportunities,
          dimensions,
          topology,
          canonicalDefaultProportionsUsed: false
        }
      });
    });
    expect(summarizeDiversityRound(FROZEN_ITERATION_PANEL_PROTOCOL, scores)).toMatchObject({
      materiallyDifferent: 5,
      dimensionSensitivePasses: 3,
      topologySensitivePasses: 2,
      pairwiseAspectPass: true,
      pass: true
    });
    const missing = scores.map((score, index) => index === 0
      ? { ...score, opportunityHits: { ...score.opportunityHits, proportions: 0 } }
      : score);
    expect(summarizeDiversityRound(FROZEN_ITERATION_PANEL_PROTOCOL, missing).pass).toBe(false);
  });

  it("qualifies pairwise aspect fingerprints by axis while retaining same-axis collisions", () => {
    const makeCase = (
      id: string,
      numerator: "widthMm" | "depthMm" | "heightMm",
      denominator: "widthMm" | "depthMm" | "heightMm",
    ) => ({
      id,
      expectedFieldOpportunities: { proportions: [], counts: [], scaleEvidence: [], access: [] },
      comparisonChannels: ["dimensions"] as const,
      expectedOutcome: "supported" as const,
      aspectRatioPredicates: [{
        kind: "aspect-ratio" as const,
        id: `${id}-ratio`,
        numerator,
        denominator,
        comparison: "at-least" as const,
        threshold: 1,
        minimumRelativeChange: 0
      }],
      topologyPredicates: [],
      topologyDifferenceFields: [],
      forbidCanonicalDefaultProportions: false
    });
    const cases = [
      makeCase("wide", "widthMm", "heightMm"),
      makeCase("tall", "heightMm", "widthMm"),
      makeCase("long", "widthMm", "depthMm")
    ];
    const panel = {
      schemaVersion: "sketchycut-diversity-panel@1.0.0",
      panelId: "axis-qualified-aspects",
      cases,
      roundPolicy: {
        expectedCaseCount: 3,
        minimumMateriallyDifferentCases: 3,
        minimumDimensionSensitiveCases: 3,
        requireEveryTopologySensitiveCase: true,
        exactOpportunityTotals: { proportions: 0, counts: 0, scaleEvidence: 0, access: 0 },
        pairwiseDistinctAspectCaseIds: ["wide", "tall", "long"]
      }
    } satisfies DiversityPanelProtocol;
    const scores = cases.map((item, index) => ({
      caseId: item.id,
      comparisonChannels: item.comparisonChannels,
      opportunityHits: { proportions: 0, counts: 0, scaleEvidence: 0, access: 0 },
      opportunityTotals: { proportions: 0, counts: 0, scaleEvidence: 0, access: 0 },
      aspectRatios: { [item.aspectRatioPredicates[0]!.id]: index === 2 ? 2.5 : 3.24 },
      dimensionsMateriallyDifferent: true,
      topologyMateriallyDifferent: false,
      directionalPredicatePass: true,
      materialDifferencePass: true,
      canonicalDefaultProportionsPass: true,
      acceptedOutcome: true
    } satisfies DiversityCaseScore));

    expect(summarizeDiversityRound(panel, scores)).toMatchObject({
      pairwiseAspectPass: true,
      pairwiseAspectSignatures: [
        "widthMm/heightMm:3.240000",
        "heightMm/widthMm:3.240000",
        "widthMm/depthMm:2.500000"
      ],
      pass: true
    });

    const sameAxisPanel = {
      ...panel,
      cases: [cases[0]!, makeCase("tall", "widthMm", "heightMm"), cases[2]!]
    } satisfies DiversityPanelProtocol;
    expect(summarizeDiversityRound(sameAxisPanel, scores)).toMatchObject({
      pairwiseAspectPass: false,
      pass: false
    });
  });

  it("rejects malformed or executable-looking sealed-panel protocol data", () => {
    expect(() => validateDiversityPanelProtocol({
      ...FROZEN_ITERATION_PANEL_PROTOCOL,
      cases: [
        FROZEN_ITERATION_PANEL_PROTOCOL.cases[0],
        FROZEN_ITERATION_PANEL_PROTOCOL.cases[0],
        ...FROZEN_ITERATION_PANEL_PROTOCOL.cases.slice(2)
      ]
    })).toThrow("DIVERSITY_PROTOCOL_INVALID:CASE_IDS_UNIQUE");
  });
});
