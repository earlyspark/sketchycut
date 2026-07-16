import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import { sha256 } from "../src/domain/hash.js";

const outputDirectoryUrl = new URL("../artifacts/m1/", import.meta.url);
const manifestUrl = new URL("artifact-manifest.json", outputDirectoryUrl);
const ManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    milestone: z.literal("M1"),
    generator: z
      .object({
        id: z.literal("m1-artifact-generator"),
        version: z.string()
      })
      .strict(),
    sourceDocumentHash: z.string().regex(/^[0-9a-f]{64}$/),
    runtimeApplicationApiCalls: z.literal(0),
    physicalVerification: z.literal("required"),
    artifacts: z.array(
      z
        .object({
          path: z.string().min(1),
          bytes: z.number().int().nonnegative(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/)
        })
        .strict(),
    )
  })
  .strict();

const manifest = ManifestSchema.parse(
  JSON.parse(await readFile(manifestUrl, "utf8")) as unknown,
);
for (const artifact of manifest.artifacts) {
  const url = new URL(artifact.path, outputDirectoryUrl);
  const contents = await readFile(url);
  const metadata = await stat(url);
  if (metadata.size !== artifact.bytes) {
    throw new Error(
      `${artifact.path} byte count changed: expected ${String(artifact.bytes)}, observed ${String(metadata.size)}.`,
    );
  }
  const observedHash = await sha256(contents);
  if (observedHash !== artifact.sha256) {
    throw new Error(
      `${artifact.path} hash changed: expected ${artifact.sha256}, observed ${observedHash}.`,
    );
  }
}

process.stdout.write(
  `Verified ${String(manifest.artifacts.length)} M1 artifact hashes for ${manifest.sourceDocumentHash}.\n`,
);
