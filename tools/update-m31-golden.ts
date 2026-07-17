import { mkdir, writeFile } from "node:fs/promises";

import { buildM3GoldenMatrix } from "../tests/helpers/m3-golden.js";

const outputUrl = new URL("../tests/golden/m3.1-evaluated-hash-matrix.json", import.meta.url);
await mkdir(new URL("../tests/golden/", import.meta.url), { recursive: true });
const matrix = await buildM3GoldenMatrix();
await writeFile(outputUrl, `${JSON.stringify({
  schemaVersion: "1.0",
  milestone: "M3.1",
  cases: matrix.cases.map(({ id, documentHash }) => ({ id, documentHash }))
}, null, 2)}\n`);
process.stdout.write(`Updated M3.1 evaluated-hash golden with ${String(matrix.cases.length)} cases.\n`);
