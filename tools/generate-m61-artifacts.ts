import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sketchyCutContentSecurityPolicy } from "../next.config.js";
import { GenerationSubmissionV1Schema } from "../src/interpretation/generation-protocol.js";
import { IntentGraphV1Schema } from "../src/interpretation/intent-graph.js";
import { buildM5ReplayIntent, M5_REPLAY_SCENARIOS } from "../src/interpretation/m5-replay-corpus.js";
import type {
  SemanticInterpretationTransport,
  SemanticTransportOutcome
} from "../src/interpretation/orchestrator.js";
import type { SemanticGenerationRequestV1 } from "../src/interpretation/semantic-request.js";
import { renderSceneSvg } from "../src/projections/mesh/render-svg.js";
import type { M6RuntimeConfig } from "../src/server/m6/config.js";
import { executeM61Generation } from "../src/server/m6/generation-service.js";
import type { M6AuthenticatedRequest } from "../src/server/m6/http-security.js";
import { MemoryM6Store } from "../src/server/m6/memory-store.js";
import { DEFAULT_GENERATED_CONTROLS } from "../src/ui/content/generated-projects.js";
import { DEFAULT_GENERATED_FABRICATION_CONTROLS } from "../src/ui/content/generated-setup.js";
import {
  parseM61ExposureCommandArguments,
  runM61ExposureAuthorizationCommand
} from "./m61-exposure-command.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const outputRoot = path.join(root, "artifacts/m6.1");

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(candidate) : [candidate];
  }))).flat().sort();
}

async function treeFingerprint(relativeRoot: string) {
  const directory = path.join(root, relativeRoot);
  const files = await filesUnder(directory);
  const entries = await Promise.all(files.map(async (file) => ({
    path: path.relative(root, file),
    sha256: sha256(await readFile(file))
  })));
  return {
    root: relativeRoot,
    entryCount: entries.length,
    sha256: sha256(entries.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(""))
  };
}

async function sourceHashes(relativePaths: readonly string[]) {
  return Promise.all(relativePaths.map(async (relative) => ({
    path: relative,
    sha256: sha256(await readFile(path.join(root, relative)))
  })));
}

async function globalExposureProof() {
  const nowMs = 100_000;
  const store = new MemoryM6Store(() => nowMs);
  for (let index = 0; index < 21; index += 1) {
    await store.createSession({
      schemaVersion: "1.0",
      sessionId: `artifact-session-${String(index + 1)}`,
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + 60_000,
      generationDispatches: 0,
      reservedExposureMicrousd: 0,
      lastDispatchAtMs: null,
      lastProjectId: null
    }, 60);
  }
  const decisions = await Promise.all(Array.from({ length: 21 }, (_, index) =>
    store.reserveGeneration({
      sessionId: `artifact-session-${String(index + 1)}`,
      clientKey: `artifact-client-${String(index + 1)}`,
      nowMs,
      minimumIntervalMs: 0,
      maximumSessionDispatches: 4,
      requestExposureMicrousd: 250_000,
      maximumSessionExposureMicrousd: 1_000_000,
      clientWindowMs: 60_000,
      maximumClientDispatches: 12
    })));
  const authorizationStore = new MemoryM6Store();
  const authorizationEvidenceDigest = sha256(JSON.stringify({
    milestone: "M6.1",
    review: "deterministic global-exposure authorization proof",
    initialCeilingMicrousd: 5_000_000,
    increaseMicrousd: 5_000_000
  }));
  const commandBase = [
    "--increase-usd", "5",
    "--evidence-sha256", authorizationEvidenceDigest,
    "--note", "M6.1 deterministic artifact review"
  ];
  const dryRun = await runM61ExposureAuthorizationCommand({
    store: authorizationStore,
    arguments: parseM61ExposureCommandArguments(commandBase),
    now: new Date("2026-07-17T23:30:00.000Z"),
    authorizationId: "m61-artifact-dry-run"
  });
  const afterDryRun = await authorizationStore.readGlobalExposureState();
  const applied = await runM61ExposureAuthorizationCommand({
    store: authorizationStore,
    arguments: parseM61ExposureCommandArguments([...commandBase, "--apply"]),
    now: new Date("2026-07-17T23:31:00.000Z"),
    authorizationId: "m61-artifact-applied"
  });
  return {
    schemaVersion: "1.0",
    milestone: "M6.1",
    initialCeilingMicrousd: 5_000_000,
    requestReservationMicrousd: 250_000,
    allowedReservationCount: decisions.filter((decision) => decision.allowed).length,
    deniedReservation: decisions[20],
    finalReservationState: await store.readGlobalExposureState(),
    dryRun: {
      applied: dryRun.applied,
      stateAfter: afterDryRun,
      outputSha256: sha256(dryRun.output)
    },
    reviewedIncrease: {
      applied: applied.applied,
      stateAfter: await authorizationStore.readGlobalExposureState(),
      authorizationRecords: await authorizationStore.readExposureAuthorizations(),
      outputSha256: sha256(applied.output)
    },
    refundsOrDecrementsImplemented: false
  };
}

function liveConfig(): M6RuntimeConfig {
  return {
    security: {
      accessCodeDigest: Buffer.alloc(32),
      signingSecret: Buffer.alloc(32),
      secureCookies: false
    },
    storeMode: "memory",
    upstash: null,
    generationEnabled: true,
    generationMode: "live",
    generationExperience: "live",
    liveTransport: null
  };
}

function submission(brief: string) {
  return GenerationSubmissionV1Schema.parse({
    schemaVersion: "1.0",
    brief,
    references: [{
      descriptor: {
        referenceId: "reference-artifact",
        sha256: "c".repeat(64),
        mediaType: "image/png",
        width: 16,
        height: 12
      },
      dataUrl: "data:image/png;base64,AA=="
    }],
    roleConstraints: [],
    deterministicControls: DEFAULT_GENERATED_CONTROLS,
    fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
    retry: null
  });
}

function rigidIntent(request: SemanticGenerationRequestV1): unknown {
  return buildM5ReplayIntent(request, {
    ...M5_REPLAY_SCENARIOS[0]!,
    brief: request.normalizedBrief
  });
}

function requiredCutoutIntent(request: SemanticGenerationRequestV1): unknown {
  const base = IntentGraphV1Schema.parse(rigidIntent(request));
  return IntentGraphV1Schema.parse({
    ...base,
    title: "Exact reference-traced cutout",
    coreIntent: request.normalizedBrief,
    requirements: [...base.requirements, {
      id: "required-reference-traced-cutout",
      priority: "must",
      kind: "specific-profile",
      statement: "The fabrication contour must exactly trace the reference silhouette.",
      evidence: [{
        evidenceId: "brief-required-cutout",
        source: "text",
        referenceId: null,
        statement: "An exact reference-traced cutout is mandatory."
      }]
    }]
  });
}

class RecordedTransport implements SemanticInterpretationTransport {
  dispatchCount = 0;

  constructor(private readonly intent: (request: SemanticGenerationRequestV1) => unknown) {}

  dispatch(input: { request: SemanticGenerationRequestV1 }): Promise<SemanticTransportOutcome> {
    this.dispatchCount += 1;
    return Promise.resolve({
      kind: "completed",
      providerRequestId: `artifact-provider-${String(this.dispatchCount)}`,
      responseId: `artifact-response-${String(this.dispatchCount)}`,
      latencyMs: 7,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 0,
        reasoningTokens: 10,
        outputTokens: 80,
        totalTokens: 180
      },
      estimatedCostUsd: 0.00145,
      requestBudgetUpperBoundUsd: 0.25,
      priceSnapshotId: "recorded-artifact-price",
      intentCandidate: this.intent(input.request)
    });
  }
}

async function recordedRun(
  brief: string,
  intent: (request: SemanticGenerationRequestV1) => unknown,
) {
  const store = new MemoryM6Store();
  const nowMs = Date.now();
  const session = {
    schemaVersion: "1.0" as const,
    sessionId: `artifact-generation-${sha256(brief).slice(0, 16)}`,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 60_000,
    generationDispatches: 0,
    reservedExposureMicrousd: 0,
    lastDispatchAtMs: null,
    lastProjectId: null
  };
  await store.createSession(session, 60);
  const authenticated: M6AuthenticatedRequest = {
    session,
    clientIdentifier: `artifact-client-${sha256(brief).slice(0, 16)}`
  };
  const transport = new RecordedTransport(intent);
  const execute = () => executeM61Generation({
    config: liveConfig(),
    authenticated,
    submission: submission(brief),
    store,
    runtimeOrigin: "test-recorded",
    interpretationTransport: transport,
    promptHash: "d".repeat(64)
  });
  return { store, transport, execute };
}

async function recordedGenerationProof() {
  const arbitraryBrief = "Build a compact glue-free organizer for three fountain pens and a small ink bottle.";
  const arbitrary = await recordedRun(arbitraryBrief, rigidIntent);
  const first = await arbitrary.execute();
  const second = await arbitrary.execute();
  const cutout = await recordedRun(
    "Make an exact fox-silhouette cutout template traced from this reference; the outline is mandatory.",
    requiredCutoutIntent,
  );
  const withheld = await cutout.execute();
  if (first.outcome.kind !== "supported" || second.outcome.kind !== "supported" ||
      withheld.outcome.kind !== "concept-only") {
    throw new Error("M61_RECORDED_ARTIFACT_OUTCOME_UNEXPECTED");
  }
  return {
    schemaVersion: "1.0",
    milestone: "M6.1",
    transport: "recorded-injected-zero-network",
    arbitraryBrief: {
      absentFromFrozenCorpus: !M5_REPLAY_SCENARIOS.some((scenario) => scenario.brief === arbitraryBrief),
      firstOutcome: first.outcome.kind,
      firstCacheResult: first.outcome.cacheResult,
      firstRuntimeOrigin: first.outcome.attempt?.runtimeOrigin,
      firstStrictParse: first.outcome.attempt?.strictParse,
      geometryHash: first.outcome.compiled.geometryHash,
      projectPersisted: first.project !== null,
      secondOutcome: second.outcome.kind,
      secondAttemptOutcome: second.outcome.attempt?.outcome,
      secondNetworkDispatchCount: second.outcome.attempt?.networkDispatchCount,
      dispatchCount: arbitrary.transport.dispatchCount,
      ledgerAttemptCount: (await arbitrary.store.readLedgerAttempts()).length,
      globalReservedExposureMicrousd:
        (await arbitrary.store.readGlobalExposureState()).reservedExposureMicrousd
    },
    mandatoryCutout: {
      outcome: withheld.outcome.kind,
      exportAllowed: withheld.outcome.exportAllowed,
      projectPersisted: withheld.project !== null,
      blockedRequirementIds: withheld.outcome.mapping.blockedRequirementIds,
      findingCodes: withheld.outcome.mapping.findings.map((finding) => finding.code).sort(),
      unresolvedNeeds: withheld.outcome.mapping.unresolvedNeeds,
      dispatchCount: cutout.transport.dispatchCount
    },
    externalNetworkRequests: 0,
    paidModelRequests: 0
  };
}

async function motifProjectionArtifacts() {
  const scenario = {
    ...M5_REPLAY_SCENARIOS.find((candidate) => candidate.id === "both-role")!,
    brief: "Build a hinged container with a framed focal treatment derived from the reference.",
    motif: {
      composition: "focal" as const,
      density: "balanced" as const,
      symmetry: "bilateral" as const,
      primitiveFamilies: [
        "corner-score-ticks" as const,
        "filled-diamond-focal" as const,
        "inset-score-frame" as const
      ]
    }
  };
  const run = await recordedRun(
    scenario.brief,
    (request) => buildM5ReplayIntent(request, scenario),
  );
  const result = await run.execute();
  if (result.outcome.kind !== "supported" || result.project === null) {
    throw new Error("M61_MOTIF_PROJECTION_ARTIFACT_OUTCOME_UNEXPECTED");
  }
  const compiled = result.outcome.compiled;
  const canonicalTreatments = compiled.document.parts.flatMap((part) =>
    part.features
      .filter((feature) => feature.kind === "treatment")
      .map((feature) => ({ partId: part.id, featureId: feature.id })),
  );
  const sceneTreatments = compiled.bundle.scene.surfaceTreatments ?? [];
  const canonicalFeatureIds = canonicalTreatments.map((item) => item.featureId).sort();
  const sceneSourceFeatureIds = sceneTreatments.map((item) => item.sourceFeatureId).sort();
  if (canonicalFeatureIds.join("\n") !== sceneSourceFeatureIds.join("\n")) {
    throw new Error("M61_MOTIF_SCENE_FEATURE_SET_MISMATCH");
  }
  const assembledSvg = renderSceneSvg(compiled.bundle.scene, "assembled");
  const explodedSvg = renderSceneSvg(compiled.bundle.scene, "exploded");
  return {
    proof: {
      schemaVersion: "1.0",
      milestone: "M6.1",
      transport: "recorded-injected-zero-network",
      outcome: result.outcome.kind,
      sourceDocumentHash: compiled.bundle.sourceDocumentHash,
      geometryHash: compiled.geometryHash,
      canonicalFeatureIds,
      sceneSourceFeatureIds,
      targetPartIds: [...new Set(sceneTreatments.map((item) => item.partId))].sort(),
      operations: [...new Set(sceneTreatments.map((item) => item.operation))].sort(),
      faceOffsetsMm: [...new Set(sceneTreatments.flatMap((item) =>
        item.verticesMm.map((vertex) => vertex.zMm)
      ))].sort((left, right) => left - right),
      assembledSvgSha256: sha256(assembledSvg),
      explodedSvgSha256: sha256(explodedSvg),
      referenceApproximationDisclosed:
        compiled.document.provenance.simplificationDisclosures?.some((item) =>
          item.includes("no reference region was traced or vectorized")
        ) === true,
      externalNetworkRequests: 0,
      paidModelRequests: 0
    },
    assembledSvg,
    explodedSvg
  };
}

await mkdir(outputRoot, { recursive: true });
const frozenBaselines = {
  schemaVersion: "1.0",
  milestone: "M6.1",
  immutableTrees: await Promise.all([
    treeFingerprint("artifacts/m5"),
    treeFingerprint("artifacts/m6"),
    treeFingerprint("docs/evidence/m05"),
    treeFingerprint("docs/evidence/m06")
  ])
};
const runtimeContract = {
  schemaVersion: "1.0",
  milestone: "M6.1",
  defaultAuthenticatedExperience: "live",
  fixtureExperience: "replay-fixture",
  replayScenarioCount: M5_REPLAY_SCENARIOS.length,
  invalidFixtureLabel: "Invalid output (failure-preservation fixture)",
  developmentCspUnsafeEval: sketchyCutContentSecurityPolicy("development").includes("'unsafe-eval'"),
  productionCspUnsafeEval: sketchyCutContentSecurityPolicy("production").includes("'unsafe-eval'"),
  memoryStoreSlot: "sketchycut.m6.memory-store.v1",
  accessSessionAuthority: "signed-cookie-stateless",
  durableSessionInitialization: "protected-api-first-use-atomic",
  accessRequiresDurableStore: false,
  paidDispatchRequiresDurableStore: true,
  localAccessCodeOverride: {
    variable: "SKETCHYCUT_LOCAL_ACCESS_CODE",
    digestDerivedBeforeSpawn: true,
    plaintextForwardedToNext: false,
    plaintextShadowedEmpty: true,
    nextEnvironmentReloadRegression: true,
    deploymentRemainsDigestOnly: true
  },
  runtimeOrigins: [
    "local-development",
    "deployment-preview",
    "deployment-production",
    "test-recorded"
  ],
  deterministicCompilationFindingCodes: "privacy-safe-exact-code",
  proceduralMotifConstructionSearch: {
    policyId: "procedural-motif-construction-search",
    policyVersion: "1.0.0",
    requestedConstructionTriedFirst: true,
    substitutionsDisclosed: true
  },
  sourceFiles: await sourceHashes([
    "package.json",
    "next.config.ts",
    "src/app/api/session/route.ts",
    "src/app/create/page.tsx",
    "src/server/m6/access.ts",
    "src/server/m6/contracts.ts",
    "src/server/m6/http-security.ts",
    "src/server/m6/store.ts",
    "src/server/m6/upstash-store.ts",
    "src/server/m6/generation-service.ts",
    "src/server/m6/exposure-authorization.ts",
    "src/interpretation/compilation-error.ts",
    "src/interpretation/generated-project-compiler.ts",
    "src/interpretation/orchestrator.ts",
    "src/interpretation/procedural-motif-planner.ts",
    "src/interpretation/replay-orchestrator.ts",
    "src/domain/contracts.ts",
    "src/projections/mesh/treatment.ts",
    "src/projections/mesh/scene.ts",
    "src/projections/mesh/render-svg.ts",
    "src/ui/components/canonical-project-workspace.tsx",
    "src/ui/components/generated-project-controller.tsx",
    "src/ui/components/generation-composer.tsx",
    "src/ui/components/guided-examples-controller.tsx",
    "src/ui/components/scene-viewer.tsx",
    "tests/server/m61-runtime.test.ts",
    "tools/m61-development.ts",
    "tools/m61-exposure-command.ts"
  ])
};
const motifProjection = await motifProjectionArtifacts();
const files = new Map<string, string>([
  ["frozen-baselines.json", JSON.stringify(frozenBaselines, null, 2) + "\n"],
  ["runtime-contract.json", JSON.stringify(runtimeContract, null, 2) + "\n"],
  ["global-exposure-proof.json", JSON.stringify(await globalExposureProof(), null, 2) + "\n"],
  ["recorded-generation-proof.json", JSON.stringify(await recordedGenerationProof(), null, 2) + "\n"],
  ["motif-projection-proof.json", JSON.stringify(motifProjection.proof, null, 2) + "\n"],
  ["motif-scene-assembled.svg", motifProjection.assembledSvg],
  ["motif-scene-exploded.svg", motifProjection.explodedSvg],
  ["non-live-verification.json", JSON.stringify({
    schemaVersion: "1.0",
    milestone: "M6.1",
    status: "zero-network-pass-live-evidence-recorded-separately",
    commands: [
      { command: "npm run typecheck", result: "pass" },
      { command: "npm run lint", result: "pass" },
      { command: "npm run verify:architecture", result: "pass" },
      { command: "npm run build", result: "pass" },
      { command: "npm run test:e2e:m5", result: "pass", detail: "5/5" },
      { command: "npm run test:e2e:m6", result: "pass", detail: "5/5" },
      { command: "npm run test:e2e:m6.1:cold", result: "pass", detail: "3/3; zero external requests" }
    ],
    apiUsage: {
      paidModelRequests: 0,
      runtimeApplicationApiCalls: 0,
      tokenUsage: null,
      estimatedCostUsd: 0,
      unresolvedPotentialExposureUsd: 0
    },
    liveBrowserGate: "passed-separate-evidence",
    physicalVerification: "required-not-performed"
  }, null, 2) + "\n"]
]);
for (const [name, contents] of files) {
  await writeFile(path.join(outputRoot, name), contents, "utf8");
}
const artifactManifest = {
  schemaVersion: "1.0",
  milestone: "M6.1",
  status: "complete-live-evidence-recorded-separately",
  entries: [...files].map(([name, contents]) => ({
    path: `artifacts/m6.1/${name}`,
    bytes: Buffer.byteLength(contents),
    sha256: sha256(contents)
  }))
};
await writeFile(
  path.join(outputRoot, "artifact-manifest.json"),
  JSON.stringify(artifactManifest, null, 2) + "\n",
  "utf8",
);
process.stdout.write(
  `Generated ${String(files.size + 1)} zero-network M6.1 artifacts with frozen-tree fingerprints.\n`,
);
