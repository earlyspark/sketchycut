import { CurrentProjectResponseSchema, CurrentProjectUpdateRequestSchema } from "../../../../server/generation/api-contracts-v2.js";
import { readRuntimeConfig } from "../../../../server/generation/config.js";
import {
  authorizeRoute,
  genericApiFailure,
  noStoreJson
} from "../../../../server/generation/http-security.js";
import {
  CurrentProjectError,
  readCurrentPersistedProject,
  recompileCurrentPersistedProject,
  updateCurrentPersistedProject
} from "../../../../server/generation/project-persistence-v2.js";
import { createGenerationStore } from "../../../../server/generation/store.js";

export const runtime = "nodejs";

function response(record: Awaited<ReturnType<typeof readCurrentPersistedProject>>, compiled: Awaited<ReturnType<typeof recompileCurrentPersistedProject>>["compiled"]) {
  return CurrentProjectResponseSchema.parse({
    schemaVersion: "2.0",
    project: {
      projectId: record.projectId,
      revision: record.revision,
      updatedAtMs: record.updatedAtMs,
      lastDocumentHash: record.lastDocumentHash,
      lastGeometryHash: record.lastGeometryHash
    },
    source: record.source,
    deterministicControls: record.deterministicControls,
    fabricationControls: record.fabricationControls,
    compiled
  });
}

export async function GET(request: Request): Promise<Response> {
  const authenticated = await authorizeRoute(request, "project");
  if (authenticated === null) return genericApiFailure();
  try {
    const config = readRuntimeConfig();
    const store = createGenerationStore(config);
    const requested = new URL(request.url).searchParams.get("projectId");
    const projectId = requested ?? authenticated.session.lastProjectId;
    if (projectId === null) return genericApiFailure();
    const record = await readCurrentPersistedProject({
      store,
      ownerSessionId: authenticated.session.sessionId,
      projectId
    });
    const { compiled } = await recompileCurrentPersistedProject(record);
    if (compiled.bundle.sourceDocumentHash !== record.lastDocumentHash ||
        compiled.geometryHash !== record.lastGeometryHash) return genericApiFailure();
    return noStoreJson(response(record, compiled));
  } catch {
    return genericApiFailure();
  }
}

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authorizeRoute(request, "project");
  if (authenticated === null) return genericApiFailure();
  try {
    const body = CurrentProjectUpdateRequestSchema.parse(await request.json() as unknown);
    const config = readRuntimeConfig();
    const updated = await updateCurrentPersistedProject({
      store: createGenerationStore(config),
      ownerSessionId: authenticated.session.sessionId,
      projectId: body.projectId,
      expectedRevision: body.expectedRevision,
      deterministicControls: body.deterministicControls,
      fabricationControls: body.fabricationControls
    });
    return noStoreJson(response(updated.record, updated.compiled));
  } catch (error) {
    return genericApiFailure(error instanceof CurrentProjectError && error.code === "CONFLICT" ? 409 : 400);
  }
}
