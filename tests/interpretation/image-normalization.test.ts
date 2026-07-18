import { describe, expect, it } from "vitest";

import {
  MAX_NORMALIZED_IMAGE_EDGE,
  MAX_REFERENCE_BYTES,
  ReferenceInputError,
  normalizeReferenceFiles,
  validateReferenceFiles,
  type ImageNormalizationAdapter,
  type ReferenceFileInput
} from "../../src/interpretation/image-normalization.js";

function file(bytes: string, type = "image/png", name = "private-name.png"): ReferenceFileInput {
  const blob = new Blob([bytes], { type }) as ReferenceFileInput;
  Object.defineProperty(blob, "name", { value: name });
  return blob;
}

const adapter: ImageNormalizationAdapter = ({ blob, maximumEdge }) => Promise.resolve({
  blob: new Blob([blob], { type: "image/jpeg" }),
  width: Math.min(800, maximumEdge),
  height: Math.min(600, maximumEdge)
});

describe("reference validation and normalization", () => {
  it("requires one to three supported images and returns typed, filename-free errors", () => {
    expect(() => validateReferenceFiles([])).toThrow(ReferenceInputError);
    expect(() => validateReferenceFiles([
      file("1"), file("2"), file("3"), file("4")
    ])).toThrow(/one and three/);
    expect(() => validateReferenceFiles([file("text", "text/plain", "secret.txt")])).toThrow(
      /Reference 1/,
    );
    try {
      validateReferenceFiles([file("text", "text/plain", "secret.txt")]);
    } catch (error) {
      expect(error).toBeInstanceOf(ReferenceInputError);
      expect((error as Error).message).not.toContain("secret.txt");
    }
    const oversized = {
      name: "large-private.png",
      type: "image/png",
      size: MAX_REFERENCE_BYTES + 1
    } as ReferenceFileInput;
    expect(() => validateReferenceFiles([oversized])).toThrow(/12 MB/);
  });

  it("strips filenames, preserves order, and hashes only normalized image bytes", async () => {
    const normalized = await normalizeReferenceFiles([
      file("first", "image/png", "first-private.png"),
      file("second", "image/jpeg", "second-private.jpg")
    ], adapter);
    expect(normalized.map((item) => item.referenceId)).toEqual(["reference-1", "reference-2"]);
    expect(normalized[0]!.descriptor.sha256).not.toBe(normalized[1]!.descriptor.sha256);
    expect(JSON.stringify(normalized.map((item) => item.descriptor))).not.toMatch(/private|filename|name/);
    expect(normalized.every((item) => item.descriptor.mediaType === "image/jpeg")).toBe(true);
    expect(MAX_NORMALIZED_IMAGE_EDGE).toBe(1_280);
  });

  it("is byte-deterministic for an identical normalized image", async () => {
    const first = await normalizeReferenceFiles([file("same")], adapter);
    const second = await normalizeReferenceFiles([file("same")], adapter);
    expect(first[0]!.descriptor).toEqual(second[0]!.descriptor);
  });
});
