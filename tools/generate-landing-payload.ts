import { mkdir, writeFile } from "node:fs/promises";

import { sha256, stableJson } from "../src/domain/hash.js";
import { LANDING_STATIC_MANIFEST_VERSION } from "../src/landing/static-manifest-contract.js";
import { renderSceneSvg } from "../src/projections/mesh/render-svg.js";
import { buildLandingPayload } from "./landing-payload.js";

const first = await buildLandingPayload();
const second = await buildLandingPayload();
if (first.bytes !== second.bytes) throw new Error("LANDING_PAYLOAD_NONDETERMINISTIC");

const destination = new URL("../src/landing/basic-demo-payload.json", import.meta.url);
await mkdir(new URL("../src/landing/", import.meta.url), { recursive: true });
await writeFile(destination, first.bytes, "utf8");
const publicDirectory = new URL("../public/landing/", import.meta.url);
await mkdir(publicDirectory, { recursive: true });
const assembledScene = renderSceneSvg(first.payload.scene, "assembled");
await writeFile(new URL("basic-demo-assembled.svg", publicDirectory), assembledScene, "utf8");
await writeFile(new URL("basic-demo-sheet.svg", publicDirectory), first.sheetSvg, "utf8");
const staticManifest = {
  schemaVersion: "1.0",
  contractVersion: LANDING_STATIC_MANIFEST_VERSION,
  sourceDocumentHash: first.payload.source.sourceDocumentHash,
  sheetHash: first.payload.source.sheetHash,
  assembledScene: {
    path: "/landing/basic-demo-assembled.svg",
    sha256: await sha256(assembledScene)
  },
  sheet: {
    path: "/landing/basic-demo-sheet.svg",
    sha256: await sha256(first.sheetSvg)
  }
};
await writeFile(
  new URL("../src/landing/basic-demo-static-manifest.json", import.meta.url),
  `${stableJson(staticManifest)}\n`,
  "utf8",
);
process.stdout.write(`Generated current landing payload ${first.payload.source.sourceDocumentHash}.\n`);
