import { mkdir, readFile, writeFile } from "node:fs/promises";

import { canonicalDocumentHash } from "../src/compiler/canonical.js";
import { sha256 } from "../src/domain/hash.js";
import { compileCalibrationCoupon } from "../src/operators/calibration-coupon.js";
import { buildProjectionBundle } from "../src/projections/bundle.js";
import { nestParts } from "../src/projections/fabrication/nesting.js";
import { renderSceneSvg } from "../src/projections/mesh/render-svg.js";
import { validateSheetProjection } from "../src/validation/sheet.js";

const outputDirectoryUrl = new URL("../artifacts/m1/", import.meta.url);
const goldenUrl = new URL("../tests/golden/m1-coupon-matrix.json", import.meta.url);

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const document = await compileCalibrationCoupon({
  measuredThicknessMm: 3,
  kerfMm: 0.15
});
const placements = nestParts(
  document.parts,
  document.resolvedInputs.machine,
  document.resolvedInputs.material,
  document.resolvedInputs.processRecipe,
  document.resolvedInputs.fabricationContext,
);
const projection = await buildProjectionBundle(document, placements);
const sheet = projection.bundle.fabrication.sheets[0]!;
const sheetValidation = validateSheetProjection(sheet, document.parts);
const assembledSvg = renderSceneSvg(projection.bundle.scene, "assembled");
const explodedSvg = renderSceneSvg(projection.bundle.scene, "exploded");
const goldenMatrix = await readFile(goldenUrl, "utf8");
const sourceDocumentHash = await canonicalDocumentHash(document);

const files = new Map<string, string>([
  ["project.json", json(document)],
  ["projection-bundle.json", json(projection.bundle)],
  ["sheet.json", json(sheet)],
  ["scene.json", json(projection.bundle.scene)],
  ["bom.json", json(projection.bundle.bom)],
  ["fabrication.svg", projection.svg],
  ["assembled.svg", assembledSvg],
  ["exploded.svg", explodedSvg],
  [
    "validation.json",
    json({
      schemaVersion: "1.0",
      canonical: document.validation,
      sheet: sheetValidation
    }),
  ],
  ["golden-matrix.json", goldenMatrix],
  [
    "generation-report.json",
    json({
      schemaVersion: "1.0",
      milestone: "M1",
      generator: {
        id: "m1-artifact-generator",
        version: "1.0.0"
      },
      sourceDocumentHash,
      deterministicSeed: document.provenance.deterministicSeed,
      runtimeApplicationApiCalls: 0,
      validation: {
        canonical: document.validation.status,
        sheet: sheetValidation.status
      },
      physicalVerification: {
        state: "required",
        performed: false
      },
      claim: "fabrication candidate",
      limitations: [
        "No xTool Studio import has been performed.",
        "No material has been cut.",
        "Fit, strength, durability, and machine compatibility remain physically unverified."
      ]
    }),
  ]
]);

await mkdir(outputDirectoryUrl, { recursive: true });
for (const [relativePath, contents] of files) {
  await writeFile(new URL(relativePath, outputDirectoryUrl), contents, "utf8");
}

const artifactEntries = await Promise.all(
  [...files.entries()].map(async ([path, contents]) => ({
    path,
    bytes: new TextEncoder().encode(contents).byteLength,
    sha256: await sha256(contents)
  })),
);
const manifest = {
  schemaVersion: "1.0",
  milestone: "M1",
  generator: {
    id: "m1-artifact-generator",
    version: "1.0.0"
  },
  sourceDocumentHash,
  runtimeApplicationApiCalls: 0,
  physicalVerification: "required",
  artifacts: artifactEntries
};
await writeFile(
  new URL("artifact-manifest.json", outputDirectoryUrl),
  json(manifest),
  "utf8",
);

process.stdout.write(
  `Generated ${String(artifactEntries.length)} deterministic M1 artifacts for ${sourceDocumentHash}.\n`,
);
