import { writeFile } from "node:fs/promises";

import { buildCombinedMotionGoldenMatrix } from "../tests/helpers/m4-golden.js";

await writeFile(
  new URL("../tests/golden/m4-motion-matrix.json", import.meta.url),
  `${JSON.stringify(await buildCombinedMotionGoldenMatrix(), null, 2)}\n`,
  "utf8",
);
