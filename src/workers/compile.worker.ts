import { compileFixtureRequest, compileProductRequest } from "./compile-service";
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
    const request = event.data;
    try {
      workerScope.postMessage(
        request.kind === "product-compile"
          ? await compileProductRequest(request)
          : await compileFixtureRequest(request),
      );
    } catch (error) {
      workerScope.postMessage({
        kind: request.kind === "product-compile" ? "product-error" : "fixture-error",
        requestId: request.requestId,
        status: "error",
        message: compileErrorMessage(error)
      });
    }
  })();
});

export {};
