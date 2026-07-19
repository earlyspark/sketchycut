import { mkdir, writeFile } from "node:fs/promises";

import { buildCalibrationCouponGoldenMatrix } from "../tests/helpers/calibration-coupon-matrix.js";

const outputUrl = new URL("../tests/golden/calibration-coupon-matrix.json", import.meta.url);
const matrix = await buildCalibrationCouponGoldenMatrix();

await mkdir(new URL(".", outputUrl), { recursive: true });
await writeFile(outputUrl, `${JSON.stringify(matrix, null, 2)}\n`, "utf8");
process.stdout.write(`Updated ${outputUrl.pathname} with ${String(matrix.cases.length)} cases.\n`);
