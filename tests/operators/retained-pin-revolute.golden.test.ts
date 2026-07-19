import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { buildRetainedPinGoldenMatrix } from "../helpers/retained-pin-golden.js";

describe("retained-pin revolute golden matrix", () => {
  it("matches the fixed named/off-family matrix inside the shared motion budget", async () => {
    const expected = JSON.parse(
      await readFile(
        new URL("../golden/retained-pin-revolute-matrix.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    const startedAt = performance.now();
    const observed = await buildRetainedPinGoldenMatrix();
    const durationMs = performance.now() - startedAt;
    const withoutEvaluatedHashes = (value: typeof observed) => {
      const normalized = structuredClone(value);
      for (const item of normalized.cases) item.documentHash = "evaluated-hash-separate-from-geometry";
      return normalized;
    };
    expect(withoutEvaluatedHashes(observed)).toEqual(withoutEvaluatedHashes(expected as typeof observed));
    const expectedEvaluated = JSON.parse(
      await readFile(
        new URL("../golden/fabrication-evidence-hash-matrix.json", import.meta.url),
        "utf8",
      ),
    ) as { schemaVersion: "1.0"; matrixId: "fabrication-evidence-current"; cases: { id: string; documentHash: string }[] };
    expect({
      schemaVersion: "1.0",
      matrixId: "fabrication-evidence-current",
      cases: observed.cases.map(({ id, documentHash }) => ({ id, documentHash }))
    }).toEqual(expectedEvaluated);
    expect(durationMs).toBeLessThan(5_000);
  });
});
