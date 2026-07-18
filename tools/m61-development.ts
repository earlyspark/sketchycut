import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import { accessCodeDigestHex, readM6RuntimeConfig } from "../src/server/m6/config.js";

export type M61DevelopmentMode = "fixtures" | "live";

const SANITIZED_FIXTURE_VARIABLES = [
  "OPENAI_API_KEY",
  "SKETCHYCUT_INTERPRETATION_PROMPT",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "KV_REST_API_READ_ONLY_TOKEN",
  "KV_URL",
  "REDIS_URL",
  "sketchycut_KV_REST_API_URL",
  "sketchycut_KV_REST_API_TOKEN",
  "sketchycut_KV_REST_API_READ_ONLY_TOKEN",
  "sketchycut_KV_URL",
  "sketchycut_REDIS_URL"
] as const;

export const M61_FIXTURE_ACCESS_CODE = "m6-fixture-access";

export function buildM61DevelopmentEnvironment(
  mode: M61DevelopmentMode,
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment = { ...source };
  for (const name of Object.keys(environment)) {
    if (name === "VERCEL" || name.startsWith("VERCEL_")) environment[name] = "";
  }
  const localAccessCode = environment.SKETCHYCUT_LOCAL_ACCESS_CODE;
  environment.SKETCHYCUT_LOCAL_ACCESS_CODE = "";
  if (mode === "live" && localAccessCode !== undefined && localAccessCode.length > 0) {
    environment.SKETCHYCUT_ACCESS_CODE_SHA256 = accessCodeDigestHex(localAccessCode);
  }
  if (mode === "live" && (environment.SKETCHYCUT_INTERPRETATION_PROMPT === undefined ||
      environment.SKETCHYCUT_INTERPRETATION_PROMPT.length === 0)) {
    const promptPath = fileURLToPath(new URL(
      "../docs/evidence/m05/runtime/interpretation-prompt.txt",
      import.meta.url,
    ));
    const prompt = readFileSync(promptPath, "utf8");
    if (prompt.length === 0) throw new Error("M61_FROZEN_LOCAL_PROMPT_EMPTY");
    environment.SKETCHYCUT_INTERPRETATION_PROMPT = prompt;
  }
  if (mode === "fixtures") {
    for (const name of SANITIZED_FIXTURE_VARIABLES) environment[name] = "";
    Object.assign(environment, {
      SKETCHYCUT_ACCESS_CODE_SHA256: accessCodeDigestHex(M61_FIXTURE_ACCESS_CODE),
      SKETCHYCUT_SESSION_SIGNING_SECRET: Buffer.alloc(32, 61).toString("base64url"),
      SKETCHYCUT_M6_STORE: "memory",
      SKETCHYCUT_TEST_MODE: "1",
      SKETCHYCUT_GENERATION_ENABLED: "1",
      SKETCHYCUT_GENERATION_MODE: "replay",
      SKETCHYCUT_FIXTURE_MODE: "1",
      SKETCHYCUT_NEXT_DIST_DIR: ".next-fixtures"
    });
    return environment;
  }
  Object.assign(environment, {
    SKETCHYCUT_M6_STORE: "upstash",
    SKETCHYCUT_GENERATION_ENABLED: "1",
    SKETCHYCUT_GENERATION_MODE: "live",
    SKETCHYCUT_FIXTURE_MODE: "0",
    SKETCHYCUT_TEST_MODE: "0",
    SKETCHYCUT_NEXT_DIST_DIR: ".next"
  });
  const config = readM6RuntimeConfig(environment);
  if (config.storeMode !== "upstash" || config.upstash === null ||
      config.liveTransport === null || config.generationExperience !== "live") {
    throw new Error("M61_LIVE_RUNTIME_PREFLIGHT_FAILED");
  }
  return environment;
}

function loadLocalEnvironment(): void {
  for (const filename of [".env.local", ".env.vercel.local"]) {
    const resolved = path.resolve(filename);
    if (!existsSync(resolved)) continue;
    const parsed = parseEnv(readFileSync(resolved, "utf8"));
    for (const [name, value] of Object.entries(parsed)) {
      const current = process.env[name];
      if (current === undefined || current.length === 0) {
        process.env[name] = value;
      }
    }
  }
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const modeIndex = process.argv.indexOf("--mode");
  const modeCandidate = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
  if (modeCandidate !== "fixtures" && modeCandidate !== "live") {
    throw new Error("M61_DEVELOPMENT_MODE_REQUIRED");
  }
  const forwarded = process.argv.slice(2).filter((value, index, values) =>
    value !== "--mode" && values[index - 1] !== "--mode");
  const environment = buildM61DevelopmentEnvironment(modeCandidate, process.env);
  if (modeCandidate === "fixtures") {
    process.stdout.write(`M6.1 fixture mode: use local access code ${M61_FIXTURE_ACCESS_CODE}; paid and durable clients are disabled.\n`);
  } else {
    process.stdout.write("M6.1 live preflight passed; no model request is made until an explicit Generate click.\n");
  }
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const nextBin = path.join(repositoryRoot, "node_modules/next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "dev", "--webpack", ...forwarded], {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit"
  });
  let forwardedSignal: NodeJS.Signals | null = null;
  const forwardSignal = (signal: NodeJS.Signals): void => {
    forwardedSignal = signal;
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  const handleSigint = (): void => forwardSignal("SIGINT");
  const handleSigterm = (): void => forwardSignal("SIGTERM");
  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null && signal !== forwardedSignal) {
        reject(new Error(`M61_DEVELOPMENT_SERVER_SIGNAL_${signal}`));
      }
      else resolve(code ?? (signal === forwardedSignal ? 0 : 1));
    });
  });
  process.off("SIGINT", handleSigint);
  process.off("SIGTERM", handleSigterm);
  process.exitCode = exitCode;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
