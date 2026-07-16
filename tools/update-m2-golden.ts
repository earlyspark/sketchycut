import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  buildMultiSheetProjectionBundle,
  canonicalGeometryHash,
  nestPartsAcrossSheets
} from "../src/index.js";
import {
  ORTHOGONAL_PRESETS,
  createPrimaryPreset
} from "../src/ui/content/presets.js";
import {
  measuredBasswoodProfile,
  provisionalFitProfile,
  xtoolM2Profile
} from "../src/domain/profiles.js";
import { compileOrthogonalPanelProgram } from "../src/operators/orthogonal-compiler.js";

const outputPath = fileURLToPath(new URL("../tests/golden/m2-panel-matrix.json", import.meta.url));

const variants = [
  { id: "edge-low", thicknessMm: 2.5, kerfMm: 0.05 },
  { id: "low", thicknessMm: 2.7, kerfMm: 0.1 },
  { id: "nominal", thicknessMm: 3, kerfMm: 0.15 },
  { id: "high", thicknessMm: 3.3, kerfMm: 0.2 },
  { id: "edge-high", thicknessMm: 3.6, kerfMm: 0.4 }
] as const;

const cases = [];
for (const preset of ORTHOGONAL_PRESETS) {
  for (const variant of variants) {
    const profiles = {
      material: measuredBasswoodProfile([
        variant.thicknessMm,
        variant.thicknessMm,
        variant.thicknessMm
      ]),
      machine: xtoolM2Profile(variant.kerfMm),
      fit: provisionalFitProfile()
    };
    const document = await compileOrthogonalPanelProgram(
      createPrimaryPreset(preset.id, profiles),
      profiles,
    );
    const artifacts = await buildMultiSheetProjectionBundle(
      document,
      nestPartsAcrossSheets(document.parts, profiles.machine, profiles.material),
    );
    cases.push({
      id: `${preset.id}-${variant.id}`,
      presetId: preset.id,
      measuredThicknessMm: variant.thicknessMm,
      kerfMm: variant.kerfMm,
      geometryHash: await canonicalGeometryHash(document),
      sheetSvgHashes: artifacts.svgs.map((item) => item.sha256),
      partCount: document.parts.length,
      jointCount: document.joints.length,
      sheetCount: artifacts.bundle.fabrication.sheets.length,
      manufacturingPathCount: artifacts.bundle.fabrication.sheets.reduce(
        (sum, sheet) => sum + sheet.paths.length,
        0,
      ),
      meshVertexCounts: Object.fromEntries(
        artifacts.bundle.scene.meshes.map((mesh) => [mesh.partId, mesh.verticesMm.length]),
      ),
      validationCodes: document.validation.findings.map((finding) => finding.code)
    });
  }
}

await mkdir(fileURLToPath(new URL("../tests/golden/", import.meta.url)), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({ schemaVersion: "1.0", milestone: "M2.1", cases }, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`Updated ${outputPath} with ${String(cases.length)} cases.\n`);
