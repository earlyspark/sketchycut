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
import { assertIntentExcludesRawBrief } from "../../interpretation/intent-privacy.js";
import {
  SimplifiedCapabilityMappingSchema,
  SupportedCapabilityMappingSchema
} from "../../interpretation/mapper.js";
import type { SemanticGenerationRequestV1 } from "../../interpretation/semantic-request.js";
import { resolveGeneratedFabricationControls } from "../../interpretation/generated-fabrication.js";
import { compileGeneratedProjectFromSemantic } from "../../interpretation/generated-project-compiler.js";
import { hashCanonical } from "../../domain/hash.js";

import { generationKeys } from "./keys.js";
import { GENERATION_POLICY } from "./policy.js";
import type { GenerationStore } from "./contracts.js";

const FabricationMappingSchema = z.discriminatedUnion("kind", [
  SupportedCapabilityMappingSchema,
  SimplifiedCapabilityMappingSchema
]);

export const PersistedProjectSchema = z
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

export type PersistedProject = z.infer<typeof PersistedProjectSchema>;

export class ProjectError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID" | "UNSUPPORTED_PROJECT_VERSION") {
    super(`GENERATION_PROJECT_${code}`);
    this.name = "ProjectError";
  }
}

export async function semanticProvenanceFromRequest(
  request: SemanticGenerationRequestV1,
): Promise<GeneratedSemanticProvenance> {
  return GeneratedSemanticProvenanceSchema.parse({
    modelId: request.modelConfiguration.modelId,
    promptVersion: request.promptVersion,
    promptHash: request.promptHash,
    semanticRequestDigest: await hashCanonical(request),
    capabilityCatalogVersion: request.capabilityCatalogVersion
  });
}

function serialize(record: PersistedProject): string {
  return JSON.stringify(PersistedProjectSchema.parse(record));
}

async function readStored(store: GenerationStore, projectId: string): Promise<{
  serialized: string;
  record: PersistedProject;
} | null> {
  const serialized = await store.getValue(generationKeys.project(projectId));
  if (serialized === null) return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized) as unknown;
  } catch {
    throw new ProjectError("INVALID");
  }
  if (typeof candidate === "object" && candidate !== null &&
      "schemaVersion" in candidate && candidate.schemaVersion !== "1.0") {
    throw new ProjectError("UNSUPPORTED_PROJECT_VERSION");
  }
  const parsed = PersistedProjectSchema.safeParse(candidate);
  if (!parsed.success) throw new ProjectError("INVALID");
  return {
    serialized,
    record: parsed.data
  };
}

function requireOwner(
  stored: Awaited<ReturnType<typeof readStored>>,
  ownerSessionId: string,
): NonNullable<Awaited<ReturnType<typeof readStored>>> {
  if (stored?.record.ownerSessionId !== ownerSessionId) {
    throw new ProjectError("NOT_FOUND");
  }
  return stored;
}

export async function recompilePersistedProject(
  project: PersistedProject,
): Promise<GeneratedCompiledProject> {
  const fabrication = resolveGeneratedFabricationControls(project.fabricationControls);
  return compileGeneratedProjectFromSemantic({
    requestId: `project-recompile-${project.projectId}-r${String(project.revision)}`,
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
  store: GenerationStore;
  ownerSessionId: string;
  semanticRequest: SemanticGenerationRequestV1;
  intent: PersistedProject["intent"];
  mapping: PersistedProject["mapping"];
  deterministicControls: GeneratedDeterministicControls;
  fabricationControls: GeneratedFabricationControls;
  compiled: GeneratedCompiledProject;
  nowMs?: number;
}): Promise<PersistedProject> {
  if (input.compiled.document.validation.status !== "pass") {
    throw new ProjectError("INVALID");
  }
  try {
    assertIntentExcludesRawBrief(input.intent, input.semanticRequest.normalizedBrief);
  } catch {
    throw new ProjectError("INVALID");
  }
  const nowMs = input.nowMs ?? Date.now();
  const projectId = `project-${randomUUID()}`;
  const record = PersistedProjectSchema.parse({
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
  const stored = await input.store.setValue(generationKeys.project(projectId), serialize(record), {
    ttlSeconds: GENERATION_POLICY.projectTtlSeconds,
    onlyIfAbsent: true
  });
  if (!stored) throw new ProjectError("CONFLICT");
  await input.store.setLastProject(input.ownerSessionId, projectId);
  return record;
}

export async function readPersistedProject(input: {
  store: GenerationStore;
  ownerSessionId: string;
  projectId: string;
}): Promise<PersistedProject> {
  return requireOwner(
    await readStored(input.store, StableIdSchema.parse(input.projectId)),
    input.ownerSessionId,
  ).record;
}

export async function updatePersistedProject(input: {
  store: GenerationStore;
  ownerSessionId: string;
  projectId: string;
  expectedRevision: number;
  deterministicControls: unknown;
  fabricationControls: unknown;
  nowMs?: number;
}): Promise<{ record: PersistedProject; compiled: GeneratedCompiledProject }> {
  const stored = requireOwner(
    await readStored(input.store, StableIdSchema.parse(input.projectId)),
    input.ownerSessionId,
  );
  if (stored.record.revision !== input.expectedRevision) throw new ProjectError("CONFLICT");
  const candidate = PersistedProjectSchema.parse({
    ...stored.record,
    revision: stored.record.revision + 1,
    updatedAtMs: input.nowMs ?? Date.now(),
    deterministicControls: GeneratedDeterministicControlsSchema.parse(input.deterministicControls),
    fabricationControls: GeneratedFabricationControlsSchema.parse(input.fabricationControls)
  });
  const compiled = await recompilePersistedProject(candidate);
  const record = PersistedProjectSchema.parse({
    ...candidate,
    lastDocumentHash: compiled.bundle.sourceDocumentHash,
    lastGeometryHash: compiled.geometryHash
  });
  const updated = await input.store.compareAndSetValue(
    generationKeys.project(record.projectId),
    stored.serialized,
    serialize(record),
    GENERATION_POLICY.projectTtlSeconds,
  );
  if (!updated) throw new ProjectError("CONFLICT");
  return { record, compiled };
}
