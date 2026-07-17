import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import {
  DesignDocumentV1Schema,
  ProjectionBundleSchema,
  StudioImportVerificationSchema,
  XToolStudioHandoffSchema,
  canonicalArtifactSetHash,
  renderXToolStudioChecklist,
  sha256
} from "../src/index.js";

const outputDirectory = new URL("../artifacts/m3.1.1/", import.meta.url);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M3.1.1"),
  generator: z.object({ id: z.literal("m3-1-1-artifact-generator"), version: z.literal("1.0.0") }).strict(),
  runtimeApplicationApiCalls: z.literal(0),
  processingPerformed: z.literal(false),
  physicalVerification: z.literal("required"),
  artifacts: z.array(z.object({ path: z.string(), bytes: z.number().int(), sha256: HashSchema }).strict())
}).strict();

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(path, outputDirectory), "utf8")) as unknown;
const manifest = ManifestSchema.parse(await readJson("artifact-manifest.json"));
for (const artifact of manifest.artifacts) {
  const url = new URL(artifact.path, outputDirectory);
  if ((await stat(url)).size !== artifact.bytes || await sha256(await readFile(url)) !== artifact.sha256) {
    throw new Error(`M3.1.1 artifact ${artifact.path} changed.`);
  }
}

const product = DesignDocumentV1Schema.parse(await readJson("product/project.json"));
const productBundle = ProjectionBundleSchema.parse(await readJson("product/projection-bundle.json"));
const optionalFitTest = DesignDocumentV1Schema.parse(await readJson("optional-cut-width-fit-test/project.json"));
const optionalFitTestBundle = ProjectionBundleSchema.parse(await readJson("optional-cut-width-fit-test/projection-bundle.json"));
const handoff = XToolStudioHandoffSchema.parse(await readJson("handoff.json"));
const verification = StudioImportVerificationSchema.parse(
  await readJson("reports/studio-import-verification-template.json"),
);
if (verification.status !== "not-performed") {
  throw new Error("Generated M3.1.1 package must not fabricate Studio-import or processing evidence.");
}
for (const [group, bundle, document] of [
  [handoff.artifactGroups[0]!, productBundle, product],
  [handoff.artifactGroups[1]!, optionalFitTestBundle, optionalFitTest]
] as const) {
  if (group.sourceDocumentHash !== bundle.sourceDocumentHash || bundle.sourceDocumentHash === "") {
    throw new Error(`${group.id} source-document linkage changed.`);
  }
  if (document.resolvedInputs.machine.id !== handoff.target.id) {
    throw new Error(`${group.id} machine target changed.`);
  }
  const hash = await canonicalArtifactSetHash(
    group.id,
    group.sheets.map((sheet) => ({ sheetId: sheet.sheetId, svgSha256: sheet.svgSha256 })),
  );
  if (hash !== group.artifactSetHash) throw new Error(`${group.id} artifact-set hash changed.`);
  for (const sheet of group.sheets) {
    const svgPath = `${group.id}/${sheet.sheetId}.svg`;
    const svg = await readFile(new URL(svgPath, outputDirectory), "utf8");
    if (
      await sha256(svg) !== sheet.svgSha256 ||
      /<text|<image|<script|<style|transform=|href=/.test(svg) ||
      !svg.includes(`width="${String(sheet.rootDimensionsMm.width)}mm"`) ||
      !svg.includes(`height="${String(sheet.rootDimensionsMm.height)}mm"`)
    ) {
      throw new Error(`${group.id}/${sheet.sheetId} plain-SVG or root identity changed.`);
    }
  }
}
if (
  product.resolvedInputs.fabricationContext.stockFootprint !== null ||
  optionalFitTest.resolvedInputs.fabricationContext.stockFootprint !== null ||
  handoff.operationMap.map((item) => item.operation).join(",") !== "engrave,score,cut"
) {
  throw new Error("M3.1.1 handoff boundary changed.");
}
const checklist = await readFile(new URL("checklist.md", outputDirectory), "utf8");
if (checklist !== renderXToolStudioChecklist(handoff)) {
  throw new Error("Readable M3.1.1 checklist diverged from the deterministic handoff.");
}
const complexityBudget = z.object({
  policy: z.literal("accepted-fixture-regression-budget-not-a-universal-Studio-limit"),
  groups: z.array(z.object({
    id: z.enum(["product", "optional-cut-width-fit-test"]),
    maximum: z.object({
      pathCount: z.number().int().positive(),
      segmentCount: z.number().int().positive(),
      vertexCount: z.number().int().positive(),
      svgByteSize: z.number().int().positive()
    }).strict()
  }).loose()).length(2)
}).loose().parse(await readJson("reports/complexity-regression-budget.json"));
for (const budget of complexityBudget.groups) {
  const group = handoff.artifactGroups.find((item) => item.id === budget.id)!;
  const observed = group.sheets.reduce((total, sheet) => ({
    pathCount: total.pathCount + sheet.complexity.pathCount,
    segmentCount: total.segmentCount + sheet.complexity.segmentCount,
    vertexCount: total.vertexCount + sheet.complexity.vertexCount,
    svgByteSize: total.svgByteSize + sheet.complexity.svgByteSize
  }), { pathCount: 0, segmentCount: 0, vertexCount: 0, svgByteSize: 0 });
  for (const key of Object.keys(observed) as (keyof typeof observed)[]) {
    if (observed[key] > budget.maximum[key]) {
      throw new Error(`${budget.id} exceeds its M3.1.1 fixture complexity budget.`);
    }
  }
}

const probeManifest = z.object({
  processingPerformed: z.literal(false),
  probes: z.array(z.object({ path: z.string(), bytes: z.number().int(), sha256: HashSchema }).loose()).length(3)
}).loose().parse(await readJson("probes/manifest.json"));
for (const probe of probeManifest.probes) {
  const contents = await readFile(new URL(`probes/${probe.path}`, outputDirectory));
  if (contents.byteLength !== probe.bytes || await sha256(contents) !== probe.sha256) {
    throw new Error(`Studio probe ${probe.path} changed.`);
  }
}

process.stdout.write(
  `Verified ${String(manifest.artifacts.length)} M3.1.1 artifacts, both exact artifact-set hashes, compact roots, handoff/checklist parity, and three non-processing Studio probes.\n`,
);
