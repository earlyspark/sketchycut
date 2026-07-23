import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import { accessCodeDigestHex, readRuntimeConfig } from "../src/server/generation/config.js";

export type DevelopmentMode = "fixtures" | "live";

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

export const GENERATION_FIXTURE_ACCESS_CODE = "sketchycut-fixture-access";

type NextDevelopmentLock = {
  pid: number;
  appUrl?: string;
};

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function readNextDevelopmentLock(
  lockPath: string,
): Promise<NextDevelopmentLock | null> {
  if (!existsSync(lockPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
  } catch {
    throw new Error(`GENERATION_DEVELOPMENT_LOCK_UNREADABLE:${lockPath}`);
  }
  if (typeof parsed !== "object" || parsed === null ||
      typeof (parsed as { pid?: unknown }).pid !== "number" ||
      !Number.isSafeInteger((parsed as { pid: number }).pid) ||
      (parsed as { pid: number }).pid <= 0) {
    throw new Error(`GENERATION_DEVELOPMENT_LOCK_INVALID:${lockPath}`);
  }
  const pid = (parsed as { pid: number }).pid;
  const appUrl = (parsed as { appUrl?: unknown }).appUrl;
  return {
    pid,
    ...(typeof appUrl === "string" && appUrl.length > 0 ? { appUrl } : {})
  };
}

export async function prepareDevelopmentCache(
  mode: DevelopmentMode,
  repositoryRoot: string,
): Promise<{ devCachePath: string; removed: boolean }> {
  const distDirectory = mode === "fixtures" ? ".next-fixtures" : ".next";
  const devCachePath = path.join(repositoryRoot, distDirectory, "dev");
  const lock = await readNextDevelopmentLock(path.join(devCachePath, "lock"));
  if (lock !== null && processIsAlive(lock.pid)) {
    throw new Error(
      `GENERATION_DEVELOPMENT_SERVER_ALREADY_RUNNING:${lock.appUrl ?? `pid-${String(lock.pid)}`}`,
    );
  }
  const removed = existsSync(devCachePath);
  await rm(devCachePath, { force: true, recursive: true });
  return { devCachePath, removed };
}

export function buildDevelopmentEnvironment(
  mode: DevelopmentMode,
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
      "../docs/runtime/semantic-interpretation-prompt.txt",
      import.meta.url,
    ));
    const prompt = readFileSync(promptPath, "utf8");
    if (prompt.length === 0) throw new Error("GENERATION_LOCAL_PROMPT_EMPTY");
    environment.SKETCHYCUT_INTERPRETATION_PROMPT = prompt;
  }
  if (mode === "fixtures") {
    for (const name of SANITIZED_FIXTURE_VARIABLES) environment[name] = "";
    Object.assign(environment, {
      SKETCHYCUT_ACCESS_CODE_SHA256: accessCodeDigestHex(GENERATION_FIXTURE_ACCESS_CODE),
      SKETCHYCUT_SESSION_SIGNING_SECRET: Buffer.alloc(32, 61).toString("base64url"),
      SKETCHYCUT_STORE: "memory",
      SKETCHYCUT_TEST_MODE: "1",
      SKETCHYCUT_GENERATION_ENABLED: "1",
      SKETCHYCUT_GENERATION_MODE: "fixture",
      SKETCHYCUT_FIXTURE_MODE: "1",
      SKETCHYCUT_NEXT_DIST_DIR: ".next-fixtures"
    });
    return environment;
  }
  Object.assign(environment, {
    SKETCHYCUT_STORE: "upstash",
    SKETCHYCUT_GENERATION_ENABLED: "1",
    SKETCHYCUT_GENERATION_MODE: "live",
    SKETCHYCUT_FIXTURE_MODE: "0",
    SKETCHYCUT_TEST_MODE: "0",
    SKETCHYCUT_NEXT_DIST_DIR: ".next"
  });
  const config = readRuntimeConfig(environment);
  if (config.storeMode !== "upstash" || config.upstash === null ||
      config.liveTransport === null || config.generationExperience !== "live") {
    throw new Error("GENERATION_LIVE_RUNTIME_PREFLIGHT_FAILED");
  }
  return environment;
}

function loadLocalEnvironment(): void {
  const resolved = path.resolve(".env.local");
  if (!existsSync(resolved)) return;
  const parsed = parseEnv(readFileSync(resolved, "utf8"));
  for (const [name, value] of Object.entries(parsed)) {
    const current = process.env[name];
    if (current === undefined || current.length === 0) {
      process.env[name] = value;
    }
  }
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const modeIndex = process.argv.indexOf("--mode");
  const modeCandidate = modeIndex < 0 ? undefined : process.argv[modeIndex + 1];
  if (modeCandidate !== "fixtures" && modeCandidate !== "live") {
    throw new Error("GENERATION_DEVELOPMENT_MODE_REQUIRED");
  }
  const forwarded = process.argv.slice(2).filter((value, index, values) =>
    value !== "--mode" && values[index - 1] !== "--mode");
  const environment = buildDevelopmentEnvironment(modeCandidate, process.env);
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const prepared = await prepareDevelopmentCache(modeCandidate, repositoryRoot);
  if (modeCandidate === "fixtures") {
    process.stdout.write(`Fixture mode: use local access code ${GENERATION_FIXTURE_ACCESS_CODE}; paid and durable clients are disabled.\n`);
  } else {
    process.stdout.write("Live preflight passed; no model request is made until an explicit Generate click.\n");
  }
  if (prepared.removed) {
    process.stdout.write(`Cleared stale generated Next development state at ${path.relative(repositoryRoot, prepared.devCachePath)}.\n`);
  }
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
        reject(new Error(`GENERATION_DEVELOPMENT_SERVER_SIGNAL_${signal}`));
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
