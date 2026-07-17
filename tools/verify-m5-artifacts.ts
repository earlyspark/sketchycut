import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import { sha256 } from "../src/index.js";

import {
  M5_ARTIFACT_GENERATOR,
  buildM5ReplayArtifactCorpus
} from "./m5-replay-artifacts-lib.js";

const root = new URL("../artifacts/m5/", import.meta.url);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M5"),
  generator: z.object({
    id: z.literal(M5_ARTIFACT_GENERATOR.id),
    version: z.literal(M5_ARTIFACT_GENERATOR.version)
  }).strict(),
  summary: z.object({
    scenarioCount: z.literal(11),
    compiledCount: z.number().int().min(8),
    conceptOnlyCount: z.number().int().min(1),
    failureCount: z.number().int().min(1),
    motifRecipeCount: z.number().int().min(3),
    runtimeApplicationApiCalls: z.literal(0)
  }).strict(),
  geometryHashes: z.record(z.string(), HashSchema),
  evaluatedDocumentHashes: z.record(z.string(), HashSchema),
  svgHashes: z.record(z.string(), HashSchema),
  runtimeApplicationApiCalls: z.literal(0),
  physicalVerification: z.literal("required"),
  artifacts: z.array(z.object({
    path: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: HashSchema
  }).strict()).min(1)
}).strict();

const manifest = ManifestSchema.parse(JSON.parse(await readFile(
  new URL("artifact-manifest.json", root),
  "utf8",
)) as unknown);
if (new Set(manifest.artifacts.map((item) => item.path)).size !== manifest.artifacts.length) {
  throw new Error("M5 artifact manifest contains duplicate paths.");
}

const expected = await buildM5ReplayArtifactCorpus();
if (
  JSON.stringify(manifest.summary) !== JSON.stringify(expected.summary) ||
  JSON.stringify(manifest.geometryHashes) !== JSON.stringify(expected.geometryHashes) ||
  JSON.stringify(manifest.evaluatedDocumentHashes) !==
    JSON.stringify(expected.evaluatedDocumentHashes) ||
  JSON.stringify(manifest.svgHashes) !== JSON.stringify(expected.svgHashes)
) {
  throw new Error("M5 replay manifest identities no longer match deterministic recomputation.");
}
const expectedPaths = [...expected.files.keys()].sort();
const manifestPaths = manifest.artifacts.map((item) => item.path).sort();
if (JSON.stringify(expectedPaths) !== JSON.stringify(manifestPaths)) {
  throw new Error("M5 artifact manifest path set changed.");
}
for (const artifact of manifest.artifacts) {
  const url = new URL(artifact.path, root);
  const [bytes, metadata] = await Promise.all([readFile(url), stat(url)]);
  const expectedContents = expected.files.get(artifact.path);
  if (expectedContents === undefined) throw new Error(`Unexpected M5 artifact ${artifact.path}.`);
  if (
    metadata.size !== artifact.bytes ||
    await sha256(bytes) !== artifact.sha256 ||
    bytes.toString("utf8") !== expectedContents
  ) {
    throw new Error(`M5 artifact ${artifact.path} no longer matches deterministic bytes.`);
  }
}

const complexity = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M5"),
  policy: z.literal("exact imported replay-corpus maxima; not a universal xTool Studio limit"),
  evidence: z.object({
    status: z.literal("exact-hash-studio-import-verified"),
    studioDesktopVersion: z.literal("1.7.30"),
    reportPath: z.literal("docs/evidence/m05/reports/studio-import-complexity.json"),
    exactArtifactSource: z.literal("both-role/sheet-1"),
    verifiedSvgSha256: z.literal(
      "168e863072aa11f8080d2898312b21bf6b874c7012fd8e118e64b2e36808268d",
    )
  }).strict(),
  maxima: z.record(z.string(), z.object({
    maximum: z.number().int().positive(),
    exactArtifactSources: z.array(z.string()).min(1)
  }).strict()),
  observedSheets: z.array(z.unknown()).min(1)
}).strict().parse(JSON.parse(await readFile(new URL("complexity-budget.json", root), "utf8")));
const studioImportReport = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M5"),
  status: z.literal("pass"),
  scope: z.literal("exact-replay-corpus-complexity-import-only"),
  artifact: z.object({
    source: z.literal("artifacts/m5/scenarios/both-role/sheet-1.svg"),
    svgSha256: z.literal(
      "168e863072aa11f8080d2898312b21bf6b874c7012fd8e118e64b2e36808268d",
    ),
    expectedRootDimensionsMm: z.object({
      width: z.literal(252.3),
      height: z.literal(226.45)
    }).strict(),
    expectedOccupiedSelectionDimensionsMm: z.object({
      width: z.literal(242.3),
      height: z.literal(216.45)
    }).strict(),
    importedOccupiedSelectionDimensionsMm: z.object({
      width: z.literal(242.3),
      height: z.literal(216.45)
    }).strict(),
    dimensionResult: z.literal("pass"),
    parsed: z.literal(true),
    manualRescalingPerformed: z.literal(false)
  }).loose(),
  environment: z.object({
    studioDesktopVersion: z.literal("1.7.30"),
    svgDpi: z.literal(72),
    vectorQuality: z.literal("High"),
    oversizedImportPreference: z.literal("ask-every-time")
  }).loose(),
  processingPerformed: z.literal(false),
  claimLimit: z.string().min(1)
}).loose().parse(JSON.parse(await readFile(
  new URL("../docs/evidence/m05/reports/studio-import-complexity.json", import.meta.url),
  "utf8",
)) as unknown);
void studioImportReport;
if (
  complexity.maxima.segmentCount?.exactArtifactSources.includes(
    complexity.evidence.exactArtifactSource,
  ) !== true ||
  complexity.maxima.vertexCount?.exactArtifactSources.includes(
    complexity.evidence.exactArtifactSource,
  ) !== true ||
  complexity.maxima.svgByteSize?.exactArtifactSources.includes(
    complexity.evidence.exactArtifactSource,
  ) !== true
) {
  throw new Error("M5 exact Studio import no longer establishes the replay-corpus maxima.");
}

const motifs = z.object({
  recipes: z.array(z.object({
    composition: z.string(),
    density: z.string(),
    symmetry: z.string(),
    firstTreatmentGeometrySha256: HashSchema,
    repeatedTreatmentGeometrySha256: HashSchema,
    byteIdentical: z.literal(true),
    materiallyVisible: z.literal(true)
  }).loose()).min(3)
}).loose().parse(JSON.parse(await readFile(new URL("motif-determinism.json", root), "utf8")));
if (new Set(motifs.recipes.map((item) =>
  `${item.composition}|${item.density}|${item.symmetry}`)).size < 3 ||
  motifs.recipes.some((item) =>
    item.firstTreatmentGeometrySha256 !== item.repeatedTreatmentGeometrySha256)
) {
  throw new Error("M5 motif replay evidence lost three distinct byte-stable recipes.");
}

process.stdout.write(
  `Verified ${String(manifest.artifacts.length)} M5 artifact hashes, ${String(manifest.summary.scenarioCount)} replay outcomes, deterministic motif geometry, and the exact Studio-backed complexity budget.\n`,
);
