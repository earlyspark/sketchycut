import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildXToolStudioHandoff,
  canonicalArtifactSetHash,
  createCompactFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/index.js";
import { XToolStudioHandoffPanel } from "../../src/ui/components/xtool-studio-handoff-panel.js";
import { createRetainedPreset } from "../../src/ui/content/presets.js";
import {
  compileFixtureRequest,
  compileProductRequest
} from "../../src/workers/compile-service.js";

async function handoffFixture() {
  const applied = createCompactFabricationSetup();
  const resolved = resolveFabricationSetup(applied);
  const profiles = {
    material: resolved.material,
    machine: resolved.machine,
    processRecipe: resolved.processRecipe,
    fabricationContext: resolved.fabricationContext,
    fit: resolved.fit
  };
  const [product, optionalFitTest] = await Promise.all([
    compileProductRequest({
      kind: "product-compile",
      structuralKind: "retained-pin",
      requestId: "handoff-product",
      program: createRetainedPreset("medium", profiles, createStarterPinSetup()),
      profiles,
      inputPolicyEvaluation: resolved.inputPolicyEvaluation
    }),
    compileFixtureRequest({
      kind: "fixture-compile",
      requestId: "handoff-fit-test",
      stockPresetId: applied.stockPresetId
    })
  ]);
  const handoff = await buildXToolStudioHandoff(
    resolved.machine,
    { fabrication: product.bundle.fabrication, svgs: product.svgs },
    { fabrication: optionalFitTest.bundle.fabrication, svgs: optionalFitTest.svgs },
  );
  return { handoff, product, optionalFitTest };
}

describe("deterministic xTool Studio handoff", () => {
  it("uses canonical sorted, group-separated non-circular artifact-set hashes", async () => {
    const sheets = [
      { sheetId: "sheet-2", svgSha256: "2".repeat(64) },
      { sheetId: "sheet-1", svgSha256: "1".repeat(64) }
    ];
    expect(await canonicalArtifactSetHash("product", sheets)).toBe(
      await canonicalArtifactSetHash("product", [...sheets].reverse()),
    );
    expect(await canonicalArtifactSetHash("product", sheets)).not.toBe(
      await canonicalArtifactSetHash("optional-cut-width-fit-test", sheets),
    );
  });

  it("projects exact sheet identity, root semantics, complexity, operation order, and manual checks", async () => {
    const { handoff, product, optionalFitTest } = await handoffFixture();
    expect(handoff.target).toMatchObject({
      manufacturer: "xTool",
      model: "M2",
      module: "20W blue-light laser",
      processingEnvelopeMm: { width: 426, height: 320 },
      downstreamApplication: "xTool Studio",
      minimumStudioDesktopVersion: "1.7.30"
    });
    expect(handoff.artifactGroups.map((group) => group.id)).toEqual([
      "product",
      "optional-cut-width-fit-test"
    ]);
    for (const [group, source] of [
      [handoff.artifactGroups[0]!, product],
      [handoff.artifactGroups[1]!, optionalFitTest]
    ] as const) {
      expect(group.sourceDocumentHash).toBe(source.bundle.fabrication.sourceDocumentHash);
      expect(group.sheets).toHaveLength(source.svgs.length);
      for (const sheet of group.sheets) {
        const sourceSheet = source.bundle.fabrication.sheets.find((item) => item.id === sheet.sheetId)!;
        const sourceSvg = source.svgs.find((item) => item.sheetId === sheet.sheetId)!;
        expect(sheet.svgSha256).toBe(sourceSvg.sha256);
        expect(sheet.rootDimensionsMm).toEqual({
          width: sourceSheet.widthMm,
          height: sourceSheet.heightMm
        });
        expect(sheet.occupiedCompensatedBoundsUm).toEqual(sourceSheet.occupiedBoundsUm);
        expect(sheet.rootPolicy).toEqual(sourceSheet.rootPolicy);
        expect(sheet.rebaseDeltaUm).toEqual(sourceSheet.rebaseDeltaUm);
        expect(sheet.requiredMaterialFootprintMm).toEqual(sourceSheet.requiredMaterialFootprintMm);
        expect(sheet.complexity.pathCount).toBe(sourceSheet.paths.length);
        expect(sheet.complexity.svgByteSize).toBe(new TextEncoder().encode(sourceSvg.svg).length);
        expect(sourceSvg.svg).not.toMatch(/<text|<image|<script|<style|transform=|href=/);
      }
    }
    expect(handoff.operationMap.map((item) => item.operation)).toEqual([
      "engrave",
      "score",
      "cut"
    ]);
    expect(handoff.operationMap).toMatchObject([
      { manualStudioAssignmentRequired: true, outputEnabledCheckRequired: true, studioKerfOffsetMm: 0 },
      { manualStudioAssignmentRequired: true, outputEnabledCheckRequired: true, studioKerfOffsetMm: 0 },
      { manualStudioAssignmentRequired: true, outputEnabledCheckRequired: true, studioKerfOffsetMm: 0 }
    ]);
    expect(handoff).toMatchObject({
      compensationOwner: "SketchyCut",
      requiredStudioKerfOffset: "off / 0.00 mm",
      manualProcessParameterConfirmationRequired: true,
      generatedProcessParameters: null,
      outputClaim: "xTool Studio-targeted; import verification required",
      proprietaryProjectGenerated: false,
      runtimeApplicationApiCalls: 0
    });
    expect(handoff.placementAndSafetyChecks).toHaveLength(11);
  });

  it("labels stale dimensions and hashes as last-applied, never current draft output", async () => {
    const { handoff } = await handoffFixture();
    const stale = renderToStaticMarkup(createElement(XToolStudioHandoffPanel, {
      handoff,
      current: false
    }));
    expect(stale).toContain("Last-applied output · draft not included");
    expect(stale).not.toContain("Matches applied output");
    expect(stale).toContain(handoff.artifactGroups[0]!.artifactSetHash);
    const current = renderToStaticMarkup(createElement(XToolStudioHandoffPanel, {
      handoff,
      current: true
    }));
    expect(current).toContain("Matches applied output");
  });
});
