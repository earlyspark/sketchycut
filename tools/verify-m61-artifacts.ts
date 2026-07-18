import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const artifactRoot = path.join(repositoryRoot, "artifacts/m6.1");
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const RelativePathSchema = z.string().min(1).refine((value) =>
  !path.isAbsolute(value) && !value.split("/").includes(".."),
);

const ManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6.1"),
  status: z.literal("complete-live-evidence-recorded-separately"),
  entries: z.array(z.object({
    path: RelativePathSchema,
    bytes: z.number().int().positive(),
    sha256: HashSchema
  }).strict()).length(8)
}).strict();

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8")) as unknown;
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(candidate) : [candidate];
  }))).flat().sort();
}

async function treeFingerprint(relativeRoot: string) {
  const files = await filesUnder(path.join(repositoryRoot, relativeRoot));
  const entries = await Promise.all(files.map(async (file) => ({
    path: path.relative(repositoryRoot, file),
    sha256: sha256(await readFile(file))
  })));
  return {
    root: relativeRoot,
    entryCount: entries.length,
    sha256: sha256(entries.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(""))
  };
}

const manifest = ManifestSchema.parse(await readJson("artifacts/m6.1/artifact-manifest.json"));
const expectedFiles = [
  "artifact-manifest.json",
  "frozen-baselines.json",
  "global-exposure-proof.json",
  "motif-projection-proof.json",
  "motif-scene-assembled.svg",
  "motif-scene-exploded.svg",
  "non-live-verification.json",
  "recorded-generation-proof.json",
  "runtime-contract.json"
];
if ((await readdir(artifactRoot)).sort().join("\n") !== expectedFiles.join("\n")) {
  throw new Error("M61ART001_FILE_SET_CHANGED");
}
if (new Set(manifest.entries.map((entry) => entry.path)).size !== manifest.entries.length) {
  throw new Error("M61ART002_DUPLICATE_MANIFEST_PATH");
}
for (const entry of manifest.entries) {
  const bytes = await readFile(path.join(repositoryRoot, entry.path));
  if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256) {
    throw new Error(`M61ART003_MANIFEST_MISMATCH: ${entry.path}`);
  }
}

const frozen = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6.1"),
  immutableTrees: z.array(z.object({
    root: z.enum(["artifacts/m5", "artifacts/m6", "docs/evidence/m05", "docs/evidence/m06"]),
    entryCount: z.number().int().positive(),
    sha256: HashSchema
  }).strict()).length(4)
}).strict().parse(await readJson("artifacts/m6.1/frozen-baselines.json"));
const expectedFrozenRoots = ["artifacts/m5", "artifacts/m6", "docs/evidence/m05", "docs/evidence/m06"];
if (frozen.immutableTrees.map((entry) => entry.root).join("\n") !== expectedFrozenRoots.join("\n")) {
  throw new Error("M61ART004_FROZEN_ROOT_SET_CHANGED");
}
for (const recorded of frozen.immutableTrees) {
  const current = await treeFingerprint(recorded.root);
  if (JSON.stringify(current) !== JSON.stringify(recorded)) {
    throw new Error(`M61ART005_FROZEN_TREE_DRIFT: ${recorded.root}`);
  }
}

const runtime = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6.1"),
  defaultAuthenticatedExperience: z.literal("live"),
  fixtureExperience: z.literal("replay-fixture"),
  replayScenarioCount: z.literal(11),
  invalidFixtureLabel: z.literal("Invalid output (failure-preservation fixture)"),
  developmentCspUnsafeEval: z.literal(true),
  productionCspUnsafeEval: z.literal(false),
  memoryStoreSlot: z.literal("sketchycut.m6.memory-store.v1"),
  accessSessionAuthority: z.literal("signed-cookie-stateless"),
  durableSessionInitialization: z.literal("protected-api-first-use-atomic"),
  accessRequiresDurableStore: z.literal(false),
  paidDispatchRequiresDurableStore: z.literal(true),
  localAccessCodeOverride: z.object({
    variable: z.literal("SKETCHYCUT_LOCAL_ACCESS_CODE"),
    digestDerivedBeforeSpawn: z.literal(true),
    plaintextForwardedToNext: z.literal(false),
    plaintextShadowedEmpty: z.literal(true),
    nextEnvironmentReloadRegression: z.literal(true),
    deploymentRemainsDigestOnly: z.literal(true)
  }).strict(),
  runtimeOrigins: z.tuple([
    z.literal("local-development"),
    z.literal("deployment-preview"),
    z.literal("deployment-production"),
    z.literal("test-recorded")
  ]),
  deterministicCompilationFindingCodes: z.literal("privacy-safe-exact-code"),
  proceduralMotifConstructionSearch: z.object({
    policyId: z.literal("procedural-motif-construction-search"),
    policyVersion: z.literal("1.0.0"),
    requestedConstructionTriedFirst: z.literal(true),
    substitutionsDisclosed: z.literal(true)
  }).strict(),
  sourceFiles: z.array(z.object({ path: RelativePathSchema, sha256: HashSchema }).strict()).length(28)
}).strict().parse(await readJson("artifacts/m6.1/runtime-contract.json"));
for (const source of runtime.sourceFiles) {
  if (sha256(await readFile(path.join(repositoryRoot, source.path))) !== source.sha256) {
    throw new Error(`M61ART006_SOURCE_HASH_DRIFT: ${source.path}`);
  }
}

const exposure = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6.1"),
  initialCeilingMicrousd: z.literal(5_000_000),
  requestReservationMicrousd: z.literal(250_000),
  allowedReservationCount: z.literal(20),
  deniedReservation: z.object({
    allowed: z.literal(false),
    reason: z.literal("global-budget"),
    retryAfterMs: z.literal(0),
    generationDispatches: z.literal(0),
    reservedExposureMicrousd: z.literal(0),
    globalReservedExposureMicrousd: z.literal(5_000_000)
  }).strict(),
  finalReservationState: z.object({
    schemaVersion: z.literal("1.0"),
    authorizedCeilingMicrousd: z.literal(5_000_000),
    reservedExposureMicrousd: z.literal(5_000_000),
    authorizationVersion: z.literal(0)
  }).strict(),
  dryRun: z.object({
    applied: z.literal(false),
    stateAfter: z.object({
      schemaVersion: z.literal("1.0"),
      authorizedCeilingMicrousd: z.literal(5_000_000),
      reservedExposureMicrousd: z.literal(0),
      authorizationVersion: z.literal(0)
    }).strict(),
    outputSha256: HashSchema
  }).strict(),
  reviewedIncrease: z.object({
    applied: z.literal(true),
    stateAfter: z.object({
      schemaVersion: z.literal("1.0"),
      authorizedCeilingMicrousd: z.literal(10_000_000),
      reservedExposureMicrousd: z.literal(0),
      authorizationVersion: z.literal(1)
    }).strict(),
    authorizationRecords: z.array(z.object({
      schemaVersion: z.literal("1.0"),
      authorizationId: z.literal("m61-artifact-applied"),
      priorAuthorizedCeilingMicrousd: z.literal(5_000_000),
      increaseMicrousd: z.literal(5_000_000),
      resultingAuthorizedCeilingMicrousd: z.literal(10_000_000),
      priorReservedExposureMicrousd: z.literal(0),
      priorAuthorizationVersion: z.literal(0),
      ledgerSummary: z.object({
        attemptCount: z.literal(0),
        dispatchedAttemptCount: z.literal(0),
        nonDispatchedAttemptCount: z.literal(0),
        confirmedEstimatedCostMicrousd: z.literal(0),
        unresolvedPotentiallyBilledExposureMicrousd: z.literal(0),
        runtimeOrigins: z.object({
          localDevelopment: z.literal(0),
          deploymentPreview: z.literal(0),
          deploymentProduction: z.literal(0),
          testRecorded: z.literal(0),
          legacyUnattributed: z.literal(0)
        }).strict()
      }).strict(),
      evidenceSha256: HashSchema,
      authorizedAt: z.literal("2026-07-17T23:31:00.000Z"),
      reviewNote: z.literal("M6.1 deterministic artifact review")
    }).strict()).length(1),
    outputSha256: HashSchema
  }).strict(),
  refundsOrDecrementsImplemented: z.literal(false)
}).strict().parse(await readJson("artifacts/m6.1/global-exposure-proof.json"));
const expectedAuthorizationEvidence = sha256(JSON.stringify({
  milestone: "M6.1",
  review: "deterministic global-exposure authorization proof",
  initialCeilingMicrousd: 5_000_000,
  increaseMicrousd: 5_000_000
}));
if (exposure.reviewedIncrease.authorizationRecords[0]!.evidenceSha256 !== expectedAuthorizationEvidence) {
  throw new Error("M61ART007_AUTHORIZATION_EVIDENCE_DIGEST_CHANGED");
}

const generation = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6.1"),
  transport: z.literal("recorded-injected-zero-network"),
  arbitraryBrief: z.object({
    absentFromFrozenCorpus: z.literal(true),
    firstOutcome: z.enum(["supported", "supported-with-simplification"]),
    firstCacheResult: z.literal("miss"),
    firstRuntimeOrigin: z.literal("test-recorded"),
    firstStrictParse: z.literal("passed"),
    geometryHash: HashSchema,
    projectPersisted: z.literal(true),
    secondOutcome: z.enum(["supported", "supported-with-simplification"]),
    secondAttemptOutcome: z.literal("cache-hit"),
    secondNetworkDispatchCount: z.literal(0),
    dispatchCount: z.literal(1),
    ledgerAttemptCount: z.literal(2),
    globalReservedExposureMicrousd: z.literal(250_000)
  }).strict(),
  mandatoryCutout: z.object({
    outcome: z.literal("concept-only"),
    exportAllowed: z.literal(false),
    projectPersisted: z.literal(false),
    blockedRequirementIds: z.tuple([z.literal("required-reference-traced-cutout")]),
    findingCodes: z.tuple([z.literal("MANDATORY_REQUIREMENT_UNSUPPORTED")]),
    unresolvedNeeds: z.array(z.string().min(1)).min(2),
    dispatchCount: z.literal(1)
  }).strict(),
  externalNetworkRequests: z.literal(0),
  paidModelRequests: z.literal(0)
}).strict().parse(await readJson("artifacts/m6.1/recorded-generation-proof.json"));
if (generation.arbitraryBrief.firstOutcome !== generation.arbitraryBrief.secondOutcome) {
  throw new Error("M61ART008_CACHE_OUTCOME_CHANGED");
}

const motif = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6.1"),
  transport: z.literal("recorded-injected-zero-network"),
  outcome: z.enum(["supported", "supported-with-simplification"]),
  sourceDocumentHash: HashSchema,
  geometryHash: HashSchema,
  canonicalFeatureIds: z.array(z.string().min(1)).min(1),
  sceneSourceFeatureIds: z.array(z.string().min(1)).min(1),
  targetPartIds: z.array(z.string().min(1)).min(1),
  operations: z.array(z.enum(["engrave", "score"])).min(1),
  faceOffsetsMm: z.array(z.number()).min(1),
  assembledSvgSha256: HashSchema,
  explodedSvgSha256: HashSchema,
  referenceApproximationDisclosed: z.literal(true),
  externalNetworkRequests: z.literal(0),
  paidModelRequests: z.literal(0)
}).strict().parse(await readJson("artifacts/m6.1/motif-projection-proof.json"));
if (motif.canonicalFeatureIds.join("\n") !== motif.sceneSourceFeatureIds.join("\n") ||
    motif.assembledSvgSha256 !== sha256(await readFile(path.join(
      repositoryRoot,
      "artifacts/m6.1/motif-scene-assembled.svg",
    ))) ||
    motif.explodedSvgSha256 !== sha256(await readFile(path.join(
      repositoryRoot,
      "artifacts/m6.1/motif-scene-exploded.svg",
    )))) {
  throw new Error("M61ART009_MOTIF_PROJECTION_MISMATCH");
}

const verification = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6.1"),
  status: z.literal("zero-network-pass-live-evidence-recorded-separately"),
  commands: z.array(z.object({
    command: z.string().min(1),
    result: z.literal("pass"),
    detail: z.string().min(1).optional()
  }).strict()).min(7),
  apiUsage: z.object({
    paidModelRequests: z.literal(0),
    runtimeApplicationApiCalls: z.literal(0),
    tokenUsage: z.null(),
    estimatedCostUsd: z.literal(0),
    unresolvedPotentialExposureUsd: z.literal(0)
  }).strict(),
  liveBrowserGate: z.literal("passed-separate-evidence"),
  physicalVerification: z.literal("required-not-performed")
}).strict().parse(await readJson("artifacts/m6.1/non-live-verification.json"));
if (!verification.commands.some((entry) => entry.command === "npm run test:e2e:m6.1:cold")) {
  throw new Error("M61ART010_COLD_GATE_MISSING");
}

process.stdout.write(
  "Verified 9 M6.1 zero-network artifacts, 8 content hashes, 4 immutable historical trees, local-access isolation, global 20/21 exposure behavior, recorded arbitrary-brief/cache behavior, motif projection, and concept-only cutout withholding.\n",
);
