import { describe, expect, it, vi } from "vitest";

import {
  canonicalGeometryHash,
  certifyRevoluteTravel,
  validateRetainedPinMechanism
} from "../../src/index.js";
import {
  RetainedPinAssumptionError,
  RetainedPinConstructionError,
  assessRetainedPinProgram,
  compileRetainedPinProgram
} from "../../src/operators/retained-pin-revolute.js";
import { registeredOperatorVersions } from "../../src/operators/registry.js";
import {
  RETAINED_PIN_FIXTURE_NAMES,
  compileRetainedPinFixture,
  loadRetainedPinFixture,
  retainedPinFixtureProfiles,
  retainedPinFixtureProgram
} from "../helpers/retained-pin-fixtures.js";

describe("retained pin revolute capability", () => {
  it("compiles named and off-family proofs through the same registered operator and proof path", async () => {
    const registered = registeredOperatorVersions();
    for (const name of RETAINED_PIN_FIXTURE_NAMES) {
      const value = await compileRetainedPinFixture(name);
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
        method: "axis-partition-conservative-angle-interval",
        rotationSign: -1,
        status: "pass",
        collisions: [],
        indeterminatePairs: [],
        animationSampleMaximumDegrees: 2
      });
      expect(value.proofReports[0]!.endpointContacts).toEqual([
        expect.objectContaining({ angleDegrees: 0, nominalGapUm: 0, status: "certified" }),
        expect.objectContaining({
          id: "open-stop-brace-contact",
          nominalGapUm: 0,
          status: "certified"
        }),
        expect.objectContaining({ angleDegrees: 0, nominalGapUm: 0, status: "certified" })
      ]);
      expect(value.proofReports[0]!.axisIntervalCount).toBeGreaterThanOrEqual(15);
      expect(value.proofReports[0]!.maximumRecursionDepth).toBeLessThanOrEqual(8);
      expect(value.document.provenance.runtimeApplicationApiCalls).toBe(0);
    }
  });

  it("records one measured external pin, one rotational degree of freedom, coaxial stations, stops, retention, and disassembly", async () => {
    const { document } = await compileRetainedPinFixture("hinged-lid-box");
    expect(document.motionConstraints).toHaveLength(1);
    const motion = document.motionConstraints[0]!;
    expect(motion.kind).toBe("revolute");
    expect(motion.revolute?.rotationSign).toBe(-1);
    expect(motion.range).toEqual({ minimum: 0, maximum: 105, unit: "degree" });
    expect(motion.revolute?.stations).toHaveLength(5);
    expect(new Set(motion.revolute?.stations.map((station) => station.boreDiameterUm))).toEqual(
      new Set([3_200]),
    );
    expect(motion.revolute?.totalDiametralClearanceUm).toBe(200);
    expect(motion.revolute?.stations.every((station) => station.boreLigamentUm >= 1_500)).toBe(true);
    expect(motion.revolute?.stops).toMatchObject({
      closed: { angleDegrees: 0, contactGapUm: 0 },
      open: { angleDegrees: 105, contactGapUm: 0 }
    });
    expect(motion.revolute?.proofModel.sectionPrimitives.map((primitive) => primitive.ownerId)).toEqual(
      expect.arrayContaining([
        "pin-guard-negative",
        "pin-guard-positive",
        "open-stop-brace",
        "left-panel",
        "right-panel"
      ]),
    );
    for (const stop of [
      ...motion.revolute!.stops.closed.fixedPartIds.map((partId, index) => ({
        partId,
        featureId: motion.revolute!.stops.closed.fixedFeatureIds[index]!
      })),
      {
        partId: motion.revolute!.stops.open.fixedPartId,
        featureId: motion.revolute!.stops.open.fixedFeatureId
      }
    ]) {
      expect(
        document.parts.find((part) => part.id === stop.partId)?.features.find(
          (feature) => feature.id === stop.featureId,
        )?.kind,
      ).toBe("stop-face");
    }
    const movingPanel = document.parts.find((part) => part.id === "cover-panel")!;
    expect(movingPanel.assembledFrame).toMatchObject({
      origin: { xUm: 0, yUm: 90_000, zUm: 64_000 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: -1, z: 0 },
      zAxis: { x: 0, y: 0, z: -1 }
    });
    const stock = document.externalStock?.[0];
    expect(stock).toMatchObject({
      id: "measured-hinge-pin",
      kind: "wooden-dowel",
      quantity: 1,
      cutLengthUm: 85_200,
      evidenceState: "user-reported",
      stockProfile: {
        nominalDiameterUm: 3_000,
        measuredDiameterUm: 3_000,
        measuredMinimumDiameterUm: 2_990,
        measuredMaximumDiameterUm: 3_010,
        measurementResolutionUm: 10,
        straightnessEvidence: "unverified"
      },
      retention: {
        method: "opposed-sheet-guards",
        axialEndplayUm: 600,
        installationClearanceUm: 12_000
      }
    });
    expect(
      document.assemblyPlan.some(
        (action) => action.action === "insert" && action.stockItemIds?.includes(stock!.id),
      ),
    ).toBe(true);
    expect(
      document.assemblyPlan.some(
        (action) =>
          action.action === "remove" &&
          action.phase === "disassembly" &&
          action.stockItemIds?.includes(stock!.id),
      ),
    ).toBe(true);
  });

  it("applies the selected snug clearance to support, hinge-leaf, guard, and stop seats", async () => {
    const fixture = await loadRetainedPinFixture("hinged-lid-box");
    const baselineProfiles = retainedPinFixtureProfiles(fixture);
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
    const result = await compileRetainedPinProgram(
      retainedPinFixtureProgram(fixture, profiles),
      profiles,
    );
    const snugJoints = result.document.joints.filter((joint) => joint.fitClass === "snug");
    expect(snugJoints.length).toBeGreaterThan(0);
    expect(snugJoints.every((joint) => joint.nominalClearanceUm === 100)).toBe(true);
    const hingeSeatSlots = result.document.parts.flatMap((part) => part.features).filter(
      (feature) => feature.kind === "slot" &&
        (feature.id.includes("leaf-seat") || feature.id.includes("pin-guard") || feature.id.includes("open-stop")),
    );
    expect(hingeSeatSlots.length).toBeGreaterThan(0);
    expect(hingeSeatSlots.every((feature) => feature.parametersUm.opening === 3_100)).toBe(true);
    expect(
      result.document.validation.status,
      JSON.stringify(result.document.validation.findings, null, 2),
    ).toBe("pass");
  });

  it("detects seeded interference that exists only at a mid-travel angle", async () => {
    const { document } = await compileRetainedPinFixture("hinged-lid-box");
    const constraint = structuredClone(document.motionConstraints[0]!);
    const intervals = constraint.revolute!.proofModel.sectionIntervals;
    const radians = 52.5 * Math.PI / 180;
    const center = {
      xUm: Math.round(50_000 * Math.cos(radians)),
      yUm: Math.round(50_000 * Math.sin(radians))
    };
    const obstacle = {
      id: "seeded-mid-angle-obstacle",
      ownerId: "rear-panel",
      behavior: "stationary" as const,
      axialStartUm: intervals[0]!.axialStartUm,
      axialEndUm: intervals[intervals.length - 1]!.axialEndUm,
      polygon: [
        { xUm: center.xUm - 1_200, yUm: center.yUm - 1_200 },
        { xUm: center.xUm + 1_200, yUm: center.yUm - 1_200 },
        { xUm: center.xUm + 1_200, yUm: center.yUm + 1_200 },
        { xUm: center.xUm - 1_200, yUm: center.yUm + 1_200 }
      ]
    };
    constraint.revolute!.proofModel.sectionPrimitives.push(obstacle);
    for (const interval of intervals) {
      interval.stationaryPrimitiveIds.push(obstacle.id);
    }
    const report = certifyRevoluteTravel(constraint);
    expect(report.status).toBe("fail");
    expect(report.collisions).toHaveLength(intervals.length);
    expect(new Set(report.collisions.map((collision) => collision.axialIntervalId))).toEqual(
      new Set(intervals.map((interval) => interval.id)),
    );
    expect(
      report.collisions.every(
        (collision) =>
          collision.movingPrimitiveId === "moving-panel-section" &&
          collision.stationaryPrimitiveId === obstacle.id &&
          collision.angleDegrees > 0 &&
          collision.angleDegrees < 105,
      ),
    ).toBe(true);
  });

  it("detects seeded interference isolated to one axial station", async () => {
    const { document } = await compileRetainedPinFixture("hinged-lid-box");
    const constraint = structuredClone(document.motionConstraints[0]!);
    const interval = constraint.revolute!.proofModel.sectionIntervals.find(
      (candidate) => candidate.movingPrimitiveIds.includes("moving-panel-section"),
    )!;
    const radians = 52.5 * Math.PI / 180;
    const center = {
      xUm: Math.round(50_000 * Math.cos(radians)),
      yUm: Math.round(50_000 * Math.sin(radians))
    };
    const obstacle = {
      id: "seeded-axial-station-obstacle",
      ownerId: "rear-panel",
      behavior: "stationary" as const,
      axialStartUm: interval.axialStartUm,
      axialEndUm: interval.axialEndUm,
      polygon: [
        { xUm: center.xUm - 1_200, yUm: center.yUm - 1_200 },
        { xUm: center.xUm + 1_200, yUm: center.yUm - 1_200 },
        { xUm: center.xUm + 1_200, yUm: center.yUm + 1_200 },
        { xUm: center.xUm - 1_200, yUm: center.yUm + 1_200 }
      ]
    };
    constraint.revolute!.proofModel.sectionPrimitives.push(obstacle);
    interval.stationaryPrimitiveIds.push(obstacle.id);
    const report = certifyRevoluteTravel(constraint);
    expect(report.status).toBe("fail");
    expect(report.collisions).toEqual([
      expect.objectContaining({
        axialIntervalId: interval.id,
        movingPrimitiveId: "moving-panel-section",
        stationaryPrimitiveId: obstacle.id
      })
    ]);
  });

  it("blocks bore-ligament and compensated-hole survival failures with typed findings", async () => {
    const { document } = await compileRetainedPinFixture("hinged-lid-box");
    const weak = structuredClone(document);
    weak.motionConstraints[0]!.revolute!.stations[0]!.boreLigamentUm = 100;
    const weakValidation = validateRetainedPinMechanism(weak).validation;
    expect(weakValidation.findings.map((finding) => finding.code)).toContain(
      "HINGE_BORE_LIGAMENT_FAILURE",
    );

    const collapsed = structuredClone(document);
    collapsed.resolvedInputs.machine.minimumFeatureMm = 3.1;
    const collapsedValidation = validateRetainedPinMechanism(collapsed).validation;
    expect(collapsedValidation.findings.map((finding) => finding.code)).toContain(
      "HINGE_COMPENSATED_HOLE_SURVIVAL_FAILURE",
    );

    const shiftedFrame = structuredClone(document);
    shiftedFrame.parts.find((part) => part.role === "moving-panel")!.assembledFrame.origin.yUm -= 1_000;
    const shiftedValidation = validateRetainedPinMechanism(shiftedFrame).validation;
    expect(shiftedValidation.findings.map((finding) => finding.code)).toContain(
      "REVOLUTE_CANONICAL_FRAME_PROOF_MISMATCH",
    );

    const missingStop = structuredClone(document);
    const stopPart = missingStop.parts.find((part) => part.id === "open-stop-brace")!;
    stopPart.features = stopPart.features.filter((feature) => feature.id !== "open-stop-brace-face");
    const missingStopValidation = validateRetainedPinMechanism(missingStop).validation;
    expect(missingStopValidation.findings.map((finding) => finding.code)).toContain(
      "HINGE_STOP_INVALID",
    );
  });

  it("returns concept-only outside the registered axis assumption and never invokes a swept-mesh fallback", async () => {
    const fixture = await loadRetainedPinFixture("hinged-lid-box");
    const profiles = retainedPinFixtureProfiles(fixture);
    const program = retainedPinFixtureProgram(fixture, profiles);
    program.mechanism.axis.direction = { x: 0, y: 1, z: 0 };
    const assessment = assessRetainedPinProgram(program);
    expect(assessment).toMatchObject({
      status: "concept-only",
      code: "REVOLUTE_ASSUMPTION_UNSUPPORTED"
    });
    await expect(compileRetainedPinProgram(program, profiles)).rejects.toBeInstanceOf(
      RetainedPinAssumptionError,
    );
  });

  it("uses fixed disclosed replay-stable construction search", async () => {
    const fixture = await loadRetainedPinFixture("hinged-lid-box");
    fixture.content.stationSpanMm = { start: 49, end: 71.5 };
    const profiles = retainedPinFixtureProfiles(fixture);
    const program = retainedPinFixtureProgram(fixture, profiles);
    const [first, second] = await Promise.all([
      compileRetainedPinProgram(program, profiles),
      compileRetainedPinProgram(program, profiles)
    ]);
    const selection = first.document.constructionSelections?.[0];
    expect(selection).toMatchObject({
      searchPolicyId: "retained-pin-construction-search",
      searchPolicyVersion: "1.1.0",
      preferredCandidateId: "five-station",
      selectedCandidateId: "three-station",
      changedConstruction: true,
      attempts: [
        { candidateId: "five-station", status: "rejected" },
        { candidateId: "three-station", status: "selected" }
      ]
    });
    expect(selection?.disclosure).toContain("without changing thickness, kerf, pin diameter");
    expect(first.document.resolvedInputs.material.measuredThicknessMm).toBe(3);
    expect(first.document.externalStock?.[0]?.stockProfile.measuredDiameterUm).toBe(3_000);
    expect(await canonicalGeometryHash(first.document)).toBe(
      await canonicalGeometryHash(second.document),
    );

    fixture.content.stationSpanMm = { start: 53, end: 67 };
    const impossibleProgram = retainedPinFixtureProgram(fixture, profiles);
    await expect(compileRetainedPinProgram(impossibleProgram, profiles)).rejects.toMatchObject({
      code: "RETAINED_PIN_CONSTRUCTION_UNAVAILABLE",
      measuredInputs: {
        thicknessUm: 3_000,
        snugClearanceUm: 0,
        pinDiameterUm: 3_000,
        kerfXUm: 150,
        kerfYUm: 160
      }
    } satisfies Partial<RetainedPinConstructionError>);
  });

  it("recomputes pin geometry from its measured diameter while kerf remains projection-only", async () => {
    const fixture = await loadRetainedPinFixture("hinged-lid-box");
    const profiles = retainedPinFixtureProfiles(fixture);
    const baselineProgram = retainedPinFixtureProgram(fixture, profiles);
    const baseline = await compileRetainedPinProgram(baselineProgram, profiles);

    fixture.content.pin.measuredDiameterMm = 3.04;
    fixture.content.pin.measuredMinimumDiameterMm = 3.04;
    fixture.content.pin.measuredMaximumDiameterMm = 3.04;
    const diameterEdit = await compileRetainedPinProgram(
      retainedPinFixtureProgram(fixture, profiles),
      profiles,
    );
    expect(await canonicalGeometryHash(diameterEdit.document)).not.toBe(
      await canonicalGeometryHash(baseline.document),
    );
    expect(diameterEdit.document.externalStock?.[0]?.stockProfile.measuredDiameterUm).toBe(3_040);

    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const kerfFixture = await loadRetainedPinFixture("hinged-lid-box");
    kerfFixture.profiles.kerfXmm = 0.2;
    kerfFixture.profiles.kerfYmm = 0.21;
    const kerfProfiles = retainedPinFixtureProfiles(kerfFixture);
    const kerfEdit = await compileRetainedPinProgram(
      retainedPinFixtureProgram(kerfFixture, kerfProfiles),
      kerfProfiles,
    );
    expect(await canonicalGeometryHash(kerfEdit.document)).toBe(
      await canonicalGeometryHash(baseline.document),
    );
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });

});
