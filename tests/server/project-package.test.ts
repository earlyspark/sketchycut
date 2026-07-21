import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { sha256 } from "../../src/domain/hash.js";
import { CURRENT_FIXTURE_SCENARIOS } from "../../src/interpretation/current-fixture-corpus.js";
import { DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2, GenerationSubmissionV2Schema } from "../../src/interpretation/generation-submission-v2.js";
import type { RuntimeConfig } from "../../src/server/generation/config.js";
import { executeCurrentGeneration } from "../../src/server/generation/generation-service-v2.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import { buildFabricationPackage, FabricationPackageManifestSchema } from "../../src/server/generation/package-builder.js";
import {
  CurrentProjectError,
  readCurrentPersistedProject,
  updateCurrentPersistedProject
} from "../../src/server/generation/project-persistence-v2.js";
import { generationKeys } from "../../src/server/generation/keys.js";
import {
  DEFAULT_GENERATED_FABRICATION_CONTROLS
} from "../../src/ui/content/generated-setup.js";

async function persistedFixture(
  fabricationControls = DEFAULT_GENERATED_FABRICATION_CONTROLS,
  scenario = CURRENT_FIXTURE_SCENARIOS[0]!,
) {
  const store = new MemoryGenerationStore();
  const config: RuntimeConfig = {
    security: { accessCodeDigest: Buffer.alloc(32), signingSecret: Buffer.alloc(32), secureCookies: false },
    storeMode: "memory", upstash: null, generationEnabled: true, quotaUnlimited: false,
    generationMode: "fixture", generationExperience: "fixture", liveTransport: null
  };
  const response = await executeCurrentGeneration({
    config,
    authenticated: {
      session: { schemaVersion: "1.0", sessionId: "session-owner", issuedAtMs: 1, expiresAtMs: 20_000, generationDispatches: 0, reservedExposureMicrousd: 0, lastDispatchAtMs: null, lastProjectId: null },
      clientIdentifier: "package-client"
    },
    submission: GenerationSubmissionV2Schema.parse({
      schemaVersion: "2.0", brief: scenario.brief,
      references: [], roleConstraints: [], deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
      fabricationControls, retry: null
    }),
    store,
    runtimeOrigin: "test-recorded"
  });
  if (response.project === null || response.compiled === null) throw new Error("Expected persisted fixture.");
  const record = await readCurrentPersistedProject({ store, ownerSessionId: "session-owner", projectId: response.project.projectId });
  return { store, record, compiled: response.compiled };
}

describe("durable projects and complete packages", () => {
  it("returns typed current-only errors for obsolete and malformed stored project bytes", async () => {
    const store = new MemoryGenerationStore();
    await store.setValue(generationKeys.project("obsolete-project"), JSON.stringify({
      schemaVersion: "0.9"
    }), { ttlSeconds: 60 });
    await expect(readCurrentPersistedProject({
      store,
      ownerSessionId: "session-owner",
      projectId: "obsolete-project"
    })).rejects.toMatchObject({
      code: "UNSUPPORTED_PROJECT_VERSION"
    } satisfies Partial<CurrentProjectError>);

    await store.setValue(generationKeys.project("malformed-project"), "{", {
      ttlSeconds: 60
    });
    await expect(readCurrentPersistedProject({
      store,
      ownerSessionId: "session-owner",
      projectId: "malformed-project"
    })).rejects.toMatchObject({ code: "INVALID" } satisfies Partial<CurrentProjectError>);
  });

  it("persists a minimal owned source, recompiles edits without a model call, and rejects stale revisions", async () => {
    const { store, record } = await persistedFixture();
    const serialized = await store.getValue(generationKeys.project(record.projectId));
    expect(serialized).not.toBeNull();
    expect(serialized).not.toContain("normalizedBrief");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("mediaType");
    expect(serialized).not.toContain("width\":900");
    await expect(readCurrentPersistedProject({
      store,
      ownerSessionId: "session-other",
      projectId: record.projectId
    })).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<CurrentProjectError>);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const updated = await updateCurrentPersistedProject({
      store,
      ownerSessionId: "session-owner",
      projectId: record.projectId,
      expectedRevision: 1,
      deterministicControls: {
        ...DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
        advancedSizing: { basis: "exact-external", dimensions: { widthMm: 130, depthMm: 96, heightMm: 62 } }
      },
      fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
      nowMs: 11_000
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updated.record.revision).toBe(2);
    expect(updated.record.lastGeometryHash).not.toBe(record.lastGeometryHash);
    expect(updated.record.source.selectedSizing.external.widthUm).toBe(130_000);
    expect(updated.compiled.document.intent).toEqual(updated.record.source.intent);
    expect(updated.record.runtimeApplicationApiCalls).toBe(0);
    await expect(updateCurrentPersistedProject({
      store,
      ownerSessionId: "session-owner",
      projectId: record.projectId,
      expectedRevision: 1,
      deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
      fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS
    })).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<CurrentProjectError>);
    fetchSpy.mockRestore();
  });

  it("builds a byte-stable, hash-complete package after server-side revalidation", async () => {
    const multiSheetControls = {
      ...DEFAULT_GENERATED_FABRICATION_CONTROLS,
      stockFootprintMm: { width: 200, height: 180 }
    };
    const fixture = await persistedFixture();
    const { record } = await updateCurrentPersistedProject({
      store: fixture.store,
      ownerSessionId: "session-owner",
      projectId: fixture.record.projectId,
      expectedRevision: fixture.record.revision,
      deterministicControls: {
        ...DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
        advancedSizing: { basis: "exact-external", dimensions: { widthMm: 130 } }
      },
      fabricationControls: multiSheetControls
    });
    const first = await buildFabricationPackage(record);
    const second = await buildFabricationPackage(record);
    expect(first.sha256).toBe(second.sha256);
    expect(first.bytes).toEqual(second.bytes);
    const files = unzipSync(first.bytes);
    const archiveText = Object.entries(files)
      .filter(([name]) => /\.(?:json|md|svg)$/.test(name))
      .map(([, bytes]) => strFromU8(bytes))
      .join("\n");
    expect(archiveText).not.toContain(CURRENT_FIXTURE_SCENARIOS[0]!.brief);
    expect(archiveText).not.toContain("data:image");
    expect(archiveText).not.toContain("/Users/");
    expect(archiveText).not.toContain("/var/folders/");
    const paths = Object.keys(files).sort();
    expect(paths).toContain("manifest.json");
    expect(paths).toContain("generation-source.json");
    expect(paths).toContain("previews/assembled.svg");
    expect(paths).toContain("previews/exploded.svg");
    expect(paths).toContain("previews/sheet-selector.json");
    expect(paths).toContain("material-fit-coupon/sheet-1.svg");
    expect(paths).toContain("optional-cut-width-fit-test/measurement-instructions.md");
    expect(paths).toContain("handoff/xtool-studio-checklist.md");
    const manifest = FabricationPackageManifestSchema.parse(
      JSON.parse(strFromU8(files["manifest.json"]!)) as unknown,
    );
    expect(manifest.artifactGroups.map((group) => group.id)).toEqual([
      "product",
      "material-fit-coupon",
      "optional-cut-width-fit-test"
    ]);
    expect(manifest.requiredStudioKerfOffset).toBe("off / 0.00 mm");
    expect(manifest.persistedProjectId).toBe(record.projectId);
    expect(manifest.sourceRecordHash).toBe(await sha256(strFromU8(files["generation-source.json"]!).trim()));
    expect(manifest.studioHandoff.svgDpi.status).toBe("must-check-record");
    expect(manifest.studioHandoff.operationMap.map((item) => item.nonColorLabel)).toEqual([
      "Engrave filled areas",
      "Score centerlines",
      "Cut contours"
    ]);
    for (const entry of manifest.files) {
      expect(await sha256(files[entry.path]!)).toBe(entry.sha256);
      expect(files[entry.path]!.byteLength).toBe(entry.bytes);
    }
    const product = manifest.artifactGroups[0]!;
    expect(product.sheetCount).toBeGreaterThan(1);
    const assigned = product.sheets.flatMap((sheet) => sheet.partIds);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(assigned.length).toBeGreaterThan(0);
    for (const sheet of product.sheets) {
      expect(sheet.units).toBe("mm");
      expect(sheet.importComplexityBudget.withinCurrentLimit).toBe(true);
      const svg = strFromU8(files[sheet.path]!);
      expect(svg).not.toMatch(/<text\b|<image\b|<style\b|\btransform\s*=/i);
      expect(svg).toContain('width="');
      expect(svg).toContain('mm"');
    }
    const completeHandoff = JSON.parse(
      strFromU8(files["handoff/xtool-studio-handoff.json"]!),
    ) as {
      artifactGroups: { id: string; sheets: { svgSha256: string }[] }[];
      studioHandoff: { operationMap: { operation: string }[] };
    };
    expect(completeHandoff.artifactGroups.map((group) => group.id)).toEqual(
      manifest.artifactGroups.map((group) => group.id),
    );
    expect(completeHandoff.studioHandoff.operationMap.map((item) => item.operation)).toEqual([
      "engrave",
      "score",
      "cut"
    ]);
    const checklist = strFromU8(files["handoff/xtool-studio-checklist.md"]!);
    for (const group of manifest.artifactGroups) {
      expect(checklist).toContain(group.id);
      for (const sheet of group.sheets) {
        expect(checklist).toContain(sheet.svgSha256);
        expect(checklist).toContain(
          `${sheet.rootDimensionsMm.width.toFixed(2)} × ${sheet.rootDimensionsMm.height.toFixed(2)} mm root`,
        );
      }
    }
    expect(checklist).toContain("enable Output");
    expect(checklist).toContain("Studio Kerf Offset: off / 0.00 mm");
    expect(checklist).toContain("built-in air-pump state");
  });

  it("revalidates and rejects packages for physically deferred moving interfaces", async () => {
    for (const scenario of [CURRENT_FIXTURE_SCENARIOS[1]!, CURRENT_FIXTURE_SCENARIOS[2]!]) {
      const { record } = await persistedFixture(
        DEFAULT_GENERATED_FABRICATION_CONTROLS,
        scenario,
      );
      await expect(buildFabricationPackage(record)).rejects.toThrow(
        "GENERATION_PACKAGE_FABRICATION_RELEASE_WITHHELD",
      );
    }
  });
});
