import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  issueSessionToken,
  sessionCookieName,
  sessionCookieOptions,
  verifyAccessCodeConstantTime
} from "../../../server/m6/access.js";
import { readM6RuntimeConfig } from "../../../server/m6/config.js";
import { sameOriginRequest } from "../../../server/m6/http-security.js";

export const runtime = "nodejs";

function failure(): NextResponse {
  return new NextResponse(
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

export async function POST(request: Request): Promise<NextResponse> {
  if (!sameOriginRequest(request)) return failure();
  try {
    const config = readM6RuntimeConfig();
    const form = await request.formData();
    const codeValue = form.get("accessCode");
    const code = typeof codeValue === "string" ? codeValue : "";
    const verified = verifyAccessCodeConstantTime(code, config.security.accessCodeDigest);
    if (!verified) return failure();
    const nowMs = Date.now();
    const sessionId = `session-${randomUUID()}`;
    const issued = issueSessionToken({ sessionId, nowMs, security: config.security });
    const response = NextResponse.redirect(new URL("/create", request.url), 303);
    response.headers.set("cache-control", "no-store");
    response.cookies.set(
      sessionCookieName(config.security),
      issued.token,
      sessionCookieOptions(config.security),
    );
    return response;
  } catch {
    return failure();
  }
}
