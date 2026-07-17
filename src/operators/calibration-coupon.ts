import {
  DesignDocumentV1Schema,
  type DesignDocumentV1,
  type FitProfile,
  type PartFeature,
  type PointUm,
  type Region2D,
  type SheetPart
} from "../domain/contracts.js";
import {
  defaultFabricationContext,
  historicalM1BasswoodProfile,
  provisionalFitProfile,
  provisionalProcessRecipe,
  xtoolM2Profile
} from "../domain/profiles.js";
import { hashCanonical } from "../domain/hash.js";
import { mmToUm } from "../domain/units.js";
import { validateParts } from "../validation/geometry.js";

export const CALIBRATION_COUPON_OPERATOR = {
  id: "calibration-coupon",
  version: "2.0.0"
} as const;

const COUPON_SLOT_LENGTH_UM = 25_000;
const COUPON_SLOT_Y_UM = 15_000;
const COUPON_SLOT_XS_UM = [10_000, 43_000, 76_000, 109_000, 142_000] as const;

const SEGMENTS = {
  a: [[0, 1], [1, 1]],
  b: [[1, 1], [1, 0.5]],
  c: [[1, 0.5], [1, 0]],
  d: [[0, 0], [1, 0]],
  e: [[0, 0], [0, 0.5]],
  f: [[0, 0.5], [0, 1]],
  g: [[0, 0.5], [1, 0.5]]
} as const;

const GLYPHS: Record<string, readonly (keyof typeof SEGMENTS)[]> = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "g", "e", "d"],
  "3": ["a", "b", "g", "c", "d"],
  "4": ["f", "g", "b", "c"],
  "5": ["a", "f", "g", "c", "d"],
  "P": ["a", "b", "f", "g", "e"]
};

function rectangleContour(
  id: string,
  xUm: number,
  yUm: number,
  widthUm: number,
  heightUm: number,
  orientation: "ccw" | "cw" = "ccw",
): Region2D["outer"] {
  const points: PointUm[] = [
    { xUm, yUm },
    { xUm: xUm + widthUm, yUm },
    { xUm: xUm + widthUm, yUm: yUm + heightUm },
    { xUm, yUm: yUm + heightUm }
  ];
  return {
    id,
    closed: true,
    points: orientation === "ccw" ? points : points.reverse()
  };
}

function circleContour(
  id: string,
  centerXUm: number,
  centerYUm: number,
  radiusUm: number,
  segments = 32,
): Region2D["outer"] {
  const points = Array.from({ length: segments }, (_, index) => {
    const angle = (-2 * Math.PI * index) / segments;
    return {
      xUm: Math.round(centerXUm + Math.cos(angle) * radiusUm),
      yUm: Math.round(centerYUm + Math.sin(angle) * radiusUm)
    };
  });
  return { id, closed: true, points };
}

function labelFeatures(
  partId: string,
  labelId: string,
  text: string,
  originXUm: number,
  originYUm: number,
  heightUm = 4_000,
): PartFeature[] {
  const widthUm = Math.round(heightUm * 0.6);
  const advanceUm = Math.round(heightUm * 0.85);
  const features: PartFeature[] = [];
  for (const [characterIndex, character] of Array.from(text).entries()) {
    const segments = GLYPHS[character];
    if (segments === undefined) {
      throw new Error(`Unsupported coupon label character ${character}.`);
    }
    for (const [segmentIndex, segmentName] of segments.entries()) {
      const segment = SEGMENTS[segmentName];
      const points = segment.map(([x, y]) => ({
        xUm: Math.round(originXUm + characterIndex * advanceUm + x * widthUm),
        yUm: Math.round(originYUm + y * heightUm)
      }));
      const id = `${partId}-${labelId}-${String(characterIndex)}-${String(segmentIndex)}`;
      features.push({
        id,
        kind: "score-label",
        operation: "score",
        fitClass: null,
        jointId: null,
        region: null,
        path: {
          id: `${id}-path`,
          closed: false,
          points
        },
        parametersUm: {
          glyphHeight: heightUm
        }
      });
    }
  }
  return features;
}

function slotFeature(
  index: number,
  xUm: number,
  yUm: number,
  lengthUm: number,
  openingUm: number,
  fitClass: keyof Pick<FitProfile, "press" | "snug" | "sliding" | "rotating" | "rod">,
  jointId: string | null,
): { contour: Region2D["outer"]; feature: PartFeature } {
  const contour = rectangleContour(
    `coupon-slot-${String(index)}-contour`,
    xUm,
    yUm,
    lengthUm,
    openingUm,
    "cw",
  );
  return {
    contour,
    feature: {
      id: `coupon-slot-${String(index)}`,
      kind: "slot",
      operation: "cut",
      fitClass,
      jointId,
      region: { outer: contour, holes: [] },
      path: null,
      parametersUm: {
        opening: openingUm,
        length: lengthUm
      }
    }
  };
}

function buildParts(thicknessMm: number, fit: FitProfile): SheetPart[] {
  const thicknessUm = mmToUm(thicknessMm);
  const classes = [
    ["press", fit.press.totalDeltaMm],
    ["snug", fit.snug.totalDeltaMm],
    ["sliding", fit.sliding.totalDeltaMm],
    ["rotating", fit.rotating.totalDeltaMm],
    ["rod", fit.rod.totalDeltaMm]
  ] as const;
  const slots = classes.map(([fitClass, deltaMm], index) =>
    slotFeature(
      index + 1,
      COUPON_SLOT_XS_UM[index]!,
      COUPON_SLOT_Y_UM,
      COUPON_SLOT_LENGTH_UM,
      thicknessUm + mmToUm(deltaMm),
      fitClass,
      fitClass === "snug" ? "coupon-snug-joint" : null,
    ),
  );

  const rotatingDiameterUm = mmToUm(3 + fit.rotating.totalDeltaMm);
  const rodDiameterUm = mmToUm(3 + fit.rod.totalDeltaMm);
  const rotatingHole = circleContour("rotating-bore-contour", 20_000, 55_000, Math.round(rotatingDiameterUm / 2));
  const rodHole = circleContour("rod-bore-contour", 40_000, 55_000, Math.round(rodDiameterUm / 2));
  const kerfAngles = [0, 45, 90] as const;
  const kerfFeatures = kerfAngles.map((angle, index): PartFeature => {
    const centerXUm = 70_000 + index * 20_000;
    const centerYUm = 55_000;
    const lengthUm = 15_000;
    const radians = (angle * Math.PI) / 180;
    const dx = Math.round((Math.cos(radians) * lengthUm) / 2);
    const dy = Math.round((Math.sin(radians) * lengthUm) / 2);
    return {
      id: `kerf-sample-${String(angle)}`,
      kind: "kerf-sample",
      operation: "cut",
      fitClass: null,
      jointId: null,
      region: null,
      path: {
        id: `kerf-sample-${String(angle)}-path`,
        closed: false,
        points: [
          { xUm: centerXUm - dx, yUm: centerYUm - dy },
          { xUm: centerXUm + dx, yUm: centerYUm + dy }
        ]
      },
      parametersUm: {
        angleDegrees: angle,
        length: lengthUm
      }
    };
  });
  const engraveFeatures: PartFeature[] = Array.from({ length: 5 }, (_, index) => ({
    id: `engrave-sample-${String(index + 1)}`,
    kind: "engrave-sample",
    operation: "engrave",
    fitClass: null,
    jointId: null,
    region: {
      outer: rectangleContour(
        `engrave-sample-${String(index + 1)}-area`,
        125_000,
        48_000 + index * 3_000,
        30_000,
        2_000,
      ),
      holes: []
    },
    path: null,
    parametersUm: { swatchWidth: 30_000, swatchHeight: 2_000, swatchIndex: index + 1 }
  }));
  const base: SheetPart = {
    schemaVersion: "1.0",
    id: "coupon-base",
    name: "Calibration coupon base",
    role: "coupon-base",
    materialProfileId: `basswood-${String(thicknessUm)}`,
    thicknessUm,
    grainVector: { x: 1, y: 0 },
    nominalRegion: {
      outer: rectangleContour("coupon-base-outer", 0, 0, 180_000, 90_000),
      holes: [...slots.map((slot) => slot.contour), rotatingHole, rodHole]
    },
    features: [
      {
        id: "coupon-base-boundary",
        kind: "outer-boundary",
        operation: "cut",
        fitClass: null,
        jointId: null,
        region: {
          outer: rectangleContour("coupon-base-outer", 0, 0, 180_000, 90_000),
          holes: []
        },
        path: null,
        parametersUm: {}
      },
      ...slots.map((slot) => slot.feature),
      {
        id: "rotating-bore",
        kind: "bore",
        operation: "cut",
        fitClass: "rotating",
        jointId: null,
        region: { outer: rotatingHole, holes: [] },
        path: null,
        parametersUm: { diameter: rotatingDiameterUm }
      },
      {
        id: "rod-bore",
        kind: "bore",
        operation: "cut",
        fitClass: "rod",
        jointId: null,
        region: { outer: rodHole, holes: [] },
        path: null,
        parametersUm: { diameter: rodDiameterUm }
      },
      ...kerfFeatures,
      ...engraveFeatures,
      ...labelFeatures("coupon-base", "part-label", "P1", 162_000, 75_000),
      ...COUPON_SLOT_XS_UM.flatMap((xUm, index) =>
        labelFeatures(
          "coupon-base",
          `slot-label-${String(index + 1)}`,
          String(index + 1),
          xUm + 10_000,
          8_000,
          3_000,
        ),
      )
    ],
    assembledFrame: {
      origin: { xUm: 0, yUm: 0, zUm: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 }
    },
    explodedOffset: { xUm: 0, yUm: 0, zUm: -20_000 },
    assemblyDependencyPartIds: [],
    sourceOperator: CALIBRATION_COUPON_OPERATOR
  };

  const insertOuter: Region2D = {
    outer: {
      id: "coupon-insert-outer",
      closed: true,
      points: [
        { xUm: 2_500, yUm: 0 },
        { xUm: 22_500, yUm: 0 },
        { xUm: 22_500, yUm: 5_000 },
        { xUm: 25_000, yUm: 5_000 },
        { xUm: 25_000, yUm: 55_000 },
        { xUm: 0, yUm: 55_000 },
        { xUm: 0, yUm: 5_000 },
        { xUm: 2_500, yUm: 5_000 }
      ]
    },
    holes: []
  };
  const insert: SheetPart = {
    schemaVersion: "1.0",
    id: "coupon-insert",
    name: "Calibration coupon insert",
    role: "coupon-insert",
    materialProfileId: `basswood-${String(thicknessUm)}`,
    thicknessUm,
    grainVector: { x: 1, y: 0 },
    nominalRegion: insertOuter,
    features: [
      {
        id: "coupon-insert-boundary",
        kind: "outer-boundary",
        operation: "cut",
        fitClass: null,
        jointId: null,
        region: insertOuter,
        path: null,
        parametersUm: {}
      },
      {
        id: "coupon-insert-tab",
        kind: "tab",
        operation: "cut",
        fitClass: "snug",
        jointId: "coupon-snug-joint",
        region: {
          outer: rectangleContour("coupon-insert-tab-contour", 2_500, 0, 20_000, 5_000),
          holes: []
        },
        path: null,
        parametersUm: {
          insertThickness: thicknessUm,
          engagement: 5_000
        }
      },
      ...labelFeatures("coupon-insert", "part-label", "P2", 8_000, 40_000)
    ],
    assembledFrame: {
      origin: {
        xUm: COUPON_SLOT_XS_UM[1],
        yUm: COUPON_SLOT_Y_UM + thicknessUm,
        zUm: 0
      },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 0, z: 1 },
      zAxis: { x: 0, y: -1, z: 0 }
    },
    explodedOffset: { xUm: 0, yUm: -25_000, zUm: 35_000 },
    assemblyDependencyPartIds: ["coupon-base"],
    sourceOperator: CALIBRATION_COUPON_OPERATOR
  };
  return [base, insert];
}

export type CalibrationCouponInputs = {
  measuredThicknessMm: number;
  kerfMm: number;
  directionalKerfYMm?: number;
};

export async function compileCalibrationCoupon(
  inputs: CalibrationCouponInputs,
): Promise<DesignDocumentV1> {
  const material = historicalM1BasswoodProfile(inputs.measuredThicknessMm);
  const machine = xtoolM2Profile();
  const processRecipe = provisionalProcessRecipe(
    material,
    machine,
    inputs.kerfMm,
    inputs.directionalKerfYMm,
  );
  const fabricationContext = defaultFabricationContext();
  const fit = provisionalFitProfile();
  const parts = buildParts(inputs.measuredThicknessMm, fit);
  const inputDigest = await hashCanonical(inputs);
  const parameterHash = await hashCanonical({
    inputs,
    fit,
    operator: CALIBRATION_COUPON_OPERATOR
  });
  const suffix = `t${String(Math.round(inputs.measuredThicknessMm * 1_000))}-k${String(Math.round(inputs.kerfMm * 1_000))}`;

  return DesignDocumentV1Schema.parse({
    schemaVersion: "1.0",
    projectId: `m1-coupon-${suffix}`,
    request: {
      schemaVersion: "1.0",
      requestId: `m1-coupon-request-${suffix}`,
      title: "M1 calibration coupon",
      description: "Deterministic kernel proof coupon; physical verification required.",
      units: "mm",
      envelopeMm: { x: 180, y: 90, z: 55 },
      materialProfileId: material.id,
      machineProfileId: machine.id,
      fitProfileId: fit.id,
      referenceIds: []
    },
    intent: {
      schemaVersion: "1.0",
      fixtureId: "m1-coupon-intent",
      title: "M1 calibration coupon",
      coreIntent: "Exercise canonical parts, thickness-driven mating features, kerf projection, nesting, mesh, BOM, and assembly states.",
      requirements: [
        {
          id: "coupon-required",
          priority: "must",
          statement: "Generate deterministic thickness, fit, kerf, rotation, rod, score, and engrave samples.",
          evidence: [
            {
              evidenceId: "m1-fixture",
              source: "text",
              referenceId: null,
              statement: "Pinned M1 intent fixture; no runtime model call."
            }
          ]
        }
      ],
      topology: {
        bodies: [
          { id: "coupon-base", role: "support", quantity: 1, shapeClass: "planar" },
          { id: "coupon-insert", role: "connector", quantity: 1, shapeClass: "planar" }
        ],
        interfaces: [
          {
            id: "coupon-interface",
            between: ["coupon-base", "coupon-insert"],
            behavior: "rigid",
            function: "Measured-thickness insert mates with the selected slot ladder."
          }
        ]
      },
      assumptions: [
        {
          id: "provisional-fit",
          statement: "Fit deltas remain provisional until a same-sheet coupon is cut.",
          source: "preset"
        }
      ],
      capabilityAssessment: {
        coreIntentRepresentable: true,
        unresolvedNeeds: []
      }
    },
    resolvedInputs: {
      material,
      machine,
      processRecipe,
      fabricationContext,
      fit,
      hardwarePolicy: {
        glueAllowed: false,
        permittedKinds: ["sheet-part", "wooden-rod", "toothpick"]
      }
    },
    operatorProgram: [
      {
        operatorId: CALIBRATION_COUPON_OPERATOR.id,
        operatorVersion: CALIBRATION_COUPON_OPERATOR.version,
        parameterHash
      }
    ],
    parts,
    joints: [
      {
        schemaVersion: "1.0",
        id: "coupon-snug-joint",
        kind: "calibration-pair",
        between: [
          { partId: "coupon-base", featureId: "coupon-slot-2" },
          { partId: "coupon-insert", featureId: "coupon-insert-tab" }
        ],
        fitClass: "snug",
        nominalClearanceUm: mmToUm(fit.snug.totalDeltaMm),
        insertionDirection: { x: 0, y: 0, z: -1 }
      }
    ],
    motionConstraints: [
      {
        schemaVersion: "1.0",
        id: "coupon-fixed",
        kind: "fixed",
        bodyPartIds: ["coupon-base", "coupon-insert"],
        axis: {
          origin: { xUm: COUPON_SLOT_XS_UM[1], yUm: COUPON_SLOT_Y_UM, zUm: 0 },
          direction: { x: 0, y: 0, z: 1 }
        },
        range: { minimum: 0, maximum: 0, unit: "mm" }
      }
    ],
    assemblyPlan: [
      {
        schemaVersion: "1.0",
        id: "align-insert",
        order: 0,
        action: "align",
        partIds: ["coupon-base", "coupon-insert"],
        jointIds: ["coupon-snug-joint"],
        direction: { x: 0, y: 0, z: -1 },
        dependsOnActionIds: [],
        instructionKey: "align-insert"
      },
      {
        schemaVersion: "1.0",
        id: "insert-coupon",
        order: 1,
        action: "insert",
        partIds: ["coupon-insert"],
        jointIds: ["coupon-snug-joint"],
        direction: { x: 0, y: 0, z: -1 },
        dependsOnActionIds: ["align-insert"],
        instructionKey: "insert-coupon"
      },
      {
        schemaVersion: "1.0",
        id: "verify-fit",
        order: 2,
        action: "verify",
        partIds: ["coupon-base", "coupon-insert"],
        jointIds: ["coupon-snug-joint"],
        direction: null,
        dependsOnActionIds: ["insert-coupon"],
        instructionKey: "verify-fit"
      }
    ],
    validation: validateParts(parts),
    provenance: {
      inputDigest,
      modelId: null,
      promptVersion: null,
      operatorVersions: {
        [CALIBRATION_COUPON_OPERATOR.id]: CALIBRATION_COUPON_OPERATOR.version
      },
      deterministicSeed: "m1-coupon-v1",
      runtimeApplicationApiCalls: 0
    }
  });
}
