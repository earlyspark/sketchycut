import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DesignDocumentV1Schema,
  DesignRequestV1Schema,
  IntentFixtureV1Schema,
  type DesignDocumentV1,
  type DesignRequestV1
} from "../../src/domain/contracts.js";

const intent = IntentFixtureV1Schema.parse(
  JSON.parse(readFileSync(new URL("../fixtures/intent/kernel-proof.json", import.meta.url), "utf8")),
);

const request: DesignRequestV1 = {
  schemaVersion: "2.0",
  requestId: "kernel-proof-request",
  title: "Kernel proof",
  description: "Generate the deterministic canonical-kernel proof coupon.",
  units: "mm",
  envelopeMm: { x: 180, y: 90, z: 30 },
  materialProfileId: "basswood-provisional",
  machineProfileId: "xtool-m2-20w",
  fitProfileId: "provisional-fit",
  referenceIds: []
};

const hash = "0".repeat(64);

function baseDocument(): DesignDocumentV1 {
  return {
    schemaVersion: "2.0",
    projectId: "kernel-proof-project",
    request,
    intent,
    resolvedInputs: {
      material: {
        schemaVersion: "2.0",
        id: "basswood-provisional",
        name: "Provisional basswood plywood",
        materialKind: "basswood-plywood",
        nominalThicknessMm: 3,
        measuredThicknessMm: 3,
        batchId: null,
        grainAxis: "x",
        physicalState: "provisional-preset"
      },
      machine: {
        schemaVersion: "2.0",
        id: "xtool-m2-20w",
        name: "xTool M2 20W",
        manufacturer: "xTool",
        model: "M2",
        module: "20W blue-light laser",
        processingMode: "flat-surface-lasering",
        processingEnvelopeMm: { width: 426, height: 320 },
        minimumFeatureMm: 0.5,
        exportFormat: "svg",
        downstreamApplication: "xTool Studio",
        minimumStudioDesktopVersion: "1.7.30",
        confidence: "vendor-documented-target"
      },
      processRecipe: {
        schemaVersion: "2.0",
        id: "process-unrecorded-k150-150",
        machineProfileId: "xtool-m2-20w",
        materialProfileId: "basswood-provisional",
        materialBatchOrSheetId: null,
        processingMode: "flat-surface-lasering",
        studioDesktopVersion: null,
        firmwareVersion: null,
        materialPresetSource: null,
        powerPercent: null,
        speedMmPerSecond: null,
        passCount: null,
        focusMode: null,
        focusDescentMm: null,
        builtInAirPump: null,
        sheetOrientation: null,
        supportArrangement: null,
        studioKerfOffsetMm: null,
        cutWidth: {
          xMm: 0.15,
          yMm: 0.15,
          semantics: "full-cut-width",
          source: "provisional-preset",
          recipeHash: null
        },
        recipeHash: null,
        evidenceStatus: "unrecorded"
      },
      fabricationContext: {
        stockFootprint: null,
        layoutPolicy: {
          id: "compact-compensated-bounds",
          version: "1.0.0",
          symmetricPaddingMm: 5,
          interPartSpacingMm: 2,
          purpose: "project-layout-padding-not-fixture-clearance"
        },
        placementConstraints: {
          mode: "manual-framing-required",
          fixtureKeepoutsModeled: false,
          magneticFixtureClearanceMm: 5,
          magneticFixtureClearanceSource: "manual-handoff-check"
        }
      },
      fit: {
        schemaVersion: "2.0",
        id: "provisional-fit",
        name: "Provisional plywood fit",
        deltaSemantics: "opening-size-minus-insert-size",
        press: { totalDeltaMm: -0.05, confidence: "provisional" },
        snug: { totalDeltaMm: 0, confidence: "provisional" },
        sliding: { totalDeltaMm: 0.2, confidence: "provisional" },
        rotating: { totalDeltaMm: 0.25, confidence: "provisional" },
        rod: { totalDeltaMm: 0.15, confidence: "provisional" }
      },
      hardwarePolicy: {
        glueAllowed: false,
        permittedKinds: ["sheet-part"]
      }
    },
    operatorProgram: [
      {
        operatorId: "calibration-coupon",
        operatorVersion: "1.0.0",
        parameterHash: hash
      }
    ],
    parts: [
      {
        schemaVersion: "2.0",
        id: "coupon-base",
        name: "Coupon base",
        role: "coupon-base",
        materialProfileId: "basswood-provisional",
        thicknessUm: 3000,
        grainVector: { x: 1, y: 0 },
        nominalRegion: {
          outer: {
            id: "coupon-base-outer",
            closed: true,
            points: [
              { xUm: 0, yUm: 0 },
              { xUm: 10_000, yUm: 0 },
              { xUm: 10_000, yUm: 10_000 },
              { xUm: 0, yUm: 10_000 }
            ]
          },
          holes: []
        },
        features: [
          {
            id: "coupon-base-outer-feature",
            kind: "outer-boundary",
            operation: "cut",
            fitClass: null,
            jointId: null,
            region: {
              outer: {
                id: "coupon-base-feature-outline",
                closed: true,
                points: [
                  { xUm: 0, yUm: 0 },
                  { xUm: 10_000, yUm: 0 },
                  { xUm: 10_000, yUm: 10_000 },
                  { xUm: 0, yUm: 10_000 }
                ]
              },
              holes: []
            },
            path: null,
            parametersUm: {}
          }
        ],
        assembledFrame: {
          origin: { xUm: 0, yUm: 0, zUm: 0 },
          xAxis: { x: 1, y: 0, z: 0 },
          yAxis: { x: 0, y: 1, z: 0 },
          zAxis: { x: 0, y: 0, z: 1 }
        },
        explodedOffset: { xUm: 0, yUm: 0, zUm: 20_000 },
        assemblyDependencyPartIds: [],
        sourceOperator: {
          id: "calibration-coupon",
          version: "1.0.0"
        }
      }
    ],
    joints: [],
    motionConstraints: [
      {
        schemaVersion: "2.0",
        id: "coupon-fixed",
        kind: "fixed",
        bodyPartIds: ["coupon-base"],
        axis: {
          origin: { xUm: 0, yUm: 0, zUm: 0 },
          direction: { x: 0, y: 0, z: 1 }
        },
        range: {
          minimum: 0,
          maximum: 0,
          unit: "mm"
        }
      }
    ],
    assemblyPlan: [
      {
        schemaVersion: "2.0",
        id: "verify-coupon",
        order: 0,
        action: "verify",
        partIds: ["coupon-base"],
        jointIds: [],
        direction: null,
        dependsOnActionIds: [],
        instructionKey: "verify-coupon"
      }
    ],
    validation: {
      schemaVersion: "2.0",
      status: "pass",
      findings: [
        {
          code: "PHYSICAL_VERIFICATION_REQUIRED",
          severity: "warning",
          owner: "evidence",
          relatedIds: ["kernel-proof-project"],
          message: "Software evidence does not establish physical fit.",
          blocksExport: false
        }
      ]
    },
    provenance: {
      inputDigest: hash,
      modelId: null,
      promptVersion: null,
      operatorVersions: {
        "calibration-coupon": "1.0.0"
      },
      deterministicSeed: "canonical-kernel-proof",
      runtimeApplicationApiCalls: 0
    }
  };
}

describe("strict canonical schemas", () => {
  it("accepts the pinned intent fixture and rejects dangling body IDs", () => {
    expect(intent.fixtureId).toBe("kernel-proof");
    const invalid = structuredClone(intent);
    invalid.topology.interfaces[0]!.between[1] = "missing-body";
    expect(IntentFixtureV1Schema.safeParse(invalid).success).toBe(false);
  });

  it("rejects unknown fields, invalid units, and version mismatches", () => {
    expect(DesignRequestV1Schema.safeParse({ ...request, surprise: true }).success).toBe(false);
    expect(DesignRequestV1Schema.safeParse({ ...request, units: "in" }).success).toBe(false);
    expect(DesignRequestV1Schema.safeParse({ ...request, schemaVersion: "1.0" }).success).toBe(false);
    const openContour = baseDocument();
    openContour.parts[0]!.nominalRegion.outer.closed = false as true;
    expect(DesignDocumentV1Schema.safeParse(openContour).success).toBe(false);
    const fractionalMicrometres = baseDocument();
    fractionalMicrometres.parts[0]!.nominalRegion.outer.points[0]!.xUm = 0.5;
    expect(DesignDocumentV1Schema.safeParse(fractionalMicrometres).success).toBe(false);
  });

  it("rejects dangling part, feature, joint, action, and profile references", () => {
    expect(DesignDocumentV1Schema.parse(baseDocument()).projectId).toBe("kernel-proof-project");

    const danglingPart = baseDocument();
    danglingPart.motionConstraints[0]!.bodyPartIds = ["missing-part"];
    expect(DesignDocumentV1Schema.safeParse(danglingPart).success).toBe(false);

    const danglingFeature = baseDocument();
    danglingFeature.joints = [
      {
        schemaVersion: "2.0",
        id: "bad-joint",
        kind: "calibration-pair",
        between: [
          { partId: "coupon-base", featureId: "coupon-base-outer-feature" },
          { partId: "coupon-base", featureId: "missing-feature" }
        ],
        fitClass: "snug",
        nominalClearanceUm: 0,
        insertionDirection: { x: 0, y: 0, z: 1 }
      }
    ];
    expect(DesignDocumentV1Schema.safeParse(danglingFeature).success).toBe(false);

    const danglingJoint = baseDocument();
    danglingJoint.assemblyPlan[0]!.jointIds = ["missing-joint"];
    expect(DesignDocumentV1Schema.safeParse(danglingJoint).success).toBe(false);

    const danglingAction = baseDocument();
    danglingAction.assemblyPlan[0]!.dependsOnActionIds = ["missing-action"];
    expect(DesignDocumentV1Schema.safeParse(danglingAction).success).toBe(false);

    const mismatchedProfile = baseDocument();
    mismatchedProfile.request.machineProfileId = "different-machine";
    expect(DesignDocumentV1Schema.safeParse(mismatchedProfile).success).toBe(false);
  });
});
