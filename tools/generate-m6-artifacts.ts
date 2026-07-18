import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildM6EvidenceArtifacts } from "./m6-artifacts-lib.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const outputRoot = path.join(repositoryRoot, "artifacts/m6");
const { outputs } = await buildM6EvidenceArtifacts();
for (const output of outputs) {
  const destination = path.join(outputRoot, output.path);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, output.bytes);
}
process.stdout.write(`Generated ${String(outputs.length)} deterministic M6 evidence artifacts.\n`);
