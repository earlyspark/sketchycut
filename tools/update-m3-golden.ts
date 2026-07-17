import { writeFile } from "node:fs/promises";

import { buildM3GoldenMatrix } from "../tests/helpers/m3-golden.js";

await writeFile(
  new URL("../tests/golden/m3-revolute-matrix.json", import.meta.url),
  `${JSON.stringify(await buildM3GoldenMatrix(), null, 2)}\n`,
  "utf8",
);
