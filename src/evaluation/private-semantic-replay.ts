import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  stat,
  unlink
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { Sha256Schema } from "../domain/contracts.js";
import { hashCanonical, sha256, stableJson } from "../domain/hash.js";
import {
  GenerationDeterministicControlsSchema
} from "../interpretation/generation-submission.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  SemanticInterpretationCandidateSchema,
  authorizeSemanticInterpretation,
  semanticInterpretationProviderSchema
} from "../interpretation/semantic-model-contract.js";
import {
  CURRENT_SEMANTIC_SCHEMA_ID,
  SemanticGenerationRequestSchema,
  semanticRequestDigest
} from "../interpretation/semantic-request.js";
import {
  evaluateSemanticCandidateForOfflineReplay
} from "../server/generation/generation-service.js";
import { MemoryGenerationStore } from "../server/generation/memory-store.js";
import {
  buildFabricationPackage
} from "../server/generation/package-builder.js";
import {
  createCurrentPersistedProject
} from "../server/generation/project-persistence.js";
import {
  GeneratedFabricationControlsSchema
} from "../interpretation/generated-project-contracts.js";

export const CURRENT_PRIVATE_SEMANTIC_REPLAY_CAPSULE_VERSION =
  "sketchycut-private-semantic-replay-capsule@1.0.0" as const;
export const CURRENT_PRIVATE_SEMANTIC_REPLAY_EVIDENCE_VERSION =
  "sketchycut-private-semantic-replay-evidence@1.0.0" as const;

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_CAPSULE_MODE = 0o600;

export const PrivateSemanticReplayCapsuleSchema = z.object({
  schemaVersion: z.literal(
    CURRENT_PRIVATE_SEMANTIC_REPLAY_CAPSULE_VERSION,
  ),
  createdAt: z.iso.datetime({ offset: true }),
  caseId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,159}$/u),
  attemptId: z.string().min(1).max(512),
  semanticRequestDigest: Sha256Schema,
  candidateDigest: Sha256Schema,
  providerSchemaHash: Sha256Schema,
  modelConfigurationHash: Sha256Schema,
  semanticContract: z.object({
    semanticSchemaId: z.literal(CURRENT_SEMANTIC_SCHEMA_ID),
    candidateSchemaVersion: z.literal(
      CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    ),
    atomTemplateVersion: z.string().min(1).max(120),
    capabilityCatalogVersion: z.string().min(1).max(120),
    unsupportedSemanticSignatureRegistryVersion:
      z.string().min(1).max(120)
  }).strict(),
  request: SemanticGenerationRequestSchema,
  candidate: SemanticInterpretationCandidateSchema,
  deterministicControls: GenerationDeterministicControlsSchema,
  fabricationControls: GeneratedFabricationControlsSchema
}).strict();

export type PrivateSemanticReplayCapsule = z.infer<
  typeof PrivateSemanticReplayCapsuleSchema
>;

export const PrivateSemanticReplayEvidenceSchema = z.object({
  schemaVersion: z.literal(
    CURRENT_PRIVATE_SEMANTIC_REPLAY_EVIDENCE_VERSION,
  ),
  caseId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,159}$/u),
  attemptId: z.string().min(1).max(512),
  capsuleSchemaVersion: z.literal(
    CURRENT_PRIVATE_SEMANTIC_REPLAY_CAPSULE_VERSION,
  ),
  capsuleSha256: Sha256Schema,
  byteCount: z.number().int().positive(),
  semanticRequestDigest: Sha256Schema,
  candidateDigest: Sha256Schema,
  promptHash: Sha256Schema,
  providerSchemaHash: Sha256Schema,
  modelConfigurationHash: Sha256Schema,
  directoryMode: z.literal("0700"),
  fileMode: z.literal("0600"),
  permissionVerified: z.literal(true),
  retentionStatus: z.literal("retained")
}).strict();

export type PrivateSemanticReplayEvidence = z.infer<
  typeof PrivateSemanticReplayEvidenceSchema
>;

export const PrivateSemanticReplayPreflightSchema = z.object({
  schemaVersion: z.literal(
    "sketchycut-private-semantic-replay-preflight@1.0.0",
  ),
  directoryMode: z.literal("0700"),
  nonPublishableRoot: z.literal(true),
  permissionVerified: z.literal(true)
}).strict();

function modeBits(mode: number): number {
  return mode & 0o777;
}

function capsuleFileName(caseId: string, attemptId: string): string {
  const safeCaseId = z.string()
    .regex(/^[a-z0-9][a-z0-9-]{2,159}$/u)
    .parse(caseId);
  const safeAttemptId = z.string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,511}$/u)
    .parse(attemptId);
  return `${safeCaseId}--${safeAttemptId}.json`;
}

async function assertPrivateDirectory(
  rootDirectory: string,
): Promise<void> {
  const observed = await stat(rootDirectory);
  if (!observed.isDirectory()) {
    throw new Error("PRIVATE_REPLAY_ROOT_NOT_DIRECTORY");
  }
  if (modeBits(observed.mode) !== PRIVATE_DIRECTORY_MODE) {
    throw new Error("PRIVATE_REPLAY_ROOT_PERMISSION_MISMATCH");
  }
}

export async function ensurePrivateSemanticReplayRoot(input: {
  rootDirectory: string;
  repositoryRoot?: string;
}) {
  const rootDirectory = path.resolve(input.rootDirectory);
  if (input.repositoryRoot !== undefined) {
    const repositoryRoot = path.resolve(input.repositoryRoot);
    const expected = path.join(
      repositoryRoot,
      "docs/private-evaluation-replay/m07-4",
    );
    if (rootDirectory !== expected) {
      throw new Error("PRIVATE_REPLAY_ROOT_NOT_PROTECTED_INPUT_TREE");
    }
    for (const publishableRoot of [
      path.join(repositoryRoot, "docs/evidence"),
      path.join(repositoryRoot, "artifacts")
    ]) {
      if (
        rootDirectory === publishableRoot ||
        rootDirectory.startsWith(`${publishableRoot}${path.sep}`)
      ) {
        throw new Error("PRIVATE_REPLAY_ROOT_PUBLISHABLE");
      }
    }
  }
  try {
    await assertPrivateDirectory(rootDirectory);
  } catch (error) {
    const code = error instanceof Error &&
        "code" in error &&
        typeof error.code === "string"
      ? error.code
      : null;
    if (code !== "ENOENT") throw error;
    await mkdir(rootDirectory, {
      recursive: true,
      mode: PRIVATE_DIRECTORY_MODE
    });
    await chmod(rootDirectory, PRIVATE_DIRECTORY_MODE);
    await assertPrivateDirectory(rootDirectory);
  }
  return PrivateSemanticReplayPreflightSchema.parse({
    schemaVersion:
      "sketchycut-private-semantic-replay-preflight@1.0.0",
    directoryMode: "0700",
    nonPublishableRoot: true,
    permissionVerified: true
  });
}

export async function buildPrivateSemanticReplayCapsule(input: {
  createdAt: string;
  caseId: string;
  attemptId: string;
  semanticRequestDigest: string;
  providerSchemaHash: string;
  request: unknown;
  candidate: unknown;
  deterministicControls: unknown;
  fabricationControls: unknown;
}): Promise<PrivateSemanticReplayCapsule> {
  const request = SemanticGenerationRequestSchema.parse(input.request);
  const candidate = SemanticInterpretationCandidateSchema.parse(
    input.candidate,
  );
  const authorization = authorizeSemanticInterpretation({
    interpretation: candidate,
    sourceEvidenceIndex: request.sourceEvidenceIndex
  });
  if (!authorization.success) {
    throw new Error("PRIVATE_REPLAY_CANDIDATE_UNAUTHORIZED");
  }
  const [
    observedRequestDigest,
    candidateDigest,
    providerSchemaHash,
    modelConfigurationHash
  ] = await Promise.all([
    semanticRequestDigest(request),
    hashCanonical(candidate),
    hashCanonical(
      semanticInterpretationProviderSchema(request.sourceEvidenceIndex),
    ),
    hashCanonical(request.modelConfiguration)
  ]);
  if (
    input.semanticRequestDigest !== observedRequestDigest ||
    input.providerSchemaHash !== providerSchemaHash
  ) {
    throw new Error("PRIVATE_REPLAY_IDENTITY_MISMATCH");
  }
  return PrivateSemanticReplayCapsuleSchema.parse({
    schemaVersion: CURRENT_PRIVATE_SEMANTIC_REPLAY_CAPSULE_VERSION,
    createdAt: input.createdAt,
    caseId: input.caseId,
    attemptId: input.attemptId,
    semanticRequestDigest: observedRequestDigest,
    candidateDigest,
    providerSchemaHash,
    modelConfigurationHash,
    semanticContract: {
      semanticSchemaId: request.semanticSchemaId,
      candidateSchemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
      atomTemplateVersion: request.atomTemplateVersion,
      capabilityCatalogVersion: request.capabilityCatalogVersion,
      unsupportedSemanticSignatureRegistryVersion:
        request.unsupportedSemanticSignatureRegistryVersion
    },
    request,
    candidate,
    deterministicControls: input.deterministicControls,
    fabricationControls: input.fabricationControls
  });
}

export async function writePrivateSemanticReplayCapsule(input: {
  rootDirectory: string;
  capsule: PrivateSemanticReplayCapsule;
}): Promise<PrivateSemanticReplayEvidence> {
  await assertPrivateDirectory(input.rootDirectory);
  const capsule = PrivateSemanticReplayCapsuleSchema.parse(input.capsule);
  const bytes = Buffer.from(`${stableJson(capsule)}\n`, "utf8");
  const target = path.join(
    input.rootDirectory,
    capsuleFileName(capsule.caseId, capsule.attemptId),
  );
  const temporary = path.join(
    input.rootDirectory,
    `.capsule-${randomUUID().replaceAll("-", "")}.tmp`,
  );
  const handle = await open(temporary, "wx", PRIVATE_CAPSULE_MODE);
  let handleClosed = false;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handleClosed = true;
    try {
      await link(temporary, target);
    } catch {
      throw new Error("PRIVATE_REPLAY_CAPSULE_ATOMIC_LINK_FAILED");
    }
  } finally {
    if (!handleClosed) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
  const observed = await stat(target);
  if (!observed.isFile() || modeBits(observed.mode) !== PRIVATE_CAPSULE_MODE) {
    throw new Error("PRIVATE_REPLAY_CAPSULE_PERMISSION_MISMATCH");
  }
  return PrivateSemanticReplayEvidenceSchema.parse({
    schemaVersion: CURRENT_PRIVATE_SEMANTIC_REPLAY_EVIDENCE_VERSION,
    caseId: capsule.caseId,
    attemptId: capsule.attemptId,
    capsuleSchemaVersion: capsule.schemaVersion,
    capsuleSha256: await sha256(bytes),
    byteCount: bytes.byteLength,
    semanticRequestDigest: capsule.semanticRequestDigest,
    candidateDigest: capsule.candidateDigest,
    promptHash: capsule.request.promptHash,
    providerSchemaHash: capsule.providerSchemaHash,
    modelConfigurationHash: capsule.modelConfigurationHash,
    directoryMode: "0700",
    fileMode: "0600",
    permissionVerified: true,
    retentionStatus: "retained"
  });
}

export async function loadPrivateSemanticReplayCapsule(input: {
  rootDirectory: string;
  caseId: string;
  attemptId: string;
  expectedEvidence?: PrivateSemanticReplayEvidence;
}): Promise<PrivateSemanticReplayCapsule> {
  await assertPrivateDirectory(input.rootDirectory);
  const target = path.join(
    input.rootDirectory,
    capsuleFileName(input.caseId, input.attemptId),
  );
  const observed = await stat(target);
  if (!observed.isFile() || modeBits(observed.mode) !== PRIVATE_CAPSULE_MODE) {
    throw new Error("PRIVATE_REPLAY_CAPSULE_PERMISSION_MISMATCH");
  }
  const bytes = await readFile(target);
  const capsule = PrivateSemanticReplayCapsuleSchema.parse(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
  const rebuilt = await buildPrivateSemanticReplayCapsule({
    createdAt: capsule.createdAt,
    caseId: capsule.caseId,
    attemptId: capsule.attemptId,
    semanticRequestDigest: capsule.semanticRequestDigest,
    providerSchemaHash: capsule.providerSchemaHash,
    request: capsule.request,
    candidate: capsule.candidate,
    deterministicControls: capsule.deterministicControls,
    fabricationControls: capsule.fabricationControls
  });
  if (await hashCanonical(rebuilt) !== await hashCanonical(capsule)) {
    throw new Error("PRIVATE_REPLAY_CAPSULE_CURRENT_IDENTITY_MISMATCH");
  }
  if (input.expectedEvidence !== undefined) {
    const expected = PrivateSemanticReplayEvidenceSchema.parse(
      input.expectedEvidence,
    );
    if (
      expected.caseId !== capsule.caseId ||
      expected.attemptId !== capsule.attemptId ||
      expected.capsuleSha256 !== await sha256(bytes) ||
      expected.byteCount !== bytes.byteLength ||
      expected.semanticRequestDigest !== capsule.semanticRequestDigest ||
      expected.candidateDigest !== capsule.candidateDigest
    ) {
      throw new Error("PRIVATE_REPLAY_EVIDENCE_MISMATCH");
    }
  }
  return capsule;
}

export async function replayPrivateSemanticCapsule(
  capsuleCandidate: unknown,
) {
  const capsule = PrivateSemanticReplayCapsuleSchema.parse(capsuleCandidate);
  const deterministic = await evaluateSemanticCandidateForOfflineReplay({
    controls: {
      deterministicControls: capsule.deterministicControls,
      fabricationControls: capsule.fabricationControls
    },
    request: capsule.request,
    candidate: capsule.candidate,
    requestId: `offline-replay-${capsule.caseId}-${capsule.attemptId}`
  });
  let packageSha256: string | null = null;
  if (
    deterministic.outcome.kind === "supported" ||
    deterministic.outcome.kind === "simplified" ||
    deterministic.outcome.kind === "modified"
  ) {
    if (!deterministic.outcome.exportAllowed || deterministic.compiled === null) {
      throw new Error("PRIVATE_REPLAY_EXPORTABLE_OUTCOME_INCOMPLETE");
    }
    const store = new MemoryGenerationStore();
    const ownerSessionId = `offline-replay-owner-${capsule.caseId}`;
    await store.createSession({
      schemaVersion: "1.0",
      sessionId: ownerSessionId,
      issuedAtMs: 1,
      expiresAtMs: 60_000,
      generationDispatches: 0,
      reservedExposureMicrousd: 0,
      lastDispatchAtMs: null,
      lastProjectId: null
    }, 60);
    const project = await createCurrentPersistedProject({
      store,
      ownerSessionId,
      projectId:
        `project-offline-replay-${(await hashCanonical(capsule)).slice(0, 32)}`,
      source: deterministic.outcome.source,
      deterministicControls: capsule.deterministicControls,
      fabricationControls: capsule.fabricationControls,
      compiled: deterministic.compiled,
      runtimeApplicationApiCalls: 0,
      nowMs: 1
    });
    packageSha256 = (await buildFabricationPackage(project)).sha256;
  }
  return z.object({
    schemaVersion: z.literal(
      "sketchycut-private-semantic-replay-result@1.0.0",
    ),
    caseId: z.string().min(1),
    attemptId: z.string().min(1),
    outcomeKind: z.enum([
      "supported",
      "simplified",
      "modified",
      "concept-only",
      "failure"
    ]),
    exportAllowed: z.boolean(),
    compiledDigest: Sha256Schema.nullable(),
    packageSha256: Sha256Schema.nullable(),
    runtimeApplicationApiCalls: z.literal(0),
    modelCalls: z.literal(0)
  }).strict().parse({
    schemaVersion:
      "sketchycut-private-semantic-replay-result@1.0.0",
    caseId: capsule.caseId,
    attemptId: capsule.attemptId,
    outcomeKind: deterministic.outcome.kind,
    exportAllowed: deterministic.outcome.exportAllowed,
    compiledDigest: deterministic.compiled === null
      ? null
      : await hashCanonical(deterministic.compiled),
    packageSha256,
    runtimeApplicationApiCalls: 0,
    modelCalls: 0
  });
}
