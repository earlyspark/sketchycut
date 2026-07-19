import {
  canonicalDocumentHash,
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../src/index.js";
import { hashCanonical, stableJson } from "../src/domain/hash.js";
import {
  LANDING_PAYLOAD_VERSION,
  type LandingDemoPayload
} from "../src/landing/payload-contract.js";
import {
  DEFAULT_GUIDED_EXAMPLE,
  buildGuidedProductCompileRequest
} from "../src/ui/content/guided-examples.js";
import { compileProductRequest } from "../src/workers/compile-service.js";

export async function buildLandingPayload(): Promise<{
  payload: LandingDemoPayload;
  bytes: string;
  sheetSvg: string;
}> {
  const resolved = resolveFabricationSetup(createPublicFabricationSetup());
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
      requestId: "landing-basic-current",
      presetId: "medium",
      profiles,
      inputPolicyEvaluation: resolved.inputPolicyEvaluation,
      retainedPin: createStarterPinSetup()
    },
  ));
  const sheet = result.bundle.fabrication.sheets[0];
  const svg = result.svgs[0];
  const stock = resolved.fabricationContext.stockFootprint;
  if (sheet === undefined || svg === undefined || stock === null || svg.sheetId !== sheet.id) {
    throw new Error("LANDING_PAYLOAD_SOURCE_INCOMPLETE");
  }
  const sourceDocumentHash = await canonicalDocumentHash(result.document);
  if (sourceDocumentHash !== result.bundle.sourceDocumentHash) {
    throw new Error("LANDING_PAYLOAD_SOURCE_HASH_MISMATCH");
  }
  const payload: LandingDemoPayload = {
    schemaVersion: "1.0",
    contractVersion: LANDING_PAYLOAD_VERSION,
    source: {
      exampleId: "guided-example",
      presetId: "medium",
      sourceDocumentHash,
      geometryHash: result.geometryHash,
      sheetId: sheet.id,
      sheetHash: await hashCanonical(sheet),
      sheetSvgHash: svg.sha256
    },
    scene: result.bundle.scene,
    sheet,
    markings: (result.bundle.legend?.entries ?? []).map((entry) => ({
      partId: entry.partId,
      markingCode: entry.markingCode
    })),
    stockFootprintMm: { width: stock.widthMm, height: stock.heightMm }
  };
  return { payload, bytes: `${stableJson(payload)}\n`, sheetSvg: svg.svg };
}
