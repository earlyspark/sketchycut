import {
  buildMultiSheetProjectionBundle,
  canonicalDocumentHash,
  canonicalGeometryHash,
  measuredBasswoodProfile,
  nestPartsAcrossSheets,
  provisionalFabricationProfiles
} from "../../src/index.js";
import { compileCapturedSlideProgram } from "../../src/operators/captured-panel-slide.js";
import { createCapturedSlideProgram } from "../../src/ui/content/presets.js";
import { buildM3GoldenMatrix } from "./m3-golden.js";
import { loadM4Fixture } from "./m4-fixtures.js";

export const M4_GOLDEN_CASES = [
  { id: "named-low", fixture: "sliding-lid-box", thicknessMm: 2.5, kerfXmm: 0.05, kerfYmm: 0.06 },
  { id: "named-nominal", fixture: "sliding-lid-box", thicknessMm: 3, kerfXmm: 0.15, kerfYmm: 0.16 },
  { id: "named-high", fixture: "sliding-lid-box", thicknessMm: 3.6, kerfXmm: 0.4, kerfYmm: 0.39 },
  { id: "off-low", fixture: "drawer-in-sleeve", thicknessMm: 2.5, kerfXmm: 0.05, kerfYmm: 0.05 },
  { id: "off-nominal", fixture: "drawer-in-sleeve", thicknessMm: 3, kerfXmm: 0.15, kerfYmm: 0.16 },
  { id: "off-high", fixture: "drawer-in-sleeve", thicknessMm: 3.6, kerfXmm: 0.4, kerfYmm: 0.4 }
] as const;

export async function buildM4PrismaticGoldenMatrix() {
  const cases = await Promise.all(M4_GOLDEN_CASES.map(async (item) => {
    const fixture = await loadM4Fixture(item.fixture);
    const profiles = provisionalFabricationProfiles(
      measuredBasswoodProfile([item.thicknessMm, item.thicknessMm, item.thicknessMm]),
      item.kerfXmm,
      item.kerfYmm,
    );
    const program = createCapturedSlideProgram(fixture.content, profiles);
    const compiled = await compileCapturedSlideProgram(program, profiles);
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
      partIds: compiled.document.parts.map((part) => part.id).sort(),
      motion: {
        id: motion.id,
        range: motion.range,
        normalTravelUm: motion.prismatic?.normalTravelUm,
        removalPositionUm: motion.prismatic?.states.removal.positionUm,
        guidePartIds: motion.prismatic?.retention.guidePartIds,
        retainerPartIds: motion.prismatic?.retention.removableRetainerPartIds,
        verticalClearanceUm: motion.prismatic?.runningClearance.projectedFinishedVerticalUm,
        lateralClearanceUm: motion.prismatic?.runningClearance.projectedFinishedLateralUm
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
    milestone: "M4" as const,
    cases
  };
}

export async function buildCombinedMotionGoldenMatrix() {
  const [revolute, prismatic] = await Promise.all([
    buildM3GoldenMatrix(),
    buildM4PrismaticGoldenMatrix()
  ]);
  return {
    schemaVersion: "1.0" as const,
    milestone: "M4-combined-motion" as const,
    revolute,
    prismatic
  };
}
