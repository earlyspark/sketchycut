import {
  FabricationProjectionSchema,
  ProjectionBundleSchema,
  type DesignDocumentV1,
  type ProjectionBundle,
  type SheetPlacement
} from "../domain/contracts.js";
import { canonicalDocumentHash } from "../compiler/canonical.js";
import { buildBomProjection } from "./bom.js";
import { buildInstructionsProjection } from "./instructions.js";
import { buildPartsLegendProjection } from "./legend.js";
import { buildSheetProjection } from "./fabrication/sheet.js";
import { serializeSheetSvg, svgHash } from "./fabrication/svg.js";
import { buildSceneProjection } from "./mesh/scene.js";
import type { SheetNest } from "./fabrication/nesting.js";

export type ProjectionArtifacts = {
  bundle: ProjectionBundle;
  svg: string;
  svgs: {
    sheetId: string;
    svg: string;
    sha256: string;
  }[];
};

export async function buildProjectionBundle(
  document: DesignDocumentV1,
  placements: readonly SheetPlacement[],
): Promise<ProjectionArtifacts> {
  const sourceDocumentHash = await canonicalDocumentHash(document);
  const sheet = await buildSheetProjection(
    "sheet-1",
    document.parts,
    placements,
    document.resolvedInputs.machine,
    document.resolvedInputs.processRecipe,
    document.resolvedInputs.fabricationContext,
  );
  const svg = serializeSheetSvg(sheet);
  const fabrication = FabricationProjectionSchema.parse({
    schemaVersion: "2.0",
    sourceDocumentHash,
    materialProfileId: document.resolvedInputs.material.id,
    machineProfileId: document.resolvedInputs.machine.id,
    sheets: [sheet],
    svgSha256: await svgHash(svg)
  });
  const scene = await buildSceneProjection(document, sourceDocumentHash);
  const bom = await buildBomProjection(document, sourceDocumentHash);
  return {
    bundle: ProjectionBundleSchema.parse({
      schemaVersion: "2.0",
      sourceDocumentHash,
      fabrication,
      scene,
      bom
    }),
    svg,
    svgs: [{ sheetId: sheet.id, svg, sha256: await svgHash(svg) }]
  };
}

export async function buildMultiSheetProjectionBundle(
  document: DesignDocumentV1,
  nests: readonly SheetNest[],
): Promise<ProjectionArtifacts> {
  if (document.validation.status !== "pass") {
    throw new Error("Projection export is withheld because deterministic validation failed.");
  }
  const sourceDocumentHash = await canonicalDocumentHash(document);
  const partById = new Map(document.parts.map((part) => [part.id, part]));
  const seenPartIds = new Set<string>();
  const sheetByPartId = new Map<string, string>();
  const sheets = await Promise.all(
    nests.map(async (nest) => {
      for (const placement of nest.placements) {
        if (!partById.has(placement.partId)) {
          throw new Error(`Sheet ${nest.id} places unknown part ${placement.partId}.`);
        }
        if (seenPartIds.has(placement.partId)) {
          throw new Error(`Part ${placement.partId} appears on more than one sheet.`);
        }
        seenPartIds.add(placement.partId);
        sheetByPartId.set(placement.partId, nest.id);
      }
      return buildSheetProjection(
        nest.id,
        document.parts,
        nest.placements,
        document.resolvedInputs.machine,
        document.resolvedInputs.processRecipe,
        document.resolvedInputs.fabricationContext,
      );
    }),
  );
  for (const part of document.parts) {
    if (!seenPartIds.has(part.id)) {
      throw new Error(`Part ${part.id} is missing from the multi-sheet projection.`);
    }
  }
  const svgs = await Promise.all(
    sheets.map(async (sheet) => {
      const svg = serializeSheetSvg(sheet);
      return { sheetId: sheet.id, svg, sha256: await svgHash(svg) };
    }),
  );
  const fabrication = FabricationProjectionSchema.parse({
    schemaVersion: "2.0",
    sourceDocumentHash,
    materialProfileId: document.resolvedInputs.material.id,
    machineProfileId: document.resolvedInputs.machine.id,
    sheets,
    svgSha256: await svgHash(svgs.map((item) => item.svg).join("\n")),
    sheetArtifacts: svgs.map((item) => ({
      sheetId: item.sheetId,
      svgSha256: item.sha256,
      partIds: sheets
        .find((sheet) => sheet.id === item.sheetId)!
        .placements.map((placement) => placement.partId)
        .sort()
    }))
  });
  const scene = await buildSceneProjection(document, sourceDocumentHash);
  const bom = await buildBomProjection(document, sourceDocumentHash, sheetByPartId);
  const legend = buildPartsLegendProjection(document.parts, sourceDocumentHash, sheetByPartId);
  const instructions = buildInstructionsProjection(
    document.assemblyPlan,
    sourceDocumentHash,
    sheetByPartId,
    document.cutThroughApplications ?? [],
    document.applicationLimitations ?? [],
  );
  return {
    bundle: ProjectionBundleSchema.parse({
      schemaVersion: "2.0",
      sourceDocumentHash,
      fabrication,
      scene,
      bom,
      legend,
      instructions
    }),
    svg: svgs[0]!.svg,
    svgs
  };
}
