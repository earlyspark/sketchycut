import type { CompileWorkerResponse } from "./protocol.js";

export type LatestCompileRequestIds = {
  product: string;
  fixture: string;
};

export function isLatestCompileResponse(
  response: CompileWorkerResponse,
  latest: LatestCompileRequestIds,
): boolean {
  const expectedRequestId = response.kind.startsWith("product-")
    ? latest.product
    : latest.fixture;
  return response.requestId === expectedRequestId;
}
