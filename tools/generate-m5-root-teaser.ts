import { mkdir, writeFile } from "node:fs/promises";

import {
  canonicalDocumentHash,
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup,
  sha256
} from "../src/index.js";
import {
  DEFAULT_GUIDED_EXAMPLE,
  buildGuidedProductCompileRequest
} from "../src/ui/content/guided-examples.js";
import { renderSceneSvg } from "../src/projections/mesh/render-svg.js";
import { compileProductRequest } from "../src/workers/compile-service.js";

const outputDirectory = new URL("../public/m5/", import.meta.url);

function svgBody(svg: string): { viewBox: string; body: string } {
  const viewBox = /\bviewBox="([^"]+)"/.exec(svg)?.[1];
  const body = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg)?.[1];
  if (viewBox === undefined || body === undefined) {
    throw new Error("Expected a complete SVG with a viewBox.");
  }
  return { viewBox, body };
}

const applied = createPublicFabricationSetup();
const resolved = resolveFabricationSetup(applied);
const profiles = {
  material: resolved.material,
  machine: resolved.machine,
  processRecipe: resolved.processRecipe,
  fabricationContext: resolved.fabricationContext,
  fit: resolved.fit
};
const result = await compileProductRequest(buildGuidedProductCompileRequest(
  DEFAULT_GUIDED_EXAMPLE,
  {
    requestId: "m5-root-teaser",
    presetId: "medium",
    profiles,
    inputPolicyEvaluation: resolved.inputPolicyEvaluation,
    retainedPin: createStarterPinSetup()
  },
));
const assembled = svgBody(renderSceneSvg(result.bundle.scene, "assembled"));
const sheet = svgBody(result.svgs[0]!.svg);
const sourceDocumentHash = await canonicalDocumentHash(result.document);

const teaser = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-labelledby="title description">',
  '<title id="title">A glue-free plywood box beside its matching cut sheet</title>',
  '<desc id="description">Static canonical preview of an assembled open-top box on the left and the exact nested plywood parts on the right.</desc>',
  '<rect width="1600" height="900" fill="#0e171d"/>',
  '<rect x="36" y="36" width="950" height="828" rx="18" fill="#f7f3eb"/>',
  '<rect x="1018" y="36" width="546" height="828" rx="18" fill="#f7f3eb"/>',
  `<svg x="56" y="72" width="910" height="756" viewBox="${assembled.viewBox}" preserveAspectRatio="xMidYMid meet">${assembled.body}</svg>`,
  `<svg x="1042" y="78" width="498" height="744" viewBox="${sheet.viewBox}" preserveAspectRatio="xMidYMid meet">${sheet.body}</svg>`,
  '<rect x="36" y="36" width="950" height="828" rx="18" fill="none" stroke="#283842" stroke-width="3"/>',
  '<rect x="1018" y="36" width="546" height="828" rx="18" fill="none" stroke="#283842" stroke-width="3"/>',
  '</svg>',
  ''
].join("\n");
const teaserSha256 = await sha256(teaser);
const manifest = {
  schemaVersion: "1.0",
  generator: { id: "m5-root-teaser", version: "1.0.0" },
  fixture: {
    sourceId: DEFAULT_GUIDED_EXAMPLE.id,
    presetId: "medium",
    canonicalGeometryHash: result.geometryHash,
    sourceDocumentHash,
    sheetId: result.svgs[0]!.sheetId,
    sheetSvgSha256: result.svgs[0]!.sha256
  },
  asset: {
    path: "/m5/root-teaser.svg",
    sha256: teaserSha256,
    width: 1600,
    height: 900
  },
  runtimeApplicationApiCalls: 0,
  physicalVerification: "required"
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL("root-teaser.svg", outputDirectory), teaser);
await writeFile(
  new URL("root-teaser-manifest.json", outputDirectory),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
process.stdout.write(
  `Generated M5 root teaser ${teaserSha256} from canonical source ${sourceDocumentHash}.\n`,
);
