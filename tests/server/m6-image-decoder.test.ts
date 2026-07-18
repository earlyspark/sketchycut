import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  M6ImageError,
  normalizeUploadedImage,
  verifyNormalizedReference
} from "../../src/server/m6/image-decoder.js";
import { M6_POLICY } from "../../src/server/m6/policy.js";

async function png(width = 8, height = 6): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 220, g: 120, b: 40, alpha: 1 } }
  }).png().toBuffer();
}

describe("M6 bounded server-side image decoding", () => {
  it("keeps the maximum three-reference JSON request below the production payload ceiling", () => {
    const maximumBase64Bytes = M6_POLICY.image.maximumReferences *
      4 * Math.ceil(M6_POLICY.image.maximumNormalizedBytes / 3);
    expect(maximumBase64Bytes + 100_000).toBeLessThan(
      M6_POLICY.image.maximumGenerationRequestBytes,
    );
    expect(M6_POLICY.image.maximumUploadRequestBytes).toBeLessThan(4_500_000);
    expect(M6_POLICY.image.maximumGenerationRequestBytes).toBeLessThan(4_500_000);
  });

  it("decodes an admitted raster, strips it to normalized JPEG, and verifies it again", async () => {
    const normalized = await normalizeUploadedImage({
      referenceId: "reference-1",
      declaredMediaType: "image/png",
      bytes: await png()
    });
    expect(normalized.descriptor).toMatchObject({
      referenceId: "reference-1",
      mediaType: "image/jpeg",
      width: 8,
      height: 6
    });
    expect(normalized.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(await verifyNormalizedReference(normalized)).toEqual(normalized.bytes);
  });

  it("rejects content-type spoofing, undecodable bytes, and descriptor tampering", async () => {
    await expect(normalizeUploadedImage({
      referenceId: "reference-1",
      declaredMediaType: "image/jpeg",
      bytes: await png()
    })).rejects.toMatchObject({ code: "IMAGE_MEDIA_TYPE_MISMATCH" });
    await expect(normalizeUploadedImage({
      referenceId: "reference-1",
      declaredMediaType: "image/png",
      bytes: Buffer.from("not an image")
    })).rejects.toBeInstanceOf(M6ImageError);
    const normalized = await normalizeUploadedImage({
      referenceId: "reference-1",
      declaredMediaType: "image/png",
      bytes: await png()
    });
    await expect(verifyNormalizedReference({
      ...normalized,
      descriptor: { ...normalized.descriptor, sha256: "0".repeat(64) }
    })).rejects.toMatchObject({ code: "IMAGE_DESCRIPTOR_MISMATCH" });
  });

  it("rejects oversized byte payloads and compressed pixel bombs before normalization", async () => {
    await expect(normalizeUploadedImage({
      referenceId: "reference-1",
      declaredMediaType: "image/png",
      bytes: Buffer.alloc(M6_POLICY.image.maximumUploadRequestBytes + 1)
    })).rejects.toMatchObject({ code: "IMAGE_BODY_TOO_LARGE" });
    const tooManyPixels = await png(2_100, 2_100);
    expect(tooManyPixels.byteLength).toBeLessThan(M6_POLICY.image.maximumUploadRequestBytes);
    await expect(normalizeUploadedImage({
      referenceId: "reference-1",
      declaredMediaType: "image/png",
      bytes: tooManyPixels
    })).rejects.toMatchObject({ code: "IMAGE_DECODE_FAILED" });
  });
});
