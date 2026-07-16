import { mkdir, writeFile } from "node:fs/promises";

import { buildM1GoldenMatrix } from "../tests/helpers/m1-matrix.js";

const outputUrl = new URL("../tests/golden/m1-coupon-matrix.json", import.meta.url);
const matrix = await buildM1GoldenMatrix();

await mkdir(new URL(".", outputUrl), { recursive: true });
await writeFile(outputUrl, `${JSON.stringify(matrix, null, 2)}\n`, "utf8");
process.stdout.write(`Updated ${outputUrl.pathname} with ${String(matrix.cases.length)} cases.\n`);
