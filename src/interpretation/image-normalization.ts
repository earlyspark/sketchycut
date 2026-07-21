import { z } from "zod";

import {
  SemanticReferenceDescriptorSchema,
  type SemanticReferenceDescriptor
} from "./semantic-input-contracts.js";

export const MAX_REFERENCE_COUNT = 3;
export const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
export const MAX_NORMALIZED_IMAGE_EDGE = 2_048;
export const MAX_NORMALIZED_REFERENCE_BYTES = 960 * 1024;
export const REFERENCE_NORMALIZATION_POLICY_VERSION = "reference-normalization-v2" as const;

const AcceptedMediaTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

export class ReferenceInputError extends Error {
  readonly code: "REFERENCE_COUNT_INVALID" | "REFERENCE_TYPE_UNSUPPORTED" |
    "REFERENCE_FILE_TOO_LARGE" | "REFERENCE_DECODE_FAILED";
  readonly referenceIndex: number | null;

  constructor(
    code: ReferenceInputError["code"],
    message: string,
    referenceIndex: number | null = null,
  ) {
    super(message);
    this.name = "ReferenceInputError";
    this.code = code;
    this.referenceIndex = referenceIndex;
  }
}

export type ReferenceFileInput = Blob & { readonly name: string };

export type NormalizedReferenceImage = {
  referenceId: string;
  normalizedBlob: Blob;
  descriptor: SemanticReferenceDescriptor;
  normalizationDisposition: "preserved" | "normalized";
};

export type ImageNormalizationAdapter = (input: {
  blob: Blob;
  maximumEdge: number;
  maximumOutputBytes: number;
}) => Promise<{
  blob: Blob;
  width: number;
  height: number;
  normalizationDisposition: "preserved" | "normalized";
}>;

export function validateReferenceFiles(files: readonly ReferenceFileInput[]): void {
  if (files.length > MAX_REFERENCE_COUNT) {
    throw new ReferenceInputError(
      "REFERENCE_COUNT_INVALID",
      "Choose no more than three reference images.",
    );
  }
  for (const [index, file] of files.entries()) {
    if (!AcceptedMediaTypeSchema.safeParse(file.type).success) {
      throw new ReferenceInputError(
        "REFERENCE_TYPE_UNSUPPORTED",
        `Reference ${String(index + 1)} must be a JPEG, PNG, or WebP image.`,
        index,
      );
    }
    if (file.size > MAX_REFERENCE_BYTES) {
      throw new ReferenceInputError(
        "REFERENCE_FILE_TOO_LARGE",
        `Reference ${String(index + 1)} exceeds the 12 MB input limit.`,
        index,
      );
    }
  }
}

async function browserNormalizationAdapter(input: {
  blob: Blob;
  maximumEdge: number;
  maximumOutputBytes: number;
}): Promise<{
  blob: Blob;
  width: number;
  height: number;
  normalizationDisposition: "preserved" | "normalized";
}> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(input.blob);
  } catch {
    throw new ReferenceInputError(
      "REFERENCE_DECODE_FAILED",
      "A selected reference could not be decoded as an image.",
    );
  }
  try {
    if (input.blob.size <= input.maximumOutputBytes &&
        Math.max(bitmap.width, bitmap.height) <= input.maximumEdge) {
      return {
        blob: input.blob,
        width: bitmap.width,
        height: bitmap.height,
        normalizationDisposition: "preserved"
      };
    }
    for (const edgeScale of [1, 0.875, 0.75, 0.625, 0.5] as const) {
      const edge = Math.round(input.maximumEdge * edgeScale);
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { alpha: false });
      if (context === null) throw new Error("Canvas context unavailable.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.94, 0.92, 0.90, 0.88] as const) {
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
        if (blob.size <= input.maximumOutputBytes) {
          return { blob, width, height, normalizationDisposition: "normalized" };
        }
      }
    }
    throw new ReferenceInputError(
      "REFERENCE_FILE_TOO_LARGE",
      "A selected reference could not be reduced to the protected upload limit without excessive quality loss.",
    );
  } catch (error) {
    if (error instanceof ReferenceInputError) throw error;
    throw new ReferenceInputError(
      "REFERENCE_DECODE_FAILED",
      "A selected reference could not be normalized safely.",
    );
  } finally {
    bitmap.close();
  }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function normalizeReferenceFiles(
  files: readonly ReferenceFileInput[],
  adapter: ImageNormalizationAdapter = browserNormalizationAdapter,
): Promise<NormalizedReferenceImage[]> {
  validateReferenceFiles(files);
  const output: NormalizedReferenceImage[] = [];
  for (const [index, file] of files.entries()) {
    const normalized = await adapter({
      blob: file,
      maximumEdge: MAX_NORMALIZED_IMAGE_EDGE,
      maximumOutputBytes: MAX_NORMALIZED_REFERENCE_BYTES
    });
    const mediaType = AcceptedMediaTypeSchema.parse(normalized.blob.type);
    const referenceId = `reference-${String(index + 1)}`;
    const descriptor = SemanticReferenceDescriptorSchema.parse({
      referenceId,
      sha256: await sha256(await normalized.blob.arrayBuffer()),
      mediaType,
      width: normalized.width,
      height: normalized.height
    });
    output.push({
      referenceId,
      normalizedBlob: normalized.blob,
      descriptor,
      normalizationDisposition: normalized.normalizationDisposition
    });
  }
  return output;
}
