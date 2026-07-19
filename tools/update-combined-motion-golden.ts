import { writeFile } from "node:fs/promises";

import { buildCombinedMotionGoldenMatrix } from "../tests/helpers/combined-motion-golden.js";

await writeFile(
  new URL("../tests/golden/combined-motion-matrix.json", import.meta.url),
  `${JSON.stringify(await buildCombinedMotionGoldenMatrix(), null, 2)}\n`,
  "utf8",
);
