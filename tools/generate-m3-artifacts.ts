import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  buildMultiSheetProjectionBundle,
  canonicalDocumentHash,
  canonicalGeometryHash,
  certifyRevoluteTravel,
  measuredBasswoodProfile,
  nestPartsAcrossSheets,
  provisionalFabricationProfiles,
  renderSceneSvg,
  sha256,
  validateFabricationProjection,
  validateRetainedPinMechanism,
} from "../src/index.js";
import {
  RetainedPinConstructionError,
  assessRetainedPinProgram,
  compileRetainedPinProgram
} from "../src/operators/retained-pin-revolute.js";
import { createRetainedProgram } from "../src/ui/content/presets.js";
import {
  M3_FIXTURE_NAMES,
  compileM3Fixture,
  loadM3Fixture,
  m3FixtureProfiles,
  m3FixtureProgram
} from "../tests/helpers/m3-fixtures.js";

const outputDirectoryUrl = new URL("../artifacts/m3/", import.meta.url);
const goldenUrl = new URL("../tests/golden/m3-revolute-matrix.json", import.meta.url);

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isZero(value: number): boolean {
  return value === 0;
}

function sameString(left: string, right: string): boolean {
  return left === right;
}

function logicalLineCount(source: string): number {
  return source.split(/\r?\n/u).filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("//");
  }).length;
}

async function projectedFixture(name: (typeof M3_FIXTURE_NAMES)[number]) {
  const value = await compileM3Fixture(name);
  const artifacts = await buildMultiSheetProjectionBundle(
    value.document,
    nestPartsAcrossSheets(
      value.document.parts,
      value.profiles.machine,
      value.profiles.material,
      value.profiles.processRecipe,
      value.profiles.fabricationContext,
    ),
  );
  return {
    ...value,
    artifacts,
    geometryHash: await canonicalGeometryHash(value.document),
    documentHash: await canonicalDocumentHash(value.document),
    fabricationValidation: validateFabricationProjection(
      artifacts.bundle.fabrication,
      value.document.parts,
    )
  };
}

const named = await projectedFixture("hinged-lid-box");
const offFamily = await projectedFixture("hinged-flap");
const proofSource = await readFile(
  new URL("../src/validation/revolute-proof.ts", import.meta.url),
  "utf8",
);
const validatorSource = await readFile(
  new URL("../src/validation/revolute.ts", import.meta.url),
  "utf8",
);
const architectureReview = {
  schemaVersion: "1.0",
  milestone: "M3",
  trigger: "shared-motion-validation-approaches-500-logical-lines",
  measuredLogicalLines: {
    "src/validation/revolute-proof.ts": logicalLineCount(proofSource),
    "src/validation/revolute.ts": logicalLineCount(validatorSource)
  },
  decision: {
    status: "reviewed-retain-focused-modules",
    rationale: [
      "The proof engine is a pure operator-owned 2D section/angle-interval certifier; the canonical validator separately owns typed document findings.",
      "The implementation remains in two focused modules with no general swept-mesh machinery and the fixed six-case revolute golden is independently limited to five seconds.",
      "Further angle subdivision was rejected in favor of analytic conservative bounds and explicit tangent endpoint-contact certification."
    ],
    rejectedAlternatives: [
      "denser sampled animation as proof",
      "general swept-mesh collision engine",
      "unbounded recursive angle subdivision"
    ],
    futureBoundary: "A future prismatic operator must remain operator-owned and may reuse only narrow mathematical primitives after a new architecture review."
  },
  assertions: {
    reviewTriggerReached:
      logicalLineCount(proofSource) + logicalLineCount(validatorSource) >= 500,
    remainsTwoFocusedModules: true,
    denserSubdivisionRejected: true,
    generalSweptMeshRejected: true,
    goldenBudgetEnforcedByTest: true
  }
};

const axialStationConstraint = structuredClone(named.document.motionConstraints[0]!);
const collisionInterval = axialStationConstraint.revolute!.proofModel.sectionIntervals.find(
  (interval) => interval.movingPrimitiveIds.includes("moving-panel-section"),
)!;
const collisionRadians = 52.5 * Math.PI / 180;
const collisionCenter = {
  xUm: Math.round(50_000 * Math.cos(collisionRadians)),
  yUm: Math.round(50_000 * Math.sin(collisionRadians))
};
const seededAxialObstacle = {
  id: "seeded-axial-station-obstacle",
  ownerId: "rear-panel",
  behavior: "stationary" as const,
  axialStartUm: collisionInterval.axialStartUm,
  axialEndUm: collisionInterval.axialEndUm,
  polygon: [
    { xUm: collisionCenter.xUm - 1_200, yUm: collisionCenter.yUm - 1_200 },
    { xUm: collisionCenter.xUm + 1_200, yUm: collisionCenter.yUm - 1_200 },
    { xUm: collisionCenter.xUm + 1_200, yUm: collisionCenter.yUm + 1_200 },
    { xUm: collisionCenter.xUm - 1_200, yUm: collisionCenter.yUm + 1_200 }
  ]
};
axialStationConstraint.revolute!.proofModel.sectionPrimitives.push(seededAxialObstacle);
collisionInterval.stationaryPrimitiveIds.push(seededAxialObstacle.id);
const seededAxialStationProof = certifyRevoluteTravel(axialStationConstraint);

const midAngleConstraint = structuredClone(named.document.motionConstraints[0]!);
const midAngleIntervals = midAngleConstraint.revolute!.proofModel.sectionIntervals;
const seededMidAngleObstacle = {
  ...seededAxialObstacle,
  id: "seeded-mid-angle-obstacle",
  axialStartUm: midAngleIntervals[0]!.axialStartUm,
  axialEndUm: midAngleIntervals[midAngleIntervals.length - 1]!.axialEndUm
};
midAngleConstraint.revolute!.proofModel.sectionPrimitives.push(seededMidAngleObstacle);
for (const interval of midAngleIntervals) {
  interval.stationaryPrimitiveIds.push(seededMidAngleObstacle.id);
}
const seededMidAngleProof = certifyRevoluteTravel(midAngleConstraint);

const weakLigament = structuredClone(named.document);
weakLigament.motionConstraints[0]!.revolute!.stations[0]!.boreLigamentUm = 100;
const weakLigamentValidation = validateRetainedPinMechanism(weakLigament).validation;
const collapsedHole = structuredClone(named.document);
collapsedHole.resolvedInputs.machine.minimumFeatureMm = 3.1;
const collapsedHoleValidation = validateRetainedPinMechanism(collapsedHole).validation;
const zeroCompensatedClearance = structuredClone(named.document);
zeroCompensatedClearance.externalStock![0]!.stockProfile.measuredDiameterUm =
  zeroCompensatedClearance.motionConstraints[0]!.revolute!.boreDiameterUm;
const zeroCompensatedClearanceValidation = validateRetainedPinMechanism(
  zeroCompensatedClearance,
).validation;

const fallbackFixture = await loadM3Fixture("hinged-lid-box");
fallbackFixture.content.stationSpanMm = { start: 49, end: 71.5 };
const fallbackProfiles = m3FixtureProfiles(fallbackFixture);
const fallbackProgram = m3FixtureProgram(fallbackFixture, fallbackProfiles);
const [fallbackFirst, fallbackReplay] = await Promise.all([
  compileRetainedPinProgram(fallbackProgram, fallbackProfiles),
  compileRetainedPinProgram(fallbackProgram, fallbackProfiles)
]);
const impossibleFixture = await loadM3Fixture("hinged-lid-box");
impossibleFixture.content.stationSpanMm = { start: 53, end: 67 };
const impossibleProfiles = m3FixtureProfiles(impossibleFixture);
let noCandidate: RetainedPinConstructionError | null = null;
try {
  await compileRetainedPinProgram(
    m3FixtureProgram(impossibleFixture, impossibleProfiles),
    impossibleProfiles,
  );
} catch (error) {
  if (error instanceof RetainedPinConstructionError) {
    noCandidate = error;
  } else {
    throw error;
  }
}
if (noCandidate === null) {
  throw new Error("The seeded no-candidate construction case unexpectedly compiled.");
}
const fallbackFirstHash = await canonicalGeometryHash(fallbackFirst.document);
const fallbackReplayHash = await canonicalGeometryHash(fallbackReplay.document);

const conceptFixture = await loadM3Fixture("hinged-lid-box");
const conceptProfiles = m3FixtureProfiles(conceptFixture);
const conceptProgram = m3FixtureProgram(conceptFixture, conceptProfiles);
conceptProgram.mechanism.axis.direction = { x: 0, y: 1, z: 0 };
const conceptAssessment = assessRetainedPinProgram(conceptProgram);

const pinEditFixture = await loadM3Fixture("hinged-lid-box");
pinEditFixture.content.pin.measuredDiameterMm = 3.04;
pinEditFixture.content.pin.measuredMinimumDiameterMm = 3.04;
pinEditFixture.content.pin.measuredMaximumDiameterMm = 3.04;
const pinEditProfiles = m3FixtureProfiles(pinEditFixture);
const pinEdit = await compileRetainedPinProgram(
  createRetainedProgram(pinEditFixture.content, pinEditProfiles),
  pinEditProfiles,
);
const kerfEditFixture = await loadM3Fixture("hinged-lid-box");
const kerfEditProfiles = provisionalFabricationProfiles(
  measuredBasswoodProfile([3, 3, 3]),
  0.2,
  0.21,
);
const kerfEdit = await compileRetainedPinProgram(
  createRetainedProgram(kerfEditFixture.content, kerfEditProfiles),
  kerfEditProfiles,
);
const kerfEditArtifacts = await buildMultiSheetProjectionBundle(
  kerfEdit.document,
  nestPartsAcrossSheets(
    kerfEdit.document.parts,
    kerfEditProfiles.machine,
    kerfEditProfiles.material,
    kerfEditProfiles.processRecipe,
    kerfEditProfiles.fabricationContext,
  ),
);
const hashSeparation = {
  schemaVersion: "1.0",
  milestone: "M3",
  hashes: {
    baseline: {
      geometry: named.geometryHash,
      evaluated: named.documentHash
    },
    pinDiameterEdit: {
      geometry: await canonicalGeometryHash(pinEdit.document),
      evaluated: await canonicalDocumentHash(pinEdit.document)
    },
    directionalKerfEdit: {
      geometry: await canonicalGeometryHash(kerfEdit.document),
      evaluated: await canonicalDocumentHash(kerfEdit.document)
    }
  },
  assertions: {
    measuredPinChangesGeometry:
      named.geometryHash !== await canonicalGeometryHash(pinEdit.document),
    directionalKerfPreservesGeometry:
      named.geometryHash === await canonicalGeometryHash(kerfEdit.document),
    directionalKerfChangesEvaluation:
      named.documentHash !== await canonicalDocumentHash(kerfEdit.document),
    directionalKerfChangesSvg:
      JSON.stringify(named.artifacts.svgs) !== JSON.stringify(kerfEditArtifacts.svgs),
    networkCallsRemainZero:
      isZero(named.document.provenance.runtimeApplicationApiCalls) &&
      isZero(pinEdit.document.provenance.runtimeApplicationApiCalls) &&
      isZero(kerfEdit.document.provenance.runtimeApplicationApiCalls)
  }
};

const constructionSearch = {
  schemaVersion: "1.0",
  milestone: "M3",
  resolvedDeferralFrom: "M2.1",
  selected: fallbackFirst.document.constructionSelections?.[0],
  replayGeometryHashes: [fallbackFirstHash, fallbackReplayHash],
  noCandidate: {
    code: noCandidate.code,
    message: noCandidate.message,
    attempts: noCandidate.attempts,
    measuredInputs: noCandidate.measuredInputs
  },
  assertions: {
    preferredCandidateRejected:
      fallbackFirst.document.constructionSelections?.[0]?.attempts[0]?.status === "rejected",
    fallbackSelected:
      fallbackFirst.document.constructionSelections?.[0]?.selectedCandidateId === "three-station",
    replayStable: fallbackFirstHash === fallbackReplayHash,
    constructionDisclosed:
      fallbackFirst.document.constructionSelections?.[0]?.disclosure.includes(
        "without changing thickness, kerf, pin diameter",
      ) === true,
    measurementsPreserved:
      fallbackFirst.document.resolvedInputs.material.measuredThicknessMm === 3 &&
      fallbackFirst.document.externalStock?.[0]?.stockProfile.measuredDiameterUm === 3_000,
    noCandidateWithholdsExport:
      sameString(noCandidate.code, "RETAINED_PIN_CONSTRUCTION_UNAVAILABLE")
  }
};

const operatorProofs = [named, offFamily].map((item) => ({
  fixture: item.fixture.fixtureId,
  proofRole: item.fixture.proofRole,
  geometryHash: item.geometryHash,
  evaluatedDocumentHash: item.documentHash,
  operatorProgram: item.document.operatorProgram,
  selectedConstruction: item.document.constructionSelections?.[0],
  externalStock: item.document.externalStock,
  motionConstraint: item.document.motionConstraints[0],
  proof: item.proofReports[0],
  validation: item.document.validation,
  fabricationValidation: item.fabricationValidation,
  runtimeApplicationApiCalls: item.document.provenance.runtimeApplicationApiCalls
}));

const interferenceReport = {
  schemaVersion: "1.0",
  milestone: "M3",
  fixture: named.fixture.fixtureId,
  midAngleOnly: {
    seed: {
      nominalCenterAngleDegrees: 52.5,
      axialScope: "all-axis-intervals",
      obstacle: seededMidAngleObstacle
    },
    proof: seededMidAngleProof
  },
  axialStationOnly: {
    seed: {
      nominalCenterAngleDegrees: 52.5,
      axialIntervalId: collisionInterval.id,
      obstacle: seededAxialObstacle
    },
    proof: seededAxialStationProof
  },
  assertions: {
    midAngleFixtureFails: seededMidAngleProof.status === "fail",
    midAngleFixtureAvoidsEndpoints:
      seededMidAngleProof.collisions.length === midAngleIntervals.length &&
      seededMidAngleProof.collisions.every(
        (collision) => collision.angleDegrees > 0 && collision.angleDegrees < 105,
      ),
    midAngleFixtureCoversEveryAxialInterval:
      new Set(seededMidAngleProof.collisions.map((collision) => collision.axialIntervalId)).size ===
      midAngleIntervals.length,
    axialStationFixtureFails: seededAxialStationProof.status === "fail",
    oneAxialOnlyCollision: seededAxialStationProof.collisions.length === 1,
    correctInterval:
      seededAxialStationProof.collisions[0]?.axialIntervalId === collisionInterval.id,
    seededProofsRemainDeterminate:
      seededMidAngleProof.indeterminatePairs.length === 0 &&
      seededAxialStationProof.indeterminatePairs.length === 0
  }
};

const negativeValidation = {
  schemaVersion: "1.0",
  milestone: "M3",
  boreLigament: weakLigamentValidation,
  compensatedHoleSurvival: collapsedHoleValidation,
  compensatedRunningClearance: zeroCompensatedClearanceValidation,
  unsupportedAxis: conceptAssessment,
  assertions: {
    ligamentBlocked: weakLigamentValidation.findings.some(
      (finding) => finding.code === "HINGE_BORE_LIGAMENT_FAILURE" && finding.blocksExport,
    ),
    compensatedHoleBlocked: collapsedHoleValidation.findings.some(
      (finding) => finding.code === "HINGE_COMPENSATED_HOLE_SURVIVAL_FAILURE" && finding.blocksExport,
    ),
    compensatedRunningClearanceBlocked: zeroCompensatedClearanceValidation.findings.some(
      (finding) =>
        finding.code === "ROTATING_COMPENSATED_CLEARANCE_FAILURE" && finding.blocksExport,
    ),
    outsideAssumptionIsConceptOnly: conceptAssessment.status === "concept-only"
  }
};

for (const report of [
  hashSeparation.assertions,
  constructionSearch.assertions,
  interferenceReport.assertions,
  negativeValidation.assertions,
  architectureReview.assertions
]) {
  if (Object.values(report).some((value) => !value)) {
    throw new Error("An M3 acceptance assertion failed during artifact generation.");
  }
}

const files = new Map<string, string>([
  ["named/program.json", json(named.program)],
  ["named/project.json", json(named.document)],
  ["named/projection-bundle.json", json(named.artifacts.bundle)],
  ["named/assembled.svg", renderSceneSvg(named.artifacts.bundle.scene, "assembled")],
  ["named/open.svg", renderSceneSvg(named.artifacts.bundle.scene, "open")],
  ["named/exploded.svg", renderSceneSvg(named.artifacts.bundle.scene, "exploded")],
  ["off-family/program.json", json(offFamily.program)],
  ["off-family/project.json", json(offFamily.document)],
  ["off-family/projection-bundle.json", json(offFamily.artifacts.bundle)],
  ["off-family/assembled.svg", renderSceneSvg(offFamily.artifacts.bundle.scene, "assembled")],
  ["off-family/open.svg", renderSceneSvg(offFamily.artifacts.bundle.scene, "open")],
  ["off-family/exploded.svg", renderSceneSvg(offFamily.artifacts.bundle.scene, "exploded")],
  ["proofs/operator-proof-reports.json", json({
    schemaVersion: "1.0",
    milestone: "M3",
    proofs: operatorProofs
  })],
  ["proofs/seeded-interference.json", json(interferenceReport)],
  ["proofs/negative-validation.json", json(negativeValidation)],
  ["proofs/construction-search.json", json(constructionSearch)],
  ["proofs/hash-separation.json", json(hashSeparation)],
  ["proofs/motion-architecture-review.json", json(architectureReview)],
  ["golden-matrix.json", await readFile(goldenUrl, "utf8")],
  ["validation.json", json({
    schemaVersion: "1.0",
    milestone: "M3",
    named: {
      canonical: named.document.validation,
      fabrication: named.fabricationValidation,
      motion: named.proofReports[0]
    },
    offFamily: {
      canonical: offFamily.document.validation,
      fabrication: offFamily.fabricationValidation,
      motion: offFamily.proofReports[0]
    }
  })],
  ["generation-report.json", json({
    schemaVersion: "1.0",
    milestone: "M3",
    generator: { id: "m3-artifact-generator", version: "1.0.0" },
    geometryHashes: {
      named: named.geometryHash,
      offFamily: offFamily.geometryHash
    },
    evaluatedDocumentHashes: {
      named: named.documentHash,
      offFamily: offFamily.documentHash
    },
    runtimeApplicationApiCalls: 0,
    modelId: null,
    promptVersion: null,
    tokenUsage: null,
    latencyMs: null,
    estimatedCostUsd: 0,
    validation: {
      namedCanonical: named.document.validation.status,
      namedFabrication: named.fabricationValidation.status,
      namedMotion: named.proofReports[0]?.status,
      offFamilyCanonical: offFamily.document.validation.status,
      offFamilyFabrication: offFamily.fabricationValidation.status,
      offFamilyMotion: offFamily.proofReports[0]?.status,
      seededMidAngleInterference: seededMidAngleProof.status,
      seededAxialStationInterference: seededAxialStationProof.status,
      constructionSearchDeferral: "resolved"
    },
    physicalVerification: {
      state: "required",
      performed: false,
      fixtureCut: false,
      assemblyBuilt: false,
      motionTested: false
    },
    claim: "software-validated retained-pin moving-assembly fabrication candidate",
    limitations: [
      "No material has been cut, assembled, or cycled.",
      "Measured wooden pin diameter and straightness remain user-reported inputs; no stock supplier or nominal diameter is guaranteed.",
      "The conservative motion proof is bounded to the registered positive-X axis/section assumptions and is not a general swept-mesh engine.",
      "No xTool Studio import has been performed.",
      "Fit, strength, durability, retention under load, motion quality, and machine compatibility remain physically unverified."
    ]
  })]
]);
for (const item of named.artifacts.svgs) {
  files.set(`named/${item.sheetId}.svg`, item.svg);
}
for (const item of offFamily.artifacts.svgs) {
  files.set(`off-family/${item.sheetId}.svg`, item.svg);
}

await mkdir(outputDirectoryUrl, { recursive: true });
for (const [relativePath, contents] of files) {
  const url = new URL(relativePath, outputDirectoryUrl);
  await mkdir(new URL("./", url), { recursive: true });
  await writeFile(url, contents, "utf8");
}
const artifactEntries = await Promise.all(
  [...files.entries()].map(async ([path, contents]) => ({
    path,
    bytes: new TextEncoder().encode(contents).byteLength,
    sha256: await sha256(contents)
  })),
);
await writeFile(
  new URL("artifact-manifest.json", outputDirectoryUrl),
  json({
    schemaVersion: "1.0",
    milestone: "M3",
    generator: { id: "m3-artifact-generator", version: "1.0.0" },
    geometryHashes: {
      named: named.geometryHash,
      offFamily: offFamily.geometryHash
    },
    evaluatedDocumentHashes: {
      named: named.documentHash,
      offFamily: offFamily.documentHash
    },
    runtimeApplicationApiCalls: 0,
    physicalVerification: "required",
    artifacts: artifactEntries
  }),
  "utf8",
);

process.stdout.write(
  `Generated ${String(artifactEntries.length)} M3 artifacts for named ${named.geometryHash} and off-family ${offFamily.geometryHash}.\n`,
);
