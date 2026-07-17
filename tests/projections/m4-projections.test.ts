import { describe, expect, it } from "vitest";

import {
  buildMultiSheetProjectionBundle,
  canonicalDocumentHash,
  nestPartsAcrossSheets,
  validateFabricationProjection
} from "../../src/index.js";
import { compileM4Fixture } from "../helpers/m4-fixtures.js";

async function projected(name: "sliding-lid-box" | "drawer-in-sleeve") {
  const value = await compileM4Fixture(name);
  const artifacts = await buildMultiSheetProjectionBundle(
    value.document,
    nestPartsAcrossSheets(
      value.document.parts,
      value.profiles.machine,
      value.profiles.material,
      value.profiles.processRecipe,
      value.profiles.fabricationContext,
    ),
  );
  return { ...value, artifacts };
}

describe("M4 linked projections", () => {
  it("projects one canonical prismatic constraint into distinct closed, open, removal, and exploded states", async () => {
    const value = await projected("sliding-lid-box");
    const { bundle } = value.artifacts;
    const sourceHash = await canonicalDocumentHash(value.document);
    expect(new Set([
      sourceHash,
      bundle.sourceDocumentHash,
      bundle.fabrication.sourceDocumentHash,
      bundle.scene.sourceDocumentHash,
      bundle.bom.sourceDocumentHash,
      bundle.legend?.sourceDocumentHash,
      bundle.instructions?.sourceDocumentHash
    ])).toHaveLength(1);
    expect(bundle.scene.states.map((state) => state.kind)).toEqual([
      "assembled",
      "exploded",
      "closed",
      "open",
      "removal"
    ]);
    expect(bundle.scene.motions).toEqual([
      expect.objectContaining({
        kind: "prismatic",
        constraintId: "captured-slide-axis",
        bodyPartIds: ["sliding-cover-panel"],
        rangeMm: { minimum: 0, maximum: 60 },
        removalPositionMm: 82,
        removableRetainerPartIds: ["travel-stop-key"],
        animationSampleMaximumMm: 1
      })
    ]);
    const statePosition = (stateId: string, partId: string) =>
      bundle.scene.states.find((state) => state.id === stateId)!.instances.find(
        (instance) => instance.partId === partId,
      )!.translationMm;
    const closed = statePosition("closed", "sliding-cover-panel");
    const open = statePosition("open", "sliding-cover-panel");
    const removal = statePosition("removal", "sliding-cover-panel");
    expect(closed).not.toEqual(open);
    expect(open).not.toEqual(removal);
    expect(closed.yMm - open.yMm).toBe(60);
    expect(closed.yMm - removal.yMm).toBe(82);
    expect(statePosition("removal", "travel-stop-key")).not.toEqual(
      statePosition("closed", "travel-stop-key"),
    );
  });

  it("projects every cut part exactly once and one removable stop without phantom copies", async () => {
    const value = await projected("drawer-in-sleeve");
    const { bundle } = value.artifacts;
    const partIds = value.document.parts.map((part) => part.id).sort();
    expect(
      bundle.fabrication.sheets.flatMap((sheet) =>
        sheet.placements.map((placement) => placement.partId),
      ).sort(),
    ).toEqual(partIds);
    expect(bundle.scene.meshes.map((mesh) => mesh.partId).sort()).toEqual(partIds);
    expect(bundle.bom.entries.map((entry) => entry.partId).sort()).toEqual(partIds);
    expect(bundle.legend?.entries.map((entry) => entry.partId).sort()).toEqual(partIds);
    expect(bundle.bom.entries.filter((entry) => entry.partId === "travel-stop-key")).toHaveLength(1);
    expect(bundle.scene.meshes.filter((mesh) => mesh.partId === "travel-stop-key")).toHaveLength(1);
    expect(bundle.legend?.entries.filter((entry) => entry.partId === "travel-stop-key")).toHaveLength(1);
    expect(
      bundle.fabrication.sheets.flatMap((sheet) => sheet.placements).filter(
        (placement) => placement.partId === "travel-stop-key",
      ),
    ).toHaveLength(1);
    expect(bundle.instructions?.steps.filter((step) =>
      step.partIds.includes("travel-stop-key"),
    ).map((step) => [step.instructionKey, step.phase])).toEqual([
      ["install-travel-stop-key", "assembly"],
      ["remove-travel-stop-key", "disassembly"]
    ]);
    expect(
      value.document.parts.filter((part) =>
        part.assemblyDependencyPartIds.includes("travel-stop-key"),
      ),
    ).toHaveLength(1);
    expect(validateFabricationProjection(bundle.fabrication, value.document.parts).status).toBe("pass");
  });

  it("keeps nominal geometry separate from compensated manufacturing paths", async () => {
    const value = await projected("sliding-lid-box");
    const panel = value.document.parts.find((part) => part.id === "sliding-cover-panel")!;
    const nominalBefore = structuredClone(panel.nominalRegion);
    const paths = value.artifacts.bundle.fabrication.sheets.flatMap((sheet) =>
      sheet.paths.filter((path) => path.partId === panel.id),
    );
    expect(paths.length).toBeGreaterThan(0);
    expect(panel.nominalRegion).toEqual(nominalBefore);
    expect(value.document.motionConstraints[0]!.prismatic?.runningClearance).toMatchObject({
      projectedFinishedVerticalUm: 600,
      projectedFinishedLateralUm: 600,
      compensationMethod: "nominal-boundary-reconstruction"
    });
  });
});
