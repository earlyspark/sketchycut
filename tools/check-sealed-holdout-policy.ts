import { readFile } from "node:fs/promises";

import {
  SealedHoldoutPanelV1Schema,
  verifyOpenedHoldoutPanel
} from "../tests/evaluation/support/holdout-policy.js";

async function main(): Promise<void> {
  const path = process.argv[2];
  const expectedCommitment = process.argv[3];
  const priorPaths = process.argv.slice(4);
  if (path === undefined || expectedCommitment === undefined) {
    process.stderr.write("SEALED_HOLDOUT_POLICY_FAIL\n");
    process.exitCode = 1;
    return;
  }
  try {
    const panel = JSON.parse(await readFile(path, "utf8")) as unknown;
    const priorPanels = await Promise.all(priorPaths.map(async (priorPath) =>
      SealedHoldoutPanelV1Schema.parse(JSON.parse(await readFile(priorPath, "utf8")))
    ));
    const report = await verifyOpenedHoldoutPanel({
      panel,
      expectedCommitment,
      priorNoveltyUniverse: {
        priorObjectAliases: priorPanels.flatMap((prior) =>
          prior.cases.flatMap((item) => item.objectAliases)
        ),
        priorRelationTuples: priorPanels.flatMap((prior) =>
          prior.cases.map((item) => item.relationTuple)
        )
      }
    });
    if (!report.pass) throw new Error("SEALED_HOLDOUT_POLICY_REJECTED");
    process.stdout.write("SEALED_HOLDOUT_POLICY_PASS\n");
  } catch {
    process.stderr.write("SEALED_HOLDOUT_POLICY_FAIL\n");
    process.exitCode = 1;
  }
}

await main();
