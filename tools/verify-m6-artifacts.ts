import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { strFromU8, unzipSync } from "fflate";

import { sha256 } from "../src/domain/hash.js";
import { M6PackageManifestSchema } from "../src/server/m6/package-builder.js";
import { buildM6EvidenceArtifacts } from "./m6-artifacts-lib.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const outputRoot = path.join(repositoryRoot, "artifacts/m6");
const { outputs } = await buildM6EvidenceArtifacts();
for (const output of outputs) {
  const actual = await readFile(path.join(outputRoot, output.path));
  if (!actual.equals(Buffer.from(output.bytes))) {
    throw new Error(`M6ART001_ARTIFACT_DRIFT: ${output.path}`);
  }
}
const archive = unzipSync(await readFile(path.join(outputRoot, "fabrication-package.zip")));
const manifest = M6PackageManifestSchema.parse(
  JSON.parse(strFromU8(archive["manifest.json"]!)) as unknown,
);
for (const entry of manifest.files) {
  const bytes = archive[entry.path];
  if (bytes === undefined) throw new Error(`M6ART002_PACKAGE_FILE_MISSING: ${entry.path}`);
  if (bytes.byteLength !== entry.bytes || await sha256(bytes) !== entry.sha256) {
    throw new Error(`M6ART002_PACKAGE_FILE_HASH_MISMATCH: ${entry.path}`);
  }
}
process.stdout.write(
  `Verified ${String(outputs.length)} byte-stable M6 artifacts and ${String(manifest.files.length)} complete-package file hashes across ${String(manifest.artifactGroups.length)} SVG groups.\n`,
);
