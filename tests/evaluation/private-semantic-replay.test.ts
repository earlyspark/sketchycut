import {
  chmod,
  mkdtemp,
  rm,
  stat
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { hashCanonical, sha256 } from "../../src/domain/hash.js";
import {
  CURRENT_PRIVATE_SEMANTIC_REPLAY_CAPSULE_VERSION,
  PrivateSemanticReplayCapsuleSchema,
  buildPrivateSemanticReplayCapsule,
  ensurePrivateSemanticReplayRoot,
  loadPrivateSemanticReplayCapsule,
  replayPrivateSemanticCapsule,
  writePrivateSemanticReplayCapsule
} from "../../src/evaluation/private-semantic-replay.js";
import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION
} from "../../src/interpretation/semantic-atom-registry.js";
import {
  CURRENT_PROMPT_LAYOUT_VERSION
} from "../../src/interpretation/semantic-input-contracts.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  SemanticInterpretationCandidateSchema,
  semanticInterpretationProviderSchema
} from "../../src/interpretation/semantic-model-contract.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS
} from "../../src/interpretation/generation-submission.js";
import {
  CURRENT_PROMPT_IDENTITY,
  prepareSemanticGenerationRequest
} from "../../src/interpretation/semantic-request.js";
import {
  DEFAULT_GENERATED_FABRICATION_CONTROLS
} from "../../src/ui/content/generated-setup.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function replayFixture() {
  const temporary = await mkdtemp(
    path.join(tmpdir(), "sketchycut-private-replay-"),
  );
  temporaryRoots.push(temporary);
  const rootDirectory = path.join(temporary, "private-input");
  await ensurePrivateSemanticReplayRoot({ rootDirectory });
  const promptHash = await sha256("private-replay-offline-prompt");
  const modelConfiguration = {
    modelId: "gpt-5.6-sol",
    reasoningEffort: "medium" as const,
    imageDetailPolicy: "high" as const,
    promptLayoutVersion: CURRENT_PROMPT_LAYOUT_VERSION,
    maxOutputTokens: 6_000,
    serviceTier: "default" as const,
    store: false as const
  };
  const prepared = await prepareSemanticGenerationRequest({
    brief: "An abstract rigid open-top compartment for replay proof.",
    references: [],
    roleConstraints: [],
    promptIdentity: CURRENT_PROMPT_IDENTITY,
    promptHash,
    modelConfiguration
  });
  const evidenceId =
    prepared.request.sourceEvidenceIndex.spans[0]!.evidenceId;
  const candidate = SemanticInterpretationCandidateSchema.parse({
    schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    items: [{
      claim: "Rigid containment remains accessible from the open top.",
      importance: "essential",
      evidenceBindings: [{
        evidenceId,
        aspect: "structure",
        support: "direct"
      }],
      relationships: [],
      measurements: [],
      state: "bound",
      atoms: [{
        kind: "primary-enclosure",
        enclosure: {
          quantity: null,
          priority: "must",
          evidenceIds: [evidenceId]
        },
        access: {
          kind: "open-top",
          priority: "must",
          evidenceIds: [evidenceId]
        },
        space: {
          layout: "unspecified",
          priority: "must",
          evidenceIds: [evidenceId]
        }
      }]
    }]
  });
  const providerSchemaHash = await hashCanonical(
    semanticInterpretationProviderSchema(
      prepared.request.sourceEvidenceIndex,
    ),
  );
  const capsule = await buildPrivateSemanticReplayCapsule({
    createdAt: "2026-07-24T00:00:00Z",
    caseId: "private-replay-proof",
    attemptId: "attempt-private-replay-1",
    semanticRequestDigest: prepared.requestDigest,
    providerSchemaHash,
    request: prepared.request,
    candidate,
    deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
    fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS
  });
  return { temporary, rootDirectory, capsule };
}

describe("protected private semantic replay capsules", () => {
  it("writes atomically with exact permissions and refuses overwrite", async () => {
    const fixture = await replayFixture();
    const evidence = await writePrivateSemanticReplayCapsule({
      rootDirectory: fixture.rootDirectory,
      capsule: fixture.capsule
    });
    expect((await stat(fixture.rootDirectory)).mode & 0o777).toBe(0o700);
    const target = path.join(
      fixture.rootDirectory,
      "private-replay-proof--attempt-private-replay-1.json",
    );
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    expect(evidence).toMatchObject({
      capsuleSchemaVersion:
        CURRENT_PRIVATE_SEMANTIC_REPLAY_CAPSULE_VERSION,
      directoryMode: "0700",
      fileMode: "0600",
      permissionVerified: true,
      retentionStatus: "retained"
    });
    await expect(writePrivateSemanticReplayCapsule({
      rootDirectory: fixture.rootDirectory,
      capsule: fixture.capsule
    })).rejects.toThrow("PRIVATE_REPLAY_CAPSULE_ATOMIC_LINK_FAILED");
    await expect(loadPrivateSemanticReplayCapsule({
      rootDirectory: fixture.rootDirectory,
      caseId: fixture.capsule.caseId,
      attemptId: fixture.capsule.attemptId,
      expectedEvidence: evidence
    })).resolves.toEqual(fixture.capsule);

    await chmod(target, 0o644);
    await expect(loadPrivateSemanticReplayCapsule({
      rootDirectory: fixture.rootDirectory,
      caseId: fixture.capsule.caseId,
      attemptId: fixture.capsule.attemptId
    })).rejects.toThrow("PRIVATE_REPLAY_CAPSULE_PERMISSION_MISMATCH");
  });

  it("keeps publishable evidence digest-only and rejects stale contracts", async () => {
    const fixture = await replayFixture();
    const evidence = await writePrivateSemanticReplayCapsule({
      rootDirectory: fixture.rootDirectory,
      capsule: fixture.capsule
    });
    const serializedEvidence = JSON.stringify(evidence);
    expect(serializedEvidence).not.toContain(
      fixture.capsule.candidate.items[0]!.claim,
    );
    expect(serializedEvidence).not.toContain(
      fixture.capsule.request.semanticBrief,
    );
    expect(serializedEvidence).not.toContain(fixture.rootDirectory);
    expect(serializedEvidence).not.toContain("data:image");
    expect(PrivateSemanticReplayCapsuleSchema.safeParse({
      ...fixture.capsule,
      schemaVersion: "sketchycut-private-semantic-replay-capsule@0.9.0"
    }).success).toBe(false);
    expect(PrivateSemanticReplayCapsuleSchema.safeParse({
      ...fixture.capsule,
      request: {
        ...fixture.capsule.request,
        semanticSchemaId: "semantic-atom-inventory@previous"
      }
    }).success).toBe(false);

    let observedError = "";
    try {
      await writePrivateSemanticReplayCapsule({
        rootDirectory: fixture.rootDirectory,
        capsule: fixture.capsule
      });
    } catch (error) {
      observedError = error instanceof Error ? error.message : String(error);
    }
    expect(observedError).not.toContain(fixture.rootDirectory);
    expect(observedError).not.toContain(
      fixture.capsule.candidate.items[0]!.claim,
    );
  });

  it("replays the complete deterministic pipeline with zero model calls", async () => {
    const fixture = await replayFixture();
    const evidence = await writePrivateSemanticReplayCapsule({
      rootDirectory: fixture.rootDirectory,
      capsule: fixture.capsule
    });
    const loaded = await loadPrivateSemanticReplayCapsule({
      rootDirectory: fixture.rootDirectory,
      caseId: fixture.capsule.caseId,
      attemptId: fixture.capsule.attemptId,
      expectedEvidence: evidence
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network disabled"),
    );
    const replay = await replayPrivateSemanticCapsule(loaded);
    const repeatedReplay = await replayPrivateSemanticCapsule(loaded);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(replay).toMatchObject({
      outcomeKind: "supported",
      exportAllowed: true,
      runtimeApplicationApiCalls: 0,
      modelCalls: 0
    });
    expect(replay.compiledDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(replay.packageSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(repeatedReplay).toEqual(replay);
  });

  it("accepts only the protected non-publishable repository root", async () => {
    const temporary = await mkdtemp(
      path.join(tmpdir(), "sketchycut-private-replay-root-"),
    );
    temporaryRoots.push(temporary);
    const expectedRoot = path.join(
      temporary,
      "docs/private-evaluation-replay/m07-4",
    );
    await expect(ensurePrivateSemanticReplayRoot({
      rootDirectory: expectedRoot,
      repositoryRoot: temporary
    })).resolves.toMatchObject({
      directoryMode: "0700",
      nonPublishableRoot: true,
      permissionVerified: true
    });
    await expect(ensurePrivateSemanticReplayRoot({
      rootDirectory: path.join(temporary, "docs/evidence/m07-4/replay"),
      repositoryRoot: temporary
    })).rejects.toThrow("PRIVATE_REPLAY_ROOT_NOT_PROTECTED_INPUT_TREE");
  });
});
