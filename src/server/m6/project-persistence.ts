import { randomUUID } from "node:crypto";

import { z } from "zod";

import { Sha256Schema, StableIdSchema } from "../../domain/contracts.js";
import {
  GeneratedDeterministicControlsSchema,
  GeneratedFabricationControlsSchema,
  GeneratedSemanticProvenanceSchema,
  type GeneratedCompiledProject,
  type GeneratedDeterministicControls,
  type GeneratedFabricationControls,
  type GeneratedSemanticProvenance
} from "../../interpretation/generated-project-contracts.js";
import { IntentGraphV1Schema } from "../../interpretation/intent-graph.js";
import {
  SimplifiedCapabilityMappingSchema,
  SupportedCapabilityMappingSchema
} from "../../interpretation/mapper.js";
import type { SemanticGenerationRequestV1 } from "../../interpretation/semantic-request.js";
import { resolveGeneratedFabricationControls } from "../../interpretation/generated-fabrication.js";
import { compileGeneratedProjectFromSemantic } from "../../interpretation/generated-project-compiler.js";
import { hashCanonical } from "../../domain/hash.js";

import { m6Keys } from "./keys.js";
import { M6_POLICY } from "./policy.js";
import type { M6Store } from "./contracts.js";

const FabricationMappingSchema = z.discriminatedUnion("kind", [
  SupportedCapabilityMappingSchema,
  SimplifiedCapabilityMappingSchema
]);

export const M6PersistedProjectSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    projectId: StableIdSchema,
    ownerSessionId: StableIdSchema,
    revision: z.number().int().positive(),
    createdAtMs: z.number().int().nonnegative(),
    updatedAtMs: z.number().int().nonnegative(),
    intent: IntentGraphV1Schema,
    mapping: FabricationMappingSchema,
    semanticProvenance: GeneratedSemanticProvenanceSchema,
    deterministicControls: GeneratedDeterministicControlsSchema,
    fabricationControls: GeneratedFabricationControlsSchema,
    runtimeApplicationApiCalls: z.union([z.literal(0), z.literal(1)]),
    lastDocumentHash: Sha256Schema,
    lastGeometryHash: Sha256Schema
  })
  .strict();

export type M6PersistedProject = z.infer<typeof M6PersistedProjectSchema>;

export class M6ProjectError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID") {
    super(`M6_PROJECT_${code}`);
    this.name = "M6ProjectError";
  }
}

export async function semanticProvenanceFromRequest(
  request: SemanticGenerationRequestV1,
): Promise<GeneratedSemanticProvenance> {
  return GeneratedSemanticProvenanceSchema.parse({
    modelId: request.modelConfiguration.modelId,
    promptVersion: request.promptVersion,
    semanticRequestDigest: await hashCanonical(request),
    capabilityCatalogVersion: request.capabilityCatalogVersion
  });
}

function serialize(record: M6PersistedProject): string {
  return JSON.stringify(M6PersistedProjectSchema.parse(record));
}

async function readStored(store: M6Store, projectId: string): Promise<{
  serialized: string;
  record: M6PersistedProject;
} | null> {
  const serialized = await store.getValue(m6Keys.project(projectId));
  if (serialized === null) return null;
  return {
    serialized,
    record: M6PersistedProjectSchema.parse(JSON.parse(serialized) as unknown)
  };
}

function requireOwner(
  stored: Awaited<ReturnType<typeof readStored>>,
  ownerSessionId: string,
): NonNullable<Awaited<ReturnType<typeof readStored>>> {
  if (stored?.record.ownerSessionId !== ownerSessionId) {
    throw new M6ProjectError("NOT_FOUND");
  }
  return stored;
}

export async function recompilePersistedProject(
  project: M6PersistedProject,
): Promise<GeneratedCompiledProject> {
  const fabrication = resolveGeneratedFabricationControls(project.fabricationControls);
  return compileGeneratedProjectFromSemantic({
    requestId: `m6-recompile-${project.projectId}-r${String(project.revision)}`,
    semanticProvenance: project.semanticProvenance,
    intent: project.intent,
    mapping: project.mapping,
    profiles: fabrication.profiles,
    inputPolicyEvaluation: fabrication.inputPolicyEvaluation,
    pin: fabrication.pin,
    controls: project.deterministicControls,
    cacheResult: "hit",
    runtimeApplicationApiCalls: project.runtimeApplicationApiCalls
  });
}

export async function createPersistedProject(input: {
  store: M6Store;
  ownerSessionId: string;
  semanticRequest: SemanticGenerationRequestV1;
  intent: M6PersistedProject["intent"];
  mapping: M6PersistedProject["mapping"];
  deterministicControls: GeneratedDeterministicControls;
  fabricationControls: GeneratedFabricationControls;
  compiled: GeneratedCompiledProject;
  nowMs?: number;
}): Promise<M6PersistedProject> {
  if (input.compiled.document.validation.status !== "pass") {
    throw new M6ProjectError("INVALID");
  }
  const nowMs = input.nowMs ?? Date.now();
  const projectId = `m6-project-${randomUUID()}`;
  const record = M6PersistedProjectSchema.parse({
    schemaVersion: "1.0",
    projectId,
    ownerSessionId: input.ownerSessionId,
    revision: 1,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    intent: input.intent,
    mapping: input.mapping,
    semanticProvenance: await semanticProvenanceFromRequest(input.semanticRequest),
    deterministicControls: input.deterministicControls,
    fabricationControls: input.fabricationControls,
    runtimeApplicationApiCalls: input.compiled.document.provenance.runtimeApplicationApiCalls,
    lastDocumentHash: input.compiled.bundle.sourceDocumentHash,
    lastGeometryHash: input.compiled.geometryHash
  });
  const stored = await input.store.setValue(m6Keys.project(projectId), serialize(record), {
    ttlSeconds: M6_POLICY.projectTtlSeconds,
    onlyIfAbsent: true
  });
  if (!stored) throw new M6ProjectError("CONFLICT");
  await input.store.setLastProject(input.ownerSessionId, projectId);
  return record;
}

export async function readPersistedProject(input: {
  store: M6Store;
  ownerSessionId: string;
  projectId: string;
}): Promise<M6PersistedProject> {
  return requireOwner(
    await readStored(input.store, StableIdSchema.parse(input.projectId)),
    input.ownerSessionId,
  ).record;
}

export async function updatePersistedProject(input: {
  store: M6Store;
  ownerSessionId: string;
  projectId: string;
  expectedRevision: number;
  deterministicControls: unknown;
  fabricationControls: unknown;
  nowMs?: number;
}): Promise<{ record: M6PersistedProject; compiled: GeneratedCompiledProject }> {
  const stored = requireOwner(
    await readStored(input.store, StableIdSchema.parse(input.projectId)),
    input.ownerSessionId,
  );
  if (stored.record.revision !== input.expectedRevision) throw new M6ProjectError("CONFLICT");
  const candidate = M6PersistedProjectSchema.parse({
    ...stored.record,
    revision: stored.record.revision + 1,
    updatedAtMs: input.nowMs ?? Date.now(),
    deterministicControls: GeneratedDeterministicControlsSchema.parse(input.deterministicControls),
    fabricationControls: GeneratedFabricationControlsSchema.parse(input.fabricationControls)
  });
  const compiled = await recompilePersistedProject(candidate);
  const record = M6PersistedProjectSchema.parse({
    ...candidate,
    lastDocumentHash: compiled.bundle.sourceDocumentHash,
    lastGeometryHash: compiled.geometryHash
  });
  const updated = await input.store.compareAndSetValue(
    m6Keys.project(record.projectId),
    stored.serialized,
    serialize(record),
    M6_POLICY.projectTtlSeconds,
  );
  if (!updated) throw new M6ProjectError("CONFLICT");
  return { record, compiled };
}
