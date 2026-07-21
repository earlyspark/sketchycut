import { createHash } from "node:crypto";

import sharp from "sharp";
import { z } from "zod";

import {
  SemanticReferenceDescriptorSchema,
  type SemanticReferenceDescriptor
} from "../../interpretation/semantic-input-contracts.js";
import { GENERATION_POLICY } from "./policy.js";

const SupportedMediaTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
type SupportedMediaType = z.infer<typeof SupportedMediaTypeSchema>;

const FORMAT_MEDIA_TYPE: Readonly<Record<string, SupportedMediaType | undefined>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export class ImageError extends Error {
  readonly code:
    | "IMAGE_BODY_TOO_LARGE"
    | "IMAGE_MEDIA_TYPE_UNSUPPORTED"
    | "IMAGE_MEDIA_TYPE_MISMATCH"
    | "IMAGE_DECODE_FAILED"
    | "IMAGE_DIMENSIONS_INVALID"
    | "IMAGE_NORMALIZED_TOO_LARGE"
    | "IMAGE_DESCRIPTOR_MISMATCH";

  constructor(code: ImageError["code"]) {
    super(code);
    this.name = "ImageError";
    this.code = code;
  }
}

export type NormalizedImage = {
  descriptor: SemanticReferenceDescriptor;
  dataUrl: string;
  bytes: Buffer;
  normalizationDisposition: "preserved" | "normalized";
};

function mediaTypeForFormat(format: string | undefined): SupportedMediaType | null {
  if (format === undefined) return null;
  return FORMAT_MEDIA_TYPE[format] ?? null;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function normalizeUploadedImage(input: {
  referenceId: string;
  declaredMediaType: string;
  bytes: Uint8Array;
}): Promise<NormalizedImage> {
  const declared = SupportedMediaTypeSchema.safeParse(input.declaredMediaType);
  if (!declared.success) throw new ImageError("IMAGE_MEDIA_TYPE_UNSUPPORTED");
  if (input.bytes.byteLength === 0 ||
      input.bytes.byteLength > GENERATION_POLICY.image.maximumUploadRequestBytes) {
    throw new ImageError("IMAGE_BODY_TOO_LARGE");
  }
  try {
    const pipeline = sharp(input.bytes, {
      failOn: "warning",
      limitInputPixels: GENERATION_POLICY.image.maximumPixels,
      sequentialRead: true,
      animated: false
    });
    const metadata = await pipeline.metadata();
    const detected = mediaTypeForFormat(metadata.format);
    if (detected === null) throw new ImageError("IMAGE_MEDIA_TYPE_UNSUPPORTED");
    if (detected !== declared.data) throw new ImageError("IMAGE_MEDIA_TYPE_MISMATCH");
    if (metadata.width < 1 || metadata.height < 1 ||
        metadata.width * metadata.height > GENERATION_POLICY.image.maximumPixels ||
        (metadata.pages ?? 1) !== 1) {
      throw new ImageError("IMAGE_DIMENSIONS_INVALID");
    }
    const canPreserve = input.bytes.byteLength <= GENERATION_POLICY.image.maximumNormalizedBytes &&
      metadata.width <= GENERATION_POLICY.image.maximumEdge &&
      metadata.height <= GENERATION_POLICY.image.maximumEdge;
    if (canPreserve) {
      const sourceBytes = Buffer.from(input.bytes);
      const descriptor = SemanticReferenceDescriptorSchema.parse({
        referenceId: input.referenceId,
        sha256: sha256(sourceBytes),
        mediaType: detected,
        width: metadata.width,
        height: metadata.height
      });
      return {
        descriptor,
        dataUrl: `data:${detected};base64,${sourceBytes.toString("base64")}`,
        bytes: sourceBytes,
        normalizationDisposition: "preserved"
      };
    }
    let result: Awaited<ReturnType<typeof pipeline.toBuffer>> | null = null;
    for (const edge of [2_048, 1_792, 1_536, 1_280, 1_024] as const) {
      const normalized = pipeline.clone()
        .rotate()
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" });
      for (const quality of [94, 92, 90, 88] as const) {
        const candidate = await normalized.clone()
          .jpeg({ quality, chromaSubsampling: "4:4:4", progressive: false })
          .toBuffer({ resolveWithObject: true });
        if (candidate.data.byteLength <= GENERATION_POLICY.image.maximumNormalizedBytes) {
          result = candidate;
          break;
        }
      }
      if (result !== null) break;
    }
    if (result === null) throw new ImageError("IMAGE_NORMALIZED_TOO_LARGE");
    const descriptor = SemanticReferenceDescriptorSchema.parse({
      referenceId: input.referenceId,
      sha256: sha256(result.data),
      mediaType: "image/jpeg",
      width: result.info.width,
      height: result.info.height
    });
    return {
      descriptor,
      dataUrl: `data:image/jpeg;base64,${result.data.toString("base64")}`,
      bytes: result.data,
      normalizationDisposition: "normalized"
    };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw new ImageError("IMAGE_DECODE_FAILED");
  }
}

export function decodeStrictImageDataUrl(dataUrl: string): {
  mediaType: SupportedMediaType;
  bytes: Buffer;
} {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (match === null) throw new ImageError("IMAGE_DECODE_FAILED");
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > GENERATION_POLICY.image.maximumNormalizedBytes) {
    throw new ImageError("IMAGE_BODY_TOO_LARGE");
  }
  return { mediaType: SupportedMediaTypeSchema.parse(match[1]), bytes };
}

export async function verifyNormalizedReference(input: {
  descriptor: SemanticReferenceDescriptor;
  dataUrl: string;
}): Promise<Buffer> {
  const descriptor = SemanticReferenceDescriptorSchema.parse(input.descriptor);
  const decoded = decodeStrictImageDataUrl(input.dataUrl);
  if (decoded.mediaType !== descriptor.mediaType || sha256(decoded.bytes) !== descriptor.sha256) {
    throw new ImageError("IMAGE_DESCRIPTOR_MISMATCH");
  }
  try {
    const metadata = await sharp(decoded.bytes, {
      failOn: "warning",
      limitInputPixels: GENERATION_POLICY.image.maximumPixels,
      sequentialRead: true,
      animated: false
    }).metadata();
    const detected = mediaTypeForFormat(metadata.format);
    if (detected !== descriptor.mediaType) throw new ImageError("IMAGE_MEDIA_TYPE_MISMATCH");
    if (metadata.width !== descriptor.width || metadata.height !== descriptor.height ||
        metadata.width > GENERATION_POLICY.image.maximumEdge ||
        metadata.height > GENERATION_POLICY.image.maximumEdge ||
        (metadata.pages ?? 1) !== 1) {
      throw new ImageError("IMAGE_DESCRIPTOR_MISMATCH");
    }
    return decoded.bytes;
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw new ImageError("IMAGE_DECODE_FAILED");
  }
}
