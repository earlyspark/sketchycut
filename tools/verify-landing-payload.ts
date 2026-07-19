import { readFile } from "node:fs/promises";

import { hashCanonical, sha256, stableJson } from "../src/domain/hash.js";
import {
  readLandingDemoPayload
} from "../src/landing/payload-contract.js";
import {
  LANDING_STATIC_MANIFEST_VERSION,
  readLandingStaticManifest
} from "../src/landing/static-manifest-contract.js";
import { renderSceneSvg } from "../src/projections/mesh/render-svg.js";
import { buildLandingPayload } from "./landing-payload.js";

const first = await buildLandingPayload();
const second = await buildLandingPayload();
if (first.bytes !== second.bytes) throw new Error("LANDING_PAYLOAD_NONDETERMINISTIC");

const committed = await readFile(
  new URL("../src/landing/basic-demo-payload.json", import.meta.url),
  "utf8",
);
if (committed !== first.bytes) throw new Error("LANDING_PAYLOAD_BYTES_CHANGED");
const parsed = readLandingDemoPayload(JSON.parse(committed) as unknown);
if (parsed.source.sourceDocumentHash !== first.payload.source.sourceDocumentHash ||
    parsed.source.geometryHash !== first.payload.source.geometryHash ||
    parsed.source.sheetHash !== await hashCanonical(parsed.sheet) ||
    parsed.source.sheetSvgHash !== first.payload.source.sheetSvgHash) {
  throw new Error("LANDING_PAYLOAD_HASH_MISMATCH");
}
const committedManifestBytes = await readFile(
  new URL("../src/landing/basic-demo-static-manifest.json", import.meta.url),
  "utf8",
);
const manifest = readLandingStaticManifest(JSON.parse(committedManifestBytes) as unknown);
const assembledScene = renderSceneSvg(first.payload.scene, "assembled");
const expectedManifest = {
  schemaVersion: "1.0",
  contractVersion: LANDING_STATIC_MANIFEST_VERSION,
  sourceDocumentHash: parsed.source.sourceDocumentHash,
  sheetHash: parsed.source.sheetHash,
  assembledScene: {
    path: "/landing/basic-demo-assembled.svg",
    sha256: await sha256(assembledScene)
  },
  sheet: {
    path: "/landing/basic-demo-sheet.svg",
    sha256: await sha256(first.sheetSvg)
  }
};
if (committedManifestBytes !== `${stableJson(expectedManifest)}\n`) {
  throw new Error("LANDING_STATIC_MANIFEST_BYTES_CHANGED");
}
const [committedScene, committedSheet] = await Promise.all([
  readFile(new URL("../public/landing/basic-demo-assembled.svg", import.meta.url), "utf8"),
  readFile(new URL("../public/landing/basic-demo-sheet.svg", import.meta.url), "utf8")
]);
if (committedScene !== assembledScene || committedSheet !== first.sheetSvg ||
    await sha256(committedScene) !== manifest.assembledScene.sha256 ||
    await sha256(committedSheet) !== manifest.sheet.sha256) {
  throw new Error("LANDING_STATIC_ASSET_HASH_MISMATCH");
}
process.stdout.write(
  `Verified current landing payload and static fallback ${parsed.source.sourceDocumentHash} and ${parsed.source.sheetHash}.\n`,
);
