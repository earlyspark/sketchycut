import { StableIdSchema } from "../../../../domain/contracts.js";
import { normalizeUploadedImage } from "../../../../server/m6/image-decoder.js";
import {
  authorizeM6Route,
  genericApiFailure,
  noStoreJson
} from "../../../../server/m6/http-security.js";
import { M6_POLICY } from "../../../../server/m6/policy.js";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (await authorizeM6Route(request, "upload") === null) return genericApiFailure();
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isInteger(declaredLength) || declaredLength < 1 ||
        declaredLength > M6_POLICY.image.maximumUploadRequestBytes) return genericApiFailure(400);
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
