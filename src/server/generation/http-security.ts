import type { SessionRecord } from "./contracts.js";
import { readRuntimeConfig } from "./config.js";
import {
  privacySafeClientIdentifier,
  sessionCookieName,
  verifySessionToken
} from "./access.js";
import { createGenerationStore } from "./store.js";
import { generationKeys } from "./keys.js";
import { GENERATION_POLICY, type ProtectedRouteKind } from "./policy.js";

export type AuthenticatedRequest = {
  session: SessionRecord;
  clientIdentifier: string;
};

function cookieValue(source: string | null, name: string): string | null {
  if (source === null) return null;
  for (const item of source.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export function genericApiFailure(status = 404): Response {
  return Response.json(
    { schemaVersion: "1.0", error: "REQUEST_UNAVAILABLE" },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function noStoreJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null || origin === "null") {
    return request.headers.get("sec-fetch-site") === "same-origin" &&
      request.headers.get("sec-fetch-mode") === "navigate";
  }
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function authenticateRequest(
  request: Request,
): Promise<AuthenticatedRequest | null> {
  const config = readRuntimeConfig();
  const token = cookieValue(
    request.headers.get("cookie"),
    sessionCookieName(config.security),
  );
  if (token === null) return null;
  const payload = verifySessionToken({
    token,
    nowMs: Date.now(),
    security: config.security
  });
  if (payload === null) return null;
  const store = createGenerationStore(config);
  const nowMs = Date.now();
  const session = await store.ensureSession({
    schemaVersion: "1.0",
    sessionId: payload.sid,
    issuedAtMs: payload.iat,
    expiresAtMs: payload.exp,
    generationDispatches: 0,
    reservedExposureMicrousd: 0,
    lastDispatchAtMs: null,
    lastProjectId: null
  }, Math.max(1, Math.ceil((payload.exp - nowMs) / 1_000)));
  if (session.expiresAtMs <= nowMs) return null;
  return {
    session,
    clientIdentifier: privacySafeClientIdentifier({
      headers: request.headers,
      signingSecret: config.security.signingSecret,
      vercel: process.env.VERCEL === "1"
    })
  };
}

export async function authorizeRoute(
  request: Request,
  route: ProtectedRouteKind,
): Promise<AuthenticatedRequest | null> {
  if (request.method !== "GET" && !sameOriginRequest(request)) return null;
  const authenticated = await authenticateRequest(request);
  if (authenticated === null) return null;
  const config = readRuntimeConfig();
  // The production-forbidden local development escape hatch also removes
  // protected-route throttles so rapid browser testing is genuinely unlimited.
  if (config.quotaUnlimited) return authenticated;
  const policy = GENERATION_POLICY.routeRates[route];
  const decision = await createGenerationStore(config).consumeRouteRate({
    key: generationKeys.routeRate(
      route,
      `${authenticated.session.sessionId}-${authenticated.clientIdentifier}`,
    ),
    nowMs: Date.now(),
    windowMs: policy.windowMs,
    maximumRequests: policy.maximumRequests
  });
  return decision.allowed ? authenticated : null;
}
