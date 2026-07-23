import { describe, expect, it } from "vitest";

import type {
  CutThroughTreatmentRequest,
  DesignDocumentV1,
  OrthogonalPanelProgramV1
} from "../../src/domain/contracts.js";
import {
  createPublicFabricationSetup,
  resolveFabricationSetup
} from "../../src/domain/fabrication-setup.js";
import { canonicalGeometryHash } from "../../src/compiler/canonical.js";
import {
  approximateCircularContour,
  measuredCircularChordErrorUm,
  REGISTERED_ARC_POLYGON_POLICY
} from "../../src/kernel/geometry/arc-polygon.js";
import { compileOrthogonalPanelProgram } from "../../src/operators/orthogonal-compiler.js";
import { createPanelProgram } from "../../src/operators/orthogonal-program-builders.js";
import { registeredOperatorVersions } from "../../src/operators/registry.js";
import { buildMultiSheetProjectionBundle } from "../../src/projections/bundle.js";
import { renderSceneSvg } from "../../src/projections/mesh/render-svg.js";
import { nestPartsAcrossSheets } from "../../src/projections/fabrication/nesting.js";
import { buildFabricationEvidenceProjection } from "../../src/projections/evidence.js";
import { buildXToolStudioHandoff } from "../../src/projections/handoff.js";
import { validateCutThroughApplications } from "../../src/validation/cut-through.js";

type PatternFamily = CutThroughTreatmentRequest["patternFamily"];

const setup = resolveFabricationSetup(createPublicFabricationSetup());
const profiles = {
  material: setup.material,
  machine: setup.machine,
  processRecipe: setup.processRecipe,
  fabricationContext: setup.fabricationContext,
  fit: setup.fit
};

function baseProgram(id: string): OrthogonalPanelProgramV1 {
  return createPanelProgram({
    programId: `${id}-program`,
    projectId: id,
    title: "Registered cut-through proof",
    description: "A fixed-top proof composed only from registered deterministic operators.",
    dimensions: { widthMm: 120, depthMm: 90, heightMm: 70 },
    includeFront: true,
    dividerCount: 0,
    dividerAxis: "width",
    treatmentPrimitive: null,
    fixedTop: true
  }, profiles);
}

function treatment(
  family: PatternFamily,
  density: CutThroughTreatmentRequest["density"] = "sparse",
): CutThroughTreatmentRequest {
  const cover = family === "ring-aperture";
  return {
    applicationId: `${family}-application`,
    patternFamily: family,
    purpose: cover ? "access" : "ornament",
    density,
    requestedDensity: density,
    symmetryOrder: family === "radial-rosette" ? 8 : 2,
    edgeMarginUm: 9_000,
    bridgeWidthUm: 3_000,
    targetPartIds: [cover ? "cover-panel" : "front-panel"],
    repeatedGroupId: null,
    sourceRequirementIds: [`${family}-requirement`]
  };
}

async function compileFamily(
  family: PatternFamily,
  density: CutThroughTreatmentRequest["density"] = "sparse",
) {
  const base = baseProgram(`proof-${family}-${density}`);
  return compileOrthogonalPanelProgram({
    ...base,
    cutThroughTreatments: [treatment(family, density)]
  }, profiles);
}

describe("registered cut-through treatment", () => {
  it("approximates circles at the fixed post-rounding chord-error tolerance", () => {
    for (const radiusUm of [900, 1_000, 4_000, 25_000]) {
      const contour = approximateCircularContour({
        id: `circle-${String(radiusUm)}`,
        center: { xUm: 50_000, yUm: 40_000 },
        radiusUm,
        orientation: "cw"
      });
      expect(contour.closed).toBe(true);
      expect(new Set(contour.points.map((point) => `${String(point.xUm)}:${String(point.yUm)}`)).size)
        .toBe(contour.points.length);
      expect(measuredCircularChordErrorUm(contour, { xUm: 50_000, yUm: 40_000 }, radiusUm))
        .toBeLessThanOrEqual(REGISTERED_ARC_POLYGON_POLICY.chordToleranceUm);
    }
  });

  it("compiles every registered family deterministically with canonical hole/feature links", async () => {
    for (const family of ["lattice-grid", "radial-rosette", "circle-field", "ring-aperture"] as const) {
      const [first, replay] = await Promise.all([compileFamily(family), compileFamily(family)]);
      expect(first.validation.status, family).toBe("pass");
      expect(await canonicalGeometryHash(first)).toBe(await canonicalGeometryHash(replay));
      const application = first.cutThroughApplications?.[0];
      expect(application).toMatchObject({
        patternFamily: family,
        arcPolicyId: REGISTERED_ARC_POLYGON_POLICY.id,
        arcPolicyVersion: REGISTERED_ARC_POLYGON_POLICY.version,
        arcChordToleranceUm: REGISTERED_ARC_POLYGON_POLICY.chordToleranceUm,
        simplificationDisclosure: null
      });
      const features = first.parts.flatMap((part) => part.features).filter((feature) =>
        application?.featureIds.includes(feature.id)
      );
      expect(features).toHaveLength(application?.featureIds.length ?? 0);
      for (const feature of features) {
        const owner = first.parts.find((part) => part.features.some((candidate) => candidate.id === feature.id))!;
        expect(owner.nominalRegion.holes).toContainEqual(feature.region?.outer);
        expect(feature.operation).toBe("cut");
      }
    }
  });

  it("keeps the dense eightfold rosette web-valid after integer rounding", async () => {
    const document = await compileFamily("radial-rosette", "dense");
    expect(document.validation.status).toBe("pass");
    expect(document.cutThroughApplications?.[0]?.featureIds).toHaveLength(24);
  });

  it("projects one fixed-aperture enclosure source across SVG, mesh, BOM, legend, and instructions", async () => {
    const base = baseProgram("fixed-aperture-enclosure-proof");
    const document = await compileOrthogonalPanelProgram({
      ...base,
      cutThroughTreatments: [
        treatment("ring-aperture"),
        {
          ...treatment("lattice-grid", "sparse"),
          applicationId: "wall-lattice-application",
          purpose: "illumination-ventilation",
          targetPartIds: ["front-panel", "rear-panel", "left-panel", "right-panel"],
          repeatedGroupId: "wall-lattice-group",
          sourceRequirementIds: ["wall-lattice-requirement"]
        }
      ],
      applicationLimitations: [{
        code: "CUT_THROUGH_APPLICATION_DISCLOSURE",
        message: "This cut-through application remains software-validated and requires physical verification.",
        relatedIds: ["ring-aperture-application", "wall-lattice-application"]
      }]
    }, profiles);
    const artifacts = await buildMultiSheetProjectionBundle(
      document,
      nestPartsAcrossSheets(
        document.parts,
        profiles.machine,
        profiles.material,
        profiles.processRecipe,
        profiles.fabricationContext,
      ),
    );
    const featureIds = new Set(document.cutThroughApplications?.flatMap((item) => item.featureIds));
    const fabricationPaths = artifacts.bundle.fabrication.sheets.flatMap((sheet) => sheet.paths)
      .filter((path) => path.featureId !== null && featureIds.has(path.featureId));
    expect(fabricationPaths).toHaveLength(featureIds.size);
    expect(artifacts.bundle.scene.motions).toBeUndefined();
    expect(artifacts.bundle.scene.states.map((state) => state.kind)).toEqual(["assembled", "exploded"]);
    expect(artifacts.bundle.scene.meshes).toHaveLength(document.parts.length);
    const assembledSvg = renderSceneSvg(artifacts.bundle.scene, "assembled", 900, 640, "isometric");
    const averagePartY = (partId: string): number => {
      const polygons = [...assembledSvg.matchAll(new RegExp(
        `<polygon[^>]+data-part-id="${partId}"[^>]+points="([^"]+)"`,
        "g",
      ))];
      const values = polygons.flatMap((match) => match[1]!.split(" ").map((point) => Number(point.split(",")[1])));
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    expect(averagePartY("cover-panel")).toBeLessThan(averagePartY("foundation-panel"));
    expect(artifacts.bundle.bom.entries.filter((entry) => entry.cutThroughFeatureIds !== undefined)).toHaveLength(5);
    expect(artifacts.bundle.legend?.entries.filter((entry) => entry.cutThroughFeatureIds !== undefined)).toHaveLength(5);
    expect(artifacts.bundle.instructions?.steps.some((step) =>
      step.cutThroughFeatureIds !== undefined && step.limitationCodes?.includes("CUT_THROUGH_APPLICATION_DISCLOSURE") === true
    )).toBe(true);
    const evidence = await buildFabricationEvidenceProjection(document);
    expect(evidence.cutThroughApplications).toHaveLength(2);
    expect(evidence.applicationLimitations.map((item) => item.code)).toEqual(["CUT_THROUGH_APPLICATION_DISCLOSURE"]);
    const handoff = await buildXToolStudioHandoff(
      profiles.machine,
      { fabrication: artifacts.bundle.fabrication, svgs: artifacts.svgs },
      { fabrication: artifacts.bundle.fabrication, svgs: artifacts.svgs },
      0,
      document,
    );
    expect(handoff.cutThroughApplications).toHaveLength(2);
    expect(handoff.applicationLimitations.map((item) => item.code)).toEqual(["CUT_THROUGH_APPLICATION_DISCLOSURE"]);
    expect(handoff.processingPreview.interiorCutsBeforeReleasedOuterContours).toBe(true);
    for (const svg of artifacts.svgs) {
      for (const partId of new Set(fabricationPaths.map((path) => path.partId))) {
        const partPaths = artifacts.bundle.fabrication.sheets.flatMap((sheet) => sheet.paths)
          .filter((path) => path.partId === partId && path.operation === "cut");
        const outer = partPaths.find((path) => path.cuttingOrder === 100)!;
        const internal = partPaths.filter((path) => path.featureId !== null && featureIds.has(path.featureId));
        expect(internal.every((path) => svg.svg.indexOf(`id="${path.id}"`) < svg.svg.indexOf(`id="${outer.id}"`)))
          .toBe(true);
      }
    }
    expect(document.operatorProgram.map((item) => item.operatorId)).toEqual(expect.arrayContaining([
      "fixed-top-frame",
      "cut-through-treatment"
    ]));
    expect(registeredOperatorVersions().get("cut-through-treatment")).toBe("1.0.0");
  });

  it("emits stable blocking findings for altered policy and broken application linkage", async () => {
    const document = await compileFamily("circle-field");
    const application = document.cutThroughApplications![0]!;
    const bridgeViolation = {
      ...document,
      cutThroughApplications: [{ ...application, bridgeWidthUm: 100 }]
    } as DesignDocumentV1;
    expect(validateCutThroughApplications(bridgeViolation).findings.map((item) => item.code))
      .toContain("CUT_THROUGH_BRIDGE_POLICY_VIOLATION");

    const missingApplication = { ...document, cutThroughApplications: [] } as DesignDocumentV1;
    expect(validateCutThroughApplications(missingApplication).findings.map((item) => item.code))
      .toContain("CUT_THROUGH_APPLICATION_MISSING");

    const mismatchedApplication = {
      ...document,
      cutThroughApplications: [{ ...application, targetPartIds: ["rear-panel"] }]
    } as DesignDocumentV1;
    expect(validateCutThroughApplications(mismatchedApplication).findings.map((item) => item.code))
      .toContain("CUT_THROUGH_APPLICATION_LINK_MISMATCH");
  });
});
