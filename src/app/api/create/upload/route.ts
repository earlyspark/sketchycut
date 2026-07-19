import { StableIdSchema } from "../../../../domain/contracts.js";
import { normalizeUploadedImage } from "../../../../server/generation/image-decoder.js";
import {
  authorizeRoute,
  genericApiFailure,
  noStoreJson
} from "../../../../server/generation/http-security.js";
import { GENERATION_POLICY } from "../../../../server/generation/policy.js";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (await authorizeRoute(request, "upload") === null) return genericApiFailure();
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isInteger(declaredLength) || declaredLength < 1 ||
        declaredLength > GENERATION_POLICY.image.maximumUploadRequestBytes) return genericApiFailure(400);
    const referenceId = StableIdSchema.parse(request.headers.get("x-sketchycut-reference-id"));
    const declaredMediaType = request.headers.get("content-type") ?? "";
    const bytes = new Uint8Array(await request.arrayBuffer());
    const normalized = await normalizeUploadedImage({
      referenceId,
      declaredMediaType,
      bytes
    });
    return noStoreJson({
      schemaVersion: "1.0",
      descriptor: normalized.descriptor,
      dataUrl: normalized.dataUrl
    });
  } catch {
    return genericApiFailure(400);
  }
}
