import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as exportProject } from "../../src/app/api/create/export/route.js";
import { POST as generate } from "../../src/app/api/create/generate/route.js";
import { GET as readProject, POST as updateProject } from "../../src/app/api/create/project/route.js";
import { POST as upload } from "../../src/app/api/create/upload/route.js";
import { POST as createSession } from "../../src/app/api/session/route.js";
import { handleSessionRequest } from "../../src/server/generation/session-route.js";
import {
  issueSessionToken,
  sessionCookieName,
  verifySessionToken
} from "../../src/server/generation/access.js";
import { readRuntimeConfig, accessCodeDigestHex } from "../../src/server/generation/config.js";
import { GenerationResponseSchema, ProjectResponseSchema } from "../../src/server/generation/api-contracts.js";
import { createGenerationStore } from "../../src/server/generation/store.js";
import {
  DEFAULT_GENERATED_CONTROLS
} from "../../src/interpretation/generated-project-contracts.js";
import {
  DEFAULT_GENERATED_FABRICATION_CONTROLS
} from "../../src/ui/content/generated-setup.js";
import { FIXTURE_SCENARIOS } from "../../src/interpretation/fixture-corpus.js";

const origin = "http://localhost:3000";
const signingSecret = Buffer.alloc(32, 19).toString("base64url");

function headers(cookie?: string): Record<string, string> {
  return {
    origin,
    "user-agent": `protected-route-test-${randomUUID()}`,
    ...(cookie === undefined ? {} : { cookie })
  };
}

function authenticatedCookie(): string {
  const config = readRuntimeConfig();
  const nowMs = Date.now();
  const sessionId = `session-route-${randomUUID()}`;
  const issued = issueSessionToken({ sessionId, nowMs, security: config.security });
  return `${sessionCookieName(config.security)}=${issued.token}`;
}

async function uploadedReference(cookie: string) {
  const image = await sharp({
    create: { width: 16, height: 12, channels: 3, background: "#c98d45" }
  }).png().toBuffer();
  const response = await upload(new Request(`${origin}/api/create/upload`, {
    method: "POST",
    headers: {
      ...headers(cookie),
      "content-type": "image/png",
      "content-length": String(image.byteLength),
      "x-sketchycut-reference-id": "reference-one"
    },
    body: image
  }));
  expect(response.status).toBe(200);
  const payload = await response.json() as { descriptor: unknown; dataUrl: string };
  return { descriptor: payload.descriptor, dataUrl: payload.dataUrl };
}

function generationBody(reference: Awaited<ReturnType<typeof uploadedReference>>, brief: string) {
  return {
    schemaVersion: "1.0",
    brief,
    references: [reference],
    roleConstraints: [],
    deterministicControls: DEFAULT_GENERATED_CONTROLS,
    fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
    retry: null
  };
}

async function requestGeneration(cookie: string, brief: string) {
  const reference = await uploadedReference(cookie);
  const body = JSON.stringify(generationBody(reference, brief));
  return generate(new Request(`${origin}/api/create/generate`, {
    method: "POST",
    headers: {
      ...headers(cookie),
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body))
    },
    body
  }));
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SKETCHYCUT_ACCESS_CODE_SHA256", accessCodeDigestHex("route-test-access"));
  vi.stubEnv("SKETCHYCUT_SESSION_SIGNING_SECRET", signingSecret);
  vi.stubEnv("SKETCHYCUT_STORE", "memory");
  vi.stubEnv("SKETCHYCUT_TEST_MODE", "1");
  vi.stubEnv("SKETCHYCUT_GENERATION_ENABLED", "1");
  vi.stubEnv("SKETCHYCUT_GENERATION_MODE", "fixture");
  vi.stubEnv("VERCEL", "0");
});

afterEach(() => vi.unstubAllEnvs());

describe("protected route chain", () => {
  it("issues a short-lived HttpOnly session only after server verification", async () => {
    const goodForm = new FormData();
    goodForm.set("accessCode", "route-test-access");
    const accepted = await createSession(new Request(`${origin}/api/session`, {
      method: "POST",
      headers: { origin, "user-agent": "session-test-good" },
      body: goodForm
    }));
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get("location")).toBe(`${origin}/create`);
    expect(accepted.headers.get("set-cookie")).toContain("HttpOnly");
    expect(accepted.headers.get("set-cookie")).toContain("SameSite=strict");
    const config = readRuntimeConfig();
    const token = accepted.headers.get("set-cookie")
      ?.match(new RegExp(`${sessionCookieName(config.security)}=([^;]+)`, "u"))?.[1];
    expect(token).toBeDefined();
    const payload = verifySessionToken({
      token: token ?? "",
      nowMs: Date.now(),
      security: config.security
    });
    expect(payload).not.toBeNull();
    expect(await createGenerationStore(config).readSession(payload?.sid ?? "missing-session")).toBeNull();

    const badForm = new FormData();
    badForm.set("accessCode", "not-the-code");
    const rejected = await createSession(new Request(`${origin}/api/session`, {
      method: "POST",
      headers: { origin, "user-agent": "session-test-bad" },
      body: badForm
    }));
    expect(rejected.status).toBe(401);
    expect(await rejected.text()).toContain("That code could not be verified.");
  });

  it("returns one secret-free generic failure for bad input, store failure, and cross-origin requests without logging", async () => {
    const config = readRuntimeConfig();
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined)
    ];
    const badForm = new FormData();
    badForm.set("accessCode", "distinguishing-wrong-code");
    const badCode = await handleSessionRequest(new Request(`${origin}/api/session`, {
      method: "POST",
      headers: { origin, "user-agent": "generic-failure-bad-code" },
      body: badForm
    }), { config, nowMs: 1_000 });
    const failedStore = await handleSessionRequest(new Request(`${origin}/api/session`, {
      method: "POST",
      headers: { origin, "user-agent": "generic-failure-store" },
      body: badForm
    }), {
      config,
      nowMs: 1_000,
      store: {
        recordAccessAttempt: () => Promise.reject(new Error("synthetic-store-secret"))
      }
    });
    const crossOrigin = await handleSessionRequest(new Request(`${origin}/api/session`, {
      method: "POST",
      headers: { origin: "https://cross-origin.invalid" },
      body: badForm
    }), { config, nowMs: 1_000 });
    const bodies = await Promise.all([badCode, failedStore, crossOrigin].map(async (response) => ({
      status: response.status,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      body: await response.text()
    })));
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(bodies[0]).toMatchObject({
      status: 401,
      contentType: "text/html; charset=utf-8",
      cacheControl: "no-store"
    });
    for (const forbidden of [
      "distinguishing-wrong-code",
      "synthetic-store-secret",
      signingSecret,
      accessCodeDigestHex("route-test-access")
    ]) {
      expect(bodies[0]!.body).not.toContain(forbidden);
    }
    expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    for (const spy of spies) spy.mockRestore();
  });

  it("independently rejects missing sessions and a cross-origin request", async () => {
    const empty = JSON.stringify({});
    const invalid = new Request(`${origin}/api/create/generate`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", "content-length": String(empty.length) },
      body: empty
    });
    expect((await generate(invalid)).status).toBe(404);
    expect((await upload(new Request(`${origin}/api/create/upload`, { method: "POST", body: "x" }))).status).toBe(404);
    expect((await readProject(new Request(`${origin}/api/create/project`))).status).toBe(404);
    expect((await exportProject(new Request(`${origin}/api/create/export`, { method: "POST", body: empty }))).status).toBe(404);

    const cookie = authenticatedCookie();
    expect((await updateProject(new Request(`${origin}/api/create/project`, {
      method: "POST",
      headers: { cookie, origin: "https://cross-origin.invalid", "content-type": "application/json" },
      body: empty
    }))).status).toBe(404);
  });

  it("runs upload → fixture interpretation → persistence → zero-call edit → complete export", async () => {
    const cookie = authenticatedCookie();
    const scenario = FIXTURE_SCENARIOS[0]!;
    const generatedResponse = await requestGeneration(cookie, scenario.brief);
    expect(generatedResponse.status, await generatedResponse.clone().text()).toBe(200);
    const generated = GenerationResponseSchema.parse(await generatedResponse.json() as unknown);
    expect(generated.outcome.kind).toBe("supported");
    expect(generated.outcome.attempt).toBeNull();
    expect(generated.project).not.toBeNull();

    const restoredResponse = await readProject(new Request(`${origin}/api/create/project`, {
      headers: { ...headers(cookie), cookie }
    }));
    expect(restoredResponse.status).toBe(200);
    const restored = ProjectResponseSchema.parse(await restoredResponse.json() as unknown);
    expect(restored.project.projectId).toBe(generated.project!.projectId);

    const updateBody = JSON.stringify({
      schemaVersion: "1.0",
      projectId: restored.project.projectId,
      expectedRevision: restored.project.revision,
      deterministicControls: {
        ...restored.source.deterministicControls,
        dimensionsMm: { width: 130, depth: 96, height: 62 },
        scaleSource: "user-specified"
      },
      fabricationControls: restored.source.fabricationControls
    });
    const updatedResponse = await updateProject(new Request(`${origin}/api/create/project`, {
      method: "POST",
      headers: {
        ...headers(cookie),
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(updateBody))
      },
      body: updateBody
    }));
    expect(updatedResponse.status).toBe(200);
    const updated = ProjectResponseSchema.parse(await updatedResponse.json() as unknown);
    expect(updated.project.revision).toBe(restored.project.revision + 1);
    expect(updated.project.lastGeometryHash).not.toBe(restored.project.lastGeometryHash);
    expect(updated.compiled.document.provenance.runtimeApplicationApiCalls).toBe(0);

    const exportBody = JSON.stringify({
      schemaVersion: "1.0",
      projectId: updated.project.projectId
    });
    const exported = await exportProject(new Request(`${origin}/api/create/export`, {
      method: "POST",
      headers: {
        ...headers(cookie),
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(exportBody))
      },
      body: exportBody
    }));
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/zip");
    expect(exported.headers.get("x-sketchycut-package-sha256")).toMatch(/^[0-9a-f]{64}$/);
    expect((await exported.arrayBuffer()).byteLength).toBeGreaterThan(1_000);
  });

  it("keeps concept-only results non-persistent and honors the generation kill switch", async () => {
    const cookie = authenticatedCookie();
    const concept = FIXTURE_SCENARIOS.find((scenario) => scenario.id === "unsupported-core")!;
    const response = GenerationResponseSchema.parse(
      await (await requestGeneration(cookie, concept.brief)).json() as unknown,
    );
    expect(response.outcome.kind).toBe("concept-only");
    expect(response.project).toBeNull();

    vi.stubEnv("SKETCHYCUT_GENERATION_ENABLED", "0");
    expect((await requestGeneration(authenticatedCookie(), FIXTURE_SCENARIOS[0]!.brief)).status).toBe(503);
  });

  it("keeps fixture mode closed to arbitrary direct-API briefs with an actionable backstop code", async () => {
    const cookie = authenticatedCookie();
    const generated = GenerationResponseSchema.parse(
      await (await requestGeneration(
        cookie,
        "This arbitrary brief is intentionally absent from the fixture corpus.",
      )).json() as unknown,
    );
    expect(generated.outcome).toMatchObject({
      kind: "failure",
      transportMode: "fixture",
      stage: "input",
      code: "FIXTURE_NOT_FOUND",
      retryable: false
    });
    expect(generated.project).toBeNull();
  });
});
