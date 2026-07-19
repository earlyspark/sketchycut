import {
  buildMultiSheetProjectionBundle,
  canonicalDocumentHash,
  canonicalGeometryHash,
  measuredBasswoodProfile,
  nestPartsAcrossSheets,
  provisionalFabricationProfiles
} from "../../src/index.js";
import { compileRetainedPinProgram } from "../../src/operators/retained-pin-revolute.js";
import { createRetainedProgram } from "../../src/ui/content/presets.js";
import { loadRetainedPinFixture } from "./retained-pin-fixtures.js";

export const RETAINED_PIN_GOLDEN_CASES = [
  { id: "named-low", fixture: "hinged-lid-box", thicknessMm: 2.5, kerfXmm: 0.05, kerfYmm: 0.06 },
  { id: "named-nominal", fixture: "hinged-lid-box", thicknessMm: 3, kerfXmm: 0.15, kerfYmm: 0.16 },
  { id: "named-high", fixture: "hinged-lid-box", thicknessMm: 3.6, kerfXmm: 0.4, kerfYmm: 0.39 },
  { id: "off-low", fixture: "hinged-flap", thicknessMm: 2.5, kerfXmm: 0.05, kerfYmm: 0.05 },
  { id: "off-nominal", fixture: "hinged-flap", thicknessMm: 3, kerfXmm: 0.15, kerfYmm: 0.16 },
  { id: "off-high", fixture: "hinged-flap", thicknessMm: 3.6, kerfXmm: 0.4, kerfYmm: 0.4 }
] as const;

export async function buildRetainedPinGoldenMatrix() {
  const cases = await Promise.all(RETAINED_PIN_GOLDEN_CASES.map(async (item) => {
    const fixture = await loadRetainedPinFixture(item.fixture);
    const profiles = provisionalFabricationProfiles(
      measuredBasswoodProfile([item.thicknessMm, item.thicknessMm, item.thicknessMm]),
      item.kerfXmm,
      item.kerfYmm,
    );
    const program = createRetainedProgram(fixture.content, profiles);
    const compiled = await compileRetainedPinProgram(program, profiles);
    const projected = await buildMultiSheetProjectionBundle(
      compiled.document,
      nestPartsAcrossSheets(
        compiled.document.parts,
        profiles.machine,
        profiles.material,
        profiles.processRecipe,
        profiles.fabricationContext,
      ),
    );
    const motion = compiled.document.motionConstraints[0]!;
    return {
      ...item,
      projectId: compiled.document.projectId,
      geometryHash: await canonicalGeometryHash(compiled.document),
      documentHash: await canonicalDocumentHash(compiled.document),
      selection: compiled.document.constructionSelections?.[0]?.selectedCandidateId,
      partIds: compiled.document.parts.map((part) => part.id).sort(),
      stock: compiled.document.externalStock?.map((stock) => ({
        id: stock.id,
        measuredDiameterUm: stock.stockProfile.measuredDiameterUm,
        cutLengthUm: stock.cutLengthUm
      })),
      motion: {
        id: motion.id,
        range: motion.range,
        stationCount: motion.revolute?.stations.length,
        boreDiameterUm: motion.revolute?.boreDiameterUm,
        endplayUm: motion.revolute?.axialEndplayUm,
        axisIntervals: motion.revolute?.proofModel.sectionIntervals.length
      },
      proof: compiled.proofReports[0],
      sheetHashes: projected.svgs.map((sheet) => ({
        sheetId: sheet.sheetId,
        sha256: sheet.sha256
      }))
    };
  }));
  return {
    schemaVersion: "1.0" as const,
    matrixId: "retained-pin-revolute-current" as const,
    cases
  };
}
