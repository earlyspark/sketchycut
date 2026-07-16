import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  NOMINAL_3MM_LASER_PLYWOOD_POLICY,
  buildMultiSheetProjectionBundle,
  canonicalDocumentHash,
  canonicalGeometryHash,
  compileAccumulatedKerfGauge,
  compileOrthogonalPanelProgram,
  evaluateStockInputs,
  measuredBasswoodProfile,
  nestPartsAcrossSheets,
  provisionalFitProfile,
  renderSceneSvg,
  sha256,
  validateFabricationProjection,
  xtoolM2Profile
} from "../src/index.js";
import { createPrimaryPreset } from "../src/ui/content/presets.js";

const outputDirectoryUrl = new URL("../artifacts/m2.1/", import.meta.url);
const goldenUrl = new URL("../tests/golden/m2-panel-matrix.json", import.meta.url);
const sweepUrl = new URL("input-sweep.json", outputDirectoryUrl);

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function profiles(
  samplesMm: readonly number[],
  kerfXmm: number,
  kerfYmm = kerfXmm,
) {
  return {
    material: measuredBasswoodProfile(samplesMm),
    machine: xtoolM2Profile(kerfXmm, kerfYmm),
    fit: provisionalFitProfile()
  };
}

async function compileProduct(
  resolved: ReturnType<typeof profiles>,
  evaluation?: ReturnType<typeof evaluateStockInputs>,
) {
  const document = await compileOrthogonalPanelProgram(
    createPrimaryPreset("medium", resolved),
    resolved,
    evaluation,
  );
  const artifacts = await buildMultiSheetProjectionBundle(
    document,
    nestPartsAcrossSheets(document.parts, resolved.machine, resolved.material),
  );
  return { document, artifacts };
}

async function compileGauge(resolved: ReturnType<typeof profiles>) {
  const document = await compileAccumulatedKerfGauge(resolved);
  const artifacts = await buildMultiSheetProjectionBundle(
    document,
    nestPartsAcrossSheets(document.parts, resolved.machine, resolved.material),
  );
  return { document, artifacts };
}

const baselineProfiles = profiles([2.98, 3, 3.02], 0.15, 0.16);
const baseline = await compileProduct(baselineProfiles);
const gauge = await compileGauge(baselineProfiles);
const wideSamples = await compileProduct(profiles([2.8, 3, 3.2], 0.15, 0.16));
const kerfEdit = await compileProduct(profiles([2.98, 3, 3.02], 0.18, 0.2));
const lowKerfGauge = await compileGauge(profiles([2.98, 3, 3.02], 0.05, 0.05));
const highKerfGauge = await compileGauge(profiles([2.98, 3, 3.02], 0.4, 0.4));

const policyBumpEvaluation = evaluateStockInputs(
  {
    materialKind: baselineProfiles.material.materialKind,
    thicknessSamplesMm: baselineProfiles.material.thicknessMeasurement!.samplesMm,
    kerfXmm: baselineProfiles.machine.kerfMm.x,
    kerfYmm: baselineProfiles.machine.kerfMm.y
  },
  {
    ...NOMINAL_3MM_LASER_PLYWOOD_POLICY,
    version: "1.0.1"
  },
);
const policyBump = await compileProduct(baselineProfiles, policyBumpEvaluation);
const hashes = {
  baseline: {
    geometry: await canonicalGeometryHash(baseline.document),
    evaluated: await canonicalDocumentHash(baseline.document)
  },
  policyBump: {
    geometry: await canonicalGeometryHash(policyBump.document),
    evaluated: await canonicalDocumentHash(policyBump.document)
  },
  sameMedianDifferentSpread: {
    geometry: await canonicalGeometryHash(wideSamples.document),
    evaluated: await canonicalDocumentHash(wideSamples.document)
  },
  directionalKerfEdit: {
    geometry: await canonicalGeometryHash(kerfEdit.document),
    evaluated: await canonicalDocumentHash(kerfEdit.document)
  },
  gauge: {
    geometry: await canonicalGeometryHash(gauge.document),
    evaluated: await canonicalDocumentHash(gauge.document)
  }
};
const hashSeparationReport = {
  schemaVersion: "1.0",
  milestone: "M2.1",
  hashes,
  assertions: {
    policyVersionPreservesGeometry:
      hashes.baseline.geometry === hashes.policyBump.geometry,
    policyVersionChangesEvaluation:
      hashes.baseline.evaluated !== hashes.policyBump.evaluated,
    policyVersionPreservesProductSvg:
      JSON.stringify(baseline.artifacts.svgs) === JSON.stringify(policyBump.artifacts.svgs),
    sameMedianDifferentSpreadPreservesGeometry:
      hashes.baseline.geometry === hashes.sameMedianDifferentSpread.geometry,
    sameMedianDifferentSpreadChangesEvaluation:
      hashes.baseline.evaluated !== hashes.sameMedianDifferentSpread.evaluated,
    directionalKerfPreservesGeometry:
      hashes.baseline.geometry === hashes.directionalKerfEdit.geometry,
    directionalKerfChangesEvaluation:
      hashes.baseline.evaluated !== hashes.directionalKerfEdit.evaluated,
    directionalKerfChangesProductSvg:
      JSON.stringify(baseline.artifacts.svgs) !== JSON.stringify(kerfEdit.artifacts.svgs),
    provisionalKerfPreservesGaugeSvg:
      JSON.stringify(lowKerfGauge.artifacts.svgs) === JSON.stringify(highKerfGauge.artifacts.svgs)
  }
};
if (Object.values(hashSeparationReport.assertions).some((value) => !value)) {
  throw new Error("M2.1 hash-separation or gauge-independence assertion failed.");
}

const boundaryReport = {
  schemaVersion: "1.0",
  milestone: "M2.1",
  exactLowBoundary: evaluateStockInputs({
    materialKind: "basswood-plywood",
    thicknessSamplesMm: [2.5, 2.5, 2.5],
    kerfXmm: 0.05,
    kerfYmm: 0.05
  }),
  exactHighBoundary: evaluateStockInputs({
    materialKind: "basswood-plywood",
    thicknessSamplesMm: [3.6, 3.6, 3.6],
    kerfXmm: 0.4,
    kerfYmm: 0.4
  }),
  justOutside: evaluateStockInputs({
    materialKind: "basswood-plywood",
    thicknessSamplesMm: [2.49, 3, 3.61],
    kerfXmm: 0.04,
    kerfYmm: 0.41
  }),
  highVariation: evaluateStockInputs({
    materialKind: "basswood-plywood",
    thicknessSamplesMm: [2.9, 3, 3.1],
    kerfXmm: 0.15,
    kerfYmm: 0.16
  })
};

const baselineFabricationValidation = validateFabricationProjection(
  baseline.artifacts.bundle.fabrication,
  baseline.document.parts,
);
const gaugeFabricationValidation = validateFabricationProjection(
  gauge.artifacts.bundle.fabrication,
  gauge.document.parts,
);
const files = new Map<string, string>([
  ["product/project.json", json(baseline.document)],
  ["product/projection-bundle.json", json(baseline.artifacts.bundle)],
  ["product/assembled.svg", renderSceneSvg(baseline.artifacts.bundle.scene, "assembled")],
  ["product/exploded.svg", renderSceneSvg(baseline.artifacts.bundle.scene, "exploded")],
  ["gauge/project.json", json(gauge.document)],
  ["gauge/projection-bundle.json", json(gauge.artifacts.bundle)],
  ["gauge/assembled.svg", renderSceneSvg(gauge.artifacts.bundle.scene, "assembled")],
  ["gauge/exploded.svg", renderSceneSvg(gauge.artifacts.bundle.scene, "exploded")],
  ["hash-separation.json", json(hashSeparationReport)],
  ["input-policy-boundaries.json", json(boundaryReport)],
  ["input-sweep.json", await readFile(sweepUrl, "utf8")],
  ["golden-matrix.json", await readFile(goldenUrl, "utf8")],
  [
    "validation.json",
    json({
      schemaVersion: "1.0",
      milestone: "M2.1",
      product: {
        canonical: baseline.document.validation,
        fabrication: baselineFabricationValidation
      },
      gauge: {
        canonical: gauge.document.validation,
        fabrication: gaugeFabricationValidation
      }
    }),
  ],
  [
    "generation-report.json",
    json({
      schemaVersion: "1.0",
      milestone: "M2.1",
      generator: { id: "m2-1-artifact-generator", version: "1.0.0" },
      geometryHashes: {
        product: hashes.baseline.geometry,
        gauge: hashes.gauge.geometry
      },
      evaluatedDocumentHashes: {
        product: hashes.baseline.evaluated,
        gauge: hashes.gauge.evaluated
      },
      inputPolicy: baseline.document.provenance.inputPolicyEvaluation,
      runtimeApplicationApiCalls: 0,
      modelId: null,
      promptVersion: null,
      tokenUsage: null,
      latencyMs: null,
      estimatedCostUsd: 0,
      validation: {
        productCanonical: baseline.document.validation.status,
        productFabrication: baselineFabricationValidation.status,
        gaugeCanonical: gauge.document.validation.status,
        gaugeFabrication: gaugeFabricationValidation.status
      },
      physicalVerification: {
        state: "required",
        performed: false,
        fixtureCut: false,
        packedSpanMeasurementsRecorded: false
      },
      claim: "software-validated measurement fixture and fabrication candidate",
      limitations: [
        "No xTool Studio import has been performed.",
        "The accumulated-kerf fixture has not been physically cut or measured.",
        "Process settings are not yet represented in MachineProfile, so measured kerf is not portable across cutting recipes.",
        "The open-tray anti-overfit proof reports TREATMENT_SAFE_REGION_UNAVAILABLE from 3.21–3.60 mm; measured inputs are preserved and no alternate measurement is suggested.",
        "Fit, strength, durability, and machine compatibility remain physically unverified."
      ]
    }),
  ]
]);
for (const item of baseline.artifacts.svgs) {
  files.set(`product/${item.sheetId}.svg`, item.svg);
}
for (const item of gauge.artifacts.svgs) {
  files.set(`gauge/${item.sheetId}.svg`, item.svg);
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
    milestone: "M2.1",
    generator: { id: "m2-1-artifact-generator", version: "1.0.0" },
    geometryHashes: {
      product: hashes.baseline.geometry,
      gauge: hashes.gauge.geometry
    },
    evaluatedDocumentHashes: {
      product: hashes.baseline.evaluated,
      gauge: hashes.gauge.evaluated
    },
    runtimeApplicationApiCalls: 0,
    physicalVerification: "required",
    artifacts: artifactEntries
  }),
  "utf8",
);
process.stdout.write(
  `Generated ${String(artifactEntries.length)} M2.1 artifacts for geometry ${hashes.baseline.geometry}.\n`,
);
