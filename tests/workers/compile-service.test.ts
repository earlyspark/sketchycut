import { describe, expect, it } from "vitest";

import { compileFixtureRequest } from "../../src/workers/compile-service.js";

describe("independent calibration fixture worker service", () => {
  it("compiles without product, pin, thickness draft, or cut-width draft state", async () => {
    const result = await compileFixtureRequest({
      kind: "fixture-compile",
      requestId: "fixture-independent",
      stockPresetId: "stock-3mm-basswood-laser-plywood"
    });
    expect(result.kind).toBe("fixture-success");
    expect(result.document.parts).toHaveLength(10);
    expect(result.document.externalStock).toBeUndefined();
    expect(result.svgs).toHaveLength(1);
    expect(result.svgs[0]?.sha256).toBe(
      "57f7acf645d8be4461e820596ba9bd0e57242490917f3616331c228d9feceb15",
    );
  });

  it("replays the registered-stock fixture byte-identically", async () => {
    const [first, second] = await Promise.all([
      compileFixtureRequest({
        kind: "fixture-compile", requestId: "fixture-first",
        stockPresetId: "stock-3mm-basswood-laser-plywood"
      }),
      compileFixtureRequest({
        kind: "fixture-compile", requestId: "fixture-second",
        stockPresetId: "stock-3mm-basswood-laser-plywood"
      })
    ]);
    expect(second.svgs).toEqual(first.svgs);
  });
});
