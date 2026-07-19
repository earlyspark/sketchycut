import { mkdir, writeFile } from "node:fs/promises";

import { buildRetainedPinGoldenMatrix } from "../tests/helpers/retained-pin-golden.js";

const outputUrl = new URL("../tests/golden/fabrication-evidence-hash-matrix.json", import.meta.url);
await mkdir(new URL("../tests/golden/", import.meta.url), { recursive: true });
const matrix = await buildRetainedPinGoldenMatrix();
await writeFile(outputUrl, `${JSON.stringify({
  schemaVersion: "1.0",
  matrixId: "fabrication-evidence-current",
  cases: matrix.cases.map(({ id, documentHash }) => ({ id, documentHash }))
}, null, 2)}\n`);
process.stdout.write(`Updated current fabrication-evidence golden with ${String(matrix.cases.length)} cases.\n`);
