import { describe, expect, it } from "vitest";

import {
  certifyPrismaticTravel,
  derivePrismaticForbiddenIntervals,
  validateOrthogonalAssembly,
  validateCapturedPanelSlide
} from "../../src/index.js";
import {
  CapturedSlideAssumptionError,
  assessCapturedSlideProgram,
  compileCapturedSlideProgram
} from "../../src/operators/captured-panel-slide.js";
import { registeredOperatorVersions } from "../../src/operators/registry.js";
import {
  CAPTURED_SLIDE_FIXTURE_NAMES,
  compileCapturedSlideFixture,
  loadCapturedSlideFixture,
  capturedSlideFixtureProfiles,
  capturedSlideFixtureProgram
} from "../helpers/combined-motion-fixtures.js";

function transverseSquare(id: string, xUm: number, zUm: number) {
  return {
    outer: {
      id: `${id}-outer`,
      closed: true as const,
      points: [
        { xUm, yUm: zUm },
        { xUm: xUm + 1_000, yUm: zUm },
        { xUm: xUm + 1_000, yUm: zUm + 1_000 },
        { xUm, yUm: zUm + 1_000 }
      ]
    },
    holes: []
  };
}

describe("captured panel prismatic capability", () => {
  it("compiles named and off-family proofs through the same registered operator and proof path", async () => {
    const registered = registeredOperatorVersions();
    for (const name of CAPTURED_SLIDE_FIXTURE_NAMES) {
      const value = await compileCapturedSlideFixture(name);
      expect(value.document.validation.status, name).toBe("pass");
      expect(value.document.validation.findings.map((finding) => finding.code)).toEqual([
        "CALIBRATION_REQUIRED",
        "PHYSICAL_VERIFICATION_REQUIRED"
      ]);
      expect(
        value.document.operatorProgram.map((item) => [item.operatorId, item.operatorVersion]),
      ).toEqual(
        value.fixture.operatorProgram.map((item) => [
          item.operatorId,
          registered.get(item.operatorId)
        ]),
      );
      expect(value.proofReports).toHaveLength(1);
      expect(value.proofReports[0]).toMatchObject({
        method: "transverse-overlap-axial-forbidden-intervals",
        status: "pass",
        overlappingTransversePairCount: 2,
        animationSampleMaximumUm: 1_000,
        normalTravelConflicts: [],
        canonicalIntervalsMatch: true
      });
      expect(value.proofReports[0]!.endpointContacts).toEqual([
        expect.objectContaining({ id: "closed-wall-contact", positionUm: 0, status: "certified" }),
        expect.objectContaining({ id: "open-key-contact", status: "certified" })
      ]);
      expect(value.document.provenance.runtimeApplicationApiCalls).toBe(0);
    }
  });

  it("records one translational degree of freedom, full capture, exact stops, and distinct removal", async () => {
    const { document, proofReports } = await compileCapturedSlideFixture("sliding-lid-box");
    expect(document.motionConstraints).toHaveLength(1);
    const constraint = document.motionConstraints[0]!;
    expect(constraint).toMatchObject({
      kind: "prismatic",
      bodyPartIds: ["sliding-cover-panel"],
      axis: { direction: { x: 0, y: -1, z: 0 } },
      range: { minimum: 0, maximum: 60, unit: "mm" },
      prismatic: {
        normalTravelUm: { minimum: 0, maximum: 60_000 },
        states: {
          closedUm: 0,
          fullyOpenUm: 60_000,
          removal: {
            positionUm: 82_000,
            requiresRetainerRemoval: true,
            retainerPartIds: ["travel-stop-key"]
          }
        },
        runningClearance: {
          verticalTotalUm: 600,
          lateralTotalUm: 600,
          projectedFinishedVerticalUm: 600,
          projectedFinishedLateralUm: 600,
          compensationMethod: "nominal-boundary-reconstruction"
        },
        retention: {
          guidePartIds: ["left-guide", "right-guide"],
          removableRetainerPartIds: ["travel-stop-key"],
          method: "through-tabbed-upper-guides-and-keyed-stop",
          glueRequired: false
        }
      }
    });
    const details = constraint.prismatic!;
    expect(details.capture.vertical.lowerClearanceUm).toBeGreaterThan(0);
    expect(details.capture.vertical.upperClearanceUm).toBeGreaterThan(0);
    expect(details.capture.vertical.retainerOverlapUm).toBeGreaterThan(0);
    expect(details.capture.lateral.leftClearanceUm).toBeGreaterThan(0);
    expect(details.capture.lateral.rightClearanceUm).toBeGreaterThan(0);
    expect(details.capture.lateral.guideOverlapUm).toBeGreaterThan(0);
    expect(details.capture.lowerBearing).toMatchObject({
      supportPartIds: ["left-lower-rail", "right-lower-rail"],
      minimumTransverseOverlapUm: 4_200
    });
    expect(details.capture.lowerBearing.bearings.map((bearing) => ({
      partId: bearing.supportPartId,
      overlapUm: bearing.transverseOverlapUm,
      minimumAxialUm: bearing.minimumRequiredAxialEngagementUm
    }))).toEqual([
      { partId: "left-lower-rail", overlapUm: 4_200, minimumAxialUm: 18_000 },
      { partId: "right-lower-rail", overlapUm: 4_200, minimumAxialUm: 18_000 }
    ]);
    expect(details.capture.lateral).toMatchObject({
      panelMinimumXUm: 6_300,
      panelMaximumXUm: 113_700,
      leftGuideInnerXUm: 6_000,
      rightGuideInnerXUm: 114_000
    });
    expect(details.capture.railEngagement).toHaveLength(2);
    expect(details.capture.railEngagement.every((item) => item.minimumRequiredUm === 18_000)).toBe(true);
    expect(proofReports[0]!.forbiddenIntervals).toEqual([
      {
        id: "moving-panel-body-proof-vs-closed-wall-stop-proof-forbidden",
        movingPrimitiveId: "moving-panel-body-proof",
        stationaryPrimitiveId: "closed-wall-stop-proof",
        minimumExclusiveUm: -81_000,
        maximumExclusiveUm: 0
      },
      {
        id: "moving-open-stop-lug-proof-vs-open-key-stop-proof-forbidden",
        movingPrimitiveId: "moving-open-stop-lug-proof",
        stationaryPrimitiveId: "open-key-stop-proof",
        minimumExclusiveUm: 60_000,
        maximumExclusiveUm: 66_000
      }
    ]);
  });

  it("rejects a virtual lower support that does not bear under the moving panel", async () => {
    const { document } = await compileCapturedSlideFixture("sliding-lid-box");
    const mutated = structuredClone(document);
    const bearing = mutated.motionConstraints[0]!.prismatic!.capture.lowerBearing.bearings[0]!;
    bearing.supportMinimumXUm = 0;
    bearing.supportMaximumXUm = 3_000;
    bearing.transverseOverlapUm = 1;
    expect(validateCapturedPanelSlide(mutated).validation.findings.map((item) => item.code)).toContain(
      "PRISMATIC_LOWER_BEARING_INVALID",
    );
  });

  it("applies non-zero snug clearance to every physical insertion and does not mislabel the contact stop", async () => {
    const fixture = await loadCapturedSlideFixture("sliding-lid-box");
    const baselineProfiles = capturedSlideFixtureProfiles(fixture);
    const profiles = {
      ...baselineProfiles,
      fit: {
        ...baselineProfiles.fit,
        snug: {
          totalDeltaMm: 0.15,
          confidence: "coupon-selected" as const
        }
      }
    };
    const result = await compileCapturedSlideProgram(
      capturedSlideFixtureProgram(fixture, profiles),
      profiles,
    );
    const snugJoints = result.document.joints.filter((joint) => joint.fitClass === "snug");
    expect(snugJoints.length).toBeGreaterThan(0);
    expect(snugJoints.every((joint) => joint.nominalClearanceUm === 150)).toBe(true);
    const guideSlots = result.document.parts.flatMap((part) => part.features).filter(
      (feature) => feature.id.includes("guide-slot") && feature.kind === "slot",
    );
    expect(guideSlots).toHaveLength(4);
    expect(guideSlots.every((feature) => feature.parametersUm.opening === 3_150)).toBe(true);
    expect(guideSlots.every((feature) => feature.parametersUm.span === 6_150)).toBe(true);
    const lowerRailSlots = result.document.parts.flatMap((part) => part.features).filter(
      (feature) => feature.id.includes("lower-rail-slot") && feature.kind === "slot",
    );
    expect(lowerRailSlots).toHaveLength(4);
    expect(lowerRailSlots.every((feature) => feature.parametersUm.opening === 3_150)).toBe(true);
    expect(lowerRailSlots.every((feature) => feature.parametersUm.span === 6_150)).toBe(true);
    const guideMounts = result.document.parts
      .filter((part) => part.id === "left-guide" || part.id === "right-guide")
      .flatMap((part) => part.features)
      .filter((feature) => feature.id.includes("-mount-"));
    expect(guideMounts).toHaveLength(4);
    expect(guideMounts.every((feature) => feature.parametersUm.throughTab === 1)).toBe(true);
    expect(guideMounts.every((feature) => feature.parametersUm.headedTab === undefined)).toBe(true);
    const dimensions = (feature: (typeof guideMounts)[number]) => {
      const points = feature.region?.outer.points ?? [];
      return [
        Math.max(...points.map((point) => point.xUm)) -
          Math.min(...points.map((point) => point.xUm)),
        Math.max(...points.map((point) => point.yUm)) -
          Math.min(...points.map((point) => point.yUm))
      ].sort((left, right) => left - right);
    };
    expect(guideMounts.map(dimensions)).toEqual(Array.from({ length: 4 }, () => [3_000, 6_000]));
    expect(guideSlots.map(dimensions)).toEqual(Array.from({ length: 4 }, () => [3_150, 6_150]));
    expect(result.document.joints.find((joint) => joint.id === "travel-stop-key-joint")).toMatchObject({
      fitClass: "snug",
      nominalClearanceUm: 150,
      between: [
        { partId: "travel-stop-key", featureId: "travel-stop-key-seat" },
        { partId: "left-guide", featureId: "left-guide-stop-key-slot" }
      ]
    });
    expect(result.document.parts.find((part) => part.id === "left-guide")?.features).toContainEqual(
      expect.objectContaining({
        id: "left-guide-stop-key-slot",
        kind: "slot",
        parametersUm: { opening: 3_150, span: 3_150 }
      }),
    );
    const realizedRailAndStopJoints = result.document.joints.filter((joint) =>
      joint.id.includes("-guide-mount-") ||
      joint.id.includes("-lower-rail-mount-") ||
      joint.id === "travel-stop-key-joint"
    );
    expect(realizedRailAndStopJoints).toHaveLength(9);
    expect(realizedRailAndStopJoints.every((joint) =>
      joint.realization?.kind === "tab-slot" &&
      joint.realization.secondaryOpeningMinusInsertUm === 150 &&
      joint.realization.insertBodySeatPointWorldUm !== undefined
    )).toBe(true);
    expect(result.document.validation.status).toBe("pass");
  });

  it("rejects a rail or stop mate whose realized body seat drifts off its opening surface", async () => {
    const { document } = await compileCapturedSlideFixture("sliding-lid-box");
    const mutated = structuredClone(document);
    const joint = mutated.joints.find((candidate) => candidate.id === "travel-stop-key-joint")!;
    if (joint.realization?.kind !== "tab-slot") throw new Error("expected realized key joint");
    joint.realization.insertBodySeatPointWorldUm!.zUm += 500;
    expect(validateOrthogonalAssembly(mutated).findings.map((item) => item.code)).toContain(
      "INSERTION_SWEEP_COLLISION",
    );
  });

  it("compiles a compact rail-channel coupon through the same operator without a product branch", async () => {
    const fixture = await loadCapturedSlideFixture("drawer-in-sleeve");
    fixture.content = {
      ...fixture.content,
      programId: "compact-rail-channel-coupon",
      projectId: "compact-rail-channel-coupon",
      title: "Compact rail-channel coupon",
      support: {
        ...fixture.content.support,
        programId: "compact-rail-channel-support",
        projectId: "compact-rail-channel-support",
        dimensions: { widthMm: 54, depthMm: 48, heightMm: 24 }
      },
      minimumGuideEngagementMm: 12,
      thumbAccessWidthMm: 14,
      thumbAccessDepthMm: 6
    };
    const baselineProfiles = capturedSlideFixtureProfiles(fixture);
    const profiles = {
      ...baselineProfiles,
      fit: {
        ...baselineProfiles.fit,
        snug: { totalDeltaMm: 0.15, confidence: "coupon-selected" as const }
      }
    };
    const result = await compileCapturedSlideProgram(
      capturedSlideFixtureProgram(fixture, profiles),
      profiles,
    );
    expect(result.document.validation.status).toBe("pass");
    expect(result.document.parts.map((part) => part.id)).toEqual(expect.arrayContaining([
      "left-lower-rail",
      "right-lower-rail",
      "left-guide",
      "right-guide",
      "drawer-platform",
      "travel-stop-key"
    ]));
    expect(result.document.motionConstraints[0]!.prismatic!.capture.lowerBearing.bearings)
      .toHaveLength(2);
  });

  it("detects a sub-millimetre obstruction interval missed by endpoints and 1 mm samples", async () => {
    const { document } = await compileCapturedSlideFixture("sliding-lid-box");
    const constraint = structuredClone(document.motionConstraints[0]!);
    constraint.prismatic!.proofModel.movingPrimitives.push({
      id: "seeded-narrow-moving-probe",
      ownerId: "sliding-cover-panel",
      featureId: null,
      behavior: "moving",
      axialStartUm: 0,
      axialEndUm: 100,
      transverseRegion: transverseSquare("seeded-narrow-moving-probe", 50_000, 70_000)
    });
    constraint.prismatic!.proofModel.stationaryPrimitives.push({
      id: "seeded-narrow-obstruction",
      ownerId: "rear-panel",
      featureId: null,
      behavior: "stationary",
      axialStartUm: 20_350,
      axialEndUm: 20_750,
      transverseRegion: transverseSquare("seeded-narrow-obstruction", 50_000, 70_000)
    });
    constraint.prismatic!.proofModel.forbiddenIntervals =
      derivePrismaticForbiddenIntervals(constraint);
    const seeded = constraint.prismatic!.proofModel.forbiddenIntervals.find(
      (interval) => interval.stationaryPrimitiveId === "seeded-narrow-obstruction",
    )!;
    expect(seeded.maximumExclusiveUm - seeded.minimumExclusiveUm).toBe(500);
    expect([0, 60_000].some(
      (sample) => sample > seeded.minimumExclusiveUm && sample < seeded.maximumExclusiveUm,
    )).toBe(false);
    expect(
      Array.from({ length: 61 }, (_, index) => index * 1_000).some(
        (sample) => sample > seeded.minimumExclusiveUm && sample < seeded.maximumExclusiveUm,
      ),
    ).toBe(false);
    const report = certifyPrismaticTravel(constraint);
    expect(report.normalTravelConflicts).toContainEqual(seeded);
    const mutated = {
      ...document,
      motionConstraints: [constraint]
    };
    expect(validateCapturedPanelSlide(mutated).validation.findings.map((item) => item.code)).toContain(
      "PRISMATIC_TRAVEL_COLLISION",
    );
  });

  it("projects one mechanically retained removable stop through canonical dependencies and actions", async () => {
    const { document } = await compileCapturedSlideFixture("sliding-lid-box");
    const retainers = document.parts.filter((part) => part.id === "travel-stop-key");
    expect(retainers).toHaveLength(1);
    expect(document.parts.filter((part) =>
      part.assemblyDependencyPartIds.includes("travel-stop-key"),
    )).toHaveLength(1);
    expect(document.resolvedInputs.hardwarePolicy.glueAllowed).toBe(false);
    expect(document.assemblyPlan.filter((action) =>
      action.action === "insert" && action.partIds.includes("travel-stop-key"),
    )).toHaveLength(1);
    expect(document.assemblyPlan.filter((action) =>
      action.action === "remove" && action.partIds.includes("travel-stop-key"),
    )).toHaveLength(1);
    expect(document.assemblyPlan.find((action) => action.id === "withdraw-captured-panel")).toMatchObject({
      action: "remove",
      phase: "disassembly",
      dependsOnActionIds: ["remove-travel-stop-key"]
    });
  });

  it("returns concept-only for an unsupported axis without a sampled-motion fallback", async () => {
    const fixture = await loadCapturedSlideFixture("sliding-lid-box");
    const profiles = capturedSlideFixtureProfiles(fixture);
    const invalid = structuredClone(capturedSlideFixtureProgram(fixture, profiles));
    invalid.mechanism.axis.direction = { x: 1, y: 0, z: 0 };
    expect(assessCapturedSlideProgram(invalid)).toMatchObject({
      status: "concept-only",
      code: "PRISMATIC_ASSUMPTION_UNSUPPORTED"
    });
    expect(() => {
      const result = assessCapturedSlideProgram(invalid);
      if (result.status === "concept-only") throw new CapturedSlideAssumptionError();
    }).toThrow(CapturedSlideAssumptionError);
  });
});
