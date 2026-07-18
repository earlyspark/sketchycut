import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { sha256 } from "../../src/domain/hash.js";
import {
  buildM5ReplayIntent,
  M5_REPLAY_SCENARIOS
} from "../../src/interpretation/m5-replay-corpus.js";
import { IntentGraphV1Schema } from "../../src/interpretation/intent-graph.js";
import { mapIntentGraph } from "../../src/interpretation/mapper.js";
import { normalizeSemanticGenerationRequest } from "../../src/interpretation/semantic-request.js";
import { compileGeneratedProjectFromSemantic } from "../../src/interpretation/generated-project-compiler.js";
import { resolveGeneratedFabricationControls } from "../../src/interpretation/generated-fabrication.js";
import { MemoryM6Store } from "../../src/server/m6/memory-store.js";
import { buildM6Package, M6PackageManifestSchema } from "../../src/server/m6/package-builder.js";
import {
  M6ProjectError,
  createPersistedProject,
  readPersistedProject,
  updatePersistedProject
} from "../../src/server/m6/project-persistence.js";
import { m6Keys } from "../../src/server/m6/keys.js";
import {
  DEFAULT_GENERATED_CONTROLS
} from "../../src/ui/content/generated-projects.js";
import {
  DEFAULT_GENERATED_FABRICATION_CONTROLS
} from "../../src/ui/content/generated-setup.js";

async function generatedFixture(
  fabricationControls = DEFAULT_GENERATED_FABRICATION_CONTROLS,
) {
  const scenario = M5_REPLAY_SCENARIOS.find((candidate) => candidate.id === "rigid-structure")!;
  const semanticRequest = normalizeSemanticGenerationRequest({
    brief: scenario.brief,
    references: [{
      referenceId: "reference-one",
      sha256: "a".repeat(64),
      mediaType: "image/png",
      width: 900,
      height: 600
    }],
    roleConstraints: [],
    modelConfiguration: {
      modelId: "gpt-5.6-terra",
      reasoningEffort: "low",
      maxOutputTokens: 4_000,
      serviceTier: "default",
      store: false
    }
  });
  const intent = IntentGraphV1Schema.parse(buildM5ReplayIntent(semanticRequest, scenario));
  const mapping = await mapIntentGraph(intent);
  if (mapping.kind === "concept-only") throw new Error("Expected fabrication mapping.");
  const fabrication = resolveGeneratedFabricationControls(fabricationControls);
  const compiled = await compileGeneratedProjectFromSemantic({
    requestId: "m6-project-package-fixture",
    semanticRequest,
    intent,
    mapping,
    profiles: fabrication.profiles,
    inputPolicyEvaluation: fabrication.inputPolicyEvaluation,
    pin: fabrication.pin,
    controls: DEFAULT_GENERATED_CONTROLS,
    cacheResult: "miss"
  });
  return { semanticRequest, intent, mapping, compiled };
}

async function persistedFixture(
  fabricationControls = DEFAULT_GENERATED_FABRICATION_CONTROLS,
) {
  const fixture = await generatedFixture(fabricationControls);
  const store = new MemoryM6Store();
  const record = await createPersistedProject({
    store,
    ownerSessionId: "session-owner",
    semanticRequest: fixture.semanticRequest,
    intent: fixture.intent,
    mapping: fixture.mapping,
    deterministicControls: DEFAULT_GENERATED_CONTROLS,
    fabricationControls,
    compiled: fixture.compiled,
    nowMs: 10_000
  });
  return { store, record, ...fixture };
}

describe("M6 durable projects and complete packages", () => {
  it("persists a minimal owned source, recompiles edits without a model call, and rejects stale revisions", async () => {
    const { store, record } = await persistedFixture();
    const serialized = await store.getValue(m6Keys.project(record.projectId));
    expect(serialized).not.toBeNull();
    expect(serialized).not.toContain("normalizedBrief");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("mediaType");
    expect(serialized).not.toContain("width\":900");
    await expect(readPersistedProject({
      store,
      ownerSessionId: "session-other",
      projectId: record.projectId
    })).rejects.toMatchObject({ code: "NOT_FOUND" } satisfies Partial<M6ProjectError>);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const updated = await updatePersistedProject({
      store,
      ownerSessionId: "session-owner",
      projectId: record.projectId,
      expectedRevision: 1,
      deterministicControls: {
        ...DEFAULT_GENERATED_CONTROLS,
        dimensionsMm: { width: 130, depth: 96, height: 62 },
        scaleSource: "user-specified"
      },
      fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
      nowMs: 11_000
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updated.record.revision).toBe(2);
    expect(updated.record.lastGeometryHash).not.toBe(record.lastGeometryHash);
    expect(updated.compiled.document.provenance.runtimeApplicationApiCalls).toBe(1);
    await expect(updatePersistedProject({
      store,
      ownerSessionId: "session-owner",
      projectId: record.projectId,
      expectedRevision: 1,
      deterministicControls: DEFAULT_GENERATED_CONTROLS,
      fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS
    })).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<M6ProjectError>);
    fetchSpy.mockRestore();
  });

  it("builds a byte-stable, hash-complete package after server-side revalidation", async () => {
    const multiSheetControls = {
      ...DEFAULT_GENERATED_FABRICATION_CONTROLS,
      stockFootprintMm: { width: 200, height: 180 }
    };
    const { record } = await persistedFixture(multiSheetControls);
    const first = await buildM6Package(record);
    const second = await buildM6Package(record);
    expect(first.sha256).toBe(second.sha256);
    expect(first.bytes).toEqual(second.bytes);
    const files = unzipSync(first.bytes);
    const paths = Object.keys(files).sort();
    expect(paths).toContain("manifest.json");
    expect(paths).toContain("previews/assembled.svg");
    expect(paths).toContain("previews/exploded.svg");
    expect(paths).toContain("previews/sheet-selector.json");
    expect(paths).toContain("material-fit-coupon/sheet-1.svg");
    expect(paths).toContain("optional-cut-width-fit-test/measurement-instructions.md");
    expect(paths).toContain("handoff/xtool-studio-checklist.md");
    const manifest = M6PackageManifestSchema.parse(
      JSON.parse(strFromU8(files["manifest.json"]!)) as unknown,
    );
    expect(manifest.artifactGroups.map((group) => group.id)).toEqual([
      "product",
      "material-fit-coupon",
      "optional-cut-width-fit-test"
    ]);
    expect(manifest.requiredStudioKerfOffset).toBe("off / 0.00 mm");
    expect(manifest.persistedProjectId).toBe(record.projectId);
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
      expect(sheet.importComplexityBudget.withinObservedEnvelope).toBe(true);
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
});
