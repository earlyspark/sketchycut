import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

import {
  StudioImportVerificationSchema,
  buildXToolStudioHandoff,
  createStarterFabricationSetup,
  createStarterPinSetup,
  renderXToolStudioChecklist,
  resolveFabricationSetup,
  sha256
} from "../src/index.js";
import { createRetainedPreset } from "../src/ui/content/presets.js";
import {
  compileFixtureRequest,
  compileProductRequest
} from "../src/workers/compile-service.js";

const outputDirectory = new URL("../artifacts/m3.1.1/", import.meta.url);

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const applied = createStarterFabricationSetup();
const resolved = resolveFabricationSetup(applied);
const profiles = {
  material: resolved.material,
  machine: resolved.machine,
  processRecipe: resolved.processRecipe,
  fabricationContext: resolved.fabricationContext,
  fit: resolved.fit
};
const [product, optionalFitTest] = await Promise.all([
  compileProductRequest({
    kind: "product-compile",
    structuralKind: "retained-pin",
    requestId: "m3-1-1-final-product",
    program: createRetainedPreset("medium", profiles, createStarterPinSetup()),
    profiles,
    inputPolicyEvaluation: resolved.inputPolicyEvaluation
  }),
  compileFixtureRequest({
    kind: "fixture-compile",
    requestId: "m3-1-1-final-optional-fit-test",
    stockPresetId: applied.stockPresetId
  })
]);
const handoff = await buildXToolStudioHandoff(
  resolved.machine,
  { fabrication: product.bundle.fabrication, svgs: product.svgs },
  { fabrication: optionalFitTest.bundle.fabrication, svgs: optionalFitTest.svgs },
);
const checklist = renderXToolStudioChecklist(handoff);
const complexityRegressionBudget = {
  schemaVersion: "1.0",
  milestone: "M3.1.1",
  policy: "accepted-fixture-regression-budget-not-a-universal-Studio-limit",
  groups: [
    {
      id: "product",
      fixture: "starter-retained-pin-medium",
      maximum: { pathCount: 66, segmentCount: 515, vertexCount: 542, svgByteSize: 29_265 }
    },
    {
      id: "optional-cut-width-fit-test",
      fixture: "starter-packed-span-fit-test",
      maximum: { pathCount: 20, segmentCount: 60, vertexCount: 70, svgByteSize: 9_431 }
    }
  ]
};
for (const budget of complexityRegressionBudget.groups) {
  const group = handoff.artifactGroups.find((item) => item.id === budget.id)!;
  const observed = group.sheets.reduce((total, sheet) => ({
    pathCount: total.pathCount + sheet.complexity.pathCount,
    segmentCount: total.segmentCount + sheet.complexity.segmentCount,
    vertexCount: total.vertexCount + sheet.complexity.vertexCount,
    svgByteSize: total.svgByteSize + sheet.complexity.svgByteSize
  }), { pathCount: 0, segmentCount: 0, vertexCount: 0, svgByteSize: 0 });
  if (Object.entries(observed).some(([key, value]) =>
    value > budget.maximum[key as keyof typeof budget.maximum]
  )) {
    throw new Error(`${budget.id} exceeds its reviewed M3.1.1 fixture complexity budget.`);
  }
}
const probeManifest = JSON.parse(await readFile(
  new URL("probes/manifest.json", outputDirectory),
  "utf8",
)) as unknown;

const verificationTemplate = StudioImportVerificationSchema.parse({
  schemaVersion: "1.0",
  milestone: "M3.1.1",
  status: "not-performed",
  scope: "import-only-no-processing",
  artifactGroups: handoff.artifactGroups.map((group) => ({
    group: group.id,
    sourceDocumentHash: group.sourceDocumentHash,
    artifactSetHash: group.artifactSetHash,
    sheets: group.sheets.map((sheet) => ({
      sheetId: sheet.sheetId,
      svgSha256: sheet.svgSha256,
      expectedRootDimensionsMm: sheet.rootDimensionsMm,
      expectedOccupiedBoundsUm: sheet.occupiedCompensatedBoundsUm,
      expectedAnchor: `occupied-bounds:${String(sheet.occupiedCompensatedBoundsUm.minXUm)},${String(sheet.occupiedCompensatedBoundsUm.minYUm)}-${String(sheet.occupiedCompensatedBoundsUm.maxXUm)},${String(sheet.occupiedCompensatedBoundsUm.maxYUm)}`,
      parsed: null,
      importedRootDimensionsMm: null,
      importedOccupiedSelectionDimensionsMm: null,
      importedAnchorObservation: null,
      dimensionResult: "not-performed",
      rootWhitespaceBehavior: null,
      objectsVisibleAndSelectable: null
    }))
  })),
  environment: {
    studioDesktopVersion: null,
    operatingSystem: null,
    svgDpi: null,
    vectorQuality: null,
    oversizedImportPreference: null
  },
  deviceContext: "none",
  observedOnImport: {
    objectAndLayerCount: null,
    initialOutputState: null,
    initialOperationState: null,
    initialParameterState: null,
    engraveOneFilledObjectNoSeparateOutline: "not-performed"
  },
  configuredForPreview: {
    operationAssignmentsRecorded: null,
    outputStatesRecorded: null,
    orderRecorded: null,
    kerfOffsetValuesRecorded: null
  },
  connectedPreflight: {
    status: "not-attempted",
    prerequisiteReason: null,
    firmwareVersion: null,
    normalStartupHomingObserved: null,
    operationOutputOrderKerfControlsObserved: null
  },
  preview: {
    status: "not-performed",
    interiorBeforeOuter: null,
    kerfOffsetProbe: {
      status: "not-performed",
      probeObjectId: null,
      offsetMm: null,
      observation: null,
      restoredOrDiscarded: null
    }
  },
  processingPerformed: false,
  reviewer: null,
  date: null,
  evidencePaths: []
});

const packageManifest = {
  schemaVersion: "1.0",
  milestone: "M3.1.1",
  claim: handoff.outputClaim,
  target: handoff.target,
  artifactGroups: handoff.artifactGroups,
  operationMap: handoff.operationMap,
  importSettings: handoff.importSettings,
  compensationOwner: handoff.compensationOwner,
  requiredStudioKerfOffset: handoff.requiredStudioKerfOffset,
  processingPerformed: false,
  runtimeApplicationApiCalls: 0,
  physicalVerification: "required",
  studioImportVerification: "not-performed",
  probeManifest
};

const entries: [string, string][] = [
  ["product/project.json", json(product.document)],
  ["product/projection-bundle.json", json(product.bundle)],
  ...product.svgs.map((item) => [`product/${item.sheetId}.svg`, item.svg] as [string, string]),
  ["optional-cut-width-fit-test/project.json", json(optionalFitTest.document)],
  ["optional-cut-width-fit-test/projection-bundle.json", json(optionalFitTest.bundle)],
  ...optionalFitTest.svgs.map((item) => [
    `optional-cut-width-fit-test/${item.sheetId}.svg`,
    item.svg
  ] as [string, string]),
  ["handoff.json", json(handoff)],
  ["checklist.md", checklist],
  ["package-manifest.json", json(packageManifest)],
  ["reports/complexity-regression-budget.json", json(complexityRegressionBudget)],
  ["reports/studio-import-verification-template.json", json(verificationTemplate)],
  ["generation-report.json", json({
    schemaVersion: "1.0",
    milestone: "M3.1.1",
    generator: { id: "m3-1-1-artifact-generator", version: "1.0.0" },
    productArtifactSetHash: handoff.artifactGroups[0]!.artifactSetHash,
    optionalFitTestArtifactSetHash: handoff.artifactGroups[1]!.artifactSetHash,
    studioImportVerification: "not-performed",
    runtimeApplicationApiCalls: 0,
    estimatedCostUsd: 0,
    processingPerformed: false,
    physicalVerification: "required"
  })]
];

await mkdir(outputDirectory, { recursive: true });
const artifactEntries: { path: string; bytes: number; sha256: string }[] = [];
for (const [path, contents] of entries) {
  const url = new URL(path, outputDirectory);
  await mkdir(new URL("./", url), { recursive: true });
  await writeFile(url, contents);
  artifactEntries.push({
    path,
    bytes: (await stat(url)).size,
    sha256: await sha256(contents)
  });
}
await writeFile(new URL("artifact-manifest.json", outputDirectory), json({
  schemaVersion: "1.0",
  milestone: "M3.1.1",
  generator: { id: "m3-1-1-artifact-generator", version: "1.0.0" },
  runtimeApplicationApiCalls: 0,
  processingPerformed: false,
  physicalVerification: "required",
  artifacts: artifactEntries
}));

process.stdout.write(
  `Generated ${String(artifactEntries.length)} M3.1.1 artifacts for product ${handoff.artifactGroups[0]!.artifactSetHash} and optional fit test ${handoff.artifactGroups[1]!.artifactSetHash}.\n`,
);
