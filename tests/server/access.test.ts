import { describe, expect, it } from "vitest";

import {
  issueSessionToken,
  privacySafeClientIdentifier,
  sessionCookieName,
  sessionCookieOptions,
  verifyAccessCodeConstantTime,
  verifySessionToken
} from "../../src/server/generation/access.js";
import { accessCodeDigestHex, readRuntimeConfig } from "../../src/server/generation/config.js";
import { sameOriginRequest } from "../../src/server/generation/http-security.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import { GENERATION_POLICY } from "../../src/server/generation/policy.js";

const signingSecret = Buffer.alloc(32, 7);
const accessCode = "correct horse battery staple with extra entropy";
const security = {
  accessCodeDigest: Buffer.from(accessCodeDigestHex(accessCode), "hex"),
  signingSecret,
  secureCookies: true
};

describe("judge access primitives", () => {
  it("compares fixed-length access digests and rejects malformed candidates", () => {
    expect(verifyAccessCodeConstantTime(accessCode, security.accessCodeDigest)).toBe(true);
    expect(verifyAccessCodeConstantTime(`${accessCode}!`, security.accessCodeDigest)).toBe(false);
    expect(verifyAccessCodeConstantTime("x".repeat(1_025), security.accessCodeDigest)).toBe(false);
    expect(verifyAccessCodeConstantTime(accessCode, Buffer.alloc(31))).toBe(false);
  });

  it("issues signed short-lived tokens and rejects tampering and expiry", () => {
    const issued = issueSessionToken({ sessionId: "session-test", nowMs: 10_000, security });
    expect(verifySessionToken({ token: issued.token, nowMs: 10_001, security })).toEqual(issued.payload);
    const changed = `${issued.token.slice(0, -1)}${issued.token.endsWith("a") ? "b" : "a"}`;
    expect(verifySessionToken({ token: changed, nowMs: 10_001, security })).toBeNull();
    expect(verifySessionToken({ token: "malformed", nowMs: 10_001, security })).toBeNull();
    expect(verifySessionToken({ token: issued.token, nowMs: issued.payload.exp, security })).toBeNull();
  });

  it("uses a production __Host cookie and privacy-safe stable client identifiers", () => {
    expect(sessionCookieName(security)).toBe("__Host-sketchycut-session");
    expect(sessionCookieOptions(security)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/"
    });
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.10, 10.0.0.1",
      "user-agent": "test-browser"
    });
    const first = privacySafeClientIdentifier({ headers, signingSecret, vercel: true });
    const second = privacySafeClientIdentifier({ headers, signingSecret, vercel: true });
    const changedAgent = privacySafeClientIdentifier({
      headers: new Headers({
        "x-vercel-forwarded-for": "203.0.113.10, 10.0.0.1",
        "user-agent": "rotated-browser-agent"
      }),
      signingSecret,
      vercel: true
    });
    const changed = privacySafeClientIdentifier({
      headers: new Headers({ "x-vercel-forwarded-for": "203.0.113.11", "user-agent": "test-browser" }),
      signingSecret,
      vercel: true
    });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
    expect(changedAgent).toBe(first);
    expect(changed).not.toBe(first);
    expect(first).not.toContain("203.0.113.10");
  });

  it("accepts an origin-null same-origin form navigation but no broader origin-null request", () => {
    const url = "https://example.test/api/session";
    expect(sameOriginRequest(new Request(url, {
      method: "POST",
      headers: {
        origin: "null",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate"
      }
    }))).toBe(true);
    expect(sameOriginRequest(new Request(url, {
      method: "POST",
      headers: { origin: "null", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }
    }))).toBe(false);
    expect(sameOriginRequest(new Request(url, {
      method: "POST",
      headers: { origin: "null", "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" }
    }))).toBe(false);
  });
});

describe("judge access attempt policy", () => {
  const input = (nowMs: number, verified: boolean) => ({
    key: "access-test-client",
    verified,
    nowMs,
    ...GENERATION_POLICY.access
  });

  it("applies backoff, caps the sixth failure at the original window, and never extends lockout", async () => {
    const store = new MemoryGenerationStore();
    expect(await store.recordAccessAttempt(input(0, false))).toEqual({
      allowed: false, retryAfterMs: 500, attemptCount: 1
    });
    expect(await store.recordAccessAttempt(input(250, false))).toEqual({
      allowed: false, retryAfterMs: 250, attemptCount: 1
    });
    expect((await store.recordAccessAttempt(input(500, false))).attemptCount).toBe(2);
    expect((await store.recordAccessAttempt(input(1_500, false))).attemptCount).toBe(3);
    expect((await store.recordAccessAttempt(input(3_500, false))).attemptCount).toBe(4);
    expect((await store.recordAccessAttempt(input(7_500, false))).attemptCount).toBe(5);
    expect(await store.recordAccessAttempt(input(15_500, false))).toEqual({
      allowed: false, retryAfterMs: 14_500, attemptCount: 6
    });
    expect(await store.recordAccessAttempt(input(20_000, false))).toEqual({
      allowed: false, retryAfterMs: 10_000, attemptCount: 6
    });
    expect(await store.recordAccessAttempt(input(29_999, true))).toEqual({
      allowed: false, retryAfterMs: 1, attemptCount: 6
    });
  });

  it("allows a correct code only after recovery and clears the attempt state", async () => {
    const store = new MemoryGenerationStore();
    await store.recordAccessAttempt(input(0, false));
    expect(await store.recordAccessAttempt(input(250, true))).toEqual({
      allowed: false, retryAfterMs: 250, attemptCount: 1
    });
    expect(await store.recordAccessAttempt(input(500, true))).toEqual({
      allowed: true, retryAfterMs: 0, attemptCount: 1
    });
    expect(await store.recordAccessAttempt(input(501, true))).toEqual({
      allowed: true, retryAfterMs: 0, attemptCount: 0
    });
  });

  it("recovers at the original window boundary after a full lockout", async () => {
    const store = new MemoryGenerationStore();
    for (const nowMs of [0, 500, 1_500, 3_500, 7_500, 15_500]) {
      await store.recordAccessAttempt(input(nowMs, false));
    }
    expect(await store.recordAccessAttempt(input(30_000, true))).toEqual({
      allowed: true, retryAfterMs: 0, attemptCount: 0
    });
  });
});

describe("current environment contract", () => {
  const base = {
    NODE_ENV: "test",
    SKETCHYCUT_ACCESS_CODE_SHA256: accessCodeDigestHex(accessCode),
    SKETCHYCUT_SESSION_SIGNING_SECRET: signingSecret.toString("base64url"),
    SKETCHYCUT_STORE: "memory"
  } satisfies NodeJS.ProcessEnv;

  it("is kill-switched by default and enables generation only explicitly", () => {
    expect(readRuntimeConfig(base).generationEnabled).toBe(false);
    expect(readRuntimeConfig({
      ...base,
      SKETCHYCUT_GENERATION_ENABLED: "1",
      SKETCHYCUT_GENERATION_MODE: "fixture"
    }).generationEnabled).toBe(true);
    expect(() => readRuntimeConfig({
      ...base,
      SKETCHYCUT_GENERATION_ENABLED: "1",
      SKETCHYCUT_GENERATION_MODE: "live"
    })).toThrow("GENERATION_CONFIG_OPENAI_API_KEY_MISSING");
  });

  it("rejects weak or missing secrets and forbids memory persistence in real production", () => {
    expect(() => readRuntimeConfig({ ...base, SKETCHYCUT_SESSION_SIGNING_SECRET: "d2Vhaw" })).toThrow();
    expect(() => readRuntimeConfig({ ...base, SKETCHYCUT_ACCESS_CODE_SHA256: undefined })).toThrow();
    expect(() => readRuntimeConfig({ ...base, NODE_ENV: "production" })).toThrow(
      "GENERATION_CONFIG_MEMORY_STORE_FORBIDDEN_IN_PRODUCTION",
    );
  });

  it("accepts generic Upstash, standard Vercel KV, and project-prefixed integration aliases", () => {
    const upstashBase = {
      ...base,
      SKETCHYCUT_STORE: "upstash"
    } satisfies NodeJS.ProcessEnv;
    expect(readRuntimeConfig({
      ...upstashBase,
      UPSTASH_REDIS_REST_URL: "https://generic.invalid",
      UPSTASH_REDIS_REST_TOKEN: "generic-token"
    }).upstash).toEqual({ url: "https://generic.invalid", token: "generic-token" });
    expect(readRuntimeConfig({
      ...upstashBase,
      KV_REST_API_URL: "https://vercel-standard.invalid",
      KV_REST_API_TOKEN: "vercel-standard-token"
    }).upstash).toEqual({
      url: "https://vercel-standard.invalid",
      token: "vercel-standard-token"
    });
    expect(readRuntimeConfig({
      ...upstashBase,
      sketchycut_KV_REST_API_URL: "https://vercel-prefix.invalid",
      sketchycut_KV_REST_API_TOKEN: "vercel-token"
    }).upstash).toEqual({ url: "https://vercel-prefix.invalid", token: "vercel-token" });
  });
});
