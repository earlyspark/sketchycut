import { randomUUID } from "node:crypto";

import { z } from "zod";

import { Sha256Schema, StableIdSchema } from "../../domain/contracts.js";
import { hashCanonical } from "../../domain/hash.js";
import { planIntentConditionedConstruction } from "../../interpretation/construction-planner.js";
import { reconcileExplicitSizingConstraints, ExplicitSizingConstraintV1Schema } from "../../interpretation/explicit-sizing.js";
import {
  CanonicalGenerationSourceSchema,
  currentComponentManifest,
  generationOutcomeFromPlanner
} from "../../interpretation/generation-outcome.js";
import { GenerationDeterministicControlsSchema } from "../../interpretation/generation-submission.js";
import {
  GeneratedCompiledProjectSchema,
  GeneratedFabricationControlsSchema,
  type GeneratedCompiledProject
} from "../../interpretation/generated-project-contracts.js";
import { resolveGeneratedFabricationControls } from "../../interpretation/generated-fabrication.js";
import { generationKeys } from "./keys.js";
import { GENERATION_POLICY } from "./policy.js";
import type { GenerationStore } from "./contracts.js";

export const CurrentPersistedProjectSchema = z.object({
  schemaVersion: z.literal("4.0"),
  projectId: StableIdSchema,
  ownerSessionId: StableIdSchema,
  revision: z.number().int().positive(),
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
  source: CanonicalGenerationSourceSchema,
  deterministicControls: GenerationDeterministicControlsSchema,
  fabricationControls: GeneratedFabricationControlsSchema,
  runtimeApplicationApiCalls: z.union([z.literal(0), z.literal(1)]),
  lastDocumentHash: Sha256Schema,
  lastGeometryHash: Sha256Schema
}).strict();

export type CurrentPersistedProject = z.infer<typeof CurrentPersistedProjectSchema>;

export class CurrentProjectError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID" | "UNSUPPORTED_PROJECT_VERSION") {
    super(`GENERATION_PROJECT_${code}`);
  }
}

function serialize(record: CurrentPersistedProject): string {
  return JSON.stringify(CurrentPersistedProjectSchema.parse(record));
}

async function readStored(store: GenerationStore, projectId: string) {
  const serialized = await store.getValue(generationKeys.project(projectId));
  if (serialized === null) return null;
  let candidate: unknown;
  try { candidate = JSON.parse(serialized) as unknown; }
  catch { throw new CurrentProjectError("INVALID"); }
  if (typeof candidate === "object" && candidate !== null &&
      "schemaVersion" in candidate && candidate.schemaVersion !== "4.0") {
    throw new CurrentProjectError("UNSUPPORTED_PROJECT_VERSION");
  }
  const parsed = CurrentPersistedProjectSchema.safeParse(candidate);
  if (!parsed.success) throw new CurrentProjectError("INVALID");
  return { serialized, record: parsed.data };
}

function requireOwner(
  stored: Awaited<ReturnType<typeof readStored>>,
  ownerSessionId: string,
): NonNullable<Awaited<ReturnType<typeof readStored>>> {
  if (stored?.record.ownerSessionId !== ownerSessionId) throw new CurrentProjectError("NOT_FOUND");
  return stored;
}

export function compiledFromCurrentPlanning(planning: Awaited<ReturnType<typeof planIntentConditionedConstruction>>): GeneratedCompiledProject {
  if (planning.kind !== "planned" || planning.selected.compiled === null || planning.selected.sizing.kind !== "solved") {
    throw new CurrentProjectError("INVALID");
  }
  const selected = planning.selected.compiled;
  return GeneratedCompiledProjectSchema.parse({
    document: selected.compiled.document,
    geometryHash: selected.compiled.geometryHash,
    bundle: selected.compiled.bundle,
    evidence: selected.compiled.evidence,
    svgs: selected.compiled.svgs,
    motifRecipe: selected.motifRecipe,
    motifReport: selected.motifReport,
    scaleDisclosure: planning.selected.sizing.fallback.used
      ? planning.selected.sizing.fallback.disclosure
      : planning.selected.sizing.supportEngagement.disclosure
  });
}

async function replan(input: {
  source: CurrentPersistedProject["source"];
  deterministicControls: CurrentPersistedProject["deterministicControls"];
  fabricationControls: CurrentPersistedProject["fabricationControls"];
  runtimeApplicationApiCalls: 0 | 1;
  requestId: string;
}) {
  if (await hashCanonical(await currentComponentManifest()) !== await hashCanonical(input.source.componentManifest)) {
    throw new CurrentProjectError("UNSUPPORTED_PROJECT_VERSION");
  }
  const parsedConstraints = input.source.explicitSizing.constraints
    .filter((item) => item.source === "brief")
    .map((item) => ExplicitSizingConstraintV1Schema.parse({
      ...item,
      ...(item.status === "overridden" ? { status: "active", findingCode: null } : {})
    }));
  const explicitSizing = await reconcileExplicitSizingConstraints({
    advancedSizing: input.deterministicControls.advancedSizing,
    parsedConstraints,
    parserFindings: input.source.explicitSizing.findings.filter((item) => item.code !== "PARSED_MEASUREMENT_OVERRIDDEN")
  });
  const fabrication = resolveGeneratedFabricationControls(input.fabricationControls);
  const planning = await planIntentConditionedConstruction({
    projection: input.source.interpretation.projection,
    explicitConstraints: explicitSizing,
    profiles: fabrication.profiles,
    inputPolicyEvaluation: fabrication.inputPolicyEvaluation,
    pin: fabrication.pin,
    motifPlacement: input.deterministicControls.motifPlacement,
    semanticProvenance: {
      modelId: input.source.semanticProvenance.modelId,
      promptIdentity: input.source.semanticProvenance.promptIdentity,
      promptHash: input.source.semanticProvenance.promptHash,
      semanticRequestDigest: input.source.semanticProvenance.semanticRequestDigest,
      runtimeApplicationApiCalls: input.runtimeApplicationApiCalls
    }
  });
  const outcome = await generationOutcomeFromPlanner({
    requestId: input.requestId,
    transportMode: "live",
    semanticRequestDigest: input.source.semanticProvenance.semanticRequestDigest,
    sourceEvidenceIndexDigest: input.source.semanticProvenance.sourceEvidenceIndexDigest,
    promptIdentity: input.source.semanticProvenance.promptIdentity,
    promptHash: input.source.semanticProvenance.promptHash,
    modelId: input.source.semanticProvenance.modelId,
    providerModelId: input.source.semanticProvenance.providerModelId,
    providerResponseId: input.source.semanticProvenance.providerResponseId,
    reasoningEffort: input.source.semanticProvenance.reasoningEffort,
    imageDetailPolicy: input.source.semanticProvenance.imageDetailPolicy,
    promptLayoutVersion: input.source.semanticProvenance.promptLayoutVersion,
    modelConfigurationHash: input.source.semanticProvenance.modelConfigurationHash,
    cacheResult: input.source.semanticProvenance.cacheResult,
    attemptId: input.source.semanticProvenance.attemptId,
    providerRequestId: input.source.semanticProvenance.providerRequestId,
    providerFinishState: input.source.semanticProvenance.providerFinishState,
    providerUsage: input.source.semanticProvenance.providerUsage,
    providerLatencyMs: input.source.semanticProvenance.providerLatencyMs,
    estimatedCostUsd: input.source.semanticProvenance.estimatedCostUsd,
    requestBudgetUpperBoundUsd: input.source.semanticProvenance.requestBudgetUpperBoundUsd,
    priceSnapshotId: input.source.semanticProvenance.priceSnapshotId,
    interpretation: input.source.interpretation,
    explicitSizing,
    planning
  });
  if (outcome.kind !== "supported" &&
      outcome.kind !== "simplified" &&
      outcome.kind !== "modified") {
    throw new CurrentProjectError("INVALID");
  }
  return { source: outcome.source, compiled: compiledFromCurrentPlanning(planning) };
}

export async function recompileCurrentPersistedProject(project: CurrentPersistedProject) {
  return replan({
    source: project.source,
    deterministicControls: project.deterministicControls,
    fabricationControls: project.fabricationControls,
    runtimeApplicationApiCalls: project.runtimeApplicationApiCalls,
    requestId: `project-recompile-${project.projectId}-r${String(project.revision)}`
  });
}

export async function createCurrentPersistedProject(input: {
  store: GenerationStore;
  ownerSessionId: string;
  source: CurrentPersistedProject["source"];
  deterministicControls: CurrentPersistedProject["deterministicControls"];
  fabricationControls: CurrentPersistedProject["fabricationControls"];
  compiled: GeneratedCompiledProject;
  runtimeApplicationApiCalls: 0 | 1;
  nowMs?: number;
}): Promise<CurrentPersistedProject> {
  const compiled = GeneratedCompiledProjectSchema.parse(input.compiled);
  if (compiled.document.validation.status !== "pass" || compiled.bundle.sourceDocumentHash !== input.source.lastVerifiedHashes.documentHash) {
    throw new CurrentProjectError("INVALID");
  }
  const nowMs = input.nowMs ?? Date.now();
  const record = CurrentPersistedProjectSchema.parse({
    schemaVersion: "4.0", projectId: `project-${randomUUID()}`, ownerSessionId: input.ownerSessionId,
    revision: 1, createdAtMs: nowMs, updatedAtMs: nowMs, source: input.source,
    deterministicControls: input.deterministicControls, fabricationControls: input.fabricationControls,
    runtimeApplicationApiCalls: input.runtimeApplicationApiCalls,
    lastDocumentHash: compiled.bundle.sourceDocumentHash, lastGeometryHash: compiled.geometryHash
  });
  if (!await input.store.setValue(generationKeys.project(record.projectId), serialize(record), {
    ttlSeconds: GENERATION_POLICY.projectTtlSeconds, onlyIfAbsent: true
  })) throw new CurrentProjectError("CONFLICT");
  await input.store.setLastProject(input.ownerSessionId, record.projectId);
  return record;
}

export async function readCurrentPersistedProject(input: {
  store: GenerationStore; ownerSessionId: string; projectId: string;
}): Promise<CurrentPersistedProject> {
  return requireOwner(await readStored(input.store, StableIdSchema.parse(input.projectId)), input.ownerSessionId).record;
}

export async function updateCurrentPersistedProject(input: {
  store: GenerationStore; ownerSessionId: string; projectId: string; expectedRevision: number;
  deterministicControls: unknown; fabricationControls: unknown; nowMs?: number;
}) {
  const stored = requireOwner(await readStored(input.store, StableIdSchema.parse(input.projectId)), input.ownerSessionId);
  if (stored.record.revision !== input.expectedRevision) throw new CurrentProjectError("CONFLICT");
  const deterministicControls = GenerationDeterministicControlsSchema.parse(input.deterministicControls);
  const fabricationControls = GeneratedFabricationControlsSchema.parse(input.fabricationControls);
  const result = await replan({
    source: stored.record.source, deterministicControls, fabricationControls,
    runtimeApplicationApiCalls: stored.record.runtimeApplicationApiCalls,
    requestId: `project-update-${stored.record.projectId}-r${String(stored.record.revision + 1)}`
  });
  const record = CurrentPersistedProjectSchema.parse({
    ...stored.record, revision: stored.record.revision + 1, updatedAtMs: input.nowMs ?? Date.now(),
    source: result.source, deterministicControls, fabricationControls,
    lastDocumentHash: result.compiled.bundle.sourceDocumentHash, lastGeometryHash: result.compiled.geometryHash
  });
  if (!await input.store.compareAndSetValue(
    generationKeys.project(record.projectId), stored.serialized, serialize(record), GENERATION_POLICY.projectTtlSeconds
  )) throw new CurrentProjectError("CONFLICT");
  return { record, compiled: result.compiled };
}
