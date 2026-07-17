import { canonicalGeometryHash } from "../compiler/canonical";
import { compileAccumulatedKerfGauge } from "../operators/accumulated-kerf-gauge";
import { compileRetainedPinProgram } from "../operators/retained-pin-revolute";
import { buildMultiSheetProjectionBundle } from "../projections/bundle";
import { nestPartsAcrossSheets } from "../projections/fabrication/nesting";

import type { CompileWorkerRequest, CompileWorkerResponse } from "./protocol";

const workerScope = globalThis as unknown as {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<CompileWorkerRequest>) => void,
  ) => void;
  postMessage: (message: CompileWorkerResponse) => void;
};

function compileErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown deterministic compile failure.";
  }
  const code = "code" in error && typeof error.code === "string" ? error.code : null;
  return code === null ? error.message : `${code}: ${error.message}`;
}

workerScope.addEventListener("message", (event: MessageEvent<CompileWorkerRequest>) => {
  void (async () => {
    const { requestId, program, profiles, inputPolicyEvaluation } = event.data;
    try {
      const [compiled, calibrationDocument] = await Promise.all([
        compileRetainedPinProgram(program, profiles, inputPolicyEvaluation),
        compileAccumulatedKerfGauge(profiles, inputPolicyEvaluation)
      ]);
      const document = compiled.document;
      const nests = nestPartsAcrossSheets(
        document.parts,
        profiles.machine,
        profiles.material,
      );
      const calibrationNests = nestPartsAcrossSheets(
        calibrationDocument.parts,
        profiles.machine,
        profiles.material,
      );
      const [artifacts, calibrationArtifacts, geometryHash, calibrationGeometryHash] =
        await Promise.all([
          buildMultiSheetProjectionBundle(document, nests),
          buildMultiSheetProjectionBundle(calibrationDocument, calibrationNests),
          canonicalGeometryHash(document),
          canonicalGeometryHash(calibrationDocument)
        ]);
      const response: CompileWorkerResponse = {
        requestId,
        status: "success",
        document,
        geometryHash,
        bundle: artifacts.bundle,
        svgs: artifacts.svgs,
        calibration: {
          document: calibrationDocument,
          geometryHash: calibrationGeometryHash,
          bundle: calibrationArtifacts.bundle,
          svgs: calibrationArtifacts.svgs
        }
      };
      workerScope.postMessage(response);
    } catch (error) {
      const response: CompileWorkerResponse = {
        requestId,
        status: "error",
        message: compileErrorMessage(error)
      };
      workerScope.postMessage(response);
    }
  })();
});

export {};
