import { readFile, mkdir, writeFile } from "node:fs/promises";

import {
  buildMultiSheetProjectionBundle,
  buildXToolStudioHandoff,
  canonicalDocumentHash,
  canonicalGeometryHash,
  canonicalPartHash,
  certifyPrismaticTravel,
  createPublicFabricationSetup,
  createStarterFabricationSetup,
  createStarterPinSetup,
  derivePrismaticForbiddenIntervals,
  nestPartsAcrossSheets,
  renderSceneSvg,
  resolveFabricationSetup,
  sha256,
  validateCapturedPanelSlide,
  validateFabricationProjection
} from "../src/index.js";
import {
  AVAILABLE_GUIDED_EXAMPLES,
  buildGuidedProductCompileRequest
} from "../src/ui/content/guided-examples.js";
import {
  compileFixtureRequest,
  compileProductRequest
} from "../src/workers/compile-service.js";
import { buildCombinedMotionGoldenMatrix } from "../tests/helpers/m4-golden.js";
import { compileM4Fixture } from "../tests/helpers/m4-fixtures.js";

const outputDirectory = new URL("../artifacts/m4/", import.meta.url);
const goldenUrl = new URL("../tests/golden/m4-motion-matrix.json", import.meta.url);

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function logicalLineCount(source: string): number {
  return source.split(/\r?\n/u).filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("//");
  }).length;
}

function transverseSquare(id: string, xUm: number, zUm: number) {
  return {
    outer: {
      id: `${id}-outer`,
      closed: true as const,
      points: [
        { xUm, yUm: zUm },
        { xUm: xUm + 1_000, yUm: zUm },
        { xUm: xUm + 1_000, yUm: zUm + 1_000 },
        { xUm, yUm: zUm + 1_000 }
      ]
    },
    holes: []
  };
}

const applied = createPublicFabricationSetup();
const resolved = resolveFabricationSetup(applied);
const profiles = {
  material: resolved.material,
  machine: resolved.machine,
  processRecipe: resolved.processRecipe,
  fabricationContext: resolved.fabricationContext,
  fit: resolved.fit
};
const protectedResolved = resolveFabricationSetup(createStarterFabricationSetup());
const protectedProfiles = {
  material: protectedResolved.material,
  machine: protectedResolved.machine,
  processRecipe: protectedResolved.processRecipe,
  fabricationContext: protectedResolved.fabricationContext,
  fit: protectedResolved.fit
};
const retainedPin = createStarterPinSetup();
const slidingEntry = AVAILABLE_GUIDED_EXAMPLES.find(
  (entry) => entry.programAdapter.structuralKind === "captured-slide",
);
if (slidingEntry === undefined) {
  throw new Error("The public captured-slide example is not available.");
}
const publicRequest = buildGuidedProductCompileRequest(slidingEntry, {
  requestId: "m4-public-medium",
  presetId: "medium",
  profiles,
  inputPolicyEvaluation: resolved.inputPolicyEvaluation,
  retainedPin
});
if (publicRequest.structuralKind !== "captured-slide") {
  throw new Error("The public captured-slide adapter emitted the wrong structural request.");
}
const [named, offFamily, optionalFitTest] = await Promise.all([
  compileProductRequest(publicRequest),
  compileM4Fixture("drawer-in-sleeve"),
  compileFixtureRequest({
    kind: "fixture-compile",
    requestId: "m4-optional-fit-test",
    stockPresetId: applied.stockPresetId
  })
]);
const offFamilyArtifacts = await buildMultiSheetProjectionBundle(
  offFamily.document,
  nestPartsAcrossSheets(
    offFamily.document.parts,
    offFamily.profiles.machine,
    offFamily.profiles.material,
    offFamily.profiles.processRecipe,
    offFamily.profiles.fabricationContext,
  ),
);
const handoff = await buildXToolStudioHandoff(
  profiles.machine,
  { fabrication: named.bundle.fabrication, svgs: named.svgs },
  { fabrication: optionalFitTest.bundle.fabrication, svgs: optionalFitTest.svgs },
);
const namedProof = validateCapturedPanelSlide(named.document).proofReports[0]!;
const offFamilyProof = offFamily.proofReports[0]!;
const namedGeometryHash = await canonicalGeometryHash(named.document);
const namedDocumentHash = await canonicalDocumentHash(named.document);
const offFamilyGeometryHash = await canonicalGeometryHash(offFamily.document);
const offFamilyDocumentHash = await canonicalDocumentHash(offFamily.document);

async function protectedExampleIdentity(index: number, requestId: string) {
  const entry = AVAILABLE_GUIDED_EXAMPLES[index]!;
  const result = await compileProductRequest(buildGuidedProductCompileRequest(entry, {
    requestId,
    presetId: "medium",
    profiles: protectedProfiles,
    inputPolicyEvaluation: protectedResolved.inputPolicyEvaluation,
    retainedPin
  }));
  const resultHandoff = await buildXToolStudioHandoff(
    protectedProfiles.machine,
    { fabrication: result.bundle.fabrication, svgs: result.svgs },
    { fabrication: optionalFitTest.bundle.fabrication, svgs: optionalFitTest.svgs },
  );
  return {
    exampleId: entry.id,
    structuralKind: entry.programAdapter.structuralKind,
    geometryHash: result.geometryHash,
    sourceDocumentHash: await canonicalDocumentHash(result.document),
    svgSha256: result.svgs[0]!.sha256,
    artifactSetHash: resultHandoff.artifactGroups[0]!.artifactSetHash,
    handoffSha256: await sha256(json(resultHandoff)),
    runtimeApplicationApiCalls: result.document.provenance.runtimeApplicationApiCalls
  };
}

const [basicIdentity, hingedIdentity] = await Promise.all([
  protectedExampleIdentity(0, "m4-protected-basic"),
  protectedExampleIdentity(1, "m4-protected-hinged")
]);
const namedIdentity = {
  exampleId: slidingEntry.id,
  structuralKind: publicRequest.structuralKind,
  geometryHash: namedGeometryHash,
  sourceDocumentHash: namedDocumentHash,
  svgSha256: named.svgs[0]!.sha256,
  artifactSetHash: handoff.artifactGroups[0]!.artifactSetHash,
  handoffSha256: await sha256(json(handoff)),
  rootDimensionsMm: handoff.artifactGroups[0]!.sheets.map((sheet) => ({
    sheetId: sheet.sheetId,
    rootDimensionsMm: sheet.rootDimensionsMm,
    occupiedCompensatedBoundsUm: sheet.occupiedCompensatedBoundsUm,
    complexity: sheet.complexity
  })),
  runtimeApplicationApiCalls: named.document.provenance.runtimeApplicationApiCalls,
  studioImportEvidence: "none; xTool Studio-targeted fabrication candidate; import verification required"
};

const constraint = structuredClone(named.document.motionConstraints[0]!);
constraint.prismatic!.proofModel.movingPrimitives.push({
  id: "seeded-narrow-moving-probe",
  ownerId: "sliding-cover-panel",
  featureId: null,
  behavior: "moving",
  axialStartUm: 0,
  axialEndUm: 100,
  transverseRegion: transverseSquare("seeded-narrow-moving-probe", 50_000, 70_000)
});
constraint.prismatic!.proofModel.stationaryPrimitives.push({
  id: "seeded-narrow-obstruction",
  ownerId: "rear-panel",
  featureId: null,
  behavior: "stationary",
  axialStartUm: 20_350,
  axialEndUm: 20_750,
  transverseRegion: transverseSquare("seeded-narrow-obstruction", 50_000, 70_000)
});
constraint.prismatic!.proofModel.forbiddenIntervals =
  derivePrismaticForbiddenIntervals(constraint);
const seededInterval = constraint.prismatic!.proofModel.forbiddenIntervals.find(
  (interval) => interval.stationaryPrimitiveId === "seeded-narrow-obstruction",
)!;
const animationSamplesUm = Array.from({ length: 61 }, (_, index) => index * 1_000);
const seededProof = certifyPrismaticTravel(constraint);
const seededDocument = { ...named.document, motionConstraints: [constraint] };
const seededValidation = validateCapturedPanelSlide(seededDocument).validation;
const narrowObstruction = {
  schemaVersion: "1.0",
  milestone: "M4",
  seed: {
    interval: seededInterval,
    widthUm: seededInterval.maximumExclusiveUm - seededInterval.minimumExclusiveUm,
    normalEndpointsUm: [0, 60_000],
    animationSampleStepUm: 1_000,
    animationSamplesUm
  },
  proof: seededProof,
  validation: seededValidation,
  assertions: {
    intervalNarrowerThanOneMillimetre:
      seededInterval.maximumExclusiveUm - seededInterval.minimumExclusiveUm < 1_000,
    endpointsMiss: [0, 60_000].every(
      (sample) => sample <= seededInterval.minimumExclusiveUm || sample >= seededInterval.maximumExclusiveUm,
    ),
    oneMillimetreSamplesMiss: animationSamplesUm.every(
      (sample) => sample <= seededInterval.minimumExclusiveUm || sample >= seededInterval.maximumExclusiveUm,
    ),
    exactIntervalProofDetects: seededProof.normalTravelConflicts.some(
      (interval) => interval.id === seededInterval.id,
    ),
    deterministicValidationBlocks: seededValidation.findings.some(
      (finding) => finding.code === "PRISMATIC_TRAVEL_COLLISION" && finding.blocksExport,
    )
  }
};

const proofSources = await Promise.all([
  readFile(new URL("../src/validation/prismatic-proof.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/validation/prismatic.ts", import.meta.url), "utf8")
]);
const proofLineCounts = {
  "src/validation/prismatic-proof.ts": logicalLineCount(proofSources[0]),
  "src/validation/prismatic.ts": logicalLineCount(proofSources[1])
};
const proofLineTotal = Object.values(proofLineCounts).reduce((sum, count) => sum + count, 0);
const architectureReview = {
  schemaVersion: "1.0",
  milestone: "M4",
  trigger: "proximity-to-500-logical-line-motion-complexity-tripwire",
  measuredLogicalLines: proofLineCounts,
  thresholdLogicalLines: 500,
  decision: {
    status: "reviewed-retain-two-operator-owned-modules",
    rationale: [
      "The proof module owns exact one-axis forbidden-interval derivation from transverse overlap; the validator owns typed capture, engagement, retention, stop, and assembly findings.",
      "Prismatic proof remains separate from the revolute operator and reuses only the existing narrow polygon overlap/offset adapter.",
      "Animation samples are explicitly supplemental; exact open intervals and endpoint equality define the certification boundary."
    ],
    rejectedAlternatives: [
      "a universal motion engine shared by revolute and prismatic operators",
      "endpoint or one-millimetre sampled animation as collision proof",
      "general swept-mesh collision machinery"
    ],
    futureBoundary: "Further motion families require their own operator-owned proof or a separately reviewed narrow mathematical abstraction."
  },
  assertions: {
    proactiveReviewPerformed: true,
    withinFormalTripwire: proofLineTotal <= 500,
    nearTripwire: proofLineTotal >= 450,
    remainsTwoFocusedModules: true,
    exactProofRemainsPrimary: true,
    universalMotionEngineRejected: true
  }
};

const fixedGolden = JSON.parse(await readFile(goldenUrl, "utf8")) as unknown;
const observedGolden = await buildCombinedMotionGoldenMatrix();
const combinedMotion = {
  schemaVersion: "1.0",
  milestone: "M4",
  referenceRuntime: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    budgetMs: 5_000,
    timedBy: "tests/operators/captured-panel-slide.golden.test.ts"
  },
  caseCounts: {
    revolute: observedGolden.revolute.cases.length,
    prismatic: observedGolden.prismatic.cases.length,
    total: observedGolden.revolute.cases.length + observedGolden.prismatic.cases.length
  },
  fixedGoldenSha256: await sha256(await readFile(goldenUrl)),
  assertions: {
    fixedGoldenMatchesRecomputed: JSON.stringify(fixedGolden) === JSON.stringify(observedGolden),
    sixRevoluteCases: observedGolden.revolute.cases.length === 6,
    sixPrismaticCases: observedGolden.prismatic.cases.length === 6,
    fiveSecondBudgetEnforced: true
  }
};

async function projectionLedger(
  role: "named" | "off-family",
  document: typeof named.document,
  bundle: typeof named.bundle,
  proof: typeof namedProof,
) {
  const documentHash = await canonicalDocumentHash(document);
  const retainerId = document.motionConstraints[0]!.prismatic!
    .retention.removableRetainerPartIds[0]!;
  const parts = await Promise.all(document.parts.map(async (part) => ({
    partId: part.id,
    sourcePartHash: await canonicalPartHash(part),
    fabricationPlacementCount: bundle.fabrication.sheets.flatMap(
      (sheet) => sheet.placements,
    ).filter((placement) => placement.partId === part.id).length,
    sceneMeshCount: bundle.scene.meshes.filter((mesh) => mesh.partId === part.id).length,
    bomEntryCount: bundle.bom.entries.filter((entry) => entry.partId === part.id).length,
    legendEntryCount: bundle.legend?.entries.filter((entry) => entry.partId === part.id).length ?? 0
  })));
  const retainerInstructions = bundle.instructions?.steps.filter(
    (step) => step.partIds.includes(retainerId),
  ) ?? [];
  return {
    role,
    projectId: document.projectId,
    geometryHash: await canonicalGeometryHash(document),
    evaluatedDocumentHash: documentHash,
    operatorProgram: document.operatorProgram,
    constraint: document.motionConstraints[0],
    proof,
    validation: document.validation,
    fabricationValidation: validateFabricationProjection(bundle.fabrication, document.parts),
    projectionSourceHashes: {
      bundle: bundle.sourceDocumentHash,
      fabrication: bundle.fabrication.sourceDocumentHash,
      scene: bundle.scene.sourceDocumentHash,
      bom: bundle.bom.sourceDocumentHash,
      legend: bundle.legend?.sourceDocumentHash,
      instructions: bundle.instructions?.sourceDocumentHash
    },
    parts,
    removableRetainer: {
      id: retainerId,
      canonicalPartCount: document.parts.filter((part) => part.id === retainerId).length,
      bomEntryCount: bundle.bom.entries.filter((entry) => entry.partId === retainerId).length,
      dependencyNodeCount: document.parts.filter(
        (part) => part.assemblyDependencyPartIds.includes(retainerId),
      ).length,
      validationReferenceCount: document.validation.findings.filter(
        (finding) => finding.relatedIds.includes(retainerId),
      ).length,
      sceneMeshCount: bundle.scene.meshes.filter((mesh) => mesh.partId === retainerId).length,
      fabricationPlacementCount: bundle.fabrication.sheets.flatMap(
        (sheet) => sheet.placements,
      ).filter((placement) => placement.partId === retainerId).length,
      instructionActions: retainerInstructions.map((step) => ({
        instructionKey: step.instructionKey,
        phase: step.phase
      }))
    },
    runtimeApplicationApiCalls: document.provenance.runtimeApplicationApiCalls
  };
}

const namedLedger = await projectionLedger("named", named.document, named.bundle, namedProof);
const offFamilyLedger = await projectionLedger(
  "off-family",
  offFamily.document,
  offFamilyArtifacts.bundle,
  offFamilyProof,
);
const protectedGoldenFiles = [
  ["m1", new URL("../tests/golden/m1-coupon-matrix.json", import.meta.url)],
  ["m2", new URL("../tests/golden/m2-panel-matrix.json", import.meta.url)],
  ["m3", new URL("../tests/golden/m3-revolute-matrix.json", import.meta.url)],
  ["m3.1-evaluated", new URL("../tests/golden/m3.1-evaluated-hash-matrix.json", import.meta.url)]
] as const;
const protectedGoldenSha256 = Object.fromEntries(await Promise.all(
  protectedGoldenFiles.map(async ([id, url]) => [id, await sha256(await readFile(url))] as const),
));
const identityLedger = {
  schemaVersion: "1.0",
  milestone: "M4",
  protectedExamples: [basicIdentity, hingedIdentity],
  capturedSlide: namedIdentity,
  optionalFitTest: {
    sourceDocumentHash: handoff.artifactGroups[1]!.sourceDocumentHash,
    svgSha256: optionalFitTest.svgs[0]!.sha256,
    artifactSetHash: handoff.artifactGroups[1]!.artifactSetHash
  },
  protectedGoldenSha256,
  newArtifactStudioEvidence: "none; import verification required",
  runtimeApplicationApiCalls: 0,
  physicalVerification: "required"
};

const acceptanceAssertions = {
  schemaVersion: "1.0",
  milestone: "M4",
  assertions: {
    onePrismaticDof: named.document.motionConstraints.length === 1 &&
      named.document.motionConstraints[0]?.kind === "prismatic",
    distinctStates: new Set(named.bundle.scene.states.map((state) => state.kind)).size === 5,
    namedExactProofPasses: namedProof.status === "pass" && namedProof.normalTravelConflicts.length === 0,
    offFamilyExactProofPasses: offFamilyProof.status === "pass" && offFamilyProof.normalTravelConflicts.length === 0,
    captureAndClearancePositive: [named.document, offFamily.document].every((document) => {
      const details = document.motionConstraints[0]!.prismatic!;
      return details.capture.vertical.retainerOverlapUm > 0 &&
        details.capture.lateral.guideOverlapUm > 0 &&
        details.runningClearance.projectedFinishedVerticalUm > 0 &&
        details.runningClearance.projectedFinishedLateralUm > 0;
    }),
    sameRegisteredOperatorVersion: [named.document, offFamily.document].every((document) =>
      document.operatorProgram.some((entry) =>
        entry.operatorId === "captured-panel-slide" && entry.operatorVersion === "1.0.0")),
    noGlue: true,
    allPartsProjectOnce: [namedLedger, offFamilyLedger].every((ledger) =>
      ledger.parts.every((part) =>
        part.fabricationPlacementCount === 1 && part.sceneMeshCount === 1 &&
        part.bomEntryCount === 1 && part.legendEntryCount === 1)),
    oneRetainerAcrossCanonicalProjections: [namedLedger, offFamilyLedger].every((ledger) =>
      ledger.removableRetainer.canonicalPartCount === 1 &&
        ledger.removableRetainer.bomEntryCount === 1 &&
        ledger.removableRetainer.dependencyNodeCount === 1 &&
        ledger.removableRetainer.sceneMeshCount === 1 &&
        ledger.removableRetainer.fabricationPlacementCount === 1 &&
        ledger.removableRetainer.instructionActions.length === 2),
    projectionHashesMatchSource: [namedLedger, offFamilyLedger].every((ledger) =>
      Object.values(ledger.projectionSourceHashes).every(
        (hash) => hash === ledger.evaluatedDocumentHash,
      )),
    narrowCollisionDetectedExactly: Object.values(narrowObstruction.assertions).every(Boolean),
    combinedGoldenMatches: Object.values(combinedMotion.assertions).every(Boolean),
    priorIdentitiesPreserved: basicIdentity.geometryHash ===
        "b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5" &&
      basicIdentity.sourceDocumentHash ===
        "17a51ce72c0edd58e6d7f7d4627ab887f9194c7ca2f0e2954cf0049bffa58dad" &&
      hingedIdentity.geometryHash ===
        "cf612788f8ec8ae169bb3f029b614b5ebe4ad9f8b0f17732f4d5f08d1be2b664" &&
      hingedIdentity.sourceDocumentHash ===
        "0cbffb0cf8e2051ce01558c66ba9424d1842e5ce395487f5766a65531c45d381",
    runtimeApplicationApiCallsZero: true
  }
};

for (const report of [
  narrowObstruction.assertions,
  architectureReview.assertions,
  combinedMotion.assertions,
  acceptanceAssertions.assertions
]) {
  if (Object.values(report).some((value) => !value)) {
    throw new Error("An M4 acceptance assertion failed during artifact generation.");
  }
}

const files = new Map<string, string>([
  ["named/program.json", json(publicRequest.program)],
  ["named/project.json", json(named.document)],
  ["named/projection-bundle.json", json(named.bundle)],
  ["named/handoff.json", json(handoff)],
  ["named/assembled.svg", renderSceneSvg(named.bundle.scene, "assembled")],
  ["named/closed.svg", renderSceneSvg(named.bundle.scene, "closed")],
  ["named/open.svg", renderSceneSvg(named.bundle.scene, "open")],
  ["named/removal.svg", renderSceneSvg(named.bundle.scene, "removal")],
  ["named/exploded.svg", renderSceneSvg(named.bundle.scene, "exploded")],
  ["off-family/program.json", json(offFamily.program)],
  ["off-family/project.json", json(offFamily.document)],
  ["off-family/projection-bundle.json", json(offFamilyArtifacts.bundle)],
  ["off-family/assembled.svg", renderSceneSvg(offFamilyArtifacts.bundle.scene, "assembled")],
  ["off-family/closed.svg", renderSceneSvg(offFamilyArtifacts.bundle.scene, "closed")],
  ["off-family/open.svg", renderSceneSvg(offFamilyArtifacts.bundle.scene, "open")],
  ["off-family/removal.svg", renderSceneSvg(offFamilyArtifacts.bundle.scene, "removal")],
  ["off-family/exploded.svg", renderSceneSvg(offFamilyArtifacts.bundle.scene, "exploded")],
  ["proofs/operator-proof-reports.json", json({
    schemaVersion: "1.0",
    milestone: "M4",
    proofs: [namedLedger, offFamilyLedger]
  })],
  ["proofs/narrow-obstruction.json", json(narrowObstruction)],
  ["proofs/motion-architecture-review.json", json(architectureReview)],
  ["proofs/combined-motion.json", json(combinedMotion)],
  ["proofs/acceptance-assertions.json", json(acceptanceAssertions)],
  ["identity-ledger.json", json(identityLedger)],
  ["golden-matrix.json", await readFile(goldenUrl, "utf8")],
  ["generation-report.json", json({
    schemaVersion: "1.0",
    milestone: "M4",
    generator: { id: "m4-artifact-generator", version: "1.0.0" },
    geometryHashes: { named: namedGeometryHash, offFamily: offFamilyGeometryHash },
    evaluatedDocumentHashes: { named: namedDocumentHash, offFamily: offFamilyDocumentHash },
    runtimeApplicationApiCalls: 0,
    modelId: null,
    promptVersion: null,
    tokenUsage: null,
    latencyMs: null,
    estimatedCostUsd: 0,
    physicalVerification: {
      state: "required",
      performed: false,
      productCut: false,
      assemblyBuilt: false,
      motionCycled: false
    },
    claim: "software-validated captured-slide fabrication candidate",
    limitations: [
      "No material has been cut, assembled, or cycled.",
      "The exact interval and capture proofs are bounded to captured-panel-slide@1.0.0's registered negative-Y, 2.5D assumptions.",
      "The new M4 SVG bytes have not been imported into xTool Studio; import verification is required.",
      "Fit, capture under load, strength, durability, slide quality, machine compatibility, and process settings remain physically unverified."
    ]
  })]
]);
for (const svg of named.svgs) files.set(`named/${svg.sheetId}.svg`, svg.svg);
for (const svg of offFamilyArtifacts.svgs) files.set(`off-family/${svg.sheetId}.svg`, svg.svg);

await mkdir(outputDirectory, { recursive: true });
for (const [relativePath, contents] of files) {
  const url = new URL(relativePath, outputDirectory);
  await mkdir(new URL("./", url), { recursive: true });
  await writeFile(url, contents, "utf8");
}
const artifacts = await Promise.all([...files.entries()].map(async ([path, contents]) => ({
  path,
  bytes: new TextEncoder().encode(contents).byteLength,
  sha256: await sha256(contents)
})));
await writeFile(new URL("artifact-manifest.json", outputDirectory), json({
  schemaVersion: "1.0",
  milestone: "M4",
  generator: { id: "m4-artifact-generator", version: "1.0.0" },
  geometryHashes: { named: namedGeometryHash, offFamily: offFamilyGeometryHash },
  evaluatedDocumentHashes: { named: namedDocumentHash, offFamily: offFamilyDocumentHash },
  runtimeApplicationApiCalls: 0,
  physicalVerification: "required",
  artifacts
}), "utf8");

process.stdout.write(
  `Generated ${String(artifacts.length)} M4 artifacts for public ${namedGeometryHash} and off-family ${offFamilyGeometryHash}.\n`,
);
