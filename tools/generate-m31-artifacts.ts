import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

import {
  NOMINAL_STOCK_PRESETS,
  DesignDocumentV1Schema,
  canonicalDocumentHash,
  canonicalGeometryHash,
  createStarterFabricationSetup,
  createStarterPinSetup,
  evaluatePackedSpanCalibration,
  resolveFabricationSetup,
  sha256,
  type AppliedFabricationSetup
} from "../src/index.js";
import { buildMultiSheetProjectionBundle } from "../src/projections/bundle.js";
import { nestPartsAcrossSheets } from "../src/projections/fabrication/nesting.js";
import { createRetainedPreset } from "../src/ui/content/presets.js";
import { compileFixtureRequest, compileProductRequest } from "../src/workers/compile-service.js";
import { compileM3Fixture } from "../tests/helpers/m3-fixtures.js";

const outputDirectory = new URL("../artifacts/m3.1/", import.meta.url);

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function compileSetup(id: string, applied: AppliedFabricationSetup) {
  const resolved = resolveFabricationSetup(applied);
  const profiles = {
    material: resolved.material,
    machine: resolved.machine,
    processRecipe: resolved.processRecipe,
    fabricationContext: resolved.fabricationContext,
    fit: resolved.fit
  };
  const program = createRetainedPreset("medium", profiles, {
    effectiveDiameterMm: createStarterPinSetup().effectiveDiameterMm,
    basis: createStarterPinSetup().basis
  });
  const response = await compileProductRequest({
    kind: "product-compile",
    structuralKind: "retained-pin",
    requestId: id,
    program,
    profiles,
    inputPolicyEvaluation: resolved.inputPolicyEvaluation
  });
  return {
    applied,
    resolved,
    program,
    response,
    geometryHash: await canonicalGeometryHash(response.document),
    evaluatedHash: await canonicalDocumentHash(response.document)
  };
}

await mkdir(outputDirectory, { recursive: true });
const starterApplied = createStarterFabricationSetup();
const oneApplied: AppliedFabricationSetup = {
  ...starterApplied,
  thickness: { basis: "user-reported-caliper", readingsMm: [3] }
};
const threeApplied: AppliedFabricationSetup = {
  ...starterApplied,
  thickness: { basis: "user-reported-caliper", readingsMm: [2.98, 3, 3.02] }
};
const sameNumericManualApplied: AppliedFabricationSetup = {
  ...starterApplied,
  cutWidth: { source: "user-reported-manual", xMm: 0.15, yMm: 0.15 }
};
const cutWidthEditApplied: AppliedFabricationSetup = {
  ...starterApplied,
  cutWidth: { source: "user-reported-manual", xMm: 0.18, yMm: 0.2 }
};
const fixture = await compileFixtureRequest({
  kind: "fixture-compile",
  requestId: "m3-1-independent-fixture",
  stockPresetId: starterApplied.stockPresetId
});
const packed = evaluatePackedSpanCalibration({
  materialKind: "basswood-plywood",
  thicknessBasis: "nominal-preset",
  effectiveThicknessMm: 3,
  packedRowWidthMm: 118.5,
  packedColumnHeightMm: 98.4,
  fixtureArtifactHash: fixture.svgs[0]!.sha256
});
if (packed.status !== "valid" || packed.evaluation.kerf.fixtureEvidence === undefined) {
  throw new Error("M3.1 fixture-derived evidence failed to resolve.");
}
const fixtureDerivedApplied: AppliedFabricationSetup = {
  ...starterApplied,
  cutWidth: {
    source: "fixture-derived",
    xMm: packed.evaluation.kerf.xMm,
    yMm: packed.evaluation.kerf.yMm,
    fixtureEvidence: packed.evaluation.kerf.fixtureEvidence
  }
};

const [starter, one, three, sameNumericManual, cutWidthEdit, fixtureDerived] = await Promise.all([
  compileSetup("m3-1-starter", starterApplied),
  compileSetup("m3-1-one-reading", oneApplied),
  compileSetup("m3-1-three-readings", threeApplied),
  compileSetup("m3-1-manual-same-numeric", sameNumericManualApplied),
  compileSetup("m3-1-cut-width-edit", cutWidthEditApplied),
  compileSetup("m3-1-fixture-derived", fixtureDerivedApplied)
]);

const m3Named = await compileM3Fixture("hinged-lid-box");
const m3NamedArtifacts = await buildMultiSheetProjectionBundle(
  m3Named.document,
  nestPartsAcrossSheets(
    m3Named.document.parts,
    m3Named.profiles.machine,
    m3Named.profiles.material,
    m3Named.profiles.processRecipe,
    m3Named.profiles.fabricationContext,
  ),
);
const m3OffFamily = await compileM3Fixture("hinged-flap");
const m3OffFamilyArtifacts = await buildMultiSheetProjectionBundle(
  m3OffFamily.document,
  nestPartsAcrossSheets(
    m3OffFamily.document.parts,
    m3OffFamily.profiles.machine,
    m3OffFamily.profiles.material,
    m3OffFamily.profiles.processRecipe,
    m3OffFamily.profiles.fabricationContext,
  ),
);
const m21ProductDocument = DesignDocumentV1Schema.parse(JSON.parse(await readFile(
  new URL("../m2.1/product/project.json", outputDirectory),
  "utf8",
)) as unknown);
const m21GaugeDocument = DesignDocumentV1Schema.parse(JSON.parse(await readFile(
  new URL("../m2.1/gauge/project.json", outputDirectory),
  "utf8",
)) as unknown);

const protectedReconciliation = {
  schemaVersion: "1.0",
  milestone: "M3.1",
  geometryHashKind: "sketchycut-nominal-geometry@1.0.0",
  observed: {
    m21ProductGeometryHash: await canonicalGeometryHash(m21ProductDocument),
    m21GaugeGeometryHash: await canonicalGeometryHash(m21GaugeDocument),
    m21ProductSvgSha256: await sha256(await readFile(new URL("../m2.1/product/sheet-1.svg", outputDirectory))),
    m21GaugeSvgSha256: await sha256(await readFile(new URL("../m2.1/gauge/sheet-1.svg", outputDirectory))),
    m3NamedGeometryHash: await canonicalGeometryHash(m3Named.document),
    m3OffFamilyGeometryHash: await canonicalGeometryHash(m3OffFamily.document),
    m3NamedProductSvgSha256: m3NamedArtifacts.svgs[0]!.sha256,
    m3OffFamilyProductSvgSha256: m3OffFamilyArtifacts.svgs[0]!.sha256,
    m1CouponGoldenSha256: await sha256(await readFile(new URL("../tests/golden/m1-coupon-matrix.json", import.meta.url))),
    m2PanelGoldenSha256: await sha256(await readFile(new URL("../tests/golden/m2-panel-matrix.json", import.meta.url))),
    m3RevoluteGoldenSha256: await sha256(await readFile(new URL("../tests/golden/m3-revolute-matrix.json", import.meta.url))),
    packageLockSha256: await sha256(await readFile(new URL("../package-lock.json", import.meta.url)))
  },
  expected: {
    m21ProductGeometryHash: "b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5",
    m21GaugeGeometryHash: "e4344b781731cef67d85acc4c81a3b68f44993173e672170f33980f95e66959b",
    m21ProductSvgSha256: "feae33b0bcbf12d82ce43cf9289e930cfda00d3bfd48302a0a0908822a71513b",
    m21GaugeSvgSha256: "2d4296889f9689cea687affd55dcb7bd7242e2340212b1d123d433aebd4b47fc",
    m3NamedGeometryHash: "0cc193ece6f863421072b02dd98379946ca351110d39879b675e1373eefd40f5",
    m3OffFamilyGeometryHash: "1a3ad1737defee5cbf385c208dd551b87269366d2c2a1f06f56cc56f539f1587",
    m3NamedProductSvgSha256: "b500e001ae3fe0ac234ed2ea688690aebfb98bc82b1745cefe03fcf0a5d00a1b",
    m3OffFamilyProductSvgSha256: "55ba964e1215f2faaa04e75ed92f9b85a1fc90d6f6442a84d004d8986679ded1",
    m1CouponGoldenSha256: "a2e02fa6cd6f58ad1ecf77eab38ea57427d4c4eb9b1b26665d4d9bf0b149dcb3",
    m2PanelGoldenSha256: "581178ac0c5a6beda54f452776b0f38e6d02b431a1692db184245f20379df042",
    m3RevoluteGoldenSha256: "c52ccd204a7f5b0929f25f86262729c93f17b3c85453e1e5c2d42781e6e63fcd",
    packageLockSha256: "518a811c5b36f3473772d3db9f6ced4f80541cb8f0ef60bda4b90b17407d419c"
  }
};
if (JSON.stringify(protectedReconciliation.observed) !== JSON.stringify(protectedReconciliation.expected)) {
  throw new Error("A protected M3.1 identity changed; artifact generation stopped.");
}

const hashSeparation = {
  schemaVersion: "1.0",
  milestone: "M3.1",
  cases: {
    starter: { geometryHash: starter.geometryHash, evaluatedHash: starter.evaluatedHash, svgSha256: starter.response.svgs[0]!.sha256 },
    oneReading: { geometryHash: one.geometryHash, evaluatedHash: one.evaluatedHash, svgSha256: one.response.svgs[0]!.sha256 },
    threeReadings: { geometryHash: three.geometryHash, evaluatedHash: three.evaluatedHash, svgSha256: three.response.svgs[0]!.sha256 },
    sameNumericManual: { geometryHash: sameNumericManual.geometryHash, evaluatedHash: sameNumericManual.evaluatedHash, svgSha256: sameNumericManual.response.svgs[0]!.sha256 },
    cutWidthEdit: { geometryHash: cutWidthEdit.geometryHash, evaluatedHash: cutWidthEdit.evaluatedHash, svgSha256: cutWidthEdit.response.svgs[0]!.sha256 },
    fixtureDerived: { geometryHash: fixtureDerived.geometryHash, evaluatedHash: fixtureDerived.evaluatedHash, svgSha256: fixtureDerived.response.svgs[0]!.sha256 }
  },
  assertions: {
    starterAndOneShareGeometry: starter.geometryHash === one.geometryHash,
    starterAndOneDifferEvaluated: starter.evaluatedHash !== one.evaluatedHash,
    oneAndThreeShareGeometry: one.geometryHash === three.geometryHash,
    oneAndThreeDifferEvaluated: one.evaluatedHash !== three.evaluatedHash,
    sameNumericSourcesShareSvg: starter.response.svgs[0]!.sha256 === sameNumericManual.response.svgs[0]!.sha256,
    sameNumericSourcesDifferEvaluated: starter.evaluatedHash !== sameNumericManual.evaluatedHash,
    cutWidthEditPreservesGeometry: starter.geometryHash === cutWidthEdit.geometryHash,
    cutWidthEditChangesSvg: starter.response.svgs[0]!.sha256 !== cutWidthEdit.response.svgs[0]!.sha256,
    fixtureRawEvidenceRetained: fixtureDerived.response.evidence.cutWidth.source === "fixture-derived",
    fixtureSvgProtected: fixture.svgs[0]!.sha256 === "2d4296889f9689cea687affd55dcb7bd7242e2340212b1d123d433aebd4b47fc"
  }
};
if (Object.values(hashSeparation.assertions).some((value) => !value)) {
  throw new Error("M3.1 hash-separation assertion failed.");
}

const motion = m3Named.document.motionConstraints[0]!;
const stopIdentity = {
  schemaVersion: "1.0",
  milestone: "M3.1",
  presentationLabel: "Lid-open stop",
  canonical: {
    partId: "open-stop-brace",
    partName: m3Named.document.parts.find((part) => part.id === "open-stop-brace")?.name,
    operatorVersion: m3Named.document.operatorProgram.find(
      (entry) => entry.operatorId === "retained-pin-revolute",
    )?.operatorVersion,
    endpointContact: motion.revolute?.proofModel.allowedEndpointContacts.find(
      (contact) => contact.id === "open-stop-brace-contact",
    ),
    range: motion.range
  },
  boundaries: {
    deterministicEndpointProof: true,
    animationIsProof: false,
    physicalVerificationPerformed: false
  }
};

const entries: [string, string][] = [
  ["stock-catalog.json", json(NOMINAL_STOCK_PRESETS)],
  ["starter/project.json", json(starter.response.document)],
  ["starter/projection-bundle.json", json(starter.response.bundle)],
  ["starter/evidence.json", json(starter.response.evidence)],
  ["starter/sheet-1.svg", starter.response.svgs[0]!.svg],
  ["one-reading/project.json", json(one.response.document)],
  ["one-reading/evidence.json", json(one.response.evidence)],
  ["three-readings/project.json", json(three.response.document)],
  ["three-readings/evidence.json", json(three.response.evidence)],
  ["fixture-derived/project.json", json(fixtureDerived.response.document)],
  ["fixture-derived/evidence.json", json(fixtureDerived.response.evidence)],
  ["fixture/project.json", json(fixture.document)],
  ["fixture/projection-bundle.json", json(fixture.bundle)],
  ["fixture/sheet-1.svg", fixture.svgs[0]!.svg],
  ["reports/hash-separation.json", json(hashSeparation)],
  ["reports/protected-reconciliation.json", json(protectedReconciliation)],
  ["reports/lid-open-stop-identity.json", json(stopIdentity)],
  ["generation-report.json", json({
    schemaVersion: "1.0",
    milestone: "M3.1",
    generator: { id: "m3-1-artifact-generator", version: "1.0.0" },
    evaluatedHashChurn: {
      m21Product: { before: "ae181f319cd4fdc1f19167675f79125f010ee81eff9102b015def5c1ce2391dc", after: "0153824a561d3bc4e010bddc220db3cde94c70aec7aadd34335ff1d463e66435" },
      m21Gauge: { before: "3cb09c8dbd6d951ad4209641f8df03c0bf10286fc0c969100de6609ba88a9bb2", after: "389d740739138bfc93c81ed8f26094d2c9a4fa6860ab6cb6e8173ea0c0cb5f72" },
      m3Named: { before: "5b45fea5d8942efd028679c7514f71aa4570c5ca58c3fb6f787105652cd56840", after: await canonicalDocumentHash(m3Named.document) },
      m3OffFamily: { before: "cf9a4c4b9838ae3d8ed530a6f045e9e004cf7587c244d36e05d7e808dc99b008", after: await canonicalDocumentHash(m3OffFamily.document) }
    },
    runtimeApplicationApiCalls: 0,
    estimatedCostUsd: 0,
    physicalVerification: "required",
    protectedReconciliation: "pass"
  })]
];

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
  milestone: "M3.1",
  generator: { id: "m3-1-artifact-generator", version: "1.0.0" },
  protectedStatus: "pass",
  runtimeApplicationApiCalls: 0,
  physicalVerification: "required",
  artifacts: artifactEntries
}));

process.stdout.write(
  `Generated ${String(artifactEntries.length)} M3.1 artifacts; protected identities pass and evaluated churn is isolated.\n`,
);
