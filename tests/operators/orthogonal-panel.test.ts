import { describe, expect, it, vi } from "vitest";

import {
  canonicalDocumentHash,
  compileOrthogonalPanelProgram,
  nestPartsAcrossSheets,
  buildMultiSheetProjectionBundle
} from "../../src/index.js";
import { registeredOperatorVersions } from "../../src/operators/registry.js";
import {
  ORTHOGONAL_PANEL_FIXTURE_NAMES,
  compileOrthogonalPanelFixture,
  fixtureProfiles,
  fixtureProgram,
  loadOrthogonalPanelFixture
} from "../helpers/orthogonal-panel-fixtures.js";

describe("orthogonal panel composition", () => {
  it("reports the exact assembled world-axis envelope for the medium Basic geometry", async () => {
    const { document } = await compileOrthogonalPanelFixture("basic-box");
    expect(document.request.envelopeMm).toEqual({ x: 120, y: 90, z: 61 });
  });

  it("realizes every primary wall connection in canonical contours and a compatible assembly action", async () => {
    const { document } = await compileOrthogonalPanelFixture("basic-box");
    expect(document.validation.status).toBe("pass");
    expect(document.validation.findings.map((finding) => finding.code)).toEqual([
      "CALIBRATION_REQUIRED",
      "PHYSICAL_VERIFICATION_REQUIRED"
    ]);
    const walls = document.parts.filter((part) => part.id !== "foundation-panel");
    expect(walls).toHaveLength(4);
    for (const wall of walls) {
      const jointKinds = document.joints
        .filter((joint) => joint.between.some((endpoint) => endpoint.partId === wall.id))
        .map((joint) => joint.kind);
      expect(jointKinds.filter((kind) => kind === "panel-tab-slot")).toHaveLength(1);
      expect(jointKinds.filter((kind) => kind === "finger-mate")).toHaveLength(2);
      expect(wall.nominalRegion.outer.points.length).toBeGreaterThan(20);
      expect(wall.features.filter((feature) => feature.kind === "tab")).toHaveLength(3);
    }
    for (const part of document.parts) {
      const markingNumber = Number.parseInt(part.markingCode!.replaceAll(/\D/g, ""), 10);
      expect(part.features.filter((feature) => feature.kind === "part-label")).toHaveLength(markingNumber);
    }
    for (const joint of document.joints) {
      expect(joint.realization).toBeDefined();
      if (joint.realization?.kind === "tab-slot") {
        expect(joint.realization.openingMinusInsertUm).toBe(joint.nominalClearanceUm);
        expect(joint.realization.insertFeatureIds).toHaveLength(3);
        expect(joint.realization.openingFeatureIds).toHaveLength(3);
      } else if (joint.realization?.kind === "edge-finger") {
        expect(joint.realization.intervals).toHaveLength(7);
        expect(new Set(joint.realization.intervals.map((interval) => interval.occupiedByPartId))).toEqual(
          new Set([joint.realization.firstPartId, joint.realization.secondPartId]),
        );
      }
    }
    const seat = document.assemblyPlan.find((action) => action.id === "seat-panel-frame");
    expect(seat?.direction).toEqual({ x: 0, y: 0, z: -1 });
    expect(seat?.jointIds).toHaveLength(4);
    expect(document.resolvedInputs.hardwarePolicy).toEqual({
      glueAllowed: false,
      permittedKinds: ["sheet-part"]
    });
    expect(document.validation.findings.some((finding) => finding.code.includes("INSERTION_SWEEP"))).toBe(false);
  });

  it("applies a non-zero snug fit to both base slots and wall finger contours", async () => {
    const fixture = await loadOrthogonalPanelFixture("basic-box");
    const baselineProfiles = fixtureProfiles(fixture);
    const baseline = await compileOrthogonalPanelProgram(
      fixtureProgram(fixture, baselineProfiles),
      baselineProfiles,
    );
    const profiles = {
      ...baselineProfiles,
      fit: {
        ...baselineProfiles.fit,
        snug: {
          totalDeltaMm: 0.1,
          confidence: "coupon-selected" as const
        }
      }
    };
    const adjusted = await compileOrthogonalPanelProgram(
      fixtureProgram(fixture, profiles),
      profiles,
    );
    const snugJoints = adjusted.joints.filter((joint) => joint.fitClass === "snug");
    expect(snugJoints.length).toBeGreaterThan(0);
    expect(snugJoints.every((joint) => joint.nominalClearanceUm === 100)).toBe(true);
    const baselineWall = baseline.parts.find((part) => part.id === "rear-panel")!;
    const adjustedWall = adjusted.parts.find((part) => part.id === "rear-panel")!;
    expect(adjustedWall.nominalRegion.outer.points).not.toEqual(
      baselineWall.nominalRegion.outer.points,
    );
    expect(adjusted.validation.status).toBe("pass");
  });

  it("keeps surface treatments procedural, non-cutting, and inside validated safe regions", async () => {
    const { document } = await compileOrthogonalPanelFixture("basic-box");
    for (const part of document.parts) {
      const treatments = part.features.filter((feature) => feature.kind === "treatment");
      for (const treatment of treatments) {
        expect(treatment.operation).toBe("score");
        expect(treatment.path).not.toBeNull();
        expect(treatment.region).toBeNull();
      }
      if (treatments.length > 0) {
        expect(part.features.some((feature) => feature.kind === "safe-treatment-region")).toBe(true);
        expect(part.features.some((feature) => feature.kind === "part-label")).toBe(true);
      }
    }
    expect(document.validation.findings.some((finding) => finding.code.startsWith("TREATMENT_"))).toBe(false);
  });

  it("compiles the named proof and all off-family proofs with one registered operator vocabulary", async () => {
    const registered = registeredOperatorVersions();
    for (const name of ORTHOGONAL_PANEL_FIXTURE_NAMES) {
      const { fixture, document } = await compileOrthogonalPanelFixture(name);
      expect(document.validation.status, name).toBe("pass");
      expect(document.operatorProgram.map((item) => [item.operatorId, item.operatorVersion])).toEqual(
        fixture.operatorProgram.map((item) => [
          item.operatorId,
          registered.get(item.operatorId)
        ]),
      );
      expect(document.provenance.runtimeApplicationApiCalls).toBe(0);
      expect(document.joints.every((joint) => joint.realization !== undefined)).toBe(true);
    }
  });

  it("constructs depth-axis partitions as width-spanning panels without a family branch", async () => {
    const { document } = await compileOrthogonalPanelFixture("depth-divided-organizer");
    expect(document.request.envelopeMm).toEqual({ x: 165, y: 105, z: 51 });
    const dividers = document.parts.filter((part) => part.id.startsWith("divider-"));
    expect(dividers).toHaveLength(2);
    expect(dividers.every((part) => part.assembledFrame.xAxis.x === 1)).toBe(true);
    expect(new Set(dividers.map((part) => part.assembledFrame.origin.yUm)).size).toBe(2);
    expect(dividers.every((part) =>
      document.joints.some((joint) =>
        joint.kind === "panel-tab-slot" &&
        joint.between.some((endpoint) => endpoint.partId === part.id)
      )
    )).toBe(true);
  });

  it("derives the envelope from panel axes after an off-family rigid orientation", async () => {
    const fixture = await loadOrthogonalPanelFixture("basic-box");
    const profiles = fixtureProfiles(fixture);
    const program = fixtureProgram(fixture, profiles);
    const rotateVector = (vector: { x: number; y: number; z: number }) => ({
      x: -vector.z,
      y: vector.x,
      z: -vector.y
    });
    const rotateOrigin = (origin: { xUm: number; yUm: number; zUm: number }) => ({
      xUm: -origin.zUm,
      yUm: origin.xUm,
      zUm: -origin.yUm
    });
    const orientedProgram = {
      ...program,
      panels: program.panels.map((panel) => ({
        ...panel,
        frame: {
          origin: rotateOrigin(panel.frame.origin),
          xAxis: rotateVector(panel.frame.xAxis),
          yAxis: rotateVector(panel.frame.yAxis),
          zAxis: rotateVector(panel.frame.zAxis)
        }
      }))
    };

    const document = await compileOrthogonalPanelProgram(orientedProgram, profiles);
    expect(document.request.envelopeMm).toEqual({ x: 61, y: 120, z: 90 });
  });

  it("does not accept fixture operator versions as compile authority", async () => {
    const fixture = await loadOrthogonalPanelFixture("basic-box");
    fixture.operatorProgram[0]!.operatorVersion = "99.0.0";
    const profiles = fixtureProfiles(fixture);
    const document = await compileOrthogonalPanelProgram(fixtureProgram(fixture, profiles), profiles);
    expect(document.operatorProgram[0]).toMatchObject({
      operatorId: "orthogonal-panel-layout",
      operatorVersion: "1.0.0"
    });
  });

  it("recomputes all linked projections on deterministic thickness and kerf edits without network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const baseline = await compileOrthogonalPanelFixture("basic-box");
    const thicknessEdit = await compileOrthogonalPanelFixture("basic-box", { measuredThicknessMm: 3.3 });
    const kerfEdit = await compileOrthogonalPanelFixture("basic-box", { kerfMm: 0.2 });
    const project = async (value: typeof baseline) => {
      const nests = nestPartsAcrossSheets(
        value.document.parts,
        value.profiles.machine,
        value.profiles.material,
        value.profiles.processRecipe,
        value.profiles.fabricationContext,
      );
      return buildMultiSheetProjectionBundle(value.document, nests);
    };
    const [baselineProjection, thicknessProjection, kerfProjection] = await Promise.all([
      project(baseline),
      project(thicknessEdit),
      project(kerfEdit)
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await canonicalDocumentHash(baseline.document)).not.toBe(
      await canonicalDocumentHash(thicknessEdit.document),
    );
    expect(baseline.document.parts.map((part) => part.thicknessUm)).not.toEqual(
      thicknessEdit.document.parts.map((part) => part.thicknessUm),
    );
    expect(baselineProjection.bundle.scene.meshes).not.toEqual(thicknessProjection.bundle.scene.meshes);
    expect(baselineProjection.bundle.bom.entries.map((entry) => entry.sourcePartHash)).not.toEqual(
      thicknessProjection.bundle.bom.entries.map((entry) => entry.sourcePartHash),
    );
    expect(baseline.document.parts.map((part) => part.nominalRegion)).toEqual(
      kerfEdit.document.parts.map((part) => part.nominalRegion),
    );
    expect(baselineProjection.bundle.fabrication.sheets[0]?.paths).not.toEqual(
      kerfProjection.bundle.fabrication.sheets[0]?.paths,
    );
    fetchSpy.mockRestore();
  });

  it("is deterministic for repeated compiles and projections", async () => {
    const first = await compileOrthogonalPanelFixture("basic-box");
    const second = await compileOrthogonalPanelFixture("basic-box");
    expect(await canonicalDocumentHash(first.document)).toBe(await canonicalDocumentHash(second.document));
    const firstProjection = await buildMultiSheetProjectionBundle(
      first.document,
      nestPartsAcrossSheets(first.document.parts, first.profiles.machine, first.profiles.material, first.profiles.processRecipe, first.profiles.fabricationContext),
    );
    const secondProjection = await buildMultiSheetProjectionBundle(
      second.document,
      nestPartsAcrossSheets(second.document.parts, second.profiles.machine, second.profiles.material, second.profiles.processRecipe, second.profiles.fabricationContext),
    );
    expect(firstProjection.bundle).toEqual(secondProjection.bundle);
    expect(firstProjection.svgs).toEqual(secondProjection.svgs);
  });
});
