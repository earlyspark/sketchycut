import { canonicalGeometryHash } from "../compiler/canonical.js";
import { createStarterFabricationSetup, resolveFabricationSetup } from "../domain/fabrication-setup.js";
import { compileAccumulatedKerfGauge } from "../operators/accumulated-kerf-gauge.js";
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

export async function compileProductRequest(
  request: ProductCompileWorkerRequest,
): Promise<ProductCompileWorkerSuccess> {
  const compiled = await compileRetainedPinProgram(
    request.program,
    request.profiles,
    request.inputPolicyEvaluation,
  );
  const document = compiled.document;
  const nests = nestPartsAcrossSheets(
    document.parts,
    request.profiles.machine,
    request.profiles.material,
  );
  const [artifacts, geometryHash, evidence] = await Promise.all([
    buildMultiSheetProjectionBundle(document, nests),
    canonicalGeometryHash(document),
    buildFabricationEvidenceProjection(document)
  ]);
  return {
    kind: "product-success",
    requestId: request.requestId,
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
