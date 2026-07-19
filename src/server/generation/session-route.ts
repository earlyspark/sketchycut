import { randomUUID } from "node:crypto";

import {
  issueSessionToken,
  privacySafeClientIdentifier,
  sessionCookieName,
  sessionCookieOptions,
  verifyAccessCodeConstantTime
} from "./access.js";
import { readRuntimeConfig, type RuntimeConfig } from "./config.js";
import type { GenerationStore } from "./contracts.js";
import { sameOriginRequest } from "./http-security.js";
import { generationKeys } from "./keys.js";
import { GENERATION_POLICY } from "./policy.js";
import { createGenerationStore } from "./store.js";

function failure(): Response {
  return new Response(
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>Request unavailable · SketchyCut</title></head><body><main><p>That code could not be verified.</p><a href=\"/\">Return to SketchyCut</a></main></body></html>",
    {
      status: 401,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      }
    },
  );
}

export async function handleSessionRequest(
  request: Request,
  dependencies: {
    config?: RuntimeConfig;
    store?: Pick<GenerationStore, "recordAccessAttempt">;
    nowMs?: number;
  } = {},
): Promise<Response> {
  if (!sameOriginRequest(request)) return failure();
  try {
    const config = dependencies.config ?? readRuntimeConfig();
    const form = await request.formData();
    const codeValue = form.get("accessCode");
    const code = typeof codeValue === "string" ? codeValue : "";
    const verified = verifyAccessCodeConstantTime(code, config.security.accessCodeDigest);
    const nowMs = dependencies.nowMs ?? Date.now();
    const clientIdentifier = privacySafeClientIdentifier({
      headers: request.headers,
      signingSecret: config.security.signingSecret,
      vercel: process.env.VERCEL === "1"
    });
    const store = dependencies.store ?? createGenerationStore(config);
    const decision = await store.recordAccessAttempt({
      key: generationKeys.accessAttempt(clientIdentifier),
      verified,
      nowMs,
      windowMs: GENERATION_POLICY.access.windowMs,
      maximumAttempts: GENERATION_POLICY.access.maximumAttempts,
      baseBackoffMs: GENERATION_POLICY.access.baseBackoffMs,
      maximumBackoffMs: GENERATION_POLICY.access.maximumBackoffMs
    });
    if (!decision.allowed) return failure();
    const sessionId = `session-${randomUUID()}`;
    const issued = issueSessionToken({ sessionId, nowMs, security: config.security });
    const cookie = sessionCookieOptions(config.security);
    const attributes = [
      `${sessionCookieName(config.security)}=${issued.token}`,
      `Max-Age=${String(cookie.maxAge)}`,
      `Path=${cookie.path}`,
      "HttpOnly",
      `SameSite=${cookie.sameSite}`,
      ...(cookie.secure ? ["Secure"] : [])
    ];
    const responseHeaders = new Headers({
      location: new URL("/create", request.url).toString(),
      "cache-control": "no-store"
    });
    responseHeaders.append("set-cookie", attributes.join("; "));
    responseHeaders.append("set-cookie", [
      "sketchycut_shell_access=1",
      `Max-Age=${String(cookie.maxAge)}`,
      `Path=${cookie.path}`,
      `SameSite=${cookie.sameSite}`,
      ...(cookie.secure ? ["Secure"] : [])
    ].join("; "));
    return new Response(null, {
      status: 303,
      headers: responseHeaders
    });
  } catch {
    return failure();
  }
}
