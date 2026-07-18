import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sketchyCutContentSecurityPolicy } from "../next.config.js";
import { M5_REPLAY_SCENARIOS } from "../src/interpretation/m5-replay-corpus.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (relative: string) => readFile(path.join(root, relative), "utf8");

const developmentCsp = sketchyCutContentSecurityPolicy("development");
const productionCsp = sketchyCutContentSecurityPolicy("production");
if (!developmentCsp.includes("'unsafe-eval'") || productionCsp.includes("'unsafe-eval'")) {
  throw new Error("M61PROD001_ENVIRONMENT_SCOPED_CSP_INVALID");
}

const [
  storeSource,
  workerSource,
  configSource,
  controllerSource,
  composerSource,
  routeSource,
  serviceSource,
  transportSource,
  upstashSource,
  developmentSource,
  commandSource,
  packageSource,
  nextConfigSource,
  sessionRouteSource,
  createPageSource,
  httpSecuritySource,
  contractsSource,
  runtimeTestSource
] = await Promise.all([
  source("src/server/m6/store.ts"),
  source("src/ui/components/guided-examples-controller.tsx"),
  source("src/server/m6/config.ts"),
  source("src/ui/components/generated-project-controller.tsx"),
  source("src/ui/components/generation-composer.tsx"),
  source("src/app/api/create/generate/route.ts"),
  source("src/server/m6/generation-service.ts"),
  source("src/server/m6/openai-transport.ts"),
  source("src/server/m6/upstash-store.ts"),
  source("tools/m61-development.ts"),
  source("tools/m61-exposure-command.ts"),
  source("package.json"),
  source("next.config.ts"),
  source("src/app/api/session/route.ts"),
  source("src/app/create/page.tsx"),
  source("src/server/m6/http-security.ts"),
  source("src/server/m6/contracts.ts"),
  source("tests/server/m61-runtime.test.ts")
]);

for (const token of [
  'Symbol.for("sketchycut.m6.memory-store.v1")',
  "developmentMemoryStore()"
]) {
  if (!storeSource.includes(token)) throw new Error(`M61PROD002_MEMORY_STORE_HMR_GUARD_MISSING:${token}`);
}
for (const token of [
  'new URL("../../workers/compile.worker.ts", import.meta.url)',
  'addEventListener("error"',
  'addEventListener("messageerror"',
  "WORKER_RUNTIME_ERROR",
  "WORKER_MESSAGE_ERROR"
]) {
  if (!workerSource.includes(token)) throw new Error(`M61PROD003_WORKER_FAILURE_GUARD_MISSING:${token}`);
}
for (const token of [
  "M61_CONFIG_REPLAY_FIXTURE_GUARD_MISSING",
  'generationExperience: generationMode === "live" ? "live" : "replay-fixture"'
]) {
  if (!configSource.includes(token)) throw new Error(`M61PROD004_MODE_CONTRACT_MISSING:${token}`);
}
for (const token of [
  'generationExperience: "live" | "replay-fixture"',
  "REPLAY_FIXTURE_NOT_FOUND",
  "failure-preservation fixture"
]) {
  if (!controllerSource.includes(token) && !composerSource.includes(token)) {
    throw new Error(`M61PROD005_FIXTURE_EXPERIENCE_MISSING:${token}`);
  }
}
if (!composerSource.includes('readOnly={props.generationExperience === "replay-fixture"}') ||
    !composerSource.includes("Replay scenario")) {
  throw new Error("M61PROD006_FIXTURE_BRIEF_NOT_EXACT_AND_READ_ONLY");
}
if (!routeSource.includes("new M6OpenAITransport({") ||
    !routeSource.includes("executeM61Generation({") ||
    !routeSource.includes("deriveM61RuntimeOrigin()")) {
  throw new Error("M61PROD007_PRODUCTION_TRANSPORT_OR_ORIGIN_SEAM_MISSING");
}
if (serviceSource.includes("process.env") || /RECORDED|MOCK_TRANSPORT|TRANSPORT_BYPASS/u.test(serviceSource)) {
  throw new Error("M61PROD008_ENVIRONMENT_CONTROLLED_TRANSPORT_BYPASS");
}
if (!serviceSource.includes("interpretationTransport?: SemanticInterpretationTransport") ||
    !serviceSource.includes("runtimeOrigin: input.runtimeOrigin")) {
  throw new Error("M61PROD009_INTERNAL_TRANSPORT_SEAM_INCOMPLETE");
}
for (const [candidate, token] of [
  [transportSource, "M61_TEST_LIVE_TRANSPORT_FORBIDDEN"],
  [upstashSource, "M61_TEST_UPSTASH_CLIENT_FORBIDDEN"]
] as const) {
  if (!candidate.includes(token)) throw new Error(`M61PROD010_COLD_TEST_CONSTRUCTION_GUARD_MISSING:${token}`);
}
for (const token of [
  "global-budget",
  "initial_global_ceiling",
  "KEYS[3]",
  "reservedExposureMicrousd",
  "AUTHORIZE_GLOBAL_EXPOSURE_SCRIPT",
  "expected_attempt_count",
  "authorizationVersion"
]) {
  if (!upstashSource.includes(token)) throw new Error(`M61PROD011_GLOBAL_EXPOSURE_ATOMICITY_MISSING:${token}`);
}
for (const token of [
  'SKETCHYCUT_M6_STORE: "upstash"',
  'SKETCHYCUT_GENERATION_MODE: "live"',
  "SANITIZED_FIXTURE_VARIABLES",
  'SKETCHYCUT_NEXT_DIST_DIR: ".next-fixtures"',
  'SKETCHYCUT_NEXT_DIST_DIR: ".next"',
  'process.once("SIGTERM"',
  "child.kill(signal)",
  "SKETCHYCUT_LOCAL_ACCESS_CODE",
  'environment.SKETCHYCUT_LOCAL_ACCESS_CODE = ""',
  "accessCodeDigestHex(localAccessCode)",
  "docs/evidence/m05/runtime/interpretation-prompt.txt",
  "readFileSync(promptPath",
  'for (const filename of [".env.local", ".env.vercel.local"])',
  "parseEnv(readFileSync(resolved"
]) {
  if (!developmentSource.includes(token)) throw new Error(`M61PROD012_LOCAL_RUNTIME_PREFLIGHT_MISSING:${token}`);
}
if (!developmentSource.includes('name === "VERCEL"') ||
    !developmentSource.includes('name.startsWith("VERCEL_")') ||
    !developmentSource.includes('environment[name] = ""')) {
  throw new Error("M61PROD012_LOCAL_RUNTIME_VERCEL_IDENTITY_LEAK");
}
for (const token of [
  "node_modules/@next/env/dist/index.js",
  'localAccessCode: ""',
  'vercelOidcToken: ""',
  'accessDigest: accessCodeDigestHex("working-local-code")'
]) {
  if (!runtimeTestSource.includes(token)) {
    throw new Error(`M61PROD012_NEXT_ENV_RELOAD_REGRESSION_MISSING:${token}`);
  }
}
if (!nextConfigSource.includes('distDir: process.env.SKETCHYCUT_NEXT_DIST_DIR ?? ".next"')) {
  throw new Error("M61PROD012_FIXTURE_BUILD_DIRECTORY_ISOLATION_MISSING");
}
for (const token of [
  "--increase-usd",
  "--evidence-sha256",
  "--note",
  "--apply",
  "Dry run only",
  "immutable authorization"
]) {
  if (!commandSource.includes(token)) throw new Error(`M61PROD013_AUTHORIZATION_COMMAND_MISSING:${token}`);
}
for (const token of [
  '"dev": "node --import tsx tools/m61-development.ts --mode live"',
  '"dev:fixtures": "node --import tsx tools/m61-development.ts --mode fixtures"',
  '"dev:m6:fixtures"',
  '"dev:m6:live"',
  '"authorize:m6.1-exposure"',
  '"test:e2e:m6.1:cold"'
]) {
  if (!packageSource.includes(token)) throw new Error(`M61PROD014_SCRIPT_MISSING:${token}`);
}
if (M5_REPLAY_SCENARIOS.length !== 11 ||
    M5_REPLAY_SCENARIOS.filter((scenario) => scenario.id === "invalid-output").length !== 1) {
  throw new Error("M61PROD015_FROZEN_REPLAY_CORPUS_CHANGED");
}
if (!sessionRouteSource.includes("verifyAccessCodeConstantTime") ||
    !sessionRouteSource.includes("issueSessionToken") ||
    sessionRouteSource.includes("createM6Store") ||
    sessionRouteSource.includes("recordAccessAttempt") ||
    !createPageSource.includes("verifySessionToken") ||
    createPageSource.includes("createM6Store") ||
    !httpSecuritySource.includes("store.ensureSession({") ||
    !httpSecuritySource.includes("consumeRouteRate({") ||
    !contractsSource.includes("ensureSession(record: M6SessionRecord") ||
    !upstashSource.includes("ENSURE_SESSION_SCRIPT") ||
    !upstashSource.includes("return redis.call('HGETALL', KEYS[1])")) {
  throw new Error("M61PROD016_STATELESS_ACCESS_DURABLE_ACCOUNTING_SPLIT_MISSING");
}

process.stdout.write(
  "Verified M6.1 stateless access/durable accounting split, development persistence/CSP/Worker handling, explicit live-fixture UX, production transport seam, trusted origin, atomic global exposure, reviewed authorization command, and frozen replay-corpus shape.\n",
);
