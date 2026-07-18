import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual
} from "node:crypto";

import { M6SessionTokenPayloadSchema, type M6SessionTokenPayload } from "./contracts.js";
import { M6_POLICY } from "./policy.js";
import type { M6SecurityConfig } from "./config.js";

export const M6_SESSION_COOKIE = "__Host-sketchycut-evaluation";
export const M6_DEVELOPMENT_SESSION_COOKIE = "sketchycut-evaluation";

function fixedBuffer(candidate: Buffer, length: number): Buffer {
  if (candidate.length === length) return candidate;
  return Buffer.alloc(length);
}

export function verifyAccessCodeConstantTime(
  candidate: string,
  expectedDigest: Buffer,
): boolean {
  const bounded = candidate.slice(0, 1_024);
  const actual = createHash("sha256").update(bounded, "utf8").digest();
  const expected = fixedBuffer(expectedDigest, actual.length);
  const equal = timingSafeEqual(actual, expected);
  return equal && candidate.length <= 1_024 && expectedDigest.length === actual.length;
}

function signature(payload: string, secret: Buffer): Buffer {
  return createHmac("sha256", secret).update(payload, "ascii").digest();
}

export function issueSessionToken(input: {
  sessionId?: string;
  nowMs: number;
  security: M6SecurityConfig;
}): { token: string; payload: M6SessionTokenPayload } {
  const payload = M6SessionTokenPayloadSchema.parse({
    v: 1,
    sid: input.sessionId ?? `session-${randomUUID()}`,
    iat: input.nowMs,
    exp: input.nowMs + M6_POLICY.sessionTtlSeconds * 1_000
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    token: `${encoded}.${signature(encoded, input.security.signingSecret).toString("base64url")}`,
    payload
  };
}

export function verifySessionToken(input: {
  token: string;
  nowMs: number;
  security: M6SecurityConfig;
}): M6SessionTokenPayload | null {
  const [encoded = "", encodedSignature = "", ...extra] = input.token.split(".");
  const expected = signature(encoded, input.security.signingSecret);
  let supplied: Buffer;
  try {
    supplied = Buffer.from(encodedSignature, "base64url");
  } catch {
    supplied = Buffer.alloc(expected.length);
  }
  const signatureMatches = timingSafeEqual(expected, fixedBuffer(supplied, expected.length)) &&
    supplied.length === expected.length && extra.length === 0;
  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
  } catch {
    candidate = null;
  }
  const parsed = M6SessionTokenPayloadSchema.safeParse(candidate);
  if (!signatureMatches || !parsed.success || parsed.data.iat > input.nowMs ||
      parsed.data.exp <= input.nowMs) return null;
  return parsed.data;
}

export function sessionCookieName(security: M6SecurityConfig): string {
  return security.secureCookies ? M6_SESSION_COOKIE : M6_DEVELOPMENT_SESSION_COOKIE;
}

export function sessionCookieOptions(security: M6SecurityConfig) {
  return {
    httpOnly: true,
    secure: security.secureCookies,
    sameSite: "strict" as const,
    path: "/",
    maxAge: M6_POLICY.sessionTtlSeconds
  };
}

export function privacySafeClientIdentifier(input: {
  headers: Headers;
  signingSecret: Buffer;
  vercel: boolean;
}): string {
  const forwarded = input.vercel
    ? input.headers.get("x-vercel-forwarded-for")
    : input.headers.get("x-forwarded-for");
  const addressCandidate = forwarded?.split(",")[0]?.trim();
  const address = addressCandidate === undefined || addressCandidate.length === 0
    ? "unavailable"
    : addressCandidate;
  const userAgent = input.headers.get("user-agent")?.slice(0, 256) ?? "unavailable";
  return createHmac("sha256", input.signingSecret)
    .update("m6-client-identifier\0", "utf8")
    .update(address, "utf8")
    .update("\0", "utf8")
    .update(userAgent, "utf8")
    .digest("hex");
}
