import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  ImageError,
  normalizeUploadedImage,
  verifyNormalizedReference
} from "../../src/server/generation/image-decoder.js";
import { GENERATION_POLICY } from "../../src/server/generation/policy.js";

async function png(width = 8, height = 6): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 220, g: 120, b: 40, alpha: 1 } }
  }).png().toBuffer();
}

describe("bounded server-side image decoding", () => {
  it("keeps the maximum three-reference JSON request below the production payload ceiling", () => {
    const maximumBase64Bytes = GENERATION_POLICY.image.maximumReferences *
      4 * Math.ceil(GENERATION_POLICY.image.maximumNormalizedBytes / 3);
    expect(maximumBase64Bytes + 100_000).toBeLessThan(
      GENERATION_POLICY.image.maximumGenerationRequestBytes,
    );
    expect(GENERATION_POLICY.image.maximumUploadRequestBytes).toBeLessThan(4_500_000);
    expect(GENERATION_POLICY.image.maximumGenerationRequestBytes).toBeLessThan(4_500_000);
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
    })).rejects.toBeInstanceOf(ImageError);
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
      bytes: Buffer.alloc(GENERATION_POLICY.image.maximumUploadRequestBytes + 1)
    })).rejects.toMatchObject({ code: "IMAGE_BODY_TOO_LARGE" });
    const tooManyPixels = await png(2_100, 2_100);
    expect(tooManyPixels.byteLength).toBeLessThan(GENERATION_POLICY.image.maximumUploadRequestBytes);
    await expect(normalizeUploadedImage({
      referenceId: "reference-1",
      declaredMediaType: "image/png",
      bytes: tooManyPixels
    })).rejects.toMatchObject({ code: "IMAGE_DECODE_FAILED" });
  });
});
