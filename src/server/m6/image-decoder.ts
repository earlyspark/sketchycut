import { createHash } from "node:crypto";

import sharp from "sharp";
import { z } from "zod";

import {
  SemanticReferenceDescriptorSchema,
  type SemanticReferenceDescriptor
} from "../../interpretation/semantic-request.js";
import { M6_POLICY } from "./policy.js";

const SupportedMediaTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
type SupportedMediaType = z.infer<typeof SupportedMediaTypeSchema>;

const FORMAT_MEDIA_TYPE: Readonly<Record<string, SupportedMediaType | undefined>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export class M6ImageError extends Error {
  readonly code:
    | "IMAGE_BODY_TOO_LARGE"
    | "IMAGE_MEDIA_TYPE_UNSUPPORTED"
    | "IMAGE_MEDIA_TYPE_MISMATCH"
    | "IMAGE_DECODE_FAILED"
    | "IMAGE_DIMENSIONS_INVALID"
    | "IMAGE_NORMALIZED_TOO_LARGE"
    | "IMAGE_DESCRIPTOR_MISMATCH";

  constructor(code: M6ImageError["code"]) {
    super(code);
    this.name = "M6ImageError";
    this.code = code;
  }
}

export type M6NormalizedImage = {
  descriptor: SemanticReferenceDescriptor;
  dataUrl: string;
  bytes: Buffer;
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
}): Promise<M6NormalizedImage> {
  const declared = SupportedMediaTypeSchema.safeParse(input.declaredMediaType);
  if (!declared.success) throw new M6ImageError("IMAGE_MEDIA_TYPE_UNSUPPORTED");
  if (input.bytes.byteLength === 0 ||
      input.bytes.byteLength > M6_POLICY.image.maximumUploadRequestBytes) {
    throw new M6ImageError("IMAGE_BODY_TOO_LARGE");
  }
  try {
    const pipeline = sharp(input.bytes, {
      failOn: "warning",
      limitInputPixels: M6_POLICY.image.maximumPixels,
      sequentialRead: true,
      animated: false
    });
    const metadata = await pipeline.metadata();
    const detected = mediaTypeForFormat(metadata.format);
    if (detected === null) throw new M6ImageError("IMAGE_MEDIA_TYPE_UNSUPPORTED");
    if (detected !== declared.data) throw new M6ImageError("IMAGE_MEDIA_TYPE_MISMATCH");
    if (metadata.width < 1 || metadata.height < 1 ||
        metadata.width * metadata.height > M6_POLICY.image.maximumPixels ||
        (metadata.pages ?? 1) !== 1) {
      throw new M6ImageError("IMAGE_DIMENSIONS_INVALID");
    }
    const normalized = pipeline
      .rotate()
      .resize({
        width: M6_POLICY.image.maximumEdge,
        height: M6_POLICY.image.maximumEdge,
        fit: "inside",
        withoutEnlargement: true
      })
      .flatten({ background: "#ffffff" });
    let result: Awaited<ReturnType<typeof normalized.toBuffer>> | null = null;
    for (const quality of [82, 72, 62] as const) {
      const candidate = await normalized.clone()
        .jpeg({ quality, chromaSubsampling: "4:2:0", progressive: false })
        .toBuffer({ resolveWithObject: true });
      if (candidate.data.byteLength <= M6_POLICY.image.maximumNormalizedBytes) {
        result = candidate;
        break;
      }
    }
    if (result === null) throw new M6ImageError("IMAGE_NORMALIZED_TOO_LARGE");
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
      bytes: result.data
    };
  } catch (error) {
    if (error instanceof M6ImageError) throw error;
    throw new M6ImageError("IMAGE_DECODE_FAILED");
  }
}

export function decodeStrictImageDataUrl(dataUrl: string): {
  mediaType: SupportedMediaType;
  bytes: Buffer;
} {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (match === null) throw new M6ImageError("IMAGE_DECODE_FAILED");
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > M6_POLICY.image.maximumNormalizedBytes) {
    throw new M6ImageError("IMAGE_BODY_TOO_LARGE");
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
    throw new M6ImageError("IMAGE_DESCRIPTOR_MISMATCH");
  }
  try {
    const metadata = await sharp(decoded.bytes, {
      failOn: "warning",
      limitInputPixels: M6_POLICY.image.maximumPixels,
      sequentialRead: true,
      animated: false
    }).metadata();
    const detected = mediaTypeForFormat(metadata.format);
    if (detected !== descriptor.mediaType) throw new M6ImageError("IMAGE_MEDIA_TYPE_MISMATCH");
    if (metadata.width !== descriptor.width || metadata.height !== descriptor.height ||
        metadata.width > M6_POLICY.image.maximumEdge ||
        metadata.height > M6_POLICY.image.maximumEdge ||
        (metadata.pages ?? 1) !== 1) {
      throw new M6ImageError("IMAGE_DESCRIPTOR_MISMATCH");
    }
    return decoded.bytes;
  } catch (error) {
    if (error instanceof M6ImageError) throw error;
    throw new M6ImageError("IMAGE_DECODE_FAILED");
  }
}
