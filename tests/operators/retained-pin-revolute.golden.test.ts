import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { buildM3GoldenMatrix } from "../helpers/m3-golden.js";

describe("M3 retained-pin golden matrix", () => {
  it("matches the fixed named/off-family matrix inside the shared motion budget", async () => {
    const expected = JSON.parse(
      await readFile(
        new URL("../golden/m3-revolute-matrix.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    const startedAt = performance.now();
    const observed = await buildM3GoldenMatrix();
    const durationMs = performance.now() - startedAt;
    expect(observed).toEqual(expected);
    expect(durationMs).toBeLessThan(5_000);
  });
});
