import { describe, expect, it } from "vitest";

import { isLatestCompileResponse } from "../../src/workers/latest-response.js";
import type { CompileWorkerResponse } from "../../src/workers/protocol.js";

function failure(
  kind: "product-error" | "fixture-error",
  requestId: string,
): CompileWorkerResponse {
  return {
    kind,
    requestId,
    status: "error",
    message: "seeded response"
  };
}

describe("latest compile response gate", () => {
  const latest = { product: "product-3", fixture: "fixture-7" };

  it("accepts only the newest product response", () => {
    expect(isLatestCompileResponse(failure("product-error", "product-3"), latest)).toBe(true);
    expect(isLatestCompileResponse(failure("product-error", "product-2"), latest)).toBe(false);
  });

  it("accepts only the newest fixture response without coupling request streams", () => {
    expect(isLatestCompileResponse(failure("fixture-error", "fixture-7"), latest)).toBe(true);
    expect(isLatestCompileResponse(failure("fixture-error", "fixture-6"), latest)).toBe(false);
    expect(isLatestCompileResponse(failure("fixture-error", "product-3"), latest)).toBe(false);
  });
});
