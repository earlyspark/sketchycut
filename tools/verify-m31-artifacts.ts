import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import {
  DesignDocumentV1Schema,
  ProjectionBundleSchema,
  canonicalDocumentHash,
  canonicalGeometryHash,
  sha256
} from "../src/index.js";
import { FabricationEvidenceProjectionSchema } from "../src/projections/evidence.js";

const outputDirectory = new URL("../artifacts/m3.1/", import.meta.url);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M3.1"),
  generator: z.object({ id: z.literal("m3-1-artifact-generator"), version: z.literal("1.0.0") }).strict(),
  protectedStatus: z.literal("pass"),
  runtimeApplicationApiCalls: z.literal(0),
  physicalVerification: z.literal("required"),
  artifacts: z.array(z.object({ path: z.string(), bytes: z.number().int(), sha256: HashSchema }).strict())
}).strict();

const manifest = ManifestSchema.parse(JSON.parse(await readFile(
  new URL("artifact-manifest.json", outputDirectory), "utf8",
)) as unknown);
for (const artifact of manifest.artifacts) {
  const url = new URL(artifact.path, outputDirectory);
  if ((await stat(url)).size !== artifact.bytes || await sha256(await readFile(url)) !== artifact.sha256) {
    throw new Error(`M3.1 artifact ${artifact.path} changed.`);
  }
}

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(path, outputDirectory), "utf8")) as unknown;
const starter = DesignDocumentV1Schema.parse(await readJson("starter/project.json"));
const one = DesignDocumentV1Schema.parse(await readJson("one-reading/project.json"));
const three = DesignDocumentV1Schema.parse(await readJson("three-readings/project.json"));
const fixtureDerived = DesignDocumentV1Schema.parse(await readJson("fixture-derived/project.json"));
const fixture = DesignDocumentV1Schema.parse(await readJson("fixture/project.json"));
ProjectionBundleSchema.parse(await readJson("starter/projection-bundle.json"));
ProjectionBundleSchema.parse(await readJson("fixture/projection-bundle.json"));
for (const path of [
  "starter/evidence.json",
  "one-reading/evidence.json",
  "three-readings/evidence.json",
  "fixture-derived/evidence.json"
]) FabricationEvidenceProjectionSchema.parse(await readJson(path));

const [starterGeometry, oneGeometry, threeGeometry] = await Promise.all([
  canonicalGeometryHash(starter), canonicalGeometryHash(one), canonicalGeometryHash(three)
]);
if (
  starterGeometry !== oneGeometry ||
  oneGeometry !== threeGeometry ||
  await canonicalDocumentHash(starter) === await canonicalDocumentHash(one) ||
  await canonicalDocumentHash(one) === await canonicalDocumentHash(three) ||
  starter.provenance.inputPolicyEvaluation?.thickness.measurement !== undefined ||
  starter.provenance.inputPolicyEvaluation?.findings.some(
    (finding) => finding.code === "STOCK_THICKNESS_UNMEASURED",
  ) !== true ||
  one.provenance.inputPolicyEvaluation?.thickness.measurement?.samplesMm.length !== 1 ||
  three.provenance.inputPolicyEvaluation?.thickness.measurement?.samplesMm.length !== 3 ||
  fixtureDerived.provenance.inputPolicyEvaluation?.kerf.source !== "fixture-derived" ||
  fixtureDerived.provenance.inputPolicyEvaluation.kerf.fixtureEvidence === undefined ||
  fixture.parts.length !== 10 ||
  fixture.externalStock !== undefined
) {
  throw new Error("M3.1 source, hash-separation, or independent-fixture contract changed.");
}

const reconciliation = z.object({
  observed: z.record(z.string(), HashSchema),
  expected: z.record(z.string(), HashSchema)
}).loose().parse(await readJson("reports/protected-reconciliation.json"));
if (JSON.stringify(reconciliation.observed) !== JSON.stringify(reconciliation.expected)) {
  throw new Error("M3.1 protected identity reconciliation failed.");
}
const stop = z.object({
  presentationLabel: z.literal("Lid-open stop"),
  canonical: z.object({
    partId: z.literal("open-stop-brace"),
    partName: z.literal("Open-angle stop brace"),
    operatorVersion: z.literal("1.0.0"),
    endpointContact: z.object({ id: z.literal("open-stop-brace-contact"), angleDegrees: z.literal(105) }).loose(),
    range: z.object({ minimum: z.literal(0), maximum: z.literal(105), unit: z.literal("degree") }).strict()
  }).strict(),
  boundaries: z.object({
    deterministicEndpointProof: z.literal(true),
    animationIsProof: z.literal(false),
    physicalVerificationPerformed: z.literal(false)
  }).strict()
}).loose().parse(await readJson("reports/lid-open-stop-identity.json"));
void stop;

process.stdout.write(
  `Verified ${String(manifest.artifacts.length)} M3.1 artifacts, source-aware hashes, independent fixture, and Lid-open-stop identity.\n`,
);
