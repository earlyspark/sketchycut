import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import {
  DesignDocumentV1Schema,
  ProjectionBundleSchema,
  sha256,
  validateFabricationProjection
} from "../src/index.js";

const outputDirectoryUrl = new URL("../artifacts/m2/", import.meta.url);
const ManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    milestone: z.literal("M2"),
    generator: z
      .object({
        id: z.literal("m2-artifact-generator"),
        version: z.string()
      })
      .strict(),
    sourceDocumentHashes: z
      .object({
        primary: z.string().regex(/^[0-9a-f]{64}$/),
        forcedMultiSheet: z.string().regex(/^[0-9a-f]{64}$/)
      })
      .strict(),
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
  JSON.parse(await readFile(new URL("artifact-manifest.json", outputDirectoryUrl), "utf8")) as unknown,
);
for (const artifact of manifest.artifacts) {
  const url = new URL(artifact.path, outputDirectoryUrl);
  const contents = await readFile(url);
  const metadata = await stat(url);
  if (metadata.size !== artifact.bytes) {
    throw new Error(`${artifact.path} byte count changed.`);
  }
  if (await sha256(contents) !== artifact.sha256) {
    throw new Error(`${artifact.path} hash changed.`);
  }
}

const primary = DesignDocumentV1Schema.parse(
  JSON.parse(await readFile(new URL("primary/project.json", outputDirectoryUrl), "utf8")) as unknown,
);
const primaryBundle = ProjectionBundleSchema.parse(
  JSON.parse(await readFile(new URL("primary/projection-bundle.json", outputDirectoryUrl), "utf8")) as unknown,
);
const forced = DesignDocumentV1Schema.parse(
  JSON.parse(await readFile(new URL("forced-multi-sheet/project.json", outputDirectoryUrl), "utf8")) as unknown,
);
const forcedBundle = ProjectionBundleSchema.parse(
  JSON.parse(
    await readFile(new URL("forced-multi-sheet/projection-bundle.json", outputDirectoryUrl), "utf8"),
  ) as unknown,
);
if (
  primary.validation.status !== "pass" ||
  forced.validation.status !== "pass" ||
  validateFabricationProjection(primaryBundle.fabrication, primary.parts).status !== "pass" ||
  validateFabricationProjection(forcedBundle.fabrication, forced.parts).status !== "pass"
) {
  throw new Error("Canonical or fabrication validation is no longer passing.");
}
if (forcedBundle.fabrication.sheets.length < 2) {
  throw new Error("Forced proof no longer produces multiple sheets.");
}
const forcedPartIds = forcedBundle.fabrication.sheets.flatMap((sheet) =>
  sheet.placements.map((placement) => placement.partId),
);
if (
  forcedPartIds.length !== forced.parts.length ||
  new Set(forcedPartIds).size !== forcedPartIds.length
) {
  throw new Error("Forced proof no longer places every canonical part exactly once.");
}
process.stdout.write(
  `Verified ${String(manifest.artifacts.length)} M2 artifact hashes and linked projection gates.\n`,
);
