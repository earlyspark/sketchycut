import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { sketchyCutContentSecurityPolicy } from "../next.config.js";
import { GENERATION_POLICY } from "../src/server/generation/policy.js";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const source = (relative: string) => readFile(path.join(root, relative), "utf8");

async function filesUnder(directory: string, relative = ""): Promise<string[]> {
  const excludedRoots = new Set([
    ".git", ".next", ".next-fixtures", ".vercel", "artifacts", "coverage", "dist",
    "docs", "node_modules", "reports", "test-results"
  ]);
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const candidateRelative = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
    if (relative.length === 0 && excludedRoots.has(entry.name)) return [];
    if (/^\.env(?:\.|$)/u.test(candidateRelative)) return [];
    if (entry.isDirectory()) return filesUnder(path.join(directory, entry.name), candidateRelative);
    return entry.isFile() || entry.isSymbolicLink() ? [candidateRelative] : [];
  }))).flat().sort();
}

async function currentPaths(): Promise<string[]> {
  try {
    await access(path.join(root, ".git"), constants.F_OK);
    const { stdout } = await execute(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "buffer" },
    );
    return stdout.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return filesUnder(root);
  }
}

function invariant(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

const packageDocument = JSON.parse(await source("package.json")) as {
  scripts: Record<string, string>;
};
const expectedScripts = [
  "authorize:generation-exposure",
  "build",
  "build:app",
  "build:core",
  "clean",
  "dev",
  "dev:fixtures",
  "evaluate:live",
  "generate:golden",
  "lint",
  "probe:live",
  "start",
  "test",
  "test:e2e",
  "test:e2e:deployment",
  "test:golden",
  "test:unit",
  "typecheck",
  "verify",
  "verify:architecture",
  "verify:physical-observation",
  "verify:upstash"
].sort();
invariant(
  JSON.stringify(Object.keys(packageDocument.scripts).sort()) === JSON.stringify(expectedScripts),
  "CURRENT001_PACKAGE_SCRIPT_SURFACE_DRIFT",
);
const verifyScript = packageDocument.scripts.verify;
invariant(verifyScript !== undefined, "CURRENT002_VERIFY_SCRIPT_MISSING");
for (const forbidden of ["docs/", "artifacts/", "m5", "m6", "m61", "milestone"]) {
  invariant(!verifyScript.toLowerCase().includes(forbidden), `CURRENT002_VERIFY_DEPENDENCY:${forbidden}`);
}

const obsoletePaths = [
  "src/evidence/index.ts",
  "src/evidence/studio-import-verification.ts",
  "src/interpretation/replay.ts",
  "src/ui/content/generated-projects.ts",
  "src/ui/components/build-progression.tsx",
  "src/app/root-teaser.ts",
  "public/m5/root-teaser-manifest.json",
  "public/m5/root-teaser.svg",
  "playwright.m5.config.ts",
  "playwright.m6.config.ts",
  "playwright.m61.cold.config.ts",
  "playwright.m6.deployment.config.ts",
  "tests/m5-e2e/create.spec.ts",
  "tests/fixtures/replay/offline-coupon.json",
  "tests/interpretation/ledger-store.test.ts",
  "tests/interpretation/live-openai-adapter.test.ts",
  "src/interpretation/intent-graph.ts",
  "src/interpretation/mapper.ts",
  "src/interpretation/orchestrator.ts",
  "src/interpretation/semantic-cache.ts",
  "src/interpretation/semantic-request.ts",
  "src/server/generation/api-contracts.ts",
  "src/server/generation/generation-service.ts",
  "src/server/generation/project-persistence.ts",
  "src/server/generation/openai-transport.ts",
  "src/server/generation/quota-transport.ts"
];
for (const relative of obsoletePaths) {
  await access(path.join(root, relative), constants.F_OK).then(
    () => { throw new Error(`CURRENT003_OBSOLETE_PATH_PRESENT:${relative}`); },
    () => undefined,
  );
}

const [
  sessionRoute,
  policySource,
  transportSource,
  costEnvelopeSource,
  semanticSource,
  semanticInputSource,
  intentGraphSource,
  outcomeSource,
  requirementRealizationSource,
  observationRealizationSource,
  mvpSafeOmissionSource,
  liveEvaluationSource,
  referenceStudySource,
  referencePredicatesSource,
  liveReferenceEvaluationSource,
  generationServiceSource,
  liveEvaluationToolSource,
  imageNormalizationSource,
  imageDecoderSource,
  controllerSource,
  composerSource,
  developmentSource,
  developmentRuntimeTest,
  nextConfigSource,
  gitignore,
  vercelignore,
  hstsMatrixSource
] = await Promise.all([
  source("src/server/generation/session-route.ts"),
  source("src/server/generation/policy.ts"),
  source("src/server/generation/openai-transport-v2.ts"),
  source("src/server/generation/cost-envelope.ts"),
  source("src/interpretation/semantic-request-v2.ts"),
  source("src/interpretation/semantic-input-contracts.ts"),
  source("src/interpretation/intent-graph-v2.ts"),
  source("src/interpretation/generation-outcome-v2.ts"),
  source("src/interpretation/realization-ledger.ts"),
  source("src/interpretation/observation-realization.ts"),
  source("src/interpretation/mvp-safe-omission-policy.ts"),
  source("src/evaluation/live-evaluation-runner.ts"),
  source("src/evaluation/reference-fidelity-study.ts"),
  source("src/evaluation/reference-fidelity-predicates.ts"),
  source("src/evaluation/live-reference-fidelity-evaluation.ts"),
  source("src/server/generation/generation-service-v2.ts"),
  source("tools/run-live-diversity-evaluation.ts"),
  source("src/interpretation/image-normalization.ts"),
  source("src/server/generation/image-decoder.ts"),
  source("src/ui/components/generated-project-controller.tsx"),
  source("src/ui/components/generation-composer.tsx"),
  source("tools/development.ts"),
  source("tests/server/development-runtime.test.ts"),
  source("next.config.ts"),
  source(".gitignore"),
  source(".vercelignore"),
  source("tests/fixtures/security/hsts-platform-matrix.json")
]);

for (const token of [
  "verifyAccessCodeConstantTime",
  "privacySafeClientIdentifier",
  "recordAccessAttempt",
  "generationKeys.accessAttempt",
  "GENERATION_POLICY.access"
]) invariant(sessionRoute.includes(token), `SECURITY001_ACCESS_THROTTLE_MISSING:${token}`);
invariant(!/console\.(?:log|warn|error)/.test(sessionRoute), "SECURITY002_SESSION_DISTINGUISHING_LOG_PRESENT");
const accessPolicy: {
  windowMs: number;
  maximumAttempts: number;
  baseBackoffMs: number;
  maximumBackoffMs: number;
} = GENERATION_POLICY.access;
invariant(accessPolicy.windowMs === 30_000, "SECURITY003_ACCESS_WINDOW_DRIFT");
invariant(accessPolicy.maximumAttempts === 6, "SECURITY004_ACCESS_ATTEMPT_DRIFT");
invariant(accessPolicy.baseBackoffMs === 500, "SECURITY005_ACCESS_BACKOFF_DRIFT");
invariant(accessPolicy.maximumBackoffMs === 8_000, "SECURITY006_ACCESS_MAX_BACKOFF_DRIFT");
invariant(policySource.includes('namespace: "sketchycut:current:v1"'), "CURRENT004_NAMESPACE_NOT_CURRENT");

invariant((transportSource.match(/\.responses\.create\(/g) ?? []).length === 1, "MODEL001_DISPATCH_SITE_COUNT");
for (const token of ["maxRetries: GENERATION_OPENAI_MAX_RETRIES", "store: false", "strict: true"]) {
  invariant(transportSource.includes(token), `MODEL002_TRANSPORT_POLICY_DRIFT:${token}`);
}
invariant(costEnvelopeSource.includes("GENERATION_OPENAI_MAX_RETRIES = 0"), "MODEL002_TRANSPORT_POLICY_DRIFT:GENERATION_OPENAI_MAX_RETRIES");
invariant(semanticSource.includes('CURRENT_PROMPT_IDENTITY = "semantic-interpretation-current"'), "CURRENT005_PROMPT_IDENTITY_MISSING");
invariant(semanticSource.includes("promptHash: Sha256Schema"), "CURRENT006_PROMPT_READER_NOT_STRICT");
invariant(semanticSource.includes('CURRENT_INTENT_SCHEMA_ID = "intent-graph-v2@2.2.1"'), "REFERENCE001_INTENT_SCHEMA_NOT_CURRENT");
invariant(semanticInputSource.includes('CURRENT_IMAGE_DETAIL_POLICY = "high"'), "REFERENCE002_BLANKET_LOW_DETAIL_PRESENT");
for (const token of ["intentGraphV2ProviderSchema", "authorizedEvidenceId", "#/$defs/referenceEvidenceId"]) {
  invariant(intentGraphSource.includes(token), `REFERENCE001_PROVIDER_EVIDENCE_BINDING_MISSING:${token}`);
}
for (const token of ["intentGraphV2ProviderSchema(input.request.sourceEvidenceIndex)", "schema: providerSchema"]) {
  invariant(transportSource.includes(token), `REFERENCE001_PROVIDER_SCHEMA_NOT_DISPATCHED:${token}`);
}
for (const token of ["reconcileDeterministicReferenceConflicts", "EXCLUSIVE_ACCESS_OBSERVATION_VALUES"]) {
  invariant(intentGraphSource.includes(token), `REFERENCE002_CONFLICT_RECONCILIATION_MISSING:${token}`);
}
for (const token of ["requirement-realization-v2", "REQUIREMENT_UNSUPPORTED", "isMvpOmittableRequirement"]) {
  invariant(requirementRealizationSource.includes(token), `REFERENCE003_REQUIREMENT_REALIZATION_MISSING:${token}`);
}
for (const token of ["observation-realization-v2", "REFERENCE_OBSERVATION_UNSUPPORTED", "isMvpOmittableObservation"]) {
  invariant(observationRealizationSource.includes(token), `REFERENCE004_OBSERVATION_REALIZATION_MISSING:${token}`);
}
for (const token of ["mvp-safe-omission-v1", "visual-treatment", "cut-through-visible", "repeated-apertures"]) {
  invariant(mvpSafeOmissionSource.includes(token), `REFERENCE004_MVP_SAFE_OMISSION_MISSING:${token}`);
}
for (const token of ["MANDATORY_REQUIREMENT_REALIZATION_MISSING", "MANDATORY_REFERENCE_OBSERVATION_UNSUPPORTED"]) {
  invariant(outcomeSource.includes(token), `REFERENCE004_OUTCOME_GATE_MISSING:${token}`);
}
for (const token of [
  "requirementRealizationPolicyVersion",
  "observationRealizationPolicyVersion",
  "mvpSafeOmissionPolicyVersion"
]) invariant(outcomeSource.includes(token), `REFERENCE004_REALIZATION_POLICY_IDENTITY_MISSING:${token}`);
for (const token of [
  "LIVE_EVALUATION_EXACTLY_FIVE_UNIQUE_CASES_REQUIRED",
  "DispatchOnlySemanticCacheV2",
  'initiatedBy: "live-eval"',
  "evaluationModelConfiguration",
  "captureAppendedLedgerAttempts"
]) invariant(liveEvaluationSource.includes(token), `REFERENCE008_LIVE_RUNNER_GUARD_MISSING:${token}`);
invariant(!liveEvaluationSource.includes(".readLedgerAttempts()"),
  "REFERENCE008_HISTORICAL_LEDGER_ENUMERATION_PRESENT");
for (const token of [
  "low-medium-request-local-control",
  "low-medium-stable-prefix",
  "high-medium-stable-prefix",
  "high-high-stable-prefix",
  "mixed-medium-stable-prefix"
]) invariant(referenceStudySource.includes(token), `REFERENCE009_STUDY_CONFIGURATION_MISSING:${token}`);
for (const token of [
  'REFERENCE_FIDELITY_STUDY_VERSION = "reference-fidelity-study-v2"',
  'relationshipAcceptance: z.array(z.enum(["exact", "non-context"]))',
  'outcomeAcceptance: z.enum(["exact", "supported-or-disclosed-simplified"])'
]) invariant(referenceStudySource.includes(token), `REFERENCE009_ACCEPTANCE_CONTRACT_MISSING:${token}`);
for (const token of [
  "NO_SILENT_PLAIN_SHELL",
  "NO_BACKGROUND_PROP_REQUIREMENT",
  "MULTI_REFERENCE_CONFLICT_NOT_SILENT",
  "PRISMATIC_AND_MOTIF_REALIZED",
  "truthfullyDisclosedSimplification"
]) invariant(referencePredicatesSource.includes(token), `REFERENCE010_EXECUTABLE_PREDICATE_MISSING:${token}`);
for (const token of [
  "PrivacySafeOutcomeSummarySchema",
  "exactDispatchCount",
  "strictParseRate",
  "outcomeAcceptanceRate",
  "relationshipAcceptanceRate",
  "predicateRate"
]) invariant(liveReferenceEvaluationSource.includes(token), `REFERENCE011_PRIVACY_SAFE_SCORER_MISSING:${token}`);
for (const token of [
  "GENERATION_EVALUATION_CONFIGURATION_FORBIDDEN",
  "GENERATION_EVALUATION_CONFIGURATION_OUTSIDE_FROZEN_ENVELOPE"
]) invariant(generationServiceSource.includes(token), `REFERENCE012_EVAL_CONFIGURATION_BOUNDARY_MISSING:${token}`);
for (const token of [
  "CALIBRATION_READ_ONLY_UPSTASH_TOKEN_MISSING",
  "CALIBRATION_READ_ONLY_EXPOSURE_STATE_MISSING",
  "sketchycut-full-component-manifest@1.2.0",
  'credentialClass: "read-only"',
  "inputHashes",
  "REFERENCE_FIDELITY_AUTHORIZED_COMPONENT_MISMATCH",
  'SKETCHYCUT_QUOTA_UNLIMITED: "0"',
  "REFERENCE_FIDELITY_QUOTA_BYPASS_FORBIDDEN"
]) invariant(liveEvaluationToolSource.includes(token), `REFERENCE013_CALIBRATION_GUARD_MISSING:${token}`);
invariant(liveEvaluationSource.includes("input.config.quotaUnlimited"),
  "REFERENCE008_QUOTA_BYPASS_GUARD_MISSING");
invariant(!liveEvaluationToolSource.includes("initialGlobalExposureCeilingMicrousd"),
  "REFERENCE013_READ_ONLY_PREFLIGHT_DEFAULTS_EXPOSURE");
for (const token of [".next/server", "serverBuildIdentity", "filesUnder(serverRoot)"]) {
  invariant(!liveEvaluationToolSource.includes(token), `REFERENCE013_NONDETERMINISTIC_BUILD_IDENTITY:${token}`);
}
for (const token of ['path.join(repositoryRoot, "src")', "sourceTreePaths", "new Set"]) {
  invariant(liveEvaluationToolSource.includes(token), `REFERENCE013_FULL_SOURCE_IDENTITY_MISSING:${token}`);
}
for (const token of ["MAX_NORMALIZED_IMAGE_EDGE = 2_048", "normalizationDisposition: \"preserved\"", "REFERENCE_NORMALIZATION_POLICY_VERSION"]) {
  invariant(imageNormalizationSource.includes(token), `REFERENCE005_CLIENT_FIDELITY_POLICY_DRIFT:${token}`);
}
for (const token of ["canPreserve", "normalizationDisposition: \"preserved\"", "[94, 92, 90, 88]"]) {
  invariant(imageDecoderSource.includes(token), `REFERENCE006_SERVER_FIDELITY_POLICY_DRIFT:${token}`);
}
for (const token of ["Observed", "Realized", "Simplified", "Unsupported", "Conflict resolved", "Uncertain"]) {
  invariant(controllerSource.includes(token), `REFERENCE007_REALIZATION_UI_MISSING:${token}`);
}
for (const token of ["usesM5Sidecar", "/__sketchycut/generate", "blobDataUrl", "compileGeneratedProjectFromSemantic"]) {
  invariant(!controllerSource.includes(token), `CURRENT007_CLIENT_COMPATIBILITY_PRESENT:${token}`);
}
for (const absent of ["Generation inputs", "Maker brief", "normalized in memory", "One interpretation request at most"]) {
  invariant(!composerSource.includes(absent), `UX001_OBSOLETE_CREATE_COPY:${absent}`);
}
invariant(composerSource.includes("Images are sent to OpenAI for interpretation and are not stored by SketchyCut."), "PRIVACY001_LIVE_COPY_DRIFT");

for (const token of ["SANITIZED_FIXTURE_VARIABLES", 'SKETCHYCUT_GENERATION_MODE: "fixture"', 'SKETCHYCUT_STORE: "memory"']) {
  invariant(developmentSource.includes(token), `RUNTIME001_FIXTURE_SANITIZATION_MISSING:${token}`);
}
invariant(!developmentSource.includes(".env.vercel.local"), "RUNTIME003_VERCEL_ENV_SNAPSHOT_COMPATIBILITY_PRESENT");
invariant(
  developmentRuntimeTest.includes("SKETCHYCUT_INTERPRETATION_PROMPT: testInterpretationPrompt"),
  "RUNTIME002_LIVE_TEST_DEPENDS_ON_PRIVATE_PROMPT",
);
invariant(sketchyCutContentSecurityPolicy("development").includes("'unsafe-eval'"), "SECURITY007_DEV_CSP_EVAL_MISSING");
invariant(!sketchyCutContentSecurityPolicy("production").includes("'unsafe-eval'"), "SECURITY008_PROD_CSP_EVAL_PRESENT");
for (const token of ["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) {
  invariant(nextConfigSource.includes(token), `SECURITY009_HEADER_MISSING:${token}`);
}

const hstsMatrix = JSON.parse(hstsMatrixSource) as {
  canonicalProductionHost: string;
  observations: { environment: string; strictTransportSecurity: string | null }[];
  decision: string;
};
invariant(hstsMatrix.canonicalProductionHost === "sketchycut.earlyspark.com", "SECURITY010_CANONICAL_HOST_DRIFT");
const productionHsts = hstsMatrix.observations.find((item) => item.environment === "production")?.strictTransportSecurity;
const previewHsts = hstsMatrix.observations.find((item) => item.environment === "preview")?.strictTransportSecurity;
invariant(/^max-age=(?:31536000|[4-9]\d{7,})/.test(productionHsts ?? ""), "SECURITY011_PRODUCTION_HSTS_UNPROVEN");
invariant(/^max-age=\d+/.test(previewHsts ?? ""), "SECURITY012_PREVIEW_HSTS_UNPROVEN");
invariant(hstsMatrix.decision.includes("no duplicate"), "SECURITY013_HSTS_DECISION_MISSING");
invariant(!nextConfigSource.includes("Strict-Transport-Security"), "SECURITY014_DUPLICATE_APPLICATION_HSTS");

for (const ignoreSource of [gitignore, vercelignore]) {
  for (const token of ["docs/", ".env", ".claude/", ".vercel/", ".next-fixtures/"]) {
    invariant(ignoreSource.includes(token), `PRIVACY002_IGNORE_RULE_MISSING:${token}`);
  }
}

for (const filename of [".env.local"]) {
  try {
    const mode = (await stat(path.join(root, filename))).mode & 0o777;
    invariant(mode === 0o600, `PRIVACY003_ENV_MODE:${filename}:${mode.toString(8)}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const tracked = await currentPaths();
const currentCodePaths = tracked.filter((candidate) =>
  /^(?:src|tests|tools)\//.test(candidate) ||
  /^(?:package\.json|next\.config\.ts|playwright[^/]*\.ts)$/.test(candidate)
);
const obsoleteCodeTokens = [
  "M5_PROMPT_VERSION",
  "M6_PROMPT_VERSION",
  "m5-interpretation-prompt@",
  "historicalM5ProjectionBundle",
  "usesM5Sidecar",
  "legacyUnattributed",
  "SKETCHYCUT_M6_",
  "M61_",
  "M2Fixture",
  "M2_FIXTURE_NAMES",
  "loadM2Fixture",
  "compileM2Fixture",
  "src/server/m6/",
  "/__sketchycut/generate"
];
for (const relative of currentCodePaths) {
  if (relative === "tools/verify-current-source.ts") continue;
  let contents: string;
  try {
    contents = await source(relative);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
    throw error;
  }
  for (const token of obsoleteCodeTokens) {
    invariant(!contents.includes(token), `CURRENT008_OBSOLETE_CODE_TOKEN:${token}:${relative}`);
  }
}
const safeTextExtensions = /(?:^|\/)(?:[^/]+\.(?:ts|tsx|js|mjs|json|md|txt|yml|yaml|css|html|svg)|package-lock\.json)$/;
const credentialPatterns = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\/Users\/[A-Za-z0-9._-]+\//,
  /\/(?:private\/)?var\/folders\//
];
for (const relative of tracked.filter((candidate) =>
  safeTextExtensions.test(candidate) && candidate !== "tools/verify-current-source.ts"
)) {
  let contents: string;
  try {
    contents = await source(relative);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
    throw error;
  }
  for (const [index, pattern] of credentialPatterns.entries()) {
    const matchingLine = contents.split("\n").find((line) =>
      pattern.test(line) && !(index >= 3 && /not\.to(?:Contain|Match)/.test(line))
    );
    invariant(matchingLine === undefined, `PRIVACY004_TRACKED_CREDENTIAL_PATTERN:${String(index)}:${relative}`);
  }
}
const landingPayload = await source("src/landing/basic-demo-payload.json");
for (const token of ["data:image", "base64", "normalizedBrief", "filename", "/Users/", "/var/folders/"]) {
  invariant(!landingPayload.includes(token), `PRIVACY005_LANDING_PAYLOAD_PRIVATE_FIELD:${token}`);
}

process.stdout.write(`Verified current-only scripts/source, one-dispatch transport, access policy, security headers/HSTS decision, fixture isolation, environment modes, and ${String(tracked.length)} current paths.\n`);
