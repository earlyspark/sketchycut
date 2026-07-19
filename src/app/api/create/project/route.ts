import { ProjectResponseSchema, ProjectUpdateRequestSchema } from "../../../../server/generation/api-contracts.js";
import { readRuntimeConfig } from "../../../../server/generation/config.js";
import {
  authorizeRoute,
  genericApiFailure,
  noStoreJson
} from "../../../../server/generation/http-security.js";
import {
  ProjectError,
  readPersistedProject,
  recompilePersistedProject,
  updatePersistedProject
} from "../../../../server/generation/project-persistence.js";
import { createGenerationStore } from "../../../../server/generation/store.js";

export const runtime = "nodejs";

function response(record: Awaited<ReturnType<typeof readPersistedProject>>, compiled: Awaited<ReturnType<typeof recompilePersistedProject>>) {
  return ProjectResponseSchema.parse({
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
  const authenticated = await authorizeRoute(request, "project");
  if (authenticated === null) return genericApiFailure();
  try {
    const config = readRuntimeConfig();
    const store = createGenerationStore(config);
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
  const authenticated = await authorizeRoute(request, "project");
  if (authenticated === null) return genericApiFailure();
  try {
    const body = ProjectUpdateRequestSchema.parse(await request.json() as unknown);
    const config = readRuntimeConfig();
    const updated = await updatePersistedProject({
      store: createGenerationStore(config),
      ownerSessionId: authenticated.session.sessionId,
      projectId: body.projectId,
      expectedRevision: body.expectedRevision,
      deterministicControls: body.deterministicControls,
      fabricationControls: body.fabricationControls
    });
    return noStoreJson(response(updated.record, updated.compiled));
  } catch (error) {
    return genericApiFailure(error instanceof ProjectError && error.code === "CONFLICT" ? 409 : 400);
  }
}
