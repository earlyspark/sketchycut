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
    const withoutEvaluatedHashes = (value: typeof observed) => {
      const normalized = structuredClone(value);
      for (const item of normalized.cases) item.documentHash = "evaluated-hash-separated-by-m3-1";
      return normalized;
    };
    expect(withoutEvaluatedHashes(observed)).toEqual(withoutEvaluatedHashes(expected as typeof observed));
    const expectedEvaluated = JSON.parse(
      await readFile(
        new URL("../golden/m3.1-evaluated-hash-matrix.json", import.meta.url),
        "utf8",
      ),
    ) as { schemaVersion: "1.0"; milestone: "M3.1"; cases: { id: string; documentHash: string }[] };
    expect({
      schemaVersion: "1.0",
      milestone: "M3.1",
      cases: observed.cases.map(({ id, documentHash }) => ({ id, documentHash }))
    }).toEqual(expectedEvaluated);
    expect(durationMs).toBeLessThan(5_000);
  });
});
