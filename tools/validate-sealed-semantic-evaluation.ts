import path from "node:path";

import {
  validateSealedPartitionPrivacySafe
} from "../src/evaluation/sealed-partition.js";

function inputRootFromArguments(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== "--input-root" || argv[1] === undefined) {
    throw new Error("SEALED_PARTITION_ARGUMENTS_INVALID");
  }
  return path.resolve(argv[1]);
}

try {
  const summary = await validateSealedPartitionPrivacySafe(
    inputRootFromArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch {
  process.stderr.write("SEALED_PARTITION_VALIDATION_FAILED\n");
  process.exitCode = 1;
}
