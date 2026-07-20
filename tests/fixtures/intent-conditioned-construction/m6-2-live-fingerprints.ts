import type {
  ResolvedDimensionFingerprint,
  SemanticTopologyFingerprint
} from "../../../src/evaluation/semantic-diversity.js";

export const M6_2_COMPARISON_BASELINE_REPORT_SHA256 =
  "52b1f25a1130c6bfaab29c59736a760a2b843f729b11548af3b440f19810b721" as const;

const UNIVERSAL_DIMENSIONS = {
  widthMm: 120,
  depthMm: 90,
  heightMm: 58
} as const satisfies ResolvedDimensionFingerprint;

const UNIVERSAL_TOPOLOGY = {
  constructionBodyRoles: ["enclosure", "support"],
  openingFaces: ["top"],
  usableSpaceCount: 1,
  dividerPartitionGraph: [],
  closureMechanism: "none"
} as const satisfies SemanticTopologyFingerprint;

export const M6_2_LIVE_COMPARISON_FINGERPRINTS = {
  "long-pencil-enclosure": {
    dimensions: UNIVERSAL_DIMENSIONS,
    topology: UNIVERSAL_TOPOLOGY,
    geometryHash: "b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5",
    sourceDocumentHash: "362040b8c9434bd423caac80e5247c03c5878b89f1b55d80b0738ff9063f85fc"
  },
  "flat-wide-tray": {
    dimensions: UNIVERSAL_DIMENSIONS,
    topology: UNIVERSAL_TOPOLOGY,
    geometryHash: "b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5",
    sourceDocumentHash: "1bf13e643f64f6b2f08dfcaa217a9470f4ffcc16808ad2fc4f6f733ac09c5d80"
  },
  "tall-narrow-container": {
    dimensions: UNIVERSAL_DIMENSIONS,
    topology: UNIVERSAL_TOPOLOGY,
    geometryHash: "b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5",
    sourceDocumentHash: "2ef158908bb7031d9801e7bb3d49e732a862dbefcd9c0a56412a0c09617c4015"
  },
  "four-sd-card-compartments": {
    dimensions: UNIVERSAL_DIMENSIONS,
    topology: UNIVERSAL_TOPOLOGY,
    geometryHash: "b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5",
    sourceDocumentHash: "3a81e55d973564c0e45a67f199847c0c3888c021f486eb05724e5502aab15e41"
  },
  "open-front-cubby": {
    dimensions: UNIVERSAL_DIMENSIONS,
    topology: UNIVERSAL_TOPOLOGY,
    geometryHash: "b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5",
    sourceDocumentHash: "538f2bc1fcd8180c8583f95caa8c884be958adc7f33a18190196a253d0af6aaf"
  }
} as const;
