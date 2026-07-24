import path from "node:path";

import { writeSealedPartitionCommitment } from "../src/evaluation/sealed-partition.js";

type Arguments = {
  inputRoot: string;
  commitmentPath: string;
};

function parseArguments(argv: readonly string[]): Arguments {
  let inputRoot: string | null = null;
  let commitmentPath: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--input-root") {
      inputRoot = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--commitment") {
      commitmentPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new Error(`SEALED_PARTITION_ARGUMENT_UNKNOWN:${argument ?? ""}`);
  }
  if (inputRoot === null || commitmentPath === null) {
    throw new Error(
      "Usage: npm run seal:semantic-evaluation -- --input-root <external-directory> --commitment <workspace-record.json>"
    );
  }
  return {
    inputRoot: path.resolve(inputRoot),
    commitmentPath: path.resolve(commitmentPath)
  };
}

try {
  const argumentsValue = parseArguments(process.argv.slice(2));
  const commitment = await writeSealedPartitionCommitment(argumentsValue);
  process.stdout.write(`${JSON.stringify({
    status: "sealed-commitment-recorded",
    partitionId: commitment.partitionId,
    commitmentSha256: commitment.commitmentSha256,
    caseIds: commitment.caseIds,
    manifestBytes: commitment.manifestBytes,
    totalPayloadBytes: commitment.totalPayloadBytes
  })}\n`);
} catch {
  process.stderr.write("SEALED_PARTITION_INGESTION_FAILED\n");
  process.exitCode = 1;
}
