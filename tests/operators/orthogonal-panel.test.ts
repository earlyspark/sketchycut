import { describe, expect, it, vi } from "vitest";

import {
  canonicalDocumentHash,
  compileOrthogonalPanelProgram,
  nestPartsAcrossSheets,
  buildMultiSheetProjectionBundle
} from "../../src/index.js";
import { registeredOperatorVersions } from "../../src/operators/registry.js";
import {
  M2_FIXTURE_NAMES,
  compileM2Fixture,
  fixtureProfiles,
  fixtureProgram,
  loadM2Fixture
} from "../helpers/m2-fixtures.js";

describe("orthogonal panel composition", () => {
  it("realizes every primary wall connection in canonical contours and a compatible assembly action", async () => {
    const { document } = await compileM2Fixture("basic-box");
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

  it("keeps surface treatments procedural, non-cutting, and inside validated safe regions", async () => {
    const { document } = await compileM2Fixture("basic-box");
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
    for (const name of M2_FIXTURE_NAMES) {
      const { fixture, document } = await compileM2Fixture(name);
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

  it("does not accept fixture operator versions as compile authority", async () => {
    const fixture = await loadM2Fixture("basic-box");
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
    const baseline = await compileM2Fixture("basic-box");
    const thicknessEdit = await compileM2Fixture("basic-box", { measuredThicknessMm: 3.3 });
    const kerfEdit = await compileM2Fixture("basic-box", { kerfMm: 0.2 });
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
    const first = await compileM2Fixture("basic-box");
    const second = await compileM2Fixture("basic-box");
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
