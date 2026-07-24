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
import { CurrentGenerationResponseSchema, CurrentProjectResponseSchema } from "../../src/server/generation/api-contracts.js";
import { createGenerationStore } from "../../src/server/generation/store.js";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS
} from "../../src/interpretation/generation-submission.js";
import {
  DEFAULT_GENERATED_FABRICATION_CONTROLS
} from "../../src/ui/content/generated-setup.js";
import { CURRENT_FIXTURE_SCENARIOS } from "../../src/interpretation/current-fixture-corpus.js";

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
    schemaVersion: "4.0",
    brief,
    references: [reference],
    roleConstraints: [{
      referenceId: "reference-one",
      roles: ["structure", "surface"]
    }],
    deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS,
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
    const scenario = CURRENT_FIXTURE_SCENARIOS[0]!;
    const generatedResponse = await requestGeneration(cookie, scenario.brief);
    expect(generatedResponse.status, await generatedResponse.clone().text()).toBe(200);
    const generated = CurrentGenerationResponseSchema.parse(await generatedResponse.json() as unknown);
    expect(generated.outcome.kind).toBe("supported");
    expect(generated.project).not.toBeNull();

    const restoredResponse = await readProject(new Request(`${origin}/api/create/project`, {
      headers: { ...headers(cookie), cookie }
    }));
    expect(restoredResponse.status).toBe(200);
    const restored = CurrentProjectResponseSchema.parse(await restoredResponse.json() as unknown);
    expect(restored.project.projectId).toBe(generated.project!.projectId);

    const updateBody = JSON.stringify({
      schemaVersion: "3.0",
      projectId: restored.project.projectId,
      expectedRevision: restored.project.revision,
      deterministicControls: {
        ...restored.deterministicControls,
        advancedSizing: { basis: "exact-external", dimensions: { widthMm: 130 } }
      },
      fabricationControls: {
        ...restored.fabricationControls,
        stockFootprintMm: { width: 200, height: 180 }
      }
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
    const updated = CurrentProjectResponseSchema.parse(await updatedResponse.json() as unknown);
    expect(updated.project.revision).toBe(restored.project.revision + 1);
    expect(updated.project.lastGeometryHash).not.toBe(restored.project.lastGeometryHash);
    expect(updated.compiled.document.provenance.runtimeApplicationApiCalls).toBe(0);

    const exportBody = JSON.stringify({
      schemaVersion: "3.0",
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

  it("bypasses protected-route throttles only for unlimited local development", async () => {
    vi.stubEnv("SKETCHYCUT_QUOTA_UNLIMITED", "1");
    const cookie = authenticatedCookie();
    const scenario = CURRENT_FIXTURE_SCENARIOS[0]!;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const response = await requestGeneration(cookie, scenario.brief);
      expect(response.status, await response.clone().text()).toBe(200);
    }
  });

  it("persists an exportable modified result, withholds release-blocked motion, and honors the kill switch", async () => {
    const cookie = authenticatedCookie();
    const modified = CURRENT_FIXTURE_SCENARIOS.find((scenario) =>
      scenario.id === "modified-fixed-aperture-enclosure"
    )!;
    const response = CurrentGenerationResponseSchema.parse(
      await (await requestGeneration(cookie, modified.brief)).json() as unknown,
    );
    expect(response.outcome.kind).toBe("modified");
    if (response.outcome.kind !== "modified") throw new Error("Expected a modified result.");
    expect(response.outcome).toMatchObject({
      omittedSemanticIds: [],
      exportAllowed: true
    });
    const appliedSubstitution =
      response.outcome.source.substitutionTrace.appliedSubstitutions[0];
    expect(appliedSubstitution).toBeDefined();
    if (appliedSubstitution === undefined) {
      throw new Error("Expected one applied substitution.");
    }
    for (const itemId of appliedSubstitution.affectedSemanticIds) {
      expect(response.outcome.changedSemanticIds).toContain(itemId);
    }
    expect(response.outcome.findingCodes).toContain(
      "MODIFIED_OUTPUT_USES_REGISTERED_SUBSTITUTION"
    );
    expect(response.project).not.toBeNull();
    expect(response.compiled?.document.validation.status).toBe("pass");
    expect(response.compiled?.document.provenance).toMatchObject({
      supportOutcome: "modified"
    });
    expect(response.compiled?.document.provenance.modificationDisclosures)
      .toContain(appliedSubstitution.disclosure);
    const restored = CurrentProjectResponseSchema.parse(await (
      await readProject(new Request(`${origin}/api/create/project`, {
        headers: { ...headers(cookie), cookie }
      }))
    ).json() as unknown);
    expect(restored.source.requestCoverage).toEqual({
      status: "modified",
      includedSemanticIds: response.outcome.includedSemanticIds,
      changedSemanticIds: response.outcome.changedSemanticIds,
      omittedSemanticIds: response.outcome.omittedSemanticIds,
      disclosures: response.outcome.modificationDisclosures
    });

    const releaseBlocked = CURRENT_FIXTURE_SCENARIOS.find((scenario) =>
      scenario.unsupportedCompoundMotion
    )!;
    const releaseBlockedResponse = CurrentGenerationResponseSchema.parse(
      await (await requestGeneration(cookie, releaseBlocked.brief)).json() as unknown,
    );
    expect(releaseBlockedResponse.outcome.kind).toBe("concept-only");
    if (releaseBlockedResponse.outcome.kind !== "concept-only") {
      throw new Error("Expected a release-blocked concept-only result.");
    }
    expect(releaseBlockedResponse.outcome.findingCodes).toContain(
      "FABRICATION_EXPORT_WITHHELD_PENDING_STRUCTURAL_REDESIGN"
    );
    expect(releaseBlockedResponse.project).toBeNull();
    expect(releaseBlockedResponse.compiled).toBeNull();

    vi.stubEnv("SKETCHYCUT_GENERATION_ENABLED", "0");
    expect((await requestGeneration(authenticatedCookie(), CURRENT_FIXTURE_SCENARIOS[0]!.brief)).status).toBe(503);
  });

  it("keeps fixture mode closed to arbitrary direct-API briefs with an actionable backstop code", async () => {
    const cookie = authenticatedCookie();
    const generated = CurrentGenerationResponseSchema.parse(
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
