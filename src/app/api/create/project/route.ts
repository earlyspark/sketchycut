import { M6ProjectResponseSchema, M6ProjectUpdateRequestSchema } from "../../../../server/m6/api-contracts.js";
import { readM6RuntimeConfig } from "../../../../server/m6/config.js";
import {
  authorizeM6Route,
  genericApiFailure,
  noStoreJson
} from "../../../../server/m6/http-security.js";
import {
  M6ProjectError,
  readPersistedProject,
  recompilePersistedProject,
  updatePersistedProject
} from "../../../../server/m6/project-persistence.js";
import { createM6Store } from "../../../../server/m6/store.js";

export const runtime = "nodejs";

function response(record: Awaited<ReturnType<typeof readPersistedProject>>, compiled: Awaited<ReturnType<typeof recompilePersistedProject>>) {
  return M6ProjectResponseSchema.parse({
    schemaVersion: "1.0",
    project: {
      projectId: record.projectId,
      revision: record.revision,
      updatedAtMs: record.updatedAtMs,
      lastDocumentHash: record.lastDocumentHash,
      lastGeometryHash: record.lastGeometryHash
    },
    source: {
      kind: record.mapping.kind,
      intent: record.intent,
      mapping: record.mapping,
      deterministicControls: record.deterministicControls,
      fabricationControls: record.fabricationControls
    },
    compiled
  });
}

export async function GET(request: Request): Promise<Response> {
  const authenticated = await authorizeM6Route(request, "project");
  if (authenticated === null) return genericApiFailure();
  try {
    const config = readM6RuntimeConfig();
    const store = createM6Store(config);
    const requested = new URL(request.url).searchParams.get("projectId");
    const projectId = requested ?? authenticated.session.lastProjectId;
    if (projectId === null) return genericApiFailure();
    const record = await readPersistedProject({
      store,
      ownerSessionId: authenticated.session.sessionId,
      projectId
    });
    const compiled = await recompilePersistedProject(record);
    if (compiled.bundle.sourceDocumentHash !== record.lastDocumentHash ||
        compiled.geometryHash !== record.lastGeometryHash) return genericApiFailure();
    return noStoreJson(response(record, compiled));
  } catch {
    return genericApiFailure();
  }
}

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authorizeM6Route(request, "project");
  if (authenticated === null) return genericApiFailure();
  try {
    const body = M6ProjectUpdateRequestSchema.parse(await request.json() as unknown);
    const config = readM6RuntimeConfig();
    const updated = await updatePersistedProject({
      store: createM6Store(config),
      ownerSessionId: authenticated.session.sessionId,
      projectId: body.projectId,
      expectedRevision: body.expectedRevision,
      deterministicControls: body.deterministicControls,
      fabricationControls: body.fabricationControls
    });
    return noStoreJson(response(updated.record, updated.compiled));
  } catch (error) {
    return genericApiFailure(error instanceof M6ProjectError && error.code === "CONFLICT" ? 409 : 400);
  }
}
