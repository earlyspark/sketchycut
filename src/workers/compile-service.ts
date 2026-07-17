import { canonicalGeometryHash } from "../compiler/canonical.js";
import { createStarterFabricationSetup, resolveFabricationSetup } from "../domain/fabrication-setup.js";
import { compileAccumulatedKerfGauge } from "../operators/accumulated-kerf-gauge.js";
import { compileOrthogonalPanelProgram } from "../operators/orthogonal-compiler.js";
import { compileRetainedPinProgram } from "../operators/retained-pin-revolute.js";
import { buildMultiSheetProjectionBundle } from "../projections/bundle.js";
import { buildFabricationEvidenceProjection } from "../projections/evidence.js";
import { nestPartsAcrossSheets } from "../projections/fabrication/nesting.js";

import type {
  FixtureCompileWorkerRequest,
  FixtureCompileWorkerSuccess,
  ProductCompileWorkerRequest,
  ProductCompileWorkerSuccess
} from "./protocol.js";
import { requireStructuralProgramMatch } from "./protocol.js";

export async function compileProductRequest(
  request: ProductCompileWorkerRequest,
): Promise<ProductCompileWorkerSuccess> {
  const parsedRequest = requireStructuralProgramMatch(request);
  const document = parsedRequest.structuralKind === "orthogonal-panel"
    ? await compileOrthogonalPanelProgram(
        parsedRequest.program,
        parsedRequest.profiles,
        parsedRequest.inputPolicyEvaluation,
      )
    : (await compileRetainedPinProgram(
        parsedRequest.program,
        parsedRequest.profiles,
        parsedRequest.inputPolicyEvaluation,
      )).document;
  const nests = nestPartsAcrossSheets(
    document.parts,
    parsedRequest.profiles.machine,
    parsedRequest.profiles.material,
    parsedRequest.profiles.processRecipe,
    parsedRequest.profiles.fabricationContext,
  );
  const [artifacts, geometryHash, evidence] = await Promise.all([
    buildMultiSheetProjectionBundle(document, nests),
    canonicalGeometryHash(document),
    buildFabricationEvidenceProjection(document)
  ]);
  return {
    kind: "product-success",
    requestId: parsedRequest.requestId,
    status: "success",
    document,
    geometryHash,
    bundle: artifacts.bundle,
    evidence,
    svgs: artifacts.svgs
  };
}

export async function compileFixtureRequest(
  request: FixtureCompileWorkerRequest,
): Promise<FixtureCompileWorkerSuccess> {
  const starter = resolveFabricationSetup(
    createStarterFabricationSetup(request.stockPresetId),
  );
  const profiles = {
    material: starter.material,
    machine: starter.machine,
    processRecipe: starter.processRecipe,
    fabricationContext: starter.fabricationContext,
    fit: starter.fit
  };
  const document = await compileAccumulatedKerfGauge(
    profiles,
    starter.inputPolicyEvaluation,
  );
  const nests = nestPartsAcrossSheets(
    document.parts,
    profiles.machine,
    profiles.material,
    profiles.processRecipe,
    profiles.fabricationContext,
  );
  const [artifacts, geometryHash] = await Promise.all([
    buildMultiSheetProjectionBundle(document, nests),
    canonicalGeometryHash(document)
  ]);
  return {
    kind: "fixture-success",
    requestId: request.requestId,
    status: "success",
    document,
    geometryHash,
    bundle: artifacts.bundle,
    svgs: artifacts.svgs
  };
}
