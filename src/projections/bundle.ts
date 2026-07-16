import {
  FabricationProjectionSchema,
  ProjectionBundleSchema,
  type DesignDocumentV1,
  type ProjectionBundle,
  type SheetPlacement
} from "../domain/contracts.js";
import { canonicalDocumentHash } from "../compiler/canonical.js";
import { buildBomProjection } from "./bom.js";
import { buildSheetProjection } from "./fabrication/sheet.js";
import { serializeSheetSvg, svgHash } from "./fabrication/svg.js";
import { buildSceneProjection } from "./mesh/scene.js";

export type ProjectionArtifacts = {
  bundle: ProjectionBundle;
  svg: string;
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
  );
  const svg = serializeSheetSvg(sheet);
  const fabrication = FabricationProjectionSchema.parse({
    schemaVersion: "1.0",
    sourceDocumentHash,
    materialProfileId: document.resolvedInputs.material.id,
    machineProfileId: document.resolvedInputs.machine.id,
    sheets: [sheet],
    svgSha256: await svgHash(svg)
  });
  const scene = await buildSceneProjection(document.parts, sourceDocumentHash);
  const bom = await buildBomProjection(document.parts, sourceDocumentHash);
  return {
    bundle: ProjectionBundleSchema.parse({
      schemaVersion: "1.0",
      sourceDocumentHash,
      fabrication,
      scene,
      bom
    }),
    svg
  };
}
