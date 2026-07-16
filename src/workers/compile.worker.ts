import { compileOrthogonalPanelProgram } from "../operators/orthogonal-compiler";
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

workerScope.addEventListener("message", (event: MessageEvent<CompileWorkerRequest>) => {
  void (async () => {
    const { requestId, program, profiles } = event.data;
    try {
      const document = await compileOrthogonalPanelProgram(program, profiles);
      const nests = nestPartsAcrossSheets(
        document.parts,
        profiles.machine,
        profiles.material,
      );
      const artifacts = await buildMultiSheetProjectionBundle(document, nests);
      const response: CompileWorkerResponse = {
        requestId,
        status: "success",
        document,
        bundle: artifacts.bundle,
        svgs: artifacts.svgs
      };
      workerScope.postMessage(response);
    } catch (error) {
      const response: CompileWorkerResponse = {
        requestId,
        status: "error",
        message: error instanceof Error ? error.message : "Unknown deterministic compile failure."
      };
      workerScope.postMessage(response);
    }
  })();
});

export {};
