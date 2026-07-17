import {
  buildMultiSheetProjectionBundle,
  canonicalDocumentHash,
  canonicalGeometryHash,
  measuredBasswoodProfile,
  nestPartsAcrossSheets,
  provisionalFitProfile,
  xtoolM2Profile
} from "../../src/index.js";
import { compileRetainedPinProgram } from "../../src/operators/retained-pin-revolute.js";
import { createRetainedProgram } from "../../src/ui/content/presets.js";
import { loadM3Fixture } from "./m3-fixtures.js";

export const M3_GOLDEN_CASES = [
  { id: "named-low", fixture: "hinged-lid-box", thicknessMm: 2.5, kerfXmm: 0.05, kerfYmm: 0.06 },
  { id: "named-nominal", fixture: "hinged-lid-box", thicknessMm: 3, kerfXmm: 0.15, kerfYmm: 0.16 },
  { id: "named-high", fixture: "hinged-lid-box", thicknessMm: 3.6, kerfXmm: 0.4, kerfYmm: 0.39 },
  { id: "off-low", fixture: "hinged-flap", thicknessMm: 2.5, kerfXmm: 0.05, kerfYmm: 0.05 },
  { id: "off-nominal", fixture: "hinged-flap", thicknessMm: 3, kerfXmm: 0.15, kerfYmm: 0.16 },
  { id: "off-high", fixture: "hinged-flap", thicknessMm: 3.6, kerfXmm: 0.4, kerfYmm: 0.4 }
] as const;

export async function buildM3GoldenMatrix() {
  const cases = await Promise.all(M3_GOLDEN_CASES.map(async (item) => {
    const fixture = await loadM3Fixture(item.fixture);
    const profiles = {
      material: measuredBasswoodProfile([item.thicknessMm, item.thicknessMm, item.thicknessMm]),
      machine: xtoolM2Profile(item.kerfXmm, item.kerfYmm),
      fit: provisionalFitProfile()
    };
    const program = createRetainedProgram(fixture.content, profiles);
    const compiled = await compileRetainedPinProgram(program, profiles);
    const projected = await buildMultiSheetProjectionBundle(
      compiled.document,
      nestPartsAcrossSheets(compiled.document.parts, profiles.machine, profiles.material),
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
    milestone: "M3" as const,
    cases
  };
}
