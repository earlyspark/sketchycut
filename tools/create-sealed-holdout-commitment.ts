import { readFile } from "node:fs/promises";

import { holdoutCommitment } from "../tests/evaluation/support/holdout-policy.js";

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path === undefined) throw new Error("Usage: create-sealed-holdout-commitment <builder-held-panel.json>");
  const panel = JSON.parse(await readFile(path, "utf8")) as unknown;
  const result = await holdoutCommitment(panel);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

await main();
