import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { buildCombinedMotionGoldenMatrix } from "../helpers/m4-golden.js";

describe("combined revolute and prismatic golden matrix", () => {
  it("matches every fixed named/off-family motion case inside five seconds", async () => {
    const expected = JSON.parse(
      await readFile(
        new URL("../golden/m4-motion-matrix.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    const startedAt = performance.now();
    const observed = await buildCombinedMotionGoldenMatrix();
    const durationMs = performance.now() - startedAt;
    expect(observed).toEqual(expected);
    expect(durationMs).toBeLessThan(5_000);
  });
});
