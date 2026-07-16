import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  canonicalDocumentHash,
  sha256,
  validateFabricationProjection
} from "../src/index.js";
import { buildMultiSheetProjectionBundle } from "../src/projections/bundle.js";
import { nestPartsAcrossSheets } from "../src/projections/fabrication/nesting.js";
import { renderSceneSvg } from "../src/projections/mesh/render-svg.js";
import {
  M2_FIXTURE_NAMES,
  compileM2Fixture
} from "../tests/helpers/m2-fixtures.js";

const outputDirectoryUrl = new URL("../artifacts/m2/", import.meta.url);
const goldenUrl = new URL("../tests/golden/m2-panel-matrix.json", import.meta.url);

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const primary = await compileM2Fixture("basic-box");
const primaryArtifacts = await buildMultiSheetProjectionBundle(
  primary.document,
  nestPartsAcrossSheets(
    primary.document.parts,
    primary.profiles.machine,
    primary.profiles.material,
  ),
);
const forced = await compileM2Fixture("basic-box", {
  bedMm: { width: 132, height: 102, margin: 5 }
});
const forcedArtifacts = await buildMultiSheetProjectionBundle(
  forced.document,
  nestPartsAcrossSheets(
    forced.document.parts,
    forced.profiles.machine,
    forced.profiles.material,
  ),
);
const primaryHash = await canonicalDocumentHash(primary.document);
const forcedHash = await canonicalDocumentHash(forced.document);
const primaryFabricationValidation = validateFabricationProjection(
  primaryArtifacts.bundle.fabrication,
  primary.document.parts,
);
const forcedFabricationValidation = validateFabricationProjection(
  forcedArtifacts.bundle.fabrication,
  forced.document.parts,
);
const proofReports = await Promise.all(
  M2_FIXTURE_NAMES.map(async (name) => {
    const proof = await compileM2Fixture(name);
    return {
      fixture: name,
      proofRole: proof.fixture.proofRole,
      sourceDocumentHash: await canonicalDocumentHash(proof.document),
      operatorProgram: proof.document.operatorProgram.map(({ operatorId, operatorVersion }) => ({
        operatorId,
        operatorVersion
      })),
      partIds: proof.document.parts.map((part) => part.id),
      jointIds: proof.document.joints.map((joint) => joint.id),
      validation: proof.document.validation,
      runtimeApplicationApiCalls: proof.document.provenance.runtimeApplicationApiCalls
    };
  }),
);

const files = new Map<string, string>([
  ["primary/program.json", json(primary.program)],
  ["primary/project.json", json(primary.document)],
  ["primary/projection-bundle.json", json(primaryArtifacts.bundle)],
  ["primary/assembled.svg", renderSceneSvg(primaryArtifacts.bundle.scene, "assembled")],
  ["primary/exploded.svg", renderSceneSvg(primaryArtifacts.bundle.scene, "exploded")],
  ["forced-multi-sheet/program.json", json(forced.program)],
  ["forced-multi-sheet/project.json", json(forced.document)],
  ["forced-multi-sheet/projection-bundle.json", json(forcedArtifacts.bundle)],
  ["proofs/operator-program-reports.json", json({
    schemaVersion: "1.0",
    milestone: "M2",
    proofs: proofReports
  })],
  ["golden-matrix.json", await readFile(goldenUrl, "utf8")],
  [
    "validation.json",
    json({
      schemaVersion: "1.0",
      primary: {
        canonical: primary.document.validation,
        fabrication: primaryFabricationValidation
      },
      forcedMultiSheet: {
        canonical: forced.document.validation,
        fabrication: forcedFabricationValidation
      }
    }),
  ],
  [
    "generation-report.json",
    json({
      schemaVersion: "1.0",
      milestone: "M2",
      generator: { id: "m2-artifact-generator", version: "1.0.0" },
      sourceDocumentHashes: {
        primary: primaryHash,
        forcedMultiSheet: forcedHash
      },
      runtimeApplicationApiCalls: 0,
      modelId: null,
      promptVersion: null,
      tokenUsage: null,
      latencyMs: null,
      estimatedCostUsd: 0,
      validation: {
        primaryCanonical: primary.document.validation.status,
        primaryFabrication: primaryFabricationValidation.status,
        forcedCanonical: forced.document.validation.status,
        forcedFabrication: forcedFabricationValidation.status,
        proofPrograms: proofReports.map((report) => ({
          fixture: report.fixture,
          status: report.validation.status
        }))
      },
      physicalVerification: { state: "required", performed: false },
      claim: "fabrication candidate",
      limitations: [
        "No xTool Studio import has been performed.",
        "No material has been cut or assembled.",
        "Fit, strength, durability, mechanism function, and machine compatibility remain physically unverified."
      ]
    }),
  ]
]);
for (const item of primaryArtifacts.svgs) {
  files.set(`primary/${item.sheetId}.svg`, item.svg);
}
for (const item of forcedArtifacts.svgs) {
  files.set(`forced-multi-sheet/${item.sheetId}.svg`, item.svg);
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
    milestone: "M2",
    generator: { id: "m2-artifact-generator", version: "1.0.0" },
    sourceDocumentHashes: {
      primary: primaryHash,
      forcedMultiSheet: forcedHash
    },
    runtimeApplicationApiCalls: 0,
    physicalVerification: "required",
    artifacts: artifactEntries
  }),
  "utf8",
);

process.stdout.write(
  `Generated ${String(artifactEntries.length)} deterministic M2 artifacts for ${primaryHash}.\n`,
);
