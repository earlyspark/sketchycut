import { describe, expect, it } from "vitest";

import {
  NOMINAL_3MM_LASER_PLYWOOD_POLICY,
  buildMultiSheetProjectionBundle,
  canonicalDocumentHash,
  canonicalGeometryHash,
  compileOrthogonalPanelProgram,
  evaluateStockInputs,
  measuredBasswoodProfile,
  nestPartsAcrossSheets,
  provisionalFitProfile,
  xtoolM2Profile
} from "../../src/index.js";
import { createPrimaryPreset } from "../../src/ui/content/presets.js";

function profiles(samplesMm: readonly number[], kerfXmm = 0.15, kerfYmm = kerfXmm) {
  return {
    material: measuredBasswoodProfile(samplesMm),
    machine: xtoolM2Profile(kerfXmm, kerfYmm),
    fit: provisionalFitProfile()
  };
}

describe("canonical nominal-geometry and evaluated-document hashes", () => {
  it("separates policy/sample evidence from nominal geometry", async () => {
    const narrow = profiles([2.98, 3, 3.02]);
    const wide = profiles([2.8, 3, 3.2]);
    const narrowDocument = await compileOrthogonalPanelProgram(
      createPrimaryPreset("medium", narrow),
      narrow,
    );
    const wideDocument = await compileOrthogonalPanelProgram(
      createPrimaryPreset("medium", wide),
      wide,
    );
    expect(await canonicalGeometryHash(narrowDocument)).toBe(
      await canonicalGeometryHash(wideDocument),
    );
    expect(await canonicalDocumentHash(narrowDocument)).not.toBe(
      await canonicalDocumentHash(wideDocument),
    );

    const policyBumpEvaluation = evaluateStockInputs(
      {
        materialKind: narrow.material.materialKind,
        thicknessSamplesMm: narrow.material.thicknessMeasurement!.samplesMm,
        kerfXmm: narrow.machine.kerfMm.x,
        kerfYmm: narrow.machine.kerfMm.y
      },
      {
        ...NOMINAL_3MM_LASER_PLYWOOD_POLICY,
        version: "1.0.1"
      },
    );
    const policyBumpDocument = await compileOrthogonalPanelProgram(
      createPrimaryPreset("medium", narrow),
      narrow,
      policyBumpEvaluation,
    );
    expect(await canonicalGeometryHash(policyBumpDocument)).toBe(
      await canonicalGeometryHash(narrowDocument),
    );
    expect(await canonicalDocumentHash(policyBumpDocument)).not.toBe(
      await canonicalDocumentHash(narrowDocument),
    );
    expect(policyBumpDocument.provenance.inputDigest).toBe(
      narrowDocument.provenance.inputDigest,
    );
    expect(policyBumpDocument.operatorProgram).toEqual(narrowDocument.operatorProgram);
    const project = async (
      document: typeof narrowDocument,
      resolved: typeof narrow,
    ) => buildMultiSheetProjectionBundle(
      document,
      nestPartsAcrossSheets(document.parts, resolved.machine, resolved.material),
    );
    const [narrowArtifacts, policyBumpArtifacts] = await Promise.all([
      project(narrowDocument, narrow),
      project(policyBumpDocument, narrow)
    ]);
    expect(policyBumpArtifacts.svgs).toEqual(narrowArtifacts.svgs);
  });

  it("changes nominal geometry for thickness but not directional kerf edits", async () => {
    const baseline = profiles([3, 3, 3]);
    const thicknessEdit = profiles([3.1, 3.1, 3.1]);
    const kerfEdit = profiles([3, 3, 3], 0.18, 0.2);
    const compile = async (resolved: ReturnType<typeof profiles>) =>
      compileOrthogonalPanelProgram(createPrimaryPreset("medium", resolved), resolved);
    const [baselineDocument, thicknessDocument, kerfDocument] = await Promise.all([
      compile(baseline),
      compile(thicknessEdit),
      compile(kerfEdit)
    ]);
    expect(await canonicalGeometryHash(baselineDocument)).not.toBe(
      await canonicalGeometryHash(thicknessDocument),
    );
    expect(await canonicalGeometryHash(baselineDocument)).toBe(
      await canonicalGeometryHash(kerfDocument),
    );

    const project = async (
      document: Awaited<ReturnType<typeof compile>>,
      resolved: ReturnType<typeof profiles>,
    ) => buildMultiSheetProjectionBundle(
      document,
      nestPartsAcrossSheets(document.parts, resolved.machine, resolved.material),
    );
    const [baselineArtifacts, kerfArtifacts] = await Promise.all([
      project(baselineDocument, baseline),
      project(kerfDocument, kerfEdit)
    ]);
    expect(baselineArtifacts.svgs).not.toEqual(kerfArtifacts.svgs);
  });

  it("keeps normalized sample order out of replay differences", async () => {
    const first = profiles([3.04, 2.98, 3]);
    const second = profiles([3, 3.04, 2.98]);
    const firstEvaluation = evaluateStockInputs({
      materialKind: "basswood-plywood",
      thicknessSamplesMm: [3.04, 2.98, 3],
      kerfXmm: 0.15
    });
    const secondEvaluation = evaluateStockInputs({
      materialKind: "basswood-plywood",
      thicknessSamplesMm: [3, 3.04, 2.98],
      kerfXmm: 0.15
    });
    const [firstDocument, secondDocument] = await Promise.all([
      compileOrthogonalPanelProgram(
        createPrimaryPreset("medium", first),
        first,
        firstEvaluation,
      ),
      compileOrthogonalPanelProgram(
        createPrimaryPreset("medium", second),
        second,
        secondEvaluation,
      )
    ]);
    expect(firstDocument.provenance.inputDigest).toBe(secondDocument.provenance.inputDigest);
    expect(await canonicalDocumentHash(firstDocument)).toBe(
      await canonicalDocumentHash(secondDocument),
    );
  });

  it("rejects policy provenance that does not describe the compiled profiles", async () => {
    const resolved = profiles([3, 3, 3], 0.15, 0.16);
    const mismatchedEvaluation = evaluateStockInputs({
      materialKind: resolved.material.materialKind,
      thicknessSamplesMm: resolved.material.thicknessMeasurement!.samplesMm,
      kerfXmm: 0.2,
      kerfYmm: 0.2
    });
    await expect(
      compileOrthogonalPanelProgram(
        createPrimaryPreset("medium", resolved),
        resolved,
        mismatchedEvaluation,
      ),
    ).rejects.toThrow(
      "Input-policy evaluation must describe the exact material and machine profiles being compiled.",
    );
  });
});
