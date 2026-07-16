import { describe, expect, it } from "vitest";

import { hashCanonical, stableJson } from "../../src/domain/hash.js";
import { mmToUm, umToMm } from "../../src/domain/units.js";

describe("canonical units and hashes", () => {
  it("converts public millimetres to integer micrometres without float drift", () => {
    expect(mmToUm(2.7)).toBe(2700);
    expect(mmToUm(3)).toBe(3000);
    expect(mmToUm(3.3)).toBe(3300);
    expect(umToMm(3150)).toBe(3.15);
  });

  it("rejects non-finite or unsafe internal coordinates", () => {
    expect(() => mmToUm(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => mmToUm(Number.MAX_SAFE_INTEGER)).toThrow();
  });

  it("serializes object keys deterministically and produces stable SHA-256 hashes", async () => {
    const first = { z: 1, a: { y: 2, x: 3 } };
    const second = { a: { x: 3, y: 2 }, z: 1 };
    expect(stableJson(first)).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(stableJson(first)).toBe(stableJson(second));
    await expect(hashCanonical(first)).resolves.toBe(await hashCanonical(second));
  });
});
