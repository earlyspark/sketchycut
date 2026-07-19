import { z } from "zod";

import { IntentGraphV1Schema } from "../interpretation/intent-graph.js";
import { SCHEMA_VERSION } from "../version.js";
import { StableIdSchema } from "./primitives.js";

export { StableIdSchema } from "./primitives.js";

export const SchemaVersionSchema = z.literal(SCHEMA_VERSION);
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const PositiveMmSchema = z.number().positive();
export const NonNegativeMmSchema = z.number().nonnegative();
export const IntegerUmSchema = z.number().int();
export const PositiveIntegerUmSchema = IntegerUmSchema.positive();
export const HundredthMmSchema = z.number().refine(
  (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
  "Millimetre values must be quantized to 0.01 mm.",
);

export const PointUmSchema = z
  .object({
    xUm: IntegerUmSchema,
    yUm: IntegerUmSchema
  })
  .strict();

export const Vector3UmSchema = z
  .object({
    xUm: IntegerUmSchema,
    yUm: IntegerUmSchema,
    zUm: IntegerUmSchema
  })
  .strict();

export const Vector3MmSchema = z
  .object({
    xMm: z.number(),
    yMm: z.number(),
    zMm: z.number()
  })
  .strict();

export const UnitVector3Schema = z
  .object({
    x: z.number().min(-1).max(1),
    y: z.number().min(-1).max(1),
    z: z.number().min(-1).max(1)
  })
  .strict()
  .superRefine((value, context) => {
    const magnitude = Math.hypot(value.x, value.y, value.z);
    if (Math.abs(magnitude - 1) > 1e-9) {
      context.addIssue({
        code: "custom",
        message: "Axis vectors must be unit length."
      });
    }
  });

export const PolylineUmSchema = z
  .object({
    id: StableIdSchema,
    closed: z.boolean(),
    points: z.array(PointUmSchema).min(2)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.closed && value.points.length < 3) {
      context.addIssue({
        code: "custom",
        message: "Closed polylines require at least three points."
      });
    }
    const first = value.points[0]!;
    const last = value.points.at(-1)!;
    if (first.xUm === last.xUm && first.yUm === last.yUm) {
      context.addIssue({
        code: "custom",
        message: "Contours are implicitly closed and must not repeat the first point."
      });
    }
  });

const ClosedPolylineUmSchema = z
  .object({
    id: StableIdSchema,
    closed: z.literal(true),
    points: z.array(PointUmSchema).min(3)
  })
  .strict()
  .superRefine((value, context) => {
    const first = value.points[0]!;
    const last = value.points.at(-1)!;
    if (first.xUm === last.xUm && first.yUm === last.yUm) {
      context.addIssue({
        code: "custom",
        message: "Contours are implicitly closed and must not repeat the first point."
      });
    }
  });

export const Region2DSchema = z
  .object({
    outer: ClosedPolylineUmSchema,
    holes: z.array(ClosedPolylineUmSchema)
  })
  .strict();

export const Frame3DSchema = z
  .object({
    origin: Vector3UmSchema,
    xAxis: UnitVector3Schema,
    yAxis: UnitVector3Schema,
    zAxis: UnitVector3Schema
  })
  .strict();

export const DesignRequestV1Schema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    requestId: StableIdSchema,
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(4_000),
    units: z.literal("mm"),
    envelopeMm: z
      .object({
        x: PositiveMmSchema,
        y: PositiveMmSchema,
        z: PositiveMmSchema
      })
      .strict(),
    materialProfileId: StableIdSchema,
    machineProfileId: StableIdSchema,
    fitProfileId: StableIdSchema,
    referenceIds: z.array(StableIdSchema).max(3)
  })
  .strict();

const IntentEvidenceSchema = z
  .object({
    evidenceId: StableIdSchema,
    source: z.enum(["text", "reference"]),
    referenceId: StableIdSchema.nullable(),
    statement: z.string().min(1).max(500)
  })
  .strict();

export const IntentFixtureV1Schema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    fixtureId: StableIdSchema,
    title: z.string().min(1).max(120),
    coreIntent: z.string().min(1).max(500),
    requirements: z.array(
      z
        .object({
          id: StableIdSchema,
          priority: z.enum(["must", "prefer"]),
          statement: z.string().min(1).max(500),
          evidence: z.array(IntentEvidenceSchema).min(1)
        })
        .strict(),
    ),
    topology: z
      .object({
        bodies: z.array(
          z
            .object({
              id: StableIdSchema,
              role: z.enum(["support", "enclosure", "cover", "moving-panel", "connector"]),
              quantity: z.number().int().positive(),
              shapeClass: z.enum(["planar", "shell", "rod"])
            })
            .strict(),
        ),
        interfaces: z.array(
          z
            .object({
              id: StableIdSchema,
              between: z.tuple([StableIdSchema, StableIdSchema]),
              behavior: z.enum(["rigid", "revolute", "prismatic"]),
              function: z.string().min(1).max(300)
            })
            .strict(),
        )
      })
      .strict(),
    assumptions: z.array(
      z
        .object({
          id: StableIdSchema,
          statement: z.string().min(1).max(300),
          source: z.enum(["preset", "fixture"])
        })
        .strict(),
    ),
    capabilityAssessment: z
      .object({
        coreIntentRepresentable: z.boolean(),
        unresolvedNeeds: z.array(z.string().min(1).max(300))
      })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    const bodyIds = new Set(value.topology.bodies.map((body) => body.id));
    for (const [index, item] of value.topology.interfaces.entries()) {
      for (const bodyId of item.between) {
        if (!bodyIds.has(bodyId)) {
          context.addIssue({
            code: "custom",
            message: `Interface references unknown body ${bodyId}.`,
            path: ["topology", "interfaces", index, "between"]
          });
        }
      }
    }
  });

export const ThicknessMeasurementSummarySchema = z
  .object({
    samplesMm: z.array(HundredthMmSchema.positive()).min(1),
    representativeThicknessMm: HundredthMmSchema.positive(),
    minimumThicknessMm: HundredthMmSchema.positive(),
    maximumThicknessMm: HundredthMmSchema.positive(),
    spreadMm: HundredthMmSchema.nonnegative(),
    method: z.literal("median"),
    resolutionUm: z.literal(10)
  })
  .strict()
  .superRefine((value, context) => {
    const samples = [...value.samplesMm].sort((left, right) => left - right);
    const middle = Math.floor(samples.length / 2);
    const rawMedian = samples.length % 2 === 1
      ? samples[middle]!
      : (samples[middle - 1]! + samples[middle]!) / 2;
    const expectedMedian = Math.round(rawMedian * 100) / 100;
    const minimum = samples[0]!;
    const maximum = samples.at(-1)!;
    const spread = Math.round((maximum - minimum) * 100) / 100;
    if (value.representativeThicknessMm !== expectedMedian) {
      context.addIssue({
        code: "custom",
        message: "Representative thickness must be the 0.01 mm-quantized sample median.",
        path: ["representativeThicknessMm"]
      });
    }
    if (value.minimumThicknessMm !== minimum || value.maximumThicknessMm !== maximum) {
      context.addIssue({
        code: "custom",
        message: "Thickness sample bounds must match the normalized sample set."
      });
    }
    if (value.spreadMm !== spread) {
      context.addIssue({
        code: "custom",
        message: "Thickness spread must equal maximum minus minimum.",
        path: ["spreadMm"]
      });
    }
  });

export const ThicknessBasisSchema = z.enum([
  "nominal-preset",
  "user-reported-caliper",
  "coupon-selected",
  "reviewed-measurement"
]);

export const NominalStockReferenceSchema = z
  .object({
    presetId: StableIdSchema,
    presetVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    policyId: StableIdSchema,
    policyVersion: z.string().regex(/^\d+\.\d+\.\d+$/)
  })
  .strict();

export const CutWidthSourceSchema = z.enum([
  "provisional-preset",
  "user-reported-manual",
  "fixture-derived",
  "coupon-selected",
  "reviewed-measurement"
]);

export const CutWidthFixtureEvidenceSchema = z
  .object({
    fixtureOperatorId: StableIdSchema,
    fixtureOperatorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    fixtureArtifactHash: Sha256Schema,
    designedPackedSpanMm: z
      .object({ x: PositiveMmSchema, y: PositiveMmSchema })
      .strict(),
    enteredPackedSpanMm: z
      .object({ row: PositiveMmSchema, column: PositiveMmSchema })
      .strict(),
    rawDerivedFullCutWidthMm: z
      .object({ x: PositiveMmSchema, y: PositiveMmSchema })
      .strict(),
    normalizedFullCutWidthMm: z
      .object({ x: HundredthMmSchema.positive(), y: HundredthMmSchema.positive() })
      .strict(),
    formulaVersion: z.literal("1.0.0"),
    orientationProcessEvidenceState: z.literal("user-reported-unreviewed")
  })
  .strict()
  .superRefine((value, context) => {
    const normalizedX = Math.round(value.rawDerivedFullCutWidthMm.x * 100) / 100;
    const normalizedY = Math.round(value.rawDerivedFullCutWidthMm.y * 100) / 100;
    if (
      value.normalizedFullCutWidthMm.x !== normalizedX ||
      value.normalizedFullCutWidthMm.y !== normalizedY
    ) {
      context.addIssue({
        code: "custom",
        message: "Normalized fixture cut width must be the 0.01 mm reduction of raw evidence.",
        path: ["normalizedFullCutWidthMm"]
      });
    }
  });

export const InputPolicyFindingSchema = z
  .object({
    code: z.enum([
      "STOCK_MATERIAL_KIND_UNSUPPORTED",
      "STOCK_MEASUREMENT_OUT_OF_SUPPORTED_ENVELOPE",
      "STOCK_MEASUREMENT_OUTSIDE_PROVISIONAL_BAND",
      "STOCK_THICKNESS_VARIATION_HIGH",
      "STOCK_THICKNESS_UNMEASURED",
      "KERF_OUT_OF_SUPPORTED_ENVELOPE",
      "KERF_OUTSIDE_PROVISIONAL_BAND",
      "FIXTURE_PACKED_SPAN_INCOMPLETE",
      "FIXTURE_PACKED_SPAN_INVALID"
    ]),
    severity: z.enum(["warning", "error"]),
    message: z.string().min(1).max(400)
  })
  .strict();

export const MaterialKindSchema = z.enum([
  "basswood-plywood",
  "birch-plywood",
  "custom-plywood"
]);

export const InputPolicyEvaluationSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    policyId: StableIdSchema,
    policyVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    policyConfidence: z.enum(["provisional-preset", "physically-verified"]),
    materialKind: MaterialKindSchema,
    status: z.enum(["pass", "fail"]),
    thickness: z
      .object({
        basis: ThicknessBasisSchema,
        effectiveThicknessMm: HundredthMmSchema.positive(),
        measurement: ThicknessMeasurementSummarySchema.optional()
      })
      .strict()
      .superRefine((value, context) => {
        if (value.basis === "nominal-preset" && value.measurement !== undefined) {
          context.addIssue({
            code: "custom",
            message: "A nominal thickness preset must not contain invented caliper readings.",
            path: ["measurement"]
          });
        }
        if (
          value.basis !== "nominal-preset" &&
          value.measurement?.representativeThicknessMm !== value.effectiveThicknessMm
        ) {
          context.addIssue({
            code: "custom",
            message: "Measured thickness basis must retain matching measurement evidence.",
            path: ["measurement"]
          });
        }
      }),
    kerf: z
      .object({
        xMm: HundredthMmSchema.positive(),
        yMm: HundredthMmSchema.positive(),
        semantics: z.literal("full-cut-width"),
        resolutionUm: z.literal(10),
        confidence: z.enum(["provisional-preset", "coupon-selected"]),
        source: CutWidthSourceSchema,
        fixtureEvidence: CutWidthFixtureEvidenceSchema.optional()
      })
      .strict()
      .superRefine((value, context) => {
        if (value.source === "fixture-derived" && value.fixtureEvidence === undefined) {
          context.addIssue({
            code: "custom",
            message: "Fixture-derived cut width must retain its raw fixture evidence.",
            path: ["fixtureEvidence"]
          });
        }
        if (value.source !== "fixture-derived" && value.fixtureEvidence !== undefined) {
          context.addIssue({
            code: "custom",
            message: "Only fixture-derived cut width may retain fixture evidence.",
            path: ["fixtureEvidence"]
          });
        }
      }),
    findings: z.array(InputPolicyFindingSchema)
  })
  .strict()
  .superRefine((value, context) => {
    const hasError = value.findings.some((finding) => finding.severity === "error");
    if ((value.status === "fail") !== hasError) {
      context.addIssue({
        code: "custom",
        message: "Input-policy status must match the presence of error findings."
      });
    }
  });

export const MaterialProfileSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    name: z.string().min(1).max(120),
    materialKind: MaterialKindSchema,
    nominalThicknessMm: PositiveMmSchema,
    measuredThicknessMm: PositiveMmSchema,
    thicknessBasis: ThicknessBasisSchema.optional(),
    nominalStock: NominalStockReferenceSchema.optional(),
    batchId: z.string().min(1).max(120).nullable(),
    grainAxis: z.enum(["x", "y", "none"]),
    physicalState: z.enum(["provisional-preset", "coupon-selected", "machine-profiled"]),
    thicknessMeasurement: ThicknessMeasurementSummarySchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.thicknessBasis === "nominal-preset" && value.thicknessMeasurement !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Nominal stock must not serialize caliper samples that were not taken.",
        path: ["thicknessMeasurement"]
      });
    }
    if (
      value.thicknessBasis !== undefined &&
      value.thicknessBasis !== "nominal-preset" &&
      value.thicknessMeasurement === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Measured material provenance requires retained thickness readings.",
        path: ["thicknessMeasurement"]
      });
    }
    if (
      value.thicknessMeasurement !== undefined &&
      value.measuredThicknessMm !== value.thicknessMeasurement.representativeThicknessMm
    ) {
      context.addIssue({
        code: "custom",
        message: "Measured thickness must equal the representative sample thickness.",
        path: ["measuredThicknessMm"]
      });
    }
  });

export const StockFootprintSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    widthMm: HundredthMmSchema.positive(),
    heightMm: HundredthMmSchema.positive(),
    orientation: z.literal("machine-x-y"),
    materialProfileId: StableIdSchema,
    sheetId: StableIdSchema,
    source: z.enum(["user-reported", "reviewed"]),
    confidence: z.enum(["user-reported-unreviewed", "reviewed-evidence"]),
    evidenceId: StableIdSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.source === "reviewed" &&
      (value.confidence !== "reviewed-evidence" || value.evidenceId === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Reviewed stock footprint requires reviewed confidence and an evidence ID."
      });
    }
    if (
      value.source === "user-reported" &&
      value.confidence !== "user-reported-unreviewed"
    ) {
      context.addIssue({
        code: "custom",
        message: "User-reported stock footprint must remain unreviewed until evidence is reviewed."
      });
    }
  });

export const LayoutPolicySchema = z
  .object({
    id: StableIdSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    symmetricPaddingMm: NonNegativeMmSchema,
    interPartSpacingMm: NonNegativeMmSchema,
    purpose: z.literal("project-layout-padding-not-fixture-clearance")
  })
  .strict();

export const FabricationContextSchema = z
  .object({
    stockFootprint: StockFootprintSchema.nullable(),
    layoutPolicy: LayoutPolicySchema,
    placementConstraints: z
      .object({
        mode: z.literal("manual-framing-required"),
        fixtureKeepoutsModeled: z.literal(false),
        magneticFixtureClearanceMm: z.literal(5),
        magneticFixtureClearanceSource: z.literal("manual-handoff-check")
      })
      .strict()
  })
  .strict();

export const MachineProfileSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    name: z.string().min(1).max(120),
    manufacturer: z.literal("xTool"),
    model: z.literal("M2"),
    module: z.literal("20W blue-light laser"),
    processingMode: z.literal("flat-surface-lasering"),
    processingEnvelopeMm: z
      .object({
        width: PositiveMmSchema,
        height: PositiveMmSchema
      })
      .strict(),
    minimumFeatureMm: PositiveMmSchema,
    exportFormat: z.literal("svg"),
    downstreamApplication: z.literal("xTool Studio"),
    minimumStudioDesktopVersion: z.literal("1.7.30"),
    confidence: z.literal("vendor-documented-target")
  })
  .strict();

export const ProcessRecipeSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    machineProfileId: StableIdSchema,
    materialProfileId: StableIdSchema,
    materialBatchOrSheetId: z.string().min(1).max(120).nullable(),
    processingMode: z.literal("flat-surface-lasering"),
    studioDesktopVersion: z.string().min(1).max(40).nullable(),
    firmwareVersion: z.string().min(1).max(80).nullable(),
    materialPresetSource: z.enum(["xtool-material", "user-defined"]).nullable(),
    powerPercent: z.number().positive().max(100).nullable(),
    speedMmPerSecond: z.number().positive().nullable(),
    passCount: z.number().int().positive().nullable(),
    focusMode: z.enum(["manual", "auto-measure", "recorded-focus-descent"]).nullable(),
    focusDescentMm: NonNegativeMmSchema.nullable(),
    builtInAirPump: z.enum(["off", "low", "medium", "high", "recorded-other"]).nullable(),
    exhaustArrangement: z.string().min(1).max(200).nullable(),
    sheetOrientation: z.enum(["machine-x-grain-x", "machine-x-grain-y", "grain-none"]).nullable(),
    supportArrangement: z.string().min(1).max(200).nullable(),
    studioKerfOffsetMm: NonNegativeMmSchema.nullable(),
    cutWidth: z
      .object({
        xMm: HundredthMmSchema.positive(),
        yMm: HundredthMmSchema.positive(),
        semantics: z.literal("full-cut-width"),
        source: CutWidthSourceSchema,
        fixtureEvidence: CutWidthFixtureEvidenceSchema.optional(),
        recipeHash: Sha256Schema.nullable()
      })
      .strict(),
    recipeHash: Sha256Schema.nullable(),
    evidenceStatus: z.enum(["unrecorded", "user-reported", "reviewed"])
  })
  .strict()
  .superRefine((value, context) => {
    if (value.cutWidth.source === "fixture-derived" && value.cutWidth.fixtureEvidence === undefined) {
      context.addIssue({
        code: "custom",
        message: "Fixture-derived cut width requires raw fixture evidence.",
        path: ["cutWidth", "fixtureEvidence"]
      });
    }
    if (value.cutWidth.source !== "fixture-derived" && value.cutWidth.fixtureEvidence !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Only fixture-derived cut width may retain fixture evidence.",
        path: ["cutWidth", "fixtureEvidence"]
      });
    }
    if (value.evidenceStatus === "unrecorded") {
      if (value.recipeHash !== null || value.cutWidth.recipeHash !== null) {
        context.addIssue({
          code: "custom",
          message: "Unrecorded recipe state cannot claim a portable recipe hash."
        });
      }
      return;
    }
    const required = [
      value.studioDesktopVersion,
      value.firmwareVersion,
      value.materialPresetSource,
      value.powerPercent,
      value.speedMmPerSecond,
      value.passCount,
      value.focusMode,
      value.builtInAirPump,
      value.exhaustArrangement,
      value.sheetOrientation,
      value.supportArrangement,
      value.studioKerfOffsetMm
    ];
    if (required.some((item) => item === null)) {
      context.addIssue({
        code: "custom",
        message: "Portable cut-width evidence requires a complete recorded process recipe."
      });
    }
    if (value.focusMode === "recorded-focus-descent" && value.focusDescentMm === null) {
      context.addIssue({
        code: "custom",
        message: "Recorded focus-descent mode requires the matching focus-descent distance."
      });
    }
    if (
      value.recipeHash === null ||
      value.cutWidth.recipeHash === null ||
      value.recipeHash !== value.cutWidth.recipeHash
    ) {
      context.addIssue({
        code: "custom",
        message: "Recorded cut width must reference the matching process-recipe hash."
      });
    }
    if (value.studioKerfOffsetMm !== 0) {
      context.addIssue({
        code: "custom",
        message: "SketchyCut-compensated recipe evidence requires xTool Studio Kerf Offset off/0."
      });
    }
  });

const FitClassSchema = z
  .object({
    totalDeltaMm: z.number(),
    confidence: z.enum(["provisional", "coupon-selected"])
  })
  .strict();

export const FitProfileSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    name: z.string().min(1).max(120),
    deltaSemantics: z.literal("opening-size-minus-insert-size"),
    press: FitClassSchema,
    snug: FitClassSchema,
    sliding: FitClassSchema,
    rotating: FitClassSchema,
    rod: FitClassSchema
  })
  .strict();

export const PartFeatureSchema = z
  .object({
    id: StableIdSchema,
    kind: z.enum([
      "outer-boundary",
      "slot",
      "tab",
      "bore",
      "kerf-sample",
      "score-label",
      "engrave-sample",
      "keepout",
      "treatment",
      "part-label",
      "joint-keepout",
      "safe-treatment-region",
      "hinge-leaf",
      "guide-rail",
      "capture-face",
      "thumb-access",
      "retainer-seat",
      "stop-face"
    ]),
    operation: z.enum(["cut", "score", "engrave", "none"]),
    surfaceSide: z.enum(["front", "back"]).optional(),
    toolpathCompensation: z.enum(["profile", "none"]).optional(),
    fitClass: z.enum(["press", "snug", "sliding", "rotating", "rod"]).nullable(),
    jointId: StableIdSchema.nullable(),
    region: Region2DSchema.nullable(),
    path: PolylineUmSchema.nullable(),
    parametersUm: z.record(z.string(), IntegerUmSchema)
  })
  .strict()
  .superRefine((value, context) => {
    const geometryCount = Number(value.region !== null) + Number(value.path !== null);
    if (geometryCount !== 1) {
      context.addIssue({
        code: "custom",
        message: "Each feature must contain exactly one region or path geometry."
      });
    }
    if (
      value.operation === "engrave" &&
      (value.region === null || value.path !== null || value.region.holes.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "ENGRAVE_REQUIRES_SIMPLE_CLOSED_AREA: vector Engrave requires one exactly closed simple region without holes."
      });
    }
    if (value.operation === "score" && (value.path === null || value.region !== null)) {
      context.addIssue({
        code: "custom",
        message: "SCORE_REQUIRES_CENTERLINE: Score geometry must be represented by a vector centerline path."
      });
    }
  });

export const SheetPartSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    name: z.string().min(1).max(120),
    role: z.enum([
      "coupon-base",
      "coupon-insert",
      "coupon-pin",
      "generic-panel",
      "structural-panel",
      "moving-panel",
      "hinge-leaf",
      "guide-rail",
      "retainer",
      "motion-stop"
    ]),
    markingCode: StableIdSchema.optional(),
    materialProfileId: StableIdSchema,
    thicknessUm: PositiveIntegerUmSchema,
    grainVector: z
      .object({
        x: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
        y: z.union([z.literal(-1), z.literal(0), z.literal(1)])
      })
      .strict()
      .refine((value) => value.x !== 0 || value.y !== 0, "Grain vector cannot be zero."),
    nominalRegion: Region2DSchema,
    features: z.array(PartFeatureSchema),
    assembledFrame: Frame3DSchema,
    explodedOffset: Vector3UmSchema,
    assemblyDependencyPartIds: z.array(StableIdSchema),
    sourceOperator: z
      .object({
        id: StableIdSchema,
        version: z.string().regex(/^\d+\.\d+\.\d+$/)
      })
      .strict()
  })
  .strict();

export const JointSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    kind: z.enum([
      "panel-tab-slot",
      "finger-mate",
      "pin-bore",
      "calibration-pair",
      "rigid-mate",
      "retainer-seat",
      "captured-slide"
    ]),
    between: z.tuple([
      z
        .object({
          partId: StableIdSchema,
          featureId: StableIdSchema
        })
        .strict(),
      z
        .object({
          partId: StableIdSchema,
          featureId: StableIdSchema
        })
        .strict()
    ]),
    fitClass: z.enum(["press", "snug", "sliding", "rotating", "rod"]),
    nominalClearanceUm: IntegerUmSchema,
    insertionDirection: UnitVector3Schema,
    realization: z
      .discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("tab-slot"),
            insertPartId: StableIdSchema,
            openingPartId: StableIdSchema,
            insertFeatureIds: z.array(StableIdSchema).min(1),
            openingFeatureIds: z.array(StableIdSchema).min(1),
            clearanceAxis: UnitVector3Schema,
            openingMinusInsertUm: IntegerUmSchema,
            mateBoundsWorldUm: z
              .array(
                z
                  .object({
                    id: StableIdSchema,
                    minimum: Vector3UmSchema,
                    maximum: Vector3UmSchema
                  })
                  .strict(),
              )
              .min(1)
          })
          .strict(),
        z
          .object({
            kind: z.literal("edge-finger"),
            firstPartId: StableIdSchema,
            secondPartId: StableIdSchema,
            firstFeatureId: StableIdSchema,
            secondFeatureId: StableIdSchema,
            spanStartUm: IntegerUmSchema,
            spanEndUm: IntegerUmSchema,
            intervals: z
              .array(
                z
                  .object({
                    id: StableIdSchema,
                    startUm: IntegerUmSchema,
                    endUm: IntegerUmSchema,
                    occupiedByPartId: StableIdSchema
                  })
                  .strict(),
              )
              .min(2),
            overlapBoundsWorldUm: z
              .object({
                minimum: Vector3UmSchema,
                maximum: Vector3UmSchema
              })
              .strict()
          })
          .strict()
      ])
      .optional()
  })
  .strict();

const PanelEdgeSchema = z.enum(["bottom", "right", "top", "left"]);

export const OrthogonalPanelProgramV1Schema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    programId: StableIdSchema,
    projectId: StableIdSchema,
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(1_000),
    materialProfileId: StableIdSchema,
    machineProfileId: StableIdSchema,
    fitProfileId: StableIdSchema,
    deterministicSeed: z.string().min(1).max(120),
    panels: z
      .array(
        z
          .object({
            id: StableIdSchema,
            name: z.string().min(1).max(120),
            markingCode: StableIdSchema,
            widthUm: PositiveIntegerUmSchema,
            heightUm: PositiveIntegerUmSchema,
            bodyInsetUm: z
              .object({
                bottom: NonNegativeMmSchema.int(),
                right: NonNegativeMmSchema.int(),
                top: NonNegativeMmSchema.int(),
                left: NonNegativeMmSchema.int()
              })
              .strict(),
            frame: Frame3DSchema,
            explodedOffset: Vector3UmSchema,
            grainVector: z
              .object({
                x: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
                y: z.union([z.literal(-1), z.literal(0), z.literal(1)])
              })
              .strict()
              .refine((value) => value.x !== 0 || value.y !== 0, "Grain vector cannot be zero.")
          })
          .strict(),
      )
      .min(2),
    tabSlotMates: z.array(
      z
        .object({
          id: StableIdSchema,
          insertPartId: StableIdSchema,
          openingPartId: StableIdSchema,
          insertEdge: PanelEdgeSchema,
          fitClass: z.enum(["press", "snug"]),
          tabCount: z.number().int().min(2).max(9),
          endInsetUm: PositiveIntegerUmSchema,
          tabDepthUm: PositiveIntegerUmSchema
        })
        .strict(),
    ),
    edgeMates: z.array(
      z
        .object({
          id: StableIdSchema,
          firstPartId: StableIdSchema,
          firstEdge: PanelEdgeSchema,
          secondPartId: StableIdSchema,
          secondEdge: PanelEdgeSchema,
          spanStartUm: NonNegativeMmSchema.int(),
          spanEndUm: PositiveIntegerUmSchema,
          fingerCount: z.number().int().min(3).max(15).refine((value) => value % 2 === 1, "Finger count must be odd."),
          insertionDirection: UnitVector3Schema
        })
        .strict()
        .refine((value) => value.spanEndUm > value.spanStartUm, "Edge mate span is inverted."),
    ),
    treatments: z.array(
      z
        .object({
          id: StableIdSchema,
          partId: StableIdSchema,
          primitive: z.enum(["parallel-lines", "inset-frame", "corner-ticks"]),
          operation: z.literal("score"),
          insetUm: PositiveIntegerUmSchema,
          count: z.number().int().min(1).max(12)
        })
        .strict(),
    ),
    assemblyGroups: z
      .array(
        z
          .object({
            id: StableIdSchema,
            order: z.number().int().nonnegative(),
            action: z.enum(["align", "insert", "verify"]),
            partIds: z.array(StableIdSchema).min(1),
            jointIds: z.array(StableIdSchema),
            direction: UnitVector3Schema.nullable(),
            dependsOnActionIds: z.array(StableIdSchema),
            instructionKey: StableIdSchema
          })
          .strict(),
      )
      .min(1)
  })
  .strict()
  .superRefine((program, context) => {
    const partIds = new Set(program.panels.map((panel) => panel.id));
    const jointIds = new Set([
      ...program.tabSlotMates.map((mate) => mate.id),
      ...program.edgeMates.map((mate) => mate.id)
    ]);
    const actionIds = new Set(program.assemblyGroups.map((group) => group.id));
    const requirePart = (partId: string, path: (string | number)[]): void => {
      if (!partIds.has(partId)) {
        context.addIssue({ code: "custom", message: `Unknown panel ${partId}.`, path });
      }
    };
    for (const [index, mate] of program.tabSlotMates.entries()) {
      requirePart(mate.insertPartId, ["tabSlotMates", index, "insertPartId"]);
      requirePart(mate.openingPartId, ["tabSlotMates", index, "openingPartId"]);
    }
    for (const [index, mate] of program.edgeMates.entries()) {
      requirePart(mate.firstPartId, ["edgeMates", index, "firstPartId"]);
      requirePart(mate.secondPartId, ["edgeMates", index, "secondPartId"]);
    }
    for (const [index, treatment] of program.treatments.entries()) {
      requirePart(treatment.partId, ["treatments", index, "partId"]);
    }
    for (const [index, group] of program.assemblyGroups.entries()) {
      for (const partId of group.partIds) {
        requirePart(partId, ["assemblyGroups", index, "partIds"]);
      }
      for (const jointId of group.jointIds) {
        if (!jointIds.has(jointId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown joint ${jointId}.`,
            path: ["assemblyGroups", index, "jointIds"]
          });
        }
      }
      for (const dependencyId of group.dependsOnActionIds) {
        if (!actionIds.has(dependencyId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown assembly action ${dependencyId}.`,
            path: ["assemblyGroups", index, "dependsOnActionIds"]
          });
        }
      }
    }
  });

const QuantizedTenUmSchema = PositiveIntegerUmSchema.refine(
  (value) => value % 10 === 0,
  "Measured stock dimensions must be quantized to 10 micrometres.",
);

export const ExternalStockItemSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    name: z.string().min(1).max(120),
    kind: z.enum(["wooden-dowel", "bamboo-skewer", "custom-wooden-pin"]),
    stockProfile: z
      .object({
        id: StableIdSchema,
        sourceLabel: z.string().min(1).max(160),
        nominalDiameterUm: PositiveIntegerUmSchema,
        measuredDiameterUm: QuantizedTenUmSchema,
        measuredMinimumDiameterUm: QuantizedTenUmSchema,
        measuredMaximumDiameterUm: QuantizedTenUmSchema,
        measurementResolutionUm: z.literal(10),
        straightnessEvidence: z.enum(["unverified", "user-reported", "reviewed-measurement"]),
        diameterBasis: z.enum(["nominal-preset", "user-reported-caliper"]).optional()
      })
      .strict()
      .superRefine((profile, context) => {
        if (
          profile.measuredMinimumDiameterUm > profile.measuredDiameterUm ||
          profile.measuredDiameterUm > profile.measuredMaximumDiameterUm
        ) {
          context.addIssue({
            code: "custom",
            message: "Measured pin diameter must remain inside its recorded measured range."
          });
        }
      }),
    quantity: z.number().int().positive(),
    cutLengthUm: PositiveIntegerUmSchema,
    pose: Frame3DSchema,
    interfaceIds: z.array(StableIdSchema).min(1),
    retention: z
      .object({
        method: z.literal("opposed-sheet-guards"),
        retainerPartIds: z.array(StableIdSchema).length(2),
        insertionDirection: UnitVector3Schema,
        axialEndplayUm: PositiveIntegerUmSchema,
        installationClearanceUm: PositiveIntegerUmSchema
      })
      .strict(),
    assemblyDependencyPartIds: z.array(StableIdSchema),
    evidenceState: z.enum([
      "provisional-preset",
      "user-reported",
      "coupon-selected",
      "reviewed-measurement"
    ])
  })
  .strict();

export const ConstructionSelectionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    operatorId: StableIdSchema,
    operatorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    searchPolicyId: StableIdSchema,
    searchPolicyVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    preferredCandidateId: StableIdSchema,
    selectedCandidateId: StableIdSchema,
    changedConstruction: z.boolean(),
    attempts: z
      .array(
        z
          .object({
            candidateId: StableIdSchema,
            status: z.enum(["rejected", "selected"]),
            findingCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/))
          })
          .strict(),
      )
      .min(1),
    disclosure: z.string().min(1).max(500)
  })
  .strict()
  .superRefine((selection, context) => {
    if (
      selection.changedConstruction !==
      (selection.selectedCandidateId !== selection.preferredCandidateId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Construction-change disclosure must match the selected candidate."
      });
    }
    const selected = selection.attempts.filter((attempt) => attempt.status === "selected");
    if (
      selected.length !== 1 ||
      selected[0]?.candidateId !== selection.selectedCandidateId
    ) {
      context.addIssue({
        code: "custom",
        message: "Construction search must record exactly one selected attempt."
      });
    }
  });

export const RetainedPinProgramV1Schema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    programId: StableIdSchema,
    projectId: StableIdSchema,
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(1_000),
    deterministicSeed: z.string().min(1).max(120),
    supportProgram: OrthogonalPanelProgramV1Schema,
    mechanism: z
      .object({
        movingPanelId: StableIdSchema,
        movingPanelName: z.string().min(1).max(120),
        movingPanelMarkingCode: StableIdSchema,
        stationaryAnchorPartId: StableIdSchema,
        panelWidthUm: PositiveIntegerUmSchema,
        panelDepthUm: PositiveIntegerUmSchema,
        axis: z
          .object({
            origin: Vector3UmSchema,
            direction: UnitVector3Schema
          })
          .strict(),
        stationSpan: z
          .object({
            startUm: IntegerUmSchema,
            endUm: IntegerUmSchema
          })
          .strict()
          .refine((value) => value.endUm > value.startUm, "Hinge station span is inverted."),
        openAngleDegrees: z.number().min(80).max(135),
        axialEndplayUm: PositiveIntegerUmSchema,
        installationClearanceUm: PositiveIntegerUmSchema,
        pin: z
          .object({
            kind: z.enum(["wooden-dowel", "bamboo-skewer", "custom-wooden-pin"]),
            stockProfileId: StableIdSchema,
            sourceLabel: z.string().min(1).max(160),
            nominalDiameterUm: PositiveIntegerUmSchema,
            measuredDiameterUm: QuantizedTenUmSchema,
            measuredMinimumDiameterUm: QuantizedTenUmSchema,
            measuredMaximumDiameterUm: QuantizedTenUmSchema,
            straightnessEvidence: z.enum(["unverified", "user-reported", "reviewed-measurement"]),
            evidenceState: z.enum([
              "provisional-preset",
              "user-reported",
              "coupon-selected",
              "reviewed-measurement"
            ]),
            diameterBasis: z.enum(["nominal-preset", "user-reported-caliper"]).optional()
          })
          .strict()
          .superRefine((pin, context) => {
            if (
              pin.measuredMinimumDiameterUm > pin.measuredDiameterUm ||
              pin.measuredDiameterUm > pin.measuredMaximumDiameterUm
            ) {
              context.addIssue({
                code: "custom",
                message: "Measured pin diameter must remain inside its recorded measured range."
              });
            }
          })
      })
      .strict()
  })
  .strict()
  .superRefine((program, context) => {
    if (
      Math.abs(program.mechanism.axis.direction.x - 1) > 1e-9 ||
      Math.abs(program.mechanism.axis.direction.y) > 1e-9 ||
      Math.abs(program.mechanism.axis.direction.z) > 1e-9
    ) {
      context.addIssue({
        code: "custom",
        message: "Retained-pin V1 accepts only the registered positive-X axis/section assumption.",
        path: ["mechanism", "axis", "direction"]
      });
    }
    if (
      !program.supportProgram.panels.some(
        (panel) => panel.id === program.mechanism.stationaryAnchorPartId,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "The stationary hinge anchor must be produced by the support composition.",
        path: ["mechanism", "stationaryAnchorPartId"]
      });
    }
  });

export const CapturedSlideProgramV1Schema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    programId: StableIdSchema,
    projectId: StableIdSchema,
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(1_000),
    deterministicSeed: z.string().min(1).max(120),
    supportProgram: OrthogonalPanelProgramV1Schema,
    mechanism: z
      .object({
        movingPanelId: StableIdSchema,
        movingPanelName: z.string().min(1).max(120),
        movingPanelMarkingCode: StableIdSchema,
        stationaryAnchorPartIds: z.array(StableIdSchema).length(3),
        panelWidthUm: PositiveIntegerUmSchema,
        panelDepthUm: PositiveIntegerUmSchema,
        axis: z
          .object({
            origin: Vector3UmSchema,
            direction: UnitVector3Schema
          })
          .strict(),
        normalTravelUm: PositiveIntegerUmSchema,
        removalTravelUm: PositiveIntegerUmSchema,
        minimumGuideEngagementUm: PositiveIntegerUmSchema,
        verticalRunningClearanceUm: PositiveIntegerUmSchema,
        lateralRunningClearanceUm: PositiveIntegerUmSchema,
        thumbAccessWidthUm: PositiveIntegerUmSchema,
        thumbAccessDepthUm: PositiveIntegerUmSchema
      })
      .strict()
      .superRefine((mechanism, context) => {
        if (mechanism.removalTravelUm <= mechanism.normalTravelUm) {
          context.addIssue({
            code: "custom",
            message: "The removal position must be beyond the normal fully-open stop.",
            path: ["removalTravelUm"]
          });
        }
        if (
          mechanism.normalTravelUm + mechanism.minimumGuideEngagementUm >
          mechanism.panelDepthUm
        ) {
          context.addIssue({
            code: "custom",
            message: "Normal travel must retain the declared minimum guide engagement.",
            path: ["minimumGuideEngagementUm"]
          });
        }
      })
  })
  .strict()
  .superRefine((program, context) => {
    const { direction } = program.mechanism.axis;
    if (
      Math.abs(direction.x) > 1e-9 ||
      Math.abs(direction.y + 1) > 1e-9 ||
      Math.abs(direction.z) > 1e-9
    ) {
      context.addIssue({
        code: "custom",
        message: "Captured-slide V1 accepts only the registered negative-Y axis/transverse-section assumption.",
        path: ["mechanism", "axis", "direction"]
      });
    }
    const supportPartIds = new Set(
      program.supportProgram.panels.map((panel) => panel.id),
    );
    for (const [index, partId] of program.mechanism.stationaryAnchorPartIds.entries()) {
      if (!supportPartIds.has(partId)) {
        context.addIssue({
          code: "custom",
          message: "Every stationary slide anchor must be produced by the support composition.",
          path: ["mechanism", "stationaryAnchorPartIds", index]
        });
      }
    }
  });

const RevoluteSectionPrimitiveSchema = z
  .object({
    id: StableIdSchema,
    ownerId: StableIdSchema,
    behavior: z.enum(["moving", "stationary"]),
    axialStartUm: IntegerUmSchema,
    axialEndUm: IntegerUmSchema,
    polygon: z.array(PointUmSchema).min(3)
  })
  .strict()
  .refine((value) => value.axialEndUm > value.axialStartUm, "Section axial span is inverted.");

const RevoluteProofModelSchema = z
  .object({
    method: z.literal("axis-partition-conservative-angle-interval"),
    assumptionVersion: z.literal("1.0.0"),
    inflationUm: NonNegativeMmSchema.int(),
    maximumAngleIntervalDegrees: z.number().positive().max(10),
    animationSampleMaximumDegrees: z.number().positive().max(2),
    axisPartitionBoundariesUm: z.array(IntegerUmSchema).min(2),
    sectionPrimitives: z.array(RevoluteSectionPrimitiveSchema).min(1),
    allowedEndpointContacts: z.array(
      z
        .object({
          id: StableIdSchema,
          movingPrimitiveId: StableIdSchema,
          stationaryPrimitiveId: StableIdSchema,
          angleDegrees: z.number(),
          transitionDegrees: z.number().positive().max(5),
          maximumContactGapUm: NonNegativeMmSchema.int(),
          approach: z.literal("operator-tangent-stop")
        })
        .strict(),
    ),
    sectionIntervals: z
      .array(
        z
          .object({
            id: StableIdSchema,
            axialStartUm: IntegerUmSchema,
            axialEndUm: IntegerUmSchema,
            movingPrimitiveIds: z.array(StableIdSchema),
            stationaryPrimitiveIds: z.array(StableIdSchema)
          })
          .strict()
          .refine((value) => value.axialEndUm > value.axialStartUm, "Axis interval is inverted."),
      )
      .min(1)
  })
  .strict()
  .superRefine((model, context) => {
    const sorted = [...model.axisPartitionBoundariesUm].sort((left, right) => left - right);
    if (
      new Set(sorted).size !== sorted.length ||
      sorted.some((value, index) => value !== model.axisPartitionBoundariesUm[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "Axis partition boundaries must be strictly increasing and unique."
      });
    }
    const primitiveIds = new Set(model.sectionPrimitives.map((primitive) => primitive.id));
    for (const [index, contact] of model.allowedEndpointContacts.entries()) {
      if (
        !primitiveIds.has(contact.movingPrimitiveId) ||
        !primitiveIds.has(contact.stationaryPrimitiveId)
      ) {
        context.addIssue({
          code: "custom",
          message: "Endpoint contact references an unknown section primitive.",
          path: ["allowedEndpointContacts", index]
        });
      }
    }
    for (const [index, interval] of model.sectionIntervals.entries()) {
      for (const primitiveId of [
        ...interval.movingPrimitiveIds,
        ...interval.stationaryPrimitiveIds
      ]) {
        if (!primitiveIds.has(primitiveId)) {
          context.addIssue({
            code: "custom",
            message: `Axis interval references unknown section primitive ${primitiveId}.`,
            path: ["sectionIntervals", index]
          });
        }
      }
    }
  });

const RevoluteConstraintDetailsSchema = z
  .object({
    rotationSign: z.literal(-1),
    pinStockItemId: StableIdSchema,
    boreDiameterUm: PositiveIntegerUmSchema,
    totalDiametralClearanceUm: PositiveIntegerUmSchema,
    axialEndplayUm: PositiveIntegerUmSchema,
    minimumBoreLigamentUm: PositiveIntegerUmSchema,
    coaxialToleranceUm: PositiveIntegerUmSchema,
    stations: z
      .array(
        z
          .object({
            id: StableIdSchema,
            partId: StableIdSchema,
            featureId: StableIdSchema,
            axisPoint: Vector3UmSchema,
            axisDirection: UnitVector3Schema,
            axialCenterUm: IntegerUmSchema,
            boreDiameterUm: PositiveIntegerUmSchema,
            boreLigamentUm: NonNegativeMmSchema.int()
          })
          .strict(),
      )
      .min(3),
    retention: z
      .object({
        retainerPartIds: z.array(StableIdSchema).length(2),
        installationSide: z.enum(["negative-axis", "positive-axis"]),
        installationClearanceUm: PositiveIntegerUmSchema,
        retainedTravel: z
          .object({
            minimumDegrees: z.number(),
            maximumDegrees: z.number()
          })
          .strict()
      })
      .strict(),
    stops: z
      .object({
        closed: z
          .object({
            angleDegrees: z.number(),
            fixedPartIds: z.array(StableIdSchema).length(2),
            fixedFeatureIds: z.array(StableIdSchema).length(2),
            movingPartId: StableIdSchema,
            movingFeatureId: StableIdSchema,
            contactGapUm: NonNegativeMmSchema.int()
          })
          .strict(),
        open: z
          .object({
            angleDegrees: z.number().positive(),
            fixedPartId: StableIdSchema,
            fixedFeatureId: StableIdSchema,
            movingPartId: StableIdSchema,
            movingFeatureId: StableIdSchema,
            contactGapUm: NonNegativeMmSchema.int()
          })
          .strict()
      })
      .strict(),
    proofModel: RevoluteProofModelSchema
  })
  .strict();

const PrismaticProofPrimitiveSchema = z
  .object({
    id: StableIdSchema,
    ownerId: StableIdSchema,
    featureId: StableIdSchema.nullable(),
    behavior: z.enum(["moving", "stationary"]),
    axialStartUm: IntegerUmSchema,
    axialEndUm: IntegerUmSchema,
    transverseRegion: Region2DSchema
  })
  .strict()
  .refine((value) => value.axialEndUm > value.axialStartUm, "Prismatic axial span is inverted.");

const PrismaticForbiddenIntervalSchema = z
  .object({
    id: StableIdSchema,
    movingPrimitiveId: StableIdSchema,
    stationaryPrimitiveId: StableIdSchema,
    minimumExclusiveUm: IntegerUmSchema,
    maximumExclusiveUm: IntegerUmSchema
  })
  .strict()
  .refine(
    (value) => value.maximumExclusiveUm > value.minimumExclusiveUm,
    "Forbidden travel interval is inverted.",
  );

const PrismaticConstraintDetailsSchema = z
  .object({
    normalTravelUm: z
      .object({ minimum: IntegerUmSchema, maximum: IntegerUmSchema })
      .strict()
      .refine((value) => value.maximum > value.minimum, "Normal slide travel is inverted."),
    states: z
      .object({
        closedUm: IntegerUmSchema,
        fullyOpenUm: IntegerUmSchema,
        removal: z
          .object({
            positionUm: IntegerUmSchema,
            requiresRetainerRemoval: z.literal(true),
            retainerPartIds: z.array(StableIdSchema).length(1)
          })
          .strict()
      })
      .strict(),
    runningClearance: z
      .object({
        verticalTotalUm: PositiveIntegerUmSchema,
        lateralTotalUm: PositiveIntegerUmSchema,
        projectedFinishedVerticalUm: PositiveIntegerUmSchema,
        projectedFinishedLateralUm: PositiveIntegerUmSchema,
        compensationMethod: z.literal("nominal-boundary-reconstruction")
      })
      .strict(),
    capture: z
      .object({
        vertical: z
          .object({
            lowerSupportMaximumZUm: IntegerUmSchema,
            panelMinimumZUm: IntegerUmSchema,
            panelMaximumZUm: IntegerUmSchema,
            upperRetainerMinimumZUm: IntegerUmSchema,
            lowerClearanceUm: PositiveIntegerUmSchema,
            upperClearanceUm: PositiveIntegerUmSchema,
            retainerOverlapUm: PositiveIntegerUmSchema
          })
          .strict(),
        lateral: z
          .object({
            leftGuideInnerXUm: IntegerUmSchema,
            panelMinimumXUm: IntegerUmSchema,
            panelMaximumXUm: IntegerUmSchema,
            rightGuideInnerXUm: IntegerUmSchema,
            leftClearanceUm: PositiveIntegerUmSchema,
            rightClearanceUm: PositiveIntegerUmSchema,
            guideOverlapUm: PositiveIntegerUmSchema
          })
          .strict(),
        railEngagement: z
          .array(
            z
              .object({
                guidePartId: StableIdSchema,
                movingAxialStartUm: IntegerUmSchema,
                movingAxialEndUm: IntegerUmSchema,
                guideAxialStartUm: IntegerUmSchema,
                guideAxialEndUm: IntegerUmSchema,
                minimumRequiredUm: PositiveIntegerUmSchema
              })
              .strict()
              .superRefine((value, context) => {
                if (
                  value.movingAxialEndUm <= value.movingAxialStartUm ||
                  value.guideAxialEndUm <= value.guideAxialStartUm
                ) {
                  context.addIssue({
                    code: "custom",
                    message: "Rail engagement spans must be strictly positive."
                  });
                }
              }),
          )
          .length(2)
      })
      .strict(),
    stops: z
      .object({
        closed: z
          .object({
            positionUm: IntegerUmSchema,
            fixedPartId: StableIdSchema,
            fixedFeatureId: StableIdSchema,
            movingPartId: StableIdSchema,
            movingFeatureId: StableIdSchema,
            contactGapUm: z.literal(0),
            wallThicknessUm: PositiveIntegerUmSchema
          })
          .strict(),
        open: z
          .object({
            positionUm: IntegerUmSchema,
            fixedPartId: StableIdSchema,
            fixedFeatureId: StableIdSchema,
            movingPartId: StableIdSchema,
            movingFeatureId: StableIdSchema,
            contactGapUm: z.literal(0)
          })
          .strict()
      })
      .strict(),
    retention: z
      .object({
        guidePartIds: z.array(StableIdSchema).length(2),
        removableRetainerPartIds: z.array(StableIdSchema).length(1),
        mechanicalJointIds: z.array(StableIdSchema).min(3),
        method: z.literal("headed-tabs-and-keyed-stop"),
        glueRequired: z.literal(false)
      })
      .strict(),
    thumbAccess: z
      .object({
        partId: StableIdSchema,
        featureId: StableIdSchema,
        widthUm: PositiveIntegerUmSchema,
        depthUm: PositiveIntegerUmSchema
      })
      .strict(),
    proofModel: z
      .object({
        method: z.literal("transverse-overlap-axial-forbidden-intervals"),
        assumptionVersion: z.literal("1.0.0"),
        transverseInflationUm: NonNegativeMmSchema.int(),
        animationSampleMaximumUm: z.literal(1_000),
        movingPrimitives: z.array(PrismaticProofPrimitiveSchema).min(1),
        stationaryPrimitives: z.array(PrismaticProofPrimitiveSchema).min(1),
        forbiddenIntervals: z.array(PrismaticForbiddenIntervalSchema).min(2),
        allowedEndpointContacts: z
          .array(
            z
              .object({
                id: StableIdSchema,
                movingPrimitiveId: StableIdSchema,
                stationaryPrimitiveId: StableIdSchema,
                positionUm: IntegerUmSchema,
                contactGapUm: z.literal(0)
              })
              .strict(),
          )
          .length(2)
      })
      .strict()
  })
  .strict();

export const MotionConstraintSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    kind: z.enum(["fixed", "revolute", "prismatic"]),
    bodyPartIds: z.array(StableIdSchema).min(1),
    axis: z
      .object({
        origin: Vector3UmSchema,
        direction: UnitVector3Schema
      })
      .strict(),
    range: z
      .object({
        minimum: z.number(),
        maximum: z.number(),
        unit: z.enum(["degree", "mm"])
      })
      .strict()
      .refine((value) => value.maximum >= value.minimum, "Motion range is inverted."),
    revolute: RevoluteConstraintDetailsSchema.optional(),
    prismatic: PrismaticConstraintDetailsSchema.optional()
  })
  .strict()
  .superRefine((constraint, context) => {
    if ((constraint.kind === "revolute") !== (constraint.revolute !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only revolute constraints may contain the revolute proof contract."
      });
    }
    if ((constraint.kind === "prismatic") !== (constraint.prismatic !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only prismatic constraints may contain the prismatic proof contract."
      });
    }
    if (constraint.kind === "revolute" && constraint.range.unit !== "degree") {
      context.addIssue({
        code: "custom",
        message: "Revolute constraints must declare their range in degrees."
      });
    }
    if (constraint.kind === "prismatic" && constraint.range.unit !== "mm") {
      context.addIssue({
        code: "custom",
        message: "Prismatic constraints must declare their range in millimetres."
      });
    }
  });

export const AssemblyActionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    order: z.number().int().nonnegative(),
    action: z.enum(["align", "insert", "rotate", "translate", "verify", "remove"]),
    partIds: z.array(StableIdSchema).min(1),
    stockItemIds: z.array(StableIdSchema).optional(),
    jointIds: z.array(StableIdSchema),
    direction: UnitVector3Schema.nullable(),
    dependsOnActionIds: z.array(StableIdSchema),
    instructionKey: StableIdSchema,
    phase: z.enum(["assembly", "disassembly"]).optional()
  })
  .strict();

export const FindingSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
    severity: z.enum(["error", "warning", "info"]),
    owner: StableIdSchema,
    relatedIds: z.array(StableIdSchema),
    message: z.string().min(1).max(500),
    blocksExport: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.blocksExport !== (value.severity === "error")) {
      context.addIssue({
        code: "custom",
        message: "Only error findings may block export, and every error must block export."
      });
    }
  });

export const ValidationReportSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    status: z.enum(["pass", "fail"]),
    findings: z.array(FindingSchema)
  })
  .strict()
  .superRefine((value, context) => {
    const hasError = value.findings.some((finding) => finding.severity === "error");
    if ((value.status === "fail") !== hasError) {
      context.addIssue({
        code: "custom",
        message: "Validation status must match the presence of error findings."
      });
    }
  });

export const CalibrationMeasurementSpecSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    operatorId: StableIdSchema,
    operatorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    kind: z.literal("accumulated-full-kerf"),
    pieceIds: z.array(StableIdSchema).length(10),
    pieceCount: z.literal(10),
    nominalPackedSpanUm: z
      .object({
        x: PositiveIntegerUmSchema,
        y: PositiveIntegerUmSchema
      })
      .strict(),
    resultResolutionUm: z.literal(10),
    semantics: z.literal("full-cut-width"),
    formulaVersion: z.literal("1.0.0"),
    orientationMarker: z.literal("scored-top-left-corner"),
    confidence: z.literal("provisional-preset")
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.pieceIds).size !== value.pieceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Accumulated-kerf measurement piece IDs must be unique.",
        path: ["pieceIds"]
      });
    }
  });

export const DesignDocumentV1Schema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    projectId: StableIdSchema,
    request: DesignRequestV1Schema,
    intent: z.union([IntentFixtureV1Schema, IntentGraphV1Schema]),
    resolvedInputs: z
      .object({
        material: MaterialProfileSchema,
        machine: MachineProfileSchema,
        processRecipe: ProcessRecipeSchema,
        fabricationContext: FabricationContextSchema,
        fit: FitProfileSchema,
        hardwarePolicy: z
          .object({
            glueAllowed: z.literal(false),
            permittedKinds: z.array(z.enum(["sheet-part", "wooden-pin", "wooden-rod", "toothpick", "wedge", "key"]))
          })
          .strict()
      })
      .strict(),
    operatorProgram: z.array(
      z
        .object({
          operatorId: StableIdSchema,
          operatorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
          parameterHash: Sha256Schema
        })
        .strict(),
    ),
    parts: z.array(SheetPartSchema).min(1),
    externalStock: z.array(ExternalStockItemSchema).optional(),
    joints: z.array(JointSchema),
    motionConstraints: z.array(MotionConstraintSchema),
    assemblyPlan: z.array(AssemblyActionSchema),
    constructionSelections: z.array(ConstructionSelectionSchema).optional(),
    calibrationMeasurements: z.array(CalibrationMeasurementSpecSchema).optional(),
    validation: ValidationReportSchema,
    provenance: z
      .object({
        inputDigest: Sha256Schema,
        modelId: z.string().min(1).max(120).nullable(),
        promptVersion: z.string().min(1).max(120).nullable(),
        promptHash: Sha256Schema.nullable().optional(),
        operatorVersions: z.record(z.string(), z.string().regex(/^\d+\.\d+\.\d+$/)),
        deterministicSeed: z.string().min(1).max(120),
        runtimeApplicationApiCalls: z.union([z.literal(0), z.literal(1)]),
        semanticRequestDigest: Sha256Schema.optional(),
        capabilityCatalogVersion: z.string().min(1).max(120).optional(),
        supportOutcome: z.enum(["supported", "simplified"]).optional(),
        requirementEvidence: z.array(
          z
            .object({
              requirementId: StableIdSchema,
              capabilityIds: z.array(StableIdSchema).min(1),
              sourceEvidenceIds: z.array(StableIdSchema).min(1),
              deterministicCheckIds: z.array(StableIdSchema).min(1)
            })
            .strict(),
        ).optional(),
        simplificationDisclosures: z.array(z.string().min(1).max(500)).optional(),
        motifRecipeHash: Sha256Schema.optional(),
        inputPolicyEvaluation: InputPolicyEvaluationSchema.optional()
      })
      .strict()
  })
  .strict()
  .superRefine((document, context) => {
    const partById = new Map(document.parts.map((part) => [part.id, part]));
    const stockById = new Map((document.externalStock ?? []).map((item) => [item.id, item]));
    const jointIds = new Set(document.joints.map((joint) => joint.id));
    const actionIds = new Set(document.assemblyPlan.map((action) => action.id));

    if (document.request.materialProfileId !== document.resolvedInputs.material.id) {
      context.addIssue({
        code: "custom",
        message: "Request material profile does not match the resolved material.",
        path: ["request", "materialProfileId"]
      });
    }
    if (document.request.machineProfileId !== document.resolvedInputs.machine.id) {
      context.addIssue({
        code: "custom",
        message: "Request machine profile does not match the resolved machine.",
        path: ["request", "machineProfileId"]
      });
    }
    if (document.request.fitProfileId !== document.resolvedInputs.fit.id) {
      context.addIssue({
        code: "custom",
        message: "Request fit profile does not match the resolved fit.",
        path: ["request", "fitProfileId"]
      });
    }
    if (
      document.resolvedInputs.processRecipe.machineProfileId !==
      document.resolvedInputs.machine.id
    ) {
      context.addIssue({
        code: "custom",
        message: "Process recipe machine profile does not match the resolved machine.",
        path: ["resolvedInputs", "processRecipe", "machineProfileId"]
      });
    }
    if (
      document.resolvedInputs.processRecipe.materialProfileId !==
      document.resolvedInputs.material.id
    ) {
      context.addIssue({
        code: "custom",
        message: "Process recipe material profile does not match the resolved material.",
        path: ["resolvedInputs", "processRecipe", "materialProfileId"]
      });
    }
    if (
      document.resolvedInputs.fabricationContext.stockFootprint !== null &&
      document.resolvedInputs.fabricationContext.stockFootprint.materialProfileId !==
        document.resolvedInputs.material.id
    ) {
      context.addIssue({
        code: "custom",
        message: "Stock footprint material does not match the resolved material.",
        path: ["resolvedInputs", "fabricationContext", "stockFootprint", "materialProfileId"]
      });
    }

    for (const [partIndex, part] of document.parts.entries()) {
      if (part.materialProfileId !== document.resolvedInputs.material.id) {
        context.addIssue({
          code: "custom",
          message: `Part ${part.id} references an unresolved material profile.`,
          path: ["parts", partIndex, "materialProfileId"]
        });
      }
      for (const dependencyId of part.assemblyDependencyPartIds) {
        if (!partById.has(dependencyId)) {
          context.addIssue({
            code: "custom",
            message: `Part ${part.id} depends on unknown part ${dependencyId}.`,
            path: ["parts", partIndex, "assemblyDependencyPartIds"]
          });
        }
      }
    }

    for (const [jointIndex, joint] of document.joints.entries()) {
      for (const endpoint of joint.between) {
        const part = partById.get(endpoint.partId);
        if (part === undefined) {
          context.addIssue({
            code: "custom",
            message: `Joint ${joint.id} references unknown part ${endpoint.partId}.`,
            path: ["joints", jointIndex, "between"]
          });
        } else if (!part.features.some((feature) => feature.id === endpoint.featureId)) {
          context.addIssue({
            code: "custom",
            message: `Joint ${joint.id} references unknown feature ${endpoint.featureId}.`,
            path: ["joints", jointIndex, "between"]
          });
        }
      }
    }

    for (const [constraintIndex, constraint] of document.motionConstraints.entries()) {
      for (const partId of constraint.bodyPartIds) {
        if (!partById.has(partId)) {
          context.addIssue({
            code: "custom",
            message: `Motion constraint ${constraint.id} references unknown part ${partId}.`,
            path: ["motionConstraints", constraintIndex, "bodyPartIds"]
          });
        }
      }
      if (
        constraint.revolute !== undefined &&
        !stockById.has(constraint.revolute.pinStockItemId)
      ) {
        context.addIssue({
          code: "custom",
          message: `Motion constraint ${constraint.id} references unknown pin stock ${constraint.revolute.pinStockItemId}.`,
          path: ["motionConstraints", constraintIndex, "revolute", "pinStockItemId"]
        });
      }
    }

    for (const [stockIndex, item] of (document.externalStock ?? []).entries()) {
      for (const partId of [
        ...item.assemblyDependencyPartIds,
        ...item.retention.retainerPartIds
      ]) {
        if (!partById.has(partId)) {
          context.addIssue({
            code: "custom",
            message: `External stock ${item.id} references unknown part ${partId}.`,
            path: ["externalStock", stockIndex]
          });
        }
      }
      const knownInterfaceIds = new Set([
        ...document.joints.map((joint) => joint.id),
        ...document.motionConstraints.map((constraint) => constraint.id)
      ]);
      for (const interfaceId of item.interfaceIds) {
        if (!knownInterfaceIds.has(interfaceId)) {
          context.addIssue({
            code: "custom",
            message: `External stock ${item.id} references unknown interface ${interfaceId}.`,
            path: ["externalStock", stockIndex, "interfaceIds"]
          });
        }
      }
    }

    for (const [actionIndex, action] of document.assemblyPlan.entries()) {
      for (const partId of action.partIds) {
        if (!partById.has(partId)) {
          context.addIssue({
            code: "custom",
            message: `Assembly action ${action.id} references unknown part ${partId}.`,
            path: ["assemblyPlan", actionIndex, "partIds"]
          });
        }
      }
      for (const jointId of action.jointIds) {
        if (!jointIds.has(jointId)) {
          context.addIssue({
            code: "custom",
            message: `Assembly action ${action.id} references unknown joint ${jointId}.`,
            path: ["assemblyPlan", actionIndex, "jointIds"]
          });
        }
      }
      for (const stockItemId of action.stockItemIds ?? []) {
        if (!stockById.has(stockItemId)) {
          context.addIssue({
            code: "custom",
            message: `Assembly action ${action.id} references unknown stock ${stockItemId}.`,
            path: ["assemblyPlan", actionIndex, "stockItemIds"]
          });
        }
      }
      for (const dependencyId of action.dependsOnActionIds) {
        if (!actionIds.has(dependencyId)) {
          context.addIssue({
            code: "custom",
            message: `Assembly action ${action.id} depends on unknown action ${dependencyId}.`,
            path: ["assemblyPlan", actionIndex, "dependsOnActionIds"]
          });
        }
      }
    }
  });

export const ManufacturingPathSchema = z
  .object({
    id: StableIdSchema,
    partId: StableIdSchema,
    featureId: StableIdSchema.nullable(),
    operation: z.enum(["cut", "score", "engrave"]),
    closed: z.boolean(),
    contour: PolylineUmSchema,
    sourceNominalHash: Sha256Schema,
    cuttingOrder: z.number().int().nonnegative()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.closed !== value.contour.closed) {
      context.addIssue({
        code: "custom",
        message: "Manufacturing-path closure must match its canonical contour."
      });
    }
    if (value.operation === "engrave" && !value.closed) {
      context.addIssue({
        code: "custom",
        message: "ENGRAVE_REQUIRES_SIMPLE_CLOSED_AREA: vector Engrave manufacturing paths must be exactly closed."
      });
    }
  });

export const SheetPlacementSchema = z
  .object({
    id: StableIdSchema,
    partId: StableIdSchema,
    xUm: IntegerUmSchema,
    yUm: IntegerUmSchema,
    rotationDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
  })
  .strict();

export const SheetProjectionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    widthMm: PositiveMmSchema,
    heightMm: PositiveMmSchema,
    rootPolicy: z
      .object({
        id: StableIdSchema,
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        symmetricPaddingMm: NonNegativeMmSchema
      })
      .strict(),
    occupiedBoundsUm: z
      .object({
        minXUm: IntegerUmSchema,
        minYUm: IntegerUmSchema,
        maxXUm: IntegerUmSchema,
        maxYUm: IntegerUmSchema
      })
      .strict(),
    rebaseDeltaUm: z.object({ xUm: IntegerUmSchema, yUm: IntegerUmSchema }).strict(),
    requiredMaterialFootprintMm: z
      .object({ width: PositiveMmSchema, height: PositiveMmSchema })
      .strict(),
    effectiveNestingConstraintMm: z
      .object({
        width: PositiveMmSchema,
        height: PositiveMmSchema,
        source: z.enum(["processing-envelope", "stock-envelope-intersection"])
      })
      .strict(),
    placements: z.array(SheetPlacementSchema),
    paths: z.array(ManufacturingPathSchema)
  })
  .strict()
  .superRefine((value, context) => {
    const paddingUm = Math.round(value.rootPolicy.symmetricPaddingMm * 1_000);
    const occupiedWidthUm = value.occupiedBoundsUm.maxXUm - value.occupiedBoundsUm.minXUm;
    const occupiedHeightUm = value.occupiedBoundsUm.maxYUm - value.occupiedBoundsUm.minYUm;
    if (
      value.occupiedBoundsUm.minXUm !== paddingUm ||
      value.occupiedBoundsUm.minYUm !== paddingUm
    ) {
      context.addIssue({
        code: "custom",
        message: "Compensated occupied bounds must begin at the symmetric root padding."
      });
    }
    if (
      Math.round(value.widthMm * 1_000) !== occupiedWidthUm + paddingUm * 2 ||
      Math.round(value.heightMm * 1_000) !== occupiedHeightUm + paddingUm * 2
    ) {
      context.addIssue({
        code: "custom",
        message: "SVG root must equal compensated occupied span plus twice the symmetric padding."
      });
    }
    if (
      value.requiredMaterialFootprintMm.width !== value.widthMm ||
      value.requiredMaterialFootprintMm.height !== value.heightMm
    ) {
      context.addIssue({
        code: "custom",
        message: "Required material footprint must match the compact padded SVG root."
      });
    }
    if (
      value.widthMm > value.effectiveNestingConstraintMm.width ||
      value.heightMm > value.effectiveNestingConstraintMm.height
    ) {
      context.addIssue({
        code: "custom",
        message: "Required output footprint exceeds the effective nesting constraint."
      });
    }
  });

export const FabricationProjectionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    sourceDocumentHash: Sha256Schema,
    materialProfileId: StableIdSchema,
    machineProfileId: StableIdSchema,
    sheets: z.array(SheetProjectionSchema).min(1),
    svgSha256: Sha256Schema,
    sheetArtifacts: z
      .array(
        z
          .object({
            sheetId: StableIdSchema,
            svgSha256: Sha256Schema,
            partIds: z.array(StableIdSchema).min(1)
          })
          .strict(),
      )
      .optional()
  })
  .strict();

export const PartMeshSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    partId: StableIdSchema,
    sourcePartHash: Sha256Schema,
    sourceDocumentHash: Sha256Schema,
    itemKind: z.literal("external-stock").optional(),
    stockItemId: StableIdSchema.optional(),
    verticesMm: z.array(Vector3MmSchema).min(3),
    triangles: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative()])).min(1)
  })
  .strict();

const SceneSurfaceTreatmentBaseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: StableIdSchema,
  partId: StableIdSchema,
  sourceFeatureId: StableIdSchema,
  sourceFeatureHash: Sha256Schema,
  surfaceSide: z.enum(["front", "back"]),
  verticesMm: z.array(Vector3MmSchema).min(2)
});

export const SceneSurfaceTreatmentSchema = z.discriminatedUnion("operation", [
  SceneSurfaceTreatmentBaseSchema.extend({
    operation: z.literal("score"),
    segments: z.array(z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative()
    ])).min(1)
  }).strict(),
  SceneSurfaceTreatmentBaseSchema.extend({
    operation: z.literal("engrave"),
    triangles: z.array(z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
      z.number().int().nonnegative()
    ])).min(1)
  }).strict()
]);

const SceneInstanceSchema = z
  .object({
    id: StableIdSchema,
    partId: StableIdSchema,
    meshId: StableIdSchema,
    translationMm: Vector3MmSchema,
    rotationAxis: UnitVector3Schema,
    rotationDegrees: z.number()
  })
  .strict();

export const SceneProjectionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    sourceDocumentHash: Sha256Schema,
    meshes: z.array(PartMeshSchema),
    surfaceTreatments: z.array(SceneSurfaceTreatmentSchema).optional(),
    states: z.array(
      z
        .object({
          id: StableIdSchema,
          kind: z.enum(["assembled", "exploded", "closed", "open", "removal"]),
          instances: z.array(SceneInstanceSchema)
        })
        .strict(),
    ),
    motions: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              id: StableIdSchema,
              constraintId: StableIdSchema,
              kind: z.literal("revolute"),
              bodyPartIds: z.array(StableIdSchema).min(1),
              axis: z
                .object({
                  originMm: Vector3MmSchema,
                  direction: UnitVector3Schema
                })
                .strict(),
              rangeDegrees: z
                .object({ minimum: z.number(), maximum: z.number() })
                .strict(),
              rotationSign: z.literal(-1),
              animationSampleMaximumDegrees: z.number().positive().max(2)
            })
            .strict(),
          z
            .object({
              id: StableIdSchema,
              constraintId: StableIdSchema,
              kind: z.literal("prismatic"),
              bodyPartIds: z.array(StableIdSchema).min(1),
              axis: z
                .object({
                  originMm: Vector3MmSchema,
                  direction: UnitVector3Schema
                })
                .strict(),
              rangeMm: z
                .object({ minimum: z.number(), maximum: z.number() })
                .strict(),
              removalPositionMm: z.number(),
              removableRetainerPartIds: z.array(StableIdSchema).length(1),
              animationSampleMaximumMm: z.literal(1)
            })
            .strict()
        ]),
      )
      .optional()
  })
  .strict();

export const BomProjectionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    sourceDocumentHash: Sha256Schema,
    entries: z.array(
      z
        .object({
          id: StableIdSchema,
          partId: StableIdSchema,
          name: z.string().min(1).max(120),
          quantity: z.number().int().positive(),
          materialProfileId: StableIdSchema,
          sourcePartHash: Sha256Schema,
          sheetId: StableIdSchema.optional(),
          markingCode: StableIdSchema.optional(),
          entryKind: z.literal("external-stock").optional(),
          stockItemId: StableIdSchema.optional(),
          cutLengthMm: PositiveMmSchema.optional(),
          measuredDiameterMm: PositiveMmSchema.optional(),
          evidenceState: z.enum([
            "provisional-preset",
            "user-reported",
            "coupon-selected",
            "reviewed-measurement"
          ]).optional()
        })
        .strict(),
    )
  })
  .strict();

export const PartsLegendProjectionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    sourceDocumentHash: Sha256Schema,
    entries: z.array(
      z
        .object({
          id: StableIdSchema,
          partId: StableIdSchema,
          markingCode: StableIdSchema,
          name: z.string().min(1).max(120),
          sheetId: StableIdSchema
        })
        .strict(),
    )
  })
  .strict();

export const InstructionsProjectionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    sourceDocumentHash: Sha256Schema,
    steps: z.array(
      z
        .object({
          id: StableIdSchema,
          order: z.number().int().nonnegative(),
          instructionKey: StableIdSchema,
          partIds: z.array(StableIdSchema).min(1),
          stockItemIds: z.array(StableIdSchema).optional(),
          jointIds: z.array(StableIdSchema),
          sheetIds: z.array(StableIdSchema),
          phase: z.enum(["assembly", "disassembly"]).optional()
        })
        .strict(),
    )
  })
  .strict();

export const ProjectionBundleSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    sourceDocumentHash: Sha256Schema,
    fabrication: FabricationProjectionSchema,
    scene: SceneProjectionSchema,
    bom: BomProjectionSchema,
    legend: PartsLegendProjectionSchema.optional(),
    instructions: InstructionsProjectionSchema.optional()
  })
  .strict()
  .superRefine((bundle, context) => {
    const hashes = [
      bundle.sourceDocumentHash,
      bundle.fabrication.sourceDocumentHash,
      bundle.scene.sourceDocumentHash,
      bundle.bom.sourceDocumentHash,
      bundle.legend?.sourceDocumentHash ?? bundle.sourceDocumentHash,
      bundle.instructions?.sourceDocumentHash ?? bundle.sourceDocumentHash
    ];
    if (new Set(hashes).size !== 1) {
      context.addIssue({
        code: "custom",
        message: "All projections must share one source document hash."
      });
    }

    const meshPartIds = new Set(bundle.scene.meshes.map((mesh) => mesh.partId));
    const bomPartIds = new Set(bundle.bom.entries.map((entry) => entry.partId));
    const stockIds = new Set([
      ...bundle.scene.meshes
        .filter((mesh) => mesh.itemKind === "external-stock")
        .map((mesh) => mesh.stockItemId ?? mesh.partId),
      ...bundle.bom.entries
        .filter((entry) => entry.entryKind === "external-stock")
        .map((entry) => entry.stockItemId ?? entry.partId)
    ]);
    const fabricationPartIds = new Set(
      bundle.fabrication.sheets.flatMap((sheet) => sheet.placements.map((placement) => placement.partId)),
    );
    const allPartIds = new Set([...meshPartIds, ...bomPartIds, ...fabricationPartIds]);
    for (const partId of allPartIds) {
      const externalStock = stockIds.has(partId);
      const projectionMismatch = externalStock
        ? !meshPartIds.has(partId) || !bomPartIds.has(partId) || fabricationPartIds.has(partId)
        : !meshPartIds.has(partId) || !bomPartIds.has(partId) || !fabricationPartIds.has(partId);
      if (projectionMismatch) {
        context.addIssue({
          code: "custom",
          message: externalStock
            ? `External stock ${partId} must appear in scene and BOM but never fabrication.`
            : `Part ${partId} is missing from one or more projections.`
        });
      }
    }
  });

export type DesignRequestV1 = z.infer<typeof DesignRequestV1Schema>;
export type IntentFixtureV1 = z.infer<typeof IntentFixtureV1Schema>;
export type MaterialProfile = z.infer<typeof MaterialProfileSchema>;
export type MachineProfile = z.infer<typeof MachineProfileSchema>;
export type StockFootprint = z.infer<typeof StockFootprintSchema>;
export type LayoutPolicy = z.infer<typeof LayoutPolicySchema>;
export type FabricationContext = z.infer<typeof FabricationContextSchema>;
export type ProcessRecipe = z.infer<typeof ProcessRecipeSchema>;
export type FitProfile = z.infer<typeof FitProfileSchema>;
export type ThicknessMeasurementSummary = z.infer<typeof ThicknessMeasurementSummarySchema>;
export type ThicknessBasis = z.infer<typeof ThicknessBasisSchema>;
export type NominalStockReference = z.infer<typeof NominalStockReferenceSchema>;
export type CutWidthSource = z.infer<typeof CutWidthSourceSchema>;
export type CutWidthFixtureEvidence = z.infer<typeof CutWidthFixtureEvidenceSchema>;
export type InputPolicyFinding = z.infer<typeof InputPolicyFindingSchema>;
export type InputPolicyEvaluation = z.infer<typeof InputPolicyEvaluationSchema>;
export type CalibrationMeasurementSpec = z.infer<typeof CalibrationMeasurementSpecSchema>;
export type ExternalStockItem = z.infer<typeof ExternalStockItemSchema>;
export type ConstructionSelection = z.infer<typeof ConstructionSelectionSchema>;
export type RetainedPinProgramV1 = z.infer<typeof RetainedPinProgramV1Schema>;
export type CapturedSlideProgramV1 = z.infer<typeof CapturedSlideProgramV1Schema>;
export type PointUm = z.infer<typeof PointUmSchema>;
export type PolylineUm = z.infer<typeof PolylineUmSchema>;
export type Region2D = z.infer<typeof Region2DSchema>;
export type PartFeature = z.infer<typeof PartFeatureSchema>;
export type SheetPart = z.infer<typeof SheetPartSchema>;
export type Joint = z.infer<typeof JointSchema>;
export type OrthogonalPanelProgramV1 = z.infer<typeof OrthogonalPanelProgramV1Schema>;
export type MotionConstraint = z.infer<typeof MotionConstraintSchema>;
export type AssemblyAction = z.infer<typeof AssemblyActionSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type ValidationReport = z.infer<typeof ValidationReportSchema>;
export type DesignDocumentV1 = z.infer<typeof DesignDocumentV1Schema>;
export type ManufacturingPath = z.infer<typeof ManufacturingPathSchema>;
export type SheetPlacement = z.infer<typeof SheetPlacementSchema>;
export type SheetProjection = z.infer<typeof SheetProjectionSchema>;
export type FabricationProjection = z.infer<typeof FabricationProjectionSchema>;
export type PartMesh = z.infer<typeof PartMeshSchema>;
export type SceneSurfaceTreatment = z.infer<typeof SceneSurfaceTreatmentSchema>;
export type SceneProjection = z.infer<typeof SceneProjectionSchema>;
export type BomProjection = z.infer<typeof BomProjectionSchema>;
export type PartsLegendProjection = z.infer<typeof PartsLegendProjectionSchema>;
export type InstructionsProjection = z.infer<typeof InstructionsProjectionSchema>;
export type ProjectionBundle = z.infer<typeof ProjectionBundleSchema>;
