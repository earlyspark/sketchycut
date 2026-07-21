import { readFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../src/domain/hash.js";
import { PhysicalConfidenceObservationDraftSchema } from
  "../src/ui/content/physical-confidence-contracts.js";
import { verifyPhysicalConfidencePackage } from
  "../src/ui/content/physical-confidence.js";
import { evaluatePhysicalConfidenceObservation } from
  "../src/ui/content/physical-confidence-observation.js";

function usage(): never {
  throw new Error(
    "Usage: npm run verify:physical-observation -- <package.zip> <observation.json>",
  );
}

async function main(): Promise<void> {
  const packagePath = process.argv[2];
  const observationPath = process.argv[3];
  if (packagePath === undefined || observationPath === undefined || process.argv.length !== 4) {
    usage();
  }
  const packageBytes = new Uint8Array(await readFile(packagePath));
  const verifiedPackage = await verifyPhysicalConfidencePackage(packageBytes);
  const observationBytes = new Uint8Array(await readFile(observationPath));
  const observation = PhysicalConfidenceObservationDraftSchema.parse(
    JSON.parse(new TextDecoder().decode(observationBytes)) as unknown,
  );
  const evaluation = evaluatePhysicalConfidenceObservation(
    observation,
    verifiedPackage.packageSha256,
    verifiedPackage.manifest,
  );
  const observationDirectory = path.dirname(path.resolve(observationPath));
  const mediaFindings: { code: string; message: string }[] = [];
  for (const media of observation.media) {
    const mediaPath = path.resolve(observationDirectory, media.filename);
    if (
      mediaPath === observationDirectory ||
      !mediaPath.startsWith(`${observationDirectory}${path.sep}`)
    ) {
      mediaFindings.push({
        code: "OBSERVATION_MEDIA_PATH_INVALID",
        message: `${media.filename} must resolve below the observation directory.`
      });
      continue;
    }
    try {
      const mediaBytes = new Uint8Array(await readFile(mediaPath));
      const actualSha256 = await sha256(mediaBytes);
      if (actualSha256 !== media.sha256) {
        mediaFindings.push({
          code: "OBSERVATION_MEDIA_HASH_MISMATCH",
          message: `${media.filename} does not match its recorded SHA-256.`
        });
      }
    } catch {
      mediaFindings.push({
        code: "OBSERVATION_MEDIA_FILE_MISSING",
        message: `${media.filename} could not be read beside the observation record.`
      });
    }
  }
  const status = evaluation.status === "pass" && mediaFindings.length === 0
    ? "pass"
    : "fail";
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "sketchycut-physical-observation-verification@1.0.0",
    status,
    candidateId: verifiedPackage.manifest.candidateId,
    packageSha256: verifiedPackage.packageSha256,
    observationSha256: await sha256(observationBytes),
    findings: [...evaluation.findings, ...mediaFindings]
  }, null, 2)}\n`);
  if (status !== "pass") process.exitCode = 1;
}

await main();
