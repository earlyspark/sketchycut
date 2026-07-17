import { mkdir, writeFile } from "node:fs/promises";

import { sha256 } from "../src/index.js";

import {
  M5_ARTIFACT_GENERATOR,
  buildM5ReplayArtifactCorpus,
  json
} from "./m5-replay-artifacts-lib.js";

const outputDirectory = new URL("../artifacts/m5/", import.meta.url);
const corpus = await buildM5ReplayArtifactCorpus();

await mkdir(outputDirectory, { recursive: true });
for (const [relativePath, contents] of corpus.files) {
  const url = new URL(relativePath, outputDirectory);
  await mkdir(new URL("./", url), { recursive: true });
  await writeFile(url, contents, "utf8");
}

const artifacts = await Promise.all([...corpus.files.entries()].map(
  async ([path, contents]) => ({
    path,
    bytes: new TextEncoder().encode(contents).byteLength,
    sha256: await sha256(contents)
  }),
));
await writeFile(new URL("artifact-manifest.json", outputDirectory), json({
  schemaVersion: "1.0",
  milestone: "M5",
  generator: M5_ARTIFACT_GENERATOR,
  summary: corpus.summary,
  geometryHashes: corpus.geometryHashes,
  evaluatedDocumentHashes: corpus.evaluatedDocumentHashes,
  svgHashes: corpus.svgHashes,
  runtimeApplicationApiCalls: 0,
  physicalVerification: "required",
  artifacts
}), "utf8");

process.stdout.write(
  `Generated ${String(artifacts.length)} M5 replay artifacts across ${String(corpus.summary.scenarioCount)} scenarios with zero runtime application calls.\n`,
);
