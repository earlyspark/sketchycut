import { describe, expect, it } from "vitest";

import {
  buildMultiSheetProjectionBundle,
  nestPartsAcrossSheets,
  validateFabricationProjection
} from "../../src/index.js";
import { compileOrthogonalPanelFixture } from "../helpers/orthogonal-panel-fixtures.js";

describe("orthogonal-panel linked projections", () => {
  it("projects exact meshes, assembled/exploded states, BOM, legend, and instructions from one document", async () => {
    const { document, profiles } = await compileOrthogonalPanelFixture("basic-box");
    const artifacts = await buildMultiSheetProjectionBundle(
      document,
      nestPartsAcrossSheets(document.parts, profiles.machine, profiles.material, profiles.processRecipe, profiles.fabricationContext),
    );
    const { bundle } = artifacts;
    expect(new Set([
      bundle.sourceDocumentHash,
      bundle.fabrication.sourceDocumentHash,
      bundle.scene.sourceDocumentHash,
      bundle.bom.sourceDocumentHash,
      bundle.legend?.sourceDocumentHash,
      bundle.instructions?.sourceDocumentHash
    ])).toHaveLength(1);
    expect(bundle.scene.states.map((state) => state.kind)).toEqual(["assembled", "exploded"]);
    expect(bundle.scene.meshes.map((mesh) => mesh.partId).sort()).toEqual(
      document.parts.map((part) => part.id).sort(),
    );
    expect(bundle.bom.entries.map((entry) => entry.partId).sort()).toEqual(
      document.parts.map((part) => part.id).sort(),
    );
    expect(bundle.legend?.entries.map((entry) => entry.partId).sort()).toEqual(
      document.parts.map((part) => part.id).sort(),
    );
    expect(bundle.instructions?.steps.map((step) => step.instructionKey)).toEqual([
      "align-panel-frame",
      "seat-panel-frame",
      "verify-panel-assembly"
    ]);
  });

  it("forces multiple sheets and preserves exactly-once part and sheet identities everywhere", async () => {
    const value = await compileOrthogonalPanelFixture("basic-box", {
      bedMm: { width: 132, height: 102, margin: 5 }
    });
    const nests = nestPartsAcrossSheets(
      value.document.parts,
      value.profiles.machine,
      value.profiles.material,
      value.profiles.processRecipe,
      value.profiles.fabricationContext,
    );
    expect(nests.length).toBeGreaterThanOrEqual(2);
    const artifacts = await buildMultiSheetProjectionBundle(value.document, nests);
    expect(validateFabricationProjection(artifacts.bundle.fabrication, value.document.parts).status).toBe("pass");
    const placedPartIds = artifacts.bundle.fabrication.sheets.flatMap((sheet) =>
      sheet.placements.map((placement) => placement.partId),
    );
    expect(placedPartIds.sort()).toEqual(value.document.parts.map((part) => part.id).sort());
    expect(new Set(placedPartIds).size).toBe(placedPartIds.length);
    expect(artifacts.svgs).toHaveLength(nests.length);
    expect(new Set(artifacts.svgs.map((item) => item.sha256)).size).toBe(artifacts.svgs.length);
    for (const entry of artifacts.bundle.bom.entries) {
      expect(entry.sheetId).toMatch(/^sheet-\d+$/);
      expect(
        artifacts.bundle.legend?.entries.find((legend) => legend.partId === entry.partId)?.sheetId,
      ).toBe(entry.sheetId);
      expect(artifacts.svgs.some((sheet) => sheet.sheetId === entry.sheetId)).toBe(true);
    }
    expect(
      artifacts.bundle.instructions?.steps.every((step) => step.sheetIds.length >= 1),
    ).toBe(true);
  });

  it("withholds export when canonical validation fails", async () => {
    const { document, profiles } = await compileOrthogonalPanelFixture("basic-box");
    const failed = {
      ...document,
      validation: {
        schemaVersion: "1.0" as const,
        status: "fail" as const,
        findings: [
          {
            code: "SEEDED_FAILURE",
            severity: "error" as const,
            owner: "test",
            relatedIds: [],
            message: "Seeded deterministic failure.",
            blocksExport: true
          }
        ]
      }
    };
    await expect(
      buildMultiSheetProjectionBundle(
        failed,
        nestPartsAcrossSheets(failed.parts, profiles.machine, profiles.material, profiles.processRecipe, profiles.fabricationContext),
      ),
    ).rejects.toThrow("withheld");
  });
});
