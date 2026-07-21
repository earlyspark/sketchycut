export type FrozenParserDisposition = {
  literal: string;
  subject: "project-external" | "project-internal" | "contained-object" | "ambiguous";
  axis: "width" | "depth" | "height" | "long" | "short" | "thickness" | null;
  targetId: string | null;
  marker: "exact" | "approximate" | "range" | "not-measurement";
  active: boolean;
  findingCode: string | null;
};

export type FrozenConstructionCase = {
  id: string;
  brief: string;
  referenceCount: 0 | 1 | 3;
  baselineBehavior: "rigid" | "revolute" | "prismatic" | "concept-only";
  advancedSizing: null | {
    basis: "exact-external" | "exact-internal";
    widthMm?: number;
    depthMm?: number;
    heightMm?: number;
  };
  expected: {
    outcome: "supported" | "simplified" | "concept-only" | "failure";
    findingCodes: readonly string[];
    access: "open-top" | "top-access" | "open-front" | "front-panel";
    canonicalSpaces: number;
    mechanism: "rigid" | "revolute" | "prismatic";
    sizingSources: readonly string[];
    fabricationCandidate: boolean;
    exportAllowed: boolean;
  };
  parser: readonly FrozenParserDisposition[];
};

export const FROZEN_CONSTRUCTION_CORPUS = [
  {
    id: "unanchored-compact-catchall",
    brief: "Make a compact open-top catchall for my desk.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["unanchored-fallback", "semantic-proportion"], fabricationCandidate: true, exportAllowed: true },
    parser: []
  },
  {
    id: "fit-critical-unmeasured-camera",
    brief: "Make a protective enclosure that must fit my camera exactly.",
    referenceCount: 1,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "concept-only", findingCodes: ["FIT_CRITICAL_MEASUREMENT_REQUIRED"], access: "top-access", canonicalSpaces: 1, mechanism: "rigid", sizingSources: [], fabricationCandidate: false, exportAllowed: false },
    parser: []
  },
  {
    id: "long-pencil-enclosure",
    brief: "Make a long, narrow covered enclosure for six standard pencils.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: ["FABRICATION_EXPORT_WITHHELD_PENDING_STRUCTURAL_REDESIGN"], access: "top-access", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["model-prior-object-scale", "semantic-proportion"], fabricationCandidate: false, exportAllowed: false },
    parser: []
  },
  {
    id: "flat-wide-tray",
    brief: "Make a flat, wide open-top tray for my desk.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["unanchored-fallback", "semantic-proportion"], fabricationCandidate: true, exportAllowed: true },
    parser: []
  },
  {
    id: "tall-narrow-container",
    brief: "Make a tall, narrow open-top container for paint brushes.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["unanchored-fallback", "semantic-proportion"], fabricationCandidate: true, exportAllowed: true },
    parser: []
  },
  {
    id: "open-top-catchall",
    brief: "Make an open-top catchall with easy access.",
    referenceCount: 1,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["unanchored-fallback", "canonical-default-proportions"], fabricationCandidate: true, exportAllowed: true },
    parser: []
  },
  {
    id: "open-front-cubby",
    brief: "Make an open-front cubby for a small notebook.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "open-front", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["model-prior-object-scale", "canonical-default-proportions"], fabricationCandidate: true, exportAllowed: true },
    parser: []
  },
  {
    id: "divided-organizer",
    brief: "Make an open-top divided organizer with two equal spaces.",
    referenceCount: 1,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "open-top", canonicalSpaces: 2, mechanism: "rigid", sizingSources: ["unanchored-fallback", "canonical-default-proportions"], fabricationCandidate: true, exportAllowed: true },
    parser: [{ literal: "two", subject: "ambiguous", axis: null, targetId: "organization", marker: "not-measurement", active: false, findingCode: null }]
  },
  {
    id: "four-sd-card-compartments",
    brief: "Make an open-top organizer with four compartments for SD cards.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "open-top", canonicalSpaces: 4, mechanism: "rigid", sizingSources: ["model-prior-object-scale", "canonical-default-proportions"], fabricationCandidate: true, exportAllowed: true },
    parser: [{ literal: "four", subject: "ambiguous", axis: null, targetId: "organization", marker: "not-measurement", active: false, findingCode: null }]
  },
  {
    id: "one-compartment-control",
    brief: "Make an open-top organizer with one compartment for SD cards.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["model-prior-object-scale", "canonical-default-proportions"], fabricationCandidate: true, exportAllowed: true },
    parser: [{ literal: "one", subject: "ambiguous", axis: null, targetId: "organization", marker: "not-measurement", active: false, findingCode: null }]
  },
  {
    id: "retained-pin-keepsake-enclosure",
    brief: "Make a keepsake enclosure with one retained-pin hinged lid.",
    referenceCount: 1,
    baselineBehavior: "revolute",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: ["FABRICATION_EXPORT_WITHHELD_PENDING_STRUCTURAL_REDESIGN"], access: "top-access", canonicalSpaces: 1, mechanism: "revolute", sizingSources: ["unanchored-fallback", "canonical-default-proportions"], fabricationCandidate: false, exportAllowed: false },
    parser: [{ literal: "one", subject: "ambiguous", axis: null, targetId: "moving-cover", marker: "not-measurement", active: false, findingCode: null }]
  },
  {
    id: "captured-sliding-card-enclosure",
    brief: "Make a card enclosure with one captured sliding lid.",
    referenceCount: 1,
    baselineBehavior: "prismatic",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: ["FABRICATION_EXPORT_WITHHELD_PENDING_STRUCTURAL_REDESIGN"], access: "top-access", canonicalSpaces: 1, mechanism: "prismatic", sizingSources: ["model-prior-object-scale", "canonical-default-proportions"], fabricationCandidate: false, exportAllowed: false },
    parser: [{ literal: "one", subject: "ambiguous", axis: null, targetId: "moving-cover", marker: "not-measurement", active: false, findingCode: null }]
  },
  {
    id: "generic-named-contents",
    brief: "Make a covered container for tea bags.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: ["FABRICATION_EXPORT_WITHHELD_PENDING_STRUCTURAL_REDESIGN"], access: "top-access", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["model-prior-object-scale", "canonical-default-proportions"], fabricationCandidate: false, exportAllowed: false },
    parser: []
  },
  {
    id: "prompt-reference-disagreement",
    brief: "Make an open-front cubby; ignore the covered shape in the reference.",
    referenceCount: 1,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: ["SEMANTIC_EVIDENCE_CONFLICT_TEXT_WINS"], access: "open-front", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["unanchored-fallback", "canonical-default-proportions"], fabricationCandidate: true, exportAllowed: true },
    parser: []
  },
  {
    id: "image-only-scale",
    brief: "Make a container like the reference; no measurements are supplied.",
    referenceCount: 1,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "top-access", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["model-prior-object-scale", "canonical-default-proportions"], fabricationCandidate: true, exportAllowed: true },
    parser: []
  },
  {
    id: "text-only-zero-reference",
    brief: "Make a simple open-top desktop container.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["unanchored-fallback", "canonical-default-proportions"], fabricationCandidate: true, exportAllowed: true },
    parser: []
  },
  {
    id: "feasible-exact-external",
    brief: "Make an open-top box with project external width 150 mm, project external depth 100 mm, and project external height 60 mm.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["parsed-exact"], fabricationCandidate: true, exportAllowed: true },
    parser: [
      { literal: "150 mm", subject: "project-external", axis: "width", targetId: "project.external.width", marker: "exact", active: true, findingCode: null },
      { literal: "100 mm", subject: "project-external", axis: "depth", targetId: "project.external.depth", marker: "exact", active: true, findingCode: null },
      { literal: "60 mm", subject: "project-external", axis: "height", targetId: "project.external.height", marker: "exact", active: true, findingCode: null }
    ]
  },
  {
    id: "feasible-exact-internal",
    brief: "Make a covered box with project internal width 120 mm, project internal depth 80 mm, and project internal height 50 mm.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: ["FABRICATION_EXPORT_WITHHELD_PENDING_STRUCTURAL_REDESIGN"], access: "top-access", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["parsed-exact"], fabricationCandidate: false, exportAllowed: false },
    parser: [
      { literal: "120 mm", subject: "project-internal", axis: "width", targetId: "project.internal.width", marker: "exact", active: true, findingCode: null },
      { literal: "80 mm", subject: "project-internal", axis: "depth", targetId: "project.internal.depth", marker: "exact", active: true, findingCode: null },
      { literal: "50 mm", subject: "project-internal", axis: "height", targetId: "project.internal.height", marker: "exact", active: true, findingCode: null }
    ]
  },
  {
    id: "partial-exact-hybrid",
    brief: "Make a long covered pencil case with project external width 160 mm.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: ["FABRICATION_EXPORT_WITHHELD_PENDING_STRUCTURAL_REDESIGN"], access: "top-access", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["parsed-exact", "model-prior-object-scale", "semantic-proportion"], fabricationCandidate: false, exportAllowed: false },
    parser: [{ literal: "160 mm", subject: "project-external", axis: "width", targetId: "project.external.width", marker: "exact", active: true, findingCode: null }]
  },
  {
    id: "advanced-overrides-parsed",
    brief: "Make an open-top box with project external width 120 mm.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: { basis: "exact-external", widthMm: 150 },
    expected: { outcome: "supported", findingCodes: ["PARSED_MEASUREMENT_OVERRIDDEN"], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["advanced-exact", "canonical-default-proportions"], fabricationCandidate: true, exportAllowed: true },
    parser: [{ literal: "120 mm", subject: "project-external", axis: "width", targetId: "project.external.width", marker: "exact", active: false, findingCode: "PARSED_MEASUREMENT_OVERRIDDEN" }]
  },
  {
    id: "contained-card-width",
    brief: "Make an organizer that holds cards with contained-object width 90 mm.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["contained-object-exact", "canonical-default-proportions"], fabricationCandidate: true, exportAllowed: true },
    parser: [{ literal: "90 mm", subject: "contained-object", axis: "width", targetId: "contained.cards.width", marker: "exact", active: true, findingCode: null }]
  },
  {
    id: "approximate-project-width",
    brief: "Make an open-top box about 10 cm wide.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: ["SIZING_MEASUREMENT_IGNORED"], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["unanchored-fallback", "semantic-proportion"], fabricationCandidate: true, exportAllowed: true },
    parser: [{ literal: "about 10 cm wide", subject: "project-external", axis: "width", targetId: "project.external.width", marker: "approximate", active: false, findingCode: "SIZING_MEASUREMENT_IGNORED" }]
  },
  {
    id: "ranged-project-width",
    brief: "Make an open-top box 90–110 mm wide.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: ["SIZING_MEASUREMENT_IGNORED"], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["unanchored-fallback", "semantic-proportion"], fabricationCandidate: true, exportAllowed: true },
    parser: [{ literal: "90–110 mm wide", subject: "project-external", axis: "width", targetId: "project.external.width", marker: "range", active: false, findingCode: "SIZING_MEASUREMENT_IGNORED" }]
  },
  {
    id: "hard-constraint-infeasible",
    brief: "Make an open-top box with project external width 8 mm, project external depth 8 mm, and project external height 8 mm.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "concept-only", findingCodes: ["SIZING_HARD_CONSTRAINT_INFEASIBLE"], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["parsed-exact"], fabricationCandidate: false, exportAllowed: false },
    parser: [
      { literal: "8 mm", subject: "project-external", axis: "width", targetId: "project.external.width", marker: "exact", active: true, findingCode: null },
      { literal: "8 mm", subject: "project-external", axis: "depth", targetId: "project.external.depth", marker: "exact", active: true, findingCode: null },
      { literal: "8 mm", subject: "project-external", axis: "height", targetId: "project.external.height", marker: "exact", active: true, findingCode: null }
    ]
  },
  {
    id: "evidence-backed-feature-preference",
    brief: "Prefer an open-front organizer with two equal compartments over a plain shell.",
    referenceCount: 1,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "supported", findingCodes: [], access: "open-front", canonicalSpaces: 2, mechanism: "rigid", sizingSources: ["unanchored-fallback", "canonical-default-proportions"], fabricationCandidate: true, exportAllowed: true },
    parser: [{ literal: "two", subject: "ambiguous", axis: null, targetId: "organization", marker: "not-measurement", active: false, findingCode: null }]
  },
  {
    id: "unsupported-angled-phone-stand",
    brief: "Make an angled phone stand with a required sloped support face.",
    referenceCount: 1,
    baselineBehavior: "concept-only",
    advancedSizing: null,
    expected: { outcome: "concept-only", findingCodes: ["MANDATORY_REQUIREMENT_UNSUPPORTED"], access: "front-panel", canonicalSpaces: 0, mechanism: "rigid", sizingSources: [], fabricationCandidate: false, exportAllowed: false },
    parser: []
  },
  {
    id: "unsupported-freeform-compound-motion",
    brief: "Make a freeform automaton with two independently moving curved panels.",
    referenceCount: 3,
    baselineBehavior: "concept-only",
    advancedSizing: null,
    expected: { outcome: "concept-only", findingCodes: ["COMPOUND_MOTION_UNSUPPORTED", "MANDATORY_REQUIREMENT_UNSUPPORTED"], access: "front-panel", canonicalSpaces: 0, mechanism: "rigid", sizingSources: [], fabricationCandidate: false, exportAllowed: false },
    parser: [{ literal: "two", subject: "ambiguous", axis: null, targetId: "moving-panels", marker: "not-measurement", active: false, findingCode: null }]
  },
  {
    id: "deliberate-search-budget-exhaustion",
    brief: "Exercise the deterministic planner with the registered adversarial test budget.",
    referenceCount: 0,
    baselineBehavior: "rigid",
    advancedSizing: null,
    expected: { outcome: "failure", findingCodes: ["SEARCH_BUDGET_EXHAUSTED"], access: "open-top", canonicalSpaces: 1, mechanism: "rigid", sizingSources: ["unanchored-fallback", "canonical-default-proportions"], fabricationCandidate: false, exportAllowed: false },
    parser: []
  }
] as const satisfies readonly FrozenConstructionCase[];

export const FROZEN_LIVE_DIVERSITY_COHORT = [
  {
    id: "long-pencil-enclosure",
    brief: "Make a long, narrow covered enclosure for six standard pencils.",
    expectedFieldOpportunities: { proportions: ["project-width-to-depth"], counts: [], scaleEvidence: ["contained-pencils"], access: [] },
    comparisonChannels: ["dimensions"],
    directionalPredicate: "width/depth >= 2.0",
    materialDifferencePredicate: "width/depth differs from M6.2 by at least 20% and direction is long/narrow",
    expectedOutcome: "supported"
  },
  {
    id: "flat-wide-tray",
    brief: "Make a flat, wide open-top tray for my desk.",
    expectedFieldOpportunities: { proportions: ["project-width-to-height"], counts: [], scaleEvidence: [], access: [] },
    comparisonChannels: ["dimensions"],
    directionalPredicate: "width/height >= 3.0",
    materialDifferencePredicate: "width/height differs from M6.2 by at least 20% and direction is flat/wide",
    expectedOutcome: "supported"
  },
  {
    id: "tall-narrow-container",
    brief: "Make a tall, narrow open-top container for paint brushes.",
    expectedFieldOpportunities: { proportions: ["project-height-to-width"], counts: [], scaleEvidence: [], access: [] },
    comparisonChannels: ["dimensions"],
    directionalPredicate: "height/width >= 1.4",
    materialDifferencePredicate: "height/width differs from M6.2 by at least 20% and direction is tall/narrow",
    expectedOutcome: "supported"
  },
  {
    id: "four-sd-card-compartments",
    brief: "Make an open-top organizer with four compartments for SD cards.",
    expectedFieldOpportunities: { proportions: [], counts: ["desired-compartment-count"], scaleEvidence: ["contained-sd-cards"], access: [] },
    comparisonChannels: ["topology"],
    directionalPredicate: "canonical-space-count == 4",
    materialDifferencePredicate: "space count and divider partition graph realize four compartments",
    expectedOutcome: "supported"
  },
  {
    id: "open-front-cubby",
    brief: "Make an open-front cubby for a small notebook.",
    expectedFieldOpportunities: { proportions: [], counts: [], scaleEvidence: [], access: ["open-front"] },
    comparisonChannels: ["topology"],
    directionalPredicate: "opening face == front",
    materialDifferencePredicate: "front opening differs from the M6.2 closed-front shell",
    expectedOutcome: "supported"
  }
] as const;
