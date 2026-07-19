import { describe, expect, it } from "vitest";

import {
  certifyPrismaticTravel,
  derivePrismaticForbiddenIntervals,
  validateCapturedPanelSlide
} from "../../src/index.js";
import {
  CapturedSlideAssumptionError,
  assessCapturedSlideProgram
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
          method: "headed-tabs-and-keyed-stop",
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
