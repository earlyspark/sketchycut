import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import {
  DesignDocumentV1Schema,
  ProjectionBundleSchema,
  canonicalDocumentHash,
  canonicalGeometryHash,
  sha256,
  validateFabricationProjection
} from "../src/index.js";

const outputDirectoryUrl = new URL("../artifacts/m2.1/", import.meta.url);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    milestone: z.literal("M2.1"),
    generator: z
      .object({
        id: z.literal("m2-1-artifact-generator"),
        version: z.string()
      })
      .strict(),
    geometryHashes: z.object({ product: HashSchema, gauge: HashSchema }).strict(),
    evaluatedDocumentHashes: z.object({ product: HashSchema, gauge: HashSchema }).strict(),
    runtimeApplicationApiCalls: z.literal(0),
    physicalVerification: z.literal("required"),
    artifacts: z.array(
      z
        .object({
          path: z.string().min(1),
          bytes: z.number().int().nonnegative(),
          sha256: HashSchema
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

const product = DesignDocumentV1Schema.parse(
  JSON.parse(await readFile(new URL("product/project.json", outputDirectoryUrl), "utf8")) as unknown,
);
const productBundle = ProjectionBundleSchema.parse(
  JSON.parse(
    await readFile(new URL("product/projection-bundle.json", outputDirectoryUrl), "utf8"),
  ) as unknown,
);
const gauge = DesignDocumentV1Schema.parse(
  JSON.parse(await readFile(new URL("gauge/project.json", outputDirectoryUrl), "utf8")) as unknown,
);
const gaugeBundle = ProjectionBundleSchema.parse(
  JSON.parse(
    await readFile(new URL("gauge/projection-bundle.json", outputDirectoryUrl), "utf8"),
  ) as unknown,
);
if (
  product.validation.status !== "pass" ||
  gauge.validation.status !== "pass" ||
  validateFabricationProjection(productBundle.fabrication, product.parts).status !== "pass" ||
  validateFabricationProjection(gaugeBundle.fabrication, gauge.parts).status !== "pass"
) {
  throw new Error("M2.1 canonical or fabrication validation is no longer passing.");
}
if (
  await canonicalGeometryHash(product) !== manifest.geometryHashes.product ||
  await canonicalGeometryHash(gauge) !== manifest.geometryHashes.gauge ||
  await canonicalDocumentHash(product) !== manifest.evaluatedDocumentHashes.product ||
  await canonicalDocumentHash(gauge) !== manifest.evaluatedDocumentHashes.gauge
) {
  throw new Error("M2.1 recorded canonical hashes no longer match recomputation.");
}
if (
  gauge.parts.length !== 10 ||
  gauge.calibrationMeasurements?.[0]?.pieceCount !== 10 ||
  !gauge.parts.every((part) => part.features[0]?.toolpathCompensation === "none") ||
  gaugeBundle.scene.meshes.length !== 10 ||
  gaugeBundle.bom.entries.length !== 10 ||
  gaugeBundle.legend?.entries.length !== 10
) {
  throw new Error("M2.1 accumulated-kerf fixture linkage or uncompensated geometry changed.");
}
const hashReport = z
  .object({
    assertions: z.record(z.string(), z.literal(true))
  })
  .loose()
  .parse(
    JSON.parse(await readFile(new URL("hash-separation.json", outputDirectoryUrl), "utf8")) as unknown,
  );
const requiredHashAssertions = [
  "policyVersionPreservesGeometry",
  "policyVersionChangesEvaluation",
  "policyVersionPreservesProductSvg",
  "sameMedianDifferentSpreadPreservesGeometry",
  "sameMedianDifferentSpreadChangesEvaluation",
  "directionalKerfPreservesGeometry",
  "directionalKerfChangesEvaluation",
  "directionalKerfChangesProductSvg",
  "provisionalKerfPreservesGaugeSvg"
] as const;
if (
  Object.keys(hashReport.assertions).length !== requiredHashAssertions.length ||
  requiredHashAssertions.some((id) => hashReport.assertions[id] !== true)
) {
  throw new Error("M2.1 hash-separation report no longer covers every required assertion.");
}
const sweep = z
  .object({
    runtimeApplicationApiCalls: z.literal(0),
    measurementSubstitutionAllowed: z.literal(false),
    summary: z
      .object({
        runCount: z.literal(14),
        evaluatedCount: z.literal(1029),
        unclassifiedFailureCount: z.literal(0)
      })
      .loose(),
    runs: z.array(
      z
        .object({
          id: z.string(),
          failCount: z.number().int().nonnegative(),
          transitions: z.array(z.unknown())
        })
        .loose(),
    )
  })
  .loose()
  .parse(
    JSON.parse(await readFile(new URL("input-sweep.json", outputDirectoryUrl), "utf8")) as unknown,
  );
if (sweep.runs.filter((run) => run.id.startsWith("public-")).some((run) => run.failCount !== 0)) {
  throw new Error("A public preset no longer compiles throughout the supported input envelope.");
}
const shallowProof = sweep.runs.find((run) => run.id === "m2-shallow-proof-thickness");
if (
  shallowProof?.failCount !== 40 ||
  !JSON.stringify(shallowProof.transitions).includes("TREATMENT_SAFE_REGION_UNAVAILABLE")
) {
  throw new Error("The disclosed open-tray construction limitation changed without evidence update.");
}
process.stdout.write(
  `Verified ${String(manifest.artifacts.length)} M2.1 artifact hashes, hash separation, gauge linkage, and sweep gates.\n`,
);
