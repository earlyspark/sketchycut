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
import { buildRetainedPinGoldenMatrix } from "./retained-pin-golden.js";
import { loadCapturedSlideFixture } from "./combined-motion-fixtures.js";

export const CAPTURED_SLIDE_GOLDEN_CASES = [
  { id: "named-low", fixture: "sliding-lid-box", thicknessMm: 2.5, kerfXmm: 0.05, kerfYmm: 0.06 },
  { id: "named-nominal", fixture: "sliding-lid-box", thicknessMm: 3, kerfXmm: 0.15, kerfYmm: 0.16 },
  { id: "named-high", fixture: "sliding-lid-box", thicknessMm: 3.6, kerfXmm: 0.4, kerfYmm: 0.39 },
  { id: "off-low", fixture: "drawer-in-sleeve", thicknessMm: 2.5, kerfXmm: 0.05, kerfYmm: 0.05 },
  { id: "off-nominal", fixture: "drawer-in-sleeve", thicknessMm: 3, kerfXmm: 0.15, kerfYmm: 0.16 },
  { id: "off-high", fixture: "drawer-in-sleeve", thicknessMm: 3.6, kerfXmm: 0.4, kerfYmm: 0.4 }
] as const;

export async function buildCapturedSlideGoldenMatrix() {
  const cases = await Promise.all(CAPTURED_SLIDE_GOLDEN_CASES.map(async (item) => {
    const fixture = await loadCapturedSlideFixture(item.fixture);
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
    matrixId: "captured-slide-prismatic-current" as const,
    cases
  };
}

export async function buildCombinedMotionGoldenMatrix() {
  const [revolute, prismatic] = await Promise.all([
    buildRetainedPinGoldenMatrix(),
    buildCapturedSlideGoldenMatrix()
  ]);
  return {
    schemaVersion: "1.0" as const,
    matrixId: "combined-motion-current" as const,
    revolute,
    prismatic
  };
}
