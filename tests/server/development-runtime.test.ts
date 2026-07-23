import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { accessCodeDigestHex, readRuntimeConfig } from "../../src/server/generation/config.js";
import { verifyAccessCodeConstantTime } from "../../src/server/generation/access.js";
import { deriveRuntimeOrigin } from "../../src/server/generation/runtime-origin.js";
import {
  buildDevelopmentEnvironment,
  GENERATION_FIXTURE_ACCESS_CODE,
  prepareDevelopmentCache
} from "../../tools/development.js";
import { sketchyCutContentSecurityPolicy } from "../../next.config.js";

const signingSecret = Buffer.alloc(32, 29).toString("base64url");
const testInterpretationPrompt = "Return one strict semantic-intent object for this synthetic test.";

afterEach(() => {
  vi.unstubAllEnvs();
  (globalThis as typeof globalThis & Record<symbol, unknown>)[
    Symbol.for("sketchycut.current.memory-store.v1")
  ] = undefined;
});

describe("runtime modes", () => {
  it("requires an explicit fixture guard outside tests", () => {
    const base = {
      NODE_ENV: "development",
      SKETCHYCUT_ACCESS_CODE_SHA256: accessCodeDigestHex("fixture"),
      SKETCHYCUT_SESSION_SIGNING_SECRET: signingSecret,
      SKETCHYCUT_STORE: "memory",
      SKETCHYCUT_GENERATION_MODE: "fixture"
    } satisfies NodeJS.ProcessEnv;
    expect(() => readRuntimeConfig(base)).toThrow("GENERATION_CONFIG_FIXTURE_GUARD_MISSING");
    expect(readRuntimeConfig({ ...base, SKETCHYCUT_FIXTURE_MODE: "1" }))
      .toMatchObject({ generationExperience: "fixture" });
  });

  it("admits unlimited quotas only outside production", () => {
    const base = {
      NODE_ENV: "development",
      SKETCHYCUT_ACCESS_CODE_SHA256: accessCodeDigestHex("fixture"),
      SKETCHYCUT_SESSION_SIGNING_SECRET: signingSecret,
      SKETCHYCUT_STORE: "memory",
      SKETCHYCUT_GENERATION_MODE: "fixture",
      SKETCHYCUT_FIXTURE_MODE: "1",
      SKETCHYCUT_QUOTA_UNLIMITED: "1"
    } satisfies NodeJS.ProcessEnv;
    expect(readRuntimeConfig(base)).toMatchObject({ quotaUnlimited: true });
    expect(readRuntimeConfig({ ...base, SKETCHYCUT_QUOTA_UNLIMITED: "0" }))
      .toMatchObject({ quotaUnlimited: false });
    // Upstash store in production so the memory-store guard cannot fire first.
    const production = {
      ...base,
      NODE_ENV: "production",
      SKETCHYCUT_STORE: "upstash",
      UPSTASH_REDIS_REST_URL: "https://recorded-upstash.invalid",
      UPSTASH_REDIS_REST_TOKEN: "recorded-upstash-token"
    } satisfies NodeJS.ProcessEnv;
    expect(() => readRuntimeConfig(production))
      .toThrow("GENERATION_CONFIG_QUOTA_UNLIMITED_FORBIDDEN_IN_PRODUCTION");
    expect(readRuntimeConfig({ ...production, SKETCHYCUT_TEST_MODE: "1" }))
      .toMatchObject({ quotaUnlimited: true });
  });

  it("sanitizes fixture development", () => {
    const fixtures = buildDevelopmentEnvironment("fixtures", {
      NODE_ENV: "development",
      OPENAI_API_KEY: "must-not-survive",
      SKETCHYCUT_LOCAL_ACCESS_CODE: "must-not-survive",
      UPSTASH_REDIS_REST_URL: "https://must-not-survive.invalid",
      SKETCHYCUT_INTERPRETATION_PROMPT: "must-not-survive"
    });
    expect(fixtures).toMatchObject({
      OPENAI_API_KEY: "",
      UPSTASH_REDIS_REST_URL: "",
      SKETCHYCUT_INTERPRETATION_PROMPT: "",
      SKETCHYCUT_LOCAL_ACCESS_CODE: "",
      SKETCHYCUT_STORE: "memory",
      SKETCHYCUT_TEST_MODE: "1",
      SKETCHYCUT_FIXTURE_MODE: "1",
      SKETCHYCUT_NEXT_DIST_DIR: ".next-fixtures",
      SKETCHYCUT_ACCESS_CODE_SHA256: accessCodeDigestHex(GENERATION_FIXTURE_ACCESS_CODE)
    });
  });

  it("admits live development only with durable accounting and every required secret", () => {
    const localAccessCode = "known-local-development-code";
    const live = buildDevelopmentEnvironment("live", {
      NODE_ENV: "development",
      SKETCHYCUT_STORE: "memory",
      SKETCHYCUT_ACCESS_CODE_SHA256: accessCodeDigestHex("stale-pulled-code"),
      SKETCHYCUT_LOCAL_ACCESS_CODE: localAccessCode,
      SKETCHYCUT_SESSION_SIGNING_SECRET: signingSecret,
      UPSTASH_REDIS_REST_URL: "https://recorded-upstash.invalid",
      UPSTASH_REDIS_REST_TOKEN: "recorded-upstash-token",
      OPENAI_API_KEY: "recorded-openai-key",
      SKETCHYCUT_INTERPRETATION_PROMPT: testInterpretationPrompt,
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_OIDC_TOKEN: "must-not-survive-local-launch"
    });
    expect(live).toMatchObject({
      SKETCHYCUT_STORE: "upstash",
      SKETCHYCUT_GENERATION_ENABLED: "1",
      SKETCHYCUT_GENERATION_MODE: "live",
      SKETCHYCUT_FIXTURE_MODE: "0",
      SKETCHYCUT_TEST_MODE: "0",
      SKETCHYCUT_NEXT_DIST_DIR: ".next"
    });
    expect(live.VERCEL).toBe("");
    expect(live.VERCEL_ENV).toBe("");
    expect(live.VERCEL_OIDC_TOKEN).toBe("");
    expect(live.SKETCHYCUT_LOCAL_ACCESS_CODE).toBe("");
    const parsedLive = readRuntimeConfig(live);
    expect(parsedLive).toMatchObject({
      storeMode: "upstash",
      generationExperience: "live",
      security: { secureCookies: false }
    });
    expect(parsedLive.liveTransport?.interpretationPrompt).toMatch(/\S/u);
    expect(verifyAccessCodeConstantTime(
      localAccessCode,
      parsedLive.security.accessCodeDigest,
    )).toBe(true);
    expect(verifyAccessCodeConstantTime(
      "stale-pulled-code",
      parsedLive.security.accessCodeDigest,
    )).toBe(false);
    expect(() => buildDevelopmentEnvironment("live", {
      NODE_ENV: "development",
      SKETCHYCUT_ACCESS_CODE_SHA256: accessCodeDigestHex("local-live"),
      SKETCHYCUT_SESSION_SIGNING_SECRET: signingSecret,
      SKETCHYCUT_INTERPRETATION_PROMPT: testInterpretationPrompt
    })).toThrow("GENERATION_CONFIG_UPSTASH_REDIS_REST_URL_MISSING");
  });

  it("keeps launcher-only plaintext and deployment metadata shadowed after Next loads env files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "sketchycut-next-env-"));
    try {
      await writeFile(path.join(directory, ".env.local"), [
        "SKETCHYCUT_LOCAL_ACCESS_CODE=must-not-reenter-next",
        "VERCEL=1",
        "VERCEL_ENV=preview",
        "VERCEL_OIDC_TOKEN=must-not-reenter-next"
      ].join("\n"), "utf8");
      const live = buildDevelopmentEnvironment("live", {
        NODE_ENV: "development",
        SKETCHYCUT_LOCAL_ACCESS_CODE: "working-local-code",
        SKETCHYCUT_SESSION_SIGNING_SECRET: signingSecret,
        UPSTASH_REDIS_REST_URL: "https://recorded-upstash.invalid",
        UPSTASH_REDIS_REST_TOKEN: "recorded-upstash-token",
        OPENAI_API_KEY: "recorded-openai-key",
        SKETCHYCUT_INTERPRETATION_PROMPT: testInterpretationPrompt,
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_OIDC_TOKEN: "must-not-reenter-next"
      });
      const nextEnvPath = path.resolve("node_modules/@next/env/dist/index.js");
      const script = [
        `const { loadEnvConfig } = require(${JSON.stringify(nextEnvPath)});`,
        "loadEnvConfig(process.cwd(), true, { info() {}, error() {} }, true);",
        "process.stdout.write(JSON.stringify({",
        "  localAccessCode: process.env.SKETCHYCUT_LOCAL_ACCESS_CODE,",
        "  vercel: process.env.VERCEL,",
        "  vercelEnv: process.env.VERCEL_ENV,",
        "  vercelOidcToken: process.env.VERCEL_OIDC_TOKEN,",
        "  accessDigest: process.env.SKETCHYCUT_ACCESS_CODE_SHA256",
        "}));"
      ].join("\n");
      const observed = JSON.parse(execFileSync(process.execPath, ["-e", script], {
        cwd: directory,
        env: live,
        encoding: "utf8"
      })) as Record<string, string>;
      expect(observed).toEqual({
        localAccessCode: "",
        vercel: "",
        vercelEnv: "",
        vercelOidcToken: "",
        accessDigest: accessCodeDigestHex("working-local-code")
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("clears stale generated dev state but preserves a cache owned by an active server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "sketchycut-development-cache-"));
    try {
      const liveDev = path.join(directory, ".next", "dev");
      await mkdir(liveDev, { recursive: true });
      await writeFile(path.join(liveDev, "lock"), JSON.stringify({
        pid: 2_147_483_647,
        appUrl: "http://localhost:3000"
      }), "utf8");
      await writeFile(path.join(liveDev, "stale-module-graph"), "stale", "utf8");
      await expect(prepareDevelopmentCache("live", directory)).resolves.toEqual({
        devCachePath: liveDev,
        removed: true
      });
      await expect(readFile(path.join(liveDev, "stale-module-graph"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });

      const fixtureDev = path.join(directory, ".next-fixtures", "dev");
      await mkdir(fixtureDev, { recursive: true });
      await writeFile(path.join(fixtureDev, "lock"), JSON.stringify({
        pid: process.pid,
        appUrl: "http://localhost:3108"
      }), "utf8");
      await writeFile(path.join(fixtureDev, "active-module-graph"), "active", "utf8");
      await expect(prepareDevelopmentCache("fixtures", directory))
        .rejects.toThrow(
          "GENERATION_DEVELOPMENT_SERVER_ALREADY_RUNNING:http://localhost:3108",
        );
      await expect(readFile(path.join(fixtureDev, "active-module-graph"), "utf8"))
        .resolves.toBe("active");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("derives origin only from trusted runtime metadata", () => {
    expect(deriveRuntimeOrigin({ NODE_ENV: "development" })).toBe("local-development");
    expect(deriveRuntimeOrigin({ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview" }))
      .toBe("deployment-preview");
    expect(deriveRuntimeOrigin({ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" }))
      .toBe("deployment-production");
    expect(deriveRuntimeOrigin({ NODE_ENV: "test", SKETCHYCUT_TEST_MODE: "1", VERCEL: "1" }))
      .toBe("test-recorded");
  });

  it("admits eval only in development CSP and keeps production strict", () => {
    expect(sketchyCutContentSecurityPolicy("development")).toContain("'unsafe-eval'");
    expect(sketchyCutContentSecurityPolicy("production")).not.toContain("'unsafe-eval'");
  });

  it("retains the development memory store across module reset and re-import", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const config = readRuntimeConfig({
      NODE_ENV: "development",
      SKETCHYCUT_ACCESS_CODE_SHA256: accessCodeDigestHex("cold-development"),
      SKETCHYCUT_SESSION_SIGNING_SECRET: signingSecret,
      SKETCHYCUT_STORE: "memory",
      SKETCHYCUT_GENERATION_MODE: "fixture",
      SKETCHYCUT_FIXTURE_MODE: "1"
    });
    const first = await import("../../src/server/generation/store.js");
    const sessionId = `cold-runtime-${crypto.randomUUID()}`;
    await first.createGenerationStore(config).createSession({
      schemaVersion: "1.0",
      sessionId,
      issuedAtMs: 1,
      expiresAtMs: Date.now() + 60_000,
      generationDispatches: 0,
      reservedExposureMicrousd: 0,
      lastDispatchAtMs: null,
      lastProjectId: null
    }, 60);
    vi.resetModules();
    const second = await import("../../src/server/generation/store.js");
    expect((await second.createGenerationStore(config).readSession(sessionId))?.sessionId).toBe(sessionId);
  });
});
