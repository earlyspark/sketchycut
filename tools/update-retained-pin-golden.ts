import { writeFile } from "node:fs/promises";

import { buildRetainedPinGoldenMatrix } from "../tests/helpers/retained-pin-golden.js";

await writeFile(
  new URL("../tests/golden/retained-pin-revolute-matrix.json", import.meta.url),
  `${JSON.stringify(await buildRetainedPinGoldenMatrix(), null, 2)}\n`,
  "utf8",
);
