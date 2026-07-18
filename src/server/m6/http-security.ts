import type { M6SessionRecord } from "./contracts.js";
import { readM6RuntimeConfig } from "./config.js";
import {
  privacySafeClientIdentifier,
  sessionCookieName,
  verifySessionToken
} from "./access.js";
import { createM6Store } from "./store.js";
import { m6Keys } from "./keys.js";
import { M6_POLICY, type M6RouteKind } from "./policy.js";

export type M6AuthenticatedRequest = {
  session: M6SessionRecord;
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

export async function authenticateM6Request(
  request: Request,
): Promise<M6AuthenticatedRequest | null> {
  const config = readM6RuntimeConfig();
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
  const store = createM6Store(config);
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

export async function authorizeM6Route(
  request: Request,
  route: M6RouteKind,
): Promise<M6AuthenticatedRequest | null> {
  if (request.method !== "GET" && !sameOriginRequest(request)) return null;
  const authenticated = await authenticateM6Request(request);
  if (authenticated === null) return null;
  const config = readM6RuntimeConfig();
  const policy = M6_POLICY.routeRates[route];
  const decision = await createM6Store(config).consumeRouteRate({
    key: m6Keys.routeRate(
      route,
      `${authenticated.session.sessionId}-${authenticated.clientIdentifier}`,
    ),
    nowMs: Date.now(),
    windowMs: policy.windowMs,
    maximumRequests: policy.maximumRequests
  });
  return decision.allowed ? authenticated : null;
}
