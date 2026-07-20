import type { DiversityPanelProtocol } from "../../../src/evaluation/semantic-diversity.js";

export const FROZEN_ITERATION_PANEL_PROTOCOL = {
  schemaVersion: "sketchycut-diversity-panel@1.0.0",
  panelId: "m6.3-public-iteration-panel",
  cases: [
    {
      id: "long-pencil-enclosure",
      expectedFieldOpportunities: {
        proportions: ["project-width-to-depth"],
        counts: [],
        scaleEvidence: ["contained-pencils"],
        access: []
      },
      comparisonChannels: ["dimensions"],
      expectedOutcome: "supported",
      aspectRatioPredicates: [{
        kind: "aspect-ratio",
        id: "width-to-depth",
        numerator: "widthMm",
        denominator: "depthMm",
        comparison: "at-least",
        threshold: 2,
        minimumRelativeChange: 0.2
      }],
      topologyPredicates: [],
      topologyDifferenceFields: [],
      forbidCanonicalDefaultProportions: true
    },
    {
      id: "flat-wide-tray",
      expectedFieldOpportunities: {
        proportions: ["project-width-to-height"],
        counts: [],
        scaleEvidence: [],
        access: []
      },
      comparisonChannels: ["dimensions"],
      expectedOutcome: "supported",
      aspectRatioPredicates: [{
        kind: "aspect-ratio",
        id: "width-to-height",
        numerator: "widthMm",
        denominator: "heightMm",
        comparison: "at-least",
        threshold: 3,
        minimumRelativeChange: 0.2
      }],
      topologyPredicates: [],
      topologyDifferenceFields: [],
      forbidCanonicalDefaultProportions: true
    },
    {
      id: "tall-narrow-container",
      expectedFieldOpportunities: {
        proportions: ["project-height-to-width"],
        counts: [],
        scaleEvidence: [],
        access: []
      },
      comparisonChannels: ["dimensions"],
      expectedOutcome: "supported",
      aspectRatioPredicates: [{
        kind: "aspect-ratio",
        id: "height-to-width",
        numerator: "heightMm",
        denominator: "widthMm",
        comparison: "at-least",
        threshold: 1.4,
        minimumRelativeChange: 0.2
      }],
      topologyPredicates: [],
      topologyDifferenceFields: [],
      forbidCanonicalDefaultProportions: true
    },
    {
      id: "four-sd-card-compartments",
      expectedFieldOpportunities: {
        proportions: [],
        counts: ["desired-compartment-count"],
        scaleEvidence: ["contained-sd-cards"],
        access: []
      },
      comparisonChannels: ["topology"],
      expectedOutcome: "supported",
      aspectRatioPredicates: [],
      topologyPredicates: [
        { kind: "usable-space-count", count: 4 },
        { kind: "divider-partition-present" }
      ],
      topologyDifferenceFields: ["usableSpaceCount", "dividerPartitionGraph"],
      forbidCanonicalDefaultProportions: false
    },
    {
      id: "open-front-cubby",
      expectedFieldOpportunities: {
        proportions: [],
        counts: [],
        scaleEvidence: [],
        access: ["open-front"]
      },
      comparisonChannels: ["topology"],
      expectedOutcome: "supported",
      aspectRatioPredicates: [],
      topologyPredicates: [{ kind: "opening-face-includes", face: "front" }],
      topologyDifferenceFields: ["openingFaces"],
      forbidCanonicalDefaultProportions: false
    }
  ],
  roundPolicy: {
    expectedCaseCount: 5,
    minimumMateriallyDifferentCases: 4,
    minimumDimensionSensitiveCases: 2,
    requireEveryTopologySensitiveCase: true,
    exactOpportunityTotals: {
      proportions: 3,
      counts: 1,
      scaleEvidence: 2,
      access: 1
    },
    pairwiseDistinctAspectCaseIds: [
      "long-pencil-enclosure",
      "flat-wide-tray",
      "tall-narrow-container"
    ]
  }
} as const satisfies DiversityPanelProtocol;
