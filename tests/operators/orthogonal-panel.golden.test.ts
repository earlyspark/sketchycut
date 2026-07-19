import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  buildMultiSheetProjectionBundle,
  canonicalGeometryHash,
  measuredBasswoodProfile,
  nestPartsAcrossSheets,
  provisionalFabricationProfiles
} from "../../src/index.js";
import { compileOrthogonalPanelProgram } from "../../src/operators/orthogonal-compiler.js";
import { createPrimaryPreset } from "../../src/ui/content/presets.js";

const GoldenSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    matrixId: z.literal("orthogonal-panel-current"),
    cases: z.array(
      z
        .object({
          id: z.string(),
          presetId: z.enum(["small", "medium", "large"]),
          measuredThicknessMm: z.number(),
          kerfMm: z.number(),
          geometryHash: z.string(),
          sheetSvgHashes: z.array(z.string()),
          partCount: z.number(),
          jointCount: z.number(),
          sheetCount: z.number(),
          manufacturingPathCount: z.number(),
          meshVertexCounts: z.record(z.string(), z.number()),
          validationCodes: z.array(z.string())
        })
        .strict(),
    )
  })
  .strict();

describe("orthogonal-panel golden matrix", () => {
  it("matches all small, medium, and large thickness/kerf proof cases", async () => {
    const golden = GoldenSchema.parse(
      JSON.parse(
        await readFile(new URL("../golden/orthogonal-panel-matrix.json", import.meta.url), "utf8"),
      ) as unknown,
    );
    expect(golden.cases).toHaveLength(15);
    for (const expected of golden.cases) {
      const profiles = provisionalFabricationProfiles(
        measuredBasswoodProfile([
          expected.measuredThicknessMm,
          expected.measuredThicknessMm,
          expected.measuredThicknessMm
        ]),
        expected.kerfMm,
      );
      const document = await compileOrthogonalPanelProgram(
        createPrimaryPreset(expected.presetId, profiles),
        profiles,
      );
      const artifacts = await buildMultiSheetProjectionBundle(
        document,
        nestPartsAcrossSheets(document.parts, profiles.machine, profiles.material, profiles.processRecipe, profiles.fabricationContext),
      );
      expect({
        id: expected.id,
        presetId: expected.presetId,
        measuredThicknessMm: expected.measuredThicknessMm,
        kerfMm: expected.kerfMm,
        geometryHash: await canonicalGeometryHash(document),
        sheetSvgHashes: artifacts.svgs.map((item) => item.sha256),
        partCount: document.parts.length,
        jointCount: document.joints.length,
        sheetCount: artifacts.bundle.fabrication.sheets.length,
        manufacturingPathCount: artifacts.bundle.fabrication.sheets.reduce(
          (sum, sheet) => sum + sheet.paths.length,
          0,
        ),
        meshVertexCounts: Object.fromEntries(
          artifacts.bundle.scene.meshes.map((mesh) => [mesh.partId, mesh.verticesMm.length]),
        ),
        validationCodes: document.validation.findings.map((finding) => finding.code)
      }).toEqual(expected);
    }
  });
});
