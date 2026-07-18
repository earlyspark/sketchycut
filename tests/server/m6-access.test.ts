import { describe, expect, it } from "vitest";

import {
  issueSessionToken,
  privacySafeClientIdentifier,
  sessionCookieName,
  sessionCookieOptions,
  verifyAccessCodeConstantTime,
  verifySessionToken
} from "../../src/server/m6/access.js";
import { accessCodeDigestHex, readM6RuntimeConfig } from "../../src/server/m6/config.js";
import { sameOriginRequest } from "../../src/server/m6/http-security.js";

const signingSecret = Buffer.alloc(32, 7);
const accessCode = "correct horse battery staple with extra entropy";
const security = {
  accessCodeDigest: Buffer.from(accessCodeDigestHex(accessCode), "hex"),
  signingSecret,
  secureCookies: true
};

describe("M6 evaluation access primitives", () => {
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
    expect(sessionCookieName(security)).toBe("__Host-sketchycut-evaluation");
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
    const changed = privacySafeClientIdentifier({
      headers: new Headers({ "x-vercel-forwarded-for": "203.0.113.11", "user-agent": "test-browser" }),
      signingSecret,
      vercel: true
    });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
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

describe("M6 environment contract", () => {
  const base = {
    NODE_ENV: "test",
    SKETCHYCUT_ACCESS_CODE_SHA256: accessCodeDigestHex(accessCode),
    SKETCHYCUT_SESSION_SIGNING_SECRET: signingSecret.toString("base64url"),
    SKETCHYCUT_M6_STORE: "memory"
  } satisfies NodeJS.ProcessEnv;

  it("is kill-switched by default and enables generation only explicitly", () => {
    expect(readM6RuntimeConfig(base).generationEnabled).toBe(false);
    expect(readM6RuntimeConfig({
      ...base,
      SKETCHYCUT_GENERATION_ENABLED: "1",
      SKETCHYCUT_GENERATION_MODE: "replay"
    }).generationEnabled).toBe(true);
    expect(() => readM6RuntimeConfig({
      ...base,
      SKETCHYCUT_GENERATION_ENABLED: "1",
      SKETCHYCUT_GENERATION_MODE: "live"
    })).toThrow("M6_CONFIG_OPENAI_API_KEY_MISSING");
  });

  it("rejects weak or missing secrets and forbids memory persistence in real production", () => {
    expect(() => readM6RuntimeConfig({ ...base, SKETCHYCUT_SESSION_SIGNING_SECRET: "d2Vhaw" })).toThrow();
    expect(() => readM6RuntimeConfig({ ...base, SKETCHYCUT_ACCESS_CODE_SHA256: undefined })).toThrow();
    expect(() => readM6RuntimeConfig({ ...base, NODE_ENV: "production" })).toThrow(
      "M6_CONFIG_MEMORY_STORE_FORBIDDEN_IN_PRODUCTION",
    );
  });

  it("accepts generic Upstash, standard Vercel KV, and project-prefixed integration aliases", () => {
    const upstashBase = {
      ...base,
      SKETCHYCUT_M6_STORE: "upstash"
    } satisfies NodeJS.ProcessEnv;
    expect(readM6RuntimeConfig({
      ...upstashBase,
      UPSTASH_REDIS_REST_URL: "https://generic.invalid",
      UPSTASH_REDIS_REST_TOKEN: "generic-token"
    }).upstash).toEqual({ url: "https://generic.invalid", token: "generic-token" });
    expect(readM6RuntimeConfig({
      ...upstashBase,
      KV_REST_API_URL: "https://vercel-standard.invalid",
      KV_REST_API_TOKEN: "vercel-standard-token"
    }).upstash).toEqual({
      url: "https://vercel-standard.invalid",
      token: "vercel-standard-token"
    });
    expect(readM6RuntimeConfig({
      ...upstashBase,
      sketchycut_KV_REST_API_URL: "https://vercel-prefix.invalid",
      sketchycut_KV_REST_API_TOKEN: "vercel-token"
    }).upstash).toEqual({ url: "https://vercel-prefix.invalid", token: "vercel-token" });
  });
});
