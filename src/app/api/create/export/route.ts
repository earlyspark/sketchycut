import { z } from "zod";

import { StableIdSchema } from "../../../../domain/contracts.js";
import { readRuntimeConfig } from "../../../../server/generation/config.js";
import {
  authorizeRoute,
  genericApiFailure
} from "../../../../server/generation/http-security.js";
import { buildFabricationPackage } from "../../../../server/generation/package-builder.js";
import { readPersistedProject } from "../../../../server/generation/project-persistence.js";
import { createGenerationStore } from "../../../../server/generation/store.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const ExportRequestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  projectId: StableIdSchema
}).strict();

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authorizeRoute(request, "export");
  if (authenticated === null) return genericApiFailure();
  try {
    const body = ExportRequestSchema.parse(await request.json() as unknown);
    const config = readRuntimeConfig();
    const record = await readPersistedProject({
      store: createGenerationStore(config),
      ownerSessionId: authenticated.session.sessionId,
      projectId: body.projectId
    });
    const output = await buildFabricationPackage(record);
    return new Response(Uint8Array.from(output.bytes).buffer, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${output.filename}"`,
        "content-length": String(output.bytes.byteLength),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-sketchycut-package-sha256": output.sha256
      }
    });
  } catch {
    return genericApiFailure(400);
  }
}
