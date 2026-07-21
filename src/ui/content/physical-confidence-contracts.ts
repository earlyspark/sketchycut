import { z } from "zod";

import {
  CutWidthFixtureEvidenceSchema,
  ReferenceDiameterGaugeEvidenceSchema,
  Sha256Schema
} from "../../domain/contracts.js";

const FitDeltaSchema = z.number().min(-2).max(2).multipleOf(0.01);
const FitClassNameSchema = z.enum(["press", "snug", "sliding", "rotating", "rod"]);
const CouponFitObservationSchema = z.object({
  specimen: z.enum(["slot", "rotating-bore", "retention-bore"]),
  result: z.enum([
    "will-not-enter",
    "forceful",
    "firm-hand-pressure-retained",
    "snug-retained",
    "slides",
    "loose",
    "rotates-freely-slight-play",
    "smooth-and-retained"
  ])
}).strict();

const CouponFitClassEvidenceSchema = z.object({
  totalDeltaMm: FitDeltaSchema,
  confidence: z.enum(["provisional", "coupon-selected", "product-observed"]),
  observations: z.array(CouponFitObservationSchema).min(1),
  adjustment: z.object({
    basis: z.literal("product-assembly-observation"),
    baselineTotalDeltaMm: FitDeltaSchema,
    adjustmentMm: z.number().min(0.01).max(0.5).multipleOf(0.01),
    sourceCandidateId: z.enum(["basic", "hinged", "sliding"]),
    sourcePackageSha256: Sha256Schema,
    sourceProductSvgSha256: Sha256Schema,
    observation: z.enum([
      "assembled-successfully-excessive-insertion-force",
      "assembly-blocked-excessive-interference",
      "shell-interfaces-seated-with-excessive-force"
    ]),
    disposition: z.literal("apply-to-subsequent-candidates-with-new-hashes"),
    targetCandidateIds: z.tuple([z.literal("hinged"), z.literal("sliding")])
  }).strict().optional()
}).strict();

const CouponObservedFitSchema = z.object({
  basis: z.literal("coupon-observed"),
  couponSvgSha256: Sha256Schema,
  selectionRuleVersion: z.literal("1.0.0"),
  validRun: z.object({
    safeRun: z.literal(true),
    errors: z.literal("none"),
    cutThrough: z.literal("complete"),
    labelsVisible: z.literal(true),
    piecesReleasedFreely: z.literal(true)
  }).strict(),
  nonqualifyingDeviations: z.array(z.literal("cut-contours-assigned-score")).max(1),
  classes: z.object({
    press: CouponFitClassEvidenceSchema.optional(),
    snug: CouponFitClassEvidenceSchema.optional(),
    sliding: CouponFitClassEvidenceSchema.optional(),
    rotating: CouponFitClassEvidenceSchema.optional(),
    rod: CouponFitClassEvidenceSchema.optional()
  }).strict().refine((classes) => Object.keys(classes).length > 0, {
    message: "Coupon-observed fit evidence must retain at least one fit class."
  })
}).strict().superRefine((value, context) => {
  const accepted: Record<z.infer<typeof FitClassNameSchema>, readonly string[]> = {
    press: ["slot:firm-hand-pressure-retained"],
    snug: ["slot:snug-retained"],
    sliding: ["slot:slides"],
    rotating: ["slot:slides", "rotating-bore:rotates-freely-slight-play"],
    rod: ["retention-bore:smooth-and-retained"]
  };
  for (const fitClass of FitClassNameSchema.options) {
    const evidence = value.classes[fitClass];
    if (evidence === undefined) continue;
    const observations = new Set(evidence.observations.map(
      (item) => `${item.specimen}:${item.result}`,
    ));
    const qualifies = accepted[fitClass].every((item) => observations.has(item));
    const expectedConfidence = evidence.adjustment === undefined
      ? (qualifies ? "coupon-selected" : "provisional")
      : "product-observed";
    if (evidence.confidence !== expectedConfidence) {
      context.addIssue({
        code: "custom",
        path: ["classes", fitClass, "confidence"],
        message: `${fitClass} confidence must distinguish provisional, coupon-selected, and product-observed evidence.`
      });
    }
    if (evidence.adjustment !== undefined) {
      if (fitClass !== "snug") {
        context.addIssue({
          code: "custom",
          path: ["classes", fitClass, "adjustment"],
          message: "The current product-observed adjustment is registered only for snug fit."
        });
      }
      if (!qualifies) {
        context.addIssue({
          code: "custom",
          path: ["classes", fitClass, "adjustment"],
          message: "A product-observed adjustment requires a qualifying coupon-selected baseline."
        });
      }
      if (
        evidence.adjustment.sourceCandidateId === "basic" &&
        (
          evidence.adjustment.observation !== "assembled-successfully-excessive-insertion-force" ||
          evidence.adjustment.baselineTotalDeltaMm !== 0
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["classes", fitClass, "adjustment"],
          message: "A Basic-source adjustment must retain the zero-clearance successful-but-excessive-force observation."
        });
      }
      if (
        evidence.adjustment.sourceCandidateId === "hinged" &&
        (
          evidence.adjustment.observation !== "assembly-blocked-excessive-interference" ||
          evidence.adjustment.adjustmentMm <= 0.01
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["classes", fitClass, "adjustment"],
          message: "A Hinged-source adjustment must retain the assembly-blocking observation and a cumulative adjustment beyond the first step."
        });
      }
      if (
        evidence.adjustment.sourceCandidateId === "sliding" &&
        (
          evidence.adjustment.observation !== "shell-interfaces-seated-with-excessive-force" ||
          evidence.adjustment.adjustmentMm <= 0.01
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["classes", fitClass, "adjustment"],
          message: "A Sliding-source adjustment must retain the excessive-force shell-interface observation without implying that every mechanism part assembled, and use a cumulative adjustment beyond the first step."
        });
      }
      const expected = Math.round((
        evidence.adjustment.baselineTotalDeltaMm + evidence.adjustment.adjustmentMm
      ) * 100) / 100;
      if (evidence.totalDeltaMm !== expected) {
        context.addIssue({
          code: "custom",
          path: ["classes", fitClass, "totalDeltaMm"],
          message: "Adjusted fit delta must equal its baseline plus the recorded adjustment."
        });
      }
    }
  }
});
const ThicknessReadingsSchema = z.union([
  z.tuple([z.number().min(2.5).max(3.6)]),
  z.tuple([
    z.number().min(2.5).max(3.6),
    z.number().min(2.5).max(3.6),
    z.number().min(2.5).max(3.6)
  ])
]);

const PhysicalConfidenceRetainedPinSchema = z.discriminatedUnion("basis", [
  z.object({ basis: z.literal("nominal-preset"), effectiveDiameterMm: z.literal(3) }).strict(),
  z.object({
    basis: z.literal("user-reported-caliper"),
    effectiveDiameterMm: z.number().positive().max(20).multipleOf(0.01)
  }).strict(),
  z.object({
    basis: z.literal("user-reported-reference-gauge"),
    effectiveDiameterMm: z.number().positive().max(20).multipleOf(0.01),
    minimumDiameterMm: z.number().positive().max(20).multipleOf(0.01),
    maximumDiameterMm: z.number().positive().max(20).multipleOf(0.01),
    stockKind: z.literal("wooden-toothpick"),
    referenceGauge: ReferenceDiameterGaugeEvidenceSchema,
    straightnessEvidence: z.enum(["unverified", "user-reported"])
  }).strict()
]);

export const PhysicalConfidenceInputSchema = z.object({
  schemaVersion: z.literal("1.2"),
  stage: z.enum(["software-preflight", "measurement-fixture", "cut-candidate"]),
  stock: z.object({
    presetId: z.literal("stock-3mm-basswood-laser-plywood"),
    batchId: z.string().min(1).max(120).nullable(),
    grainAxis: z.enum(["machine-x-grain-x", "machine-x-grain-y"]),
    footprintMm: z.object({
      width: z.number().min(100).max(426),
      height: z.number().min(100).max(320)
    }).strict(),
    thickness: z.discriminatedUnion("basis", [
      z.object({ basis: z.literal("nominal-preset") }).strict(),
      z.object({
        basis: z.literal("user-reported-caliper"),
        readingsMm: ThicknessReadingsSchema
      }).strict()
    ])
  }).strict(),
  cutWidth: z.discriminatedUnion("source", [
    z.object({ source: z.literal("provisional-preset") }).strict(),
    z.object({
      source: z.literal("fixture-derived"),
      fixtureEvidence: CutWidthFixtureEvidenceSchema
    }).strict()
  ]),
  fit: z.discriminatedUnion("basis", [
    z.object({ basis: z.literal("provisional") }).strict(),
    CouponObservedFitSchema
  ]),
  retainedPin: PhysicalConfidenceRetainedPinSchema.nullable(),
  process: z.object({
    studioDesktopVersion: z.string().min(1).max(40),
    firmwareVersion: z.string().min(1).max(80),
    materialPresetSource: z.enum(["xtool-material", "user-defined"]),
    powerPercent: z.number().positive().max(100),
    speedMmPerSecond: z.number().positive(),
    passCount: z.number().int().positive(),
    focusMode: z.enum(["manual", "auto-measure", "recorded-focus-descent"]),
    focusDescentMm: z.number().nonnegative().nullable(),
    builtInAirPump: z.enum(["off", "low", "medium", "high", "recorded-other"]),
    exhaustArrangement: z.string().min(1).max(200),
    supportArrangement: z.string().min(1).max(200),
    studioKerfOffsetMm: z.literal(0),
    evidenceStatus: z.enum(["user-reported", "reviewed"])
  }).strict().nullable()
}).strict().superRefine((value, context) => {
  if (value.stage === "software-preflight") return;
  if (value.stock.batchId === null) {
    context.addIssue({
      code: "custom",
      path: ["stock", "batchId"],
      message: "Measurement-fixture and cut-candidate stages require a material batch or sheet identifier."
    });
  }
  if (value.process === null) {
    context.addIssue({
      code: "custom",
      path: ["process"],
      message: "Measurement-fixture and cut-candidate stages require the exact recorded cutting recipe."
    });
  }
  if (value.stage !== "cut-candidate") return;
  if (value.cutWidth.source !== "fixture-derived") {
    context.addIssue({
      code: "custom",
      path: ["cutWidth"],
      message: "A cut candidate requires retained cut-width fixture evidence."
    });
  }
  if (value.fit.basis !== "coupon-observed") {
    context.addIssue({
      code: "custom",
      path: ["fit"],
      message: "A cut candidate requires exact coupon observations and capability-scoped fit confidence."
    });
  }
  if (
    value.retainedPin?.basis === "user-reported-reference-gauge" &&
    value.retainedPin.straightnessEvidence !== "user-reported"
  ) {
    context.addIssue({
      code: "custom",
      path: ["retainedPin", "straightnessEvidence"],
      message: "A cut candidate requires the selected toothpick section to be reported straight."
    });
  }
});

export type PhysicalConfidenceInput = z.infer<typeof PhysicalConfidenceInputSchema>;

const PackageFileSchema = z.object({
  path: z.string().min(1),
  bytes: z.number().int().positive(),
  sha256: Sha256Schema
}).strict();

const SheetArtifactSchema = z.object({
  sheetId: z.string().min(1),
  path: z.string().min(1),
  svgSha256: Sha256Schema,
  rootDimensionsMm: z.object({
    width: z.number().positive(),
    height: z.number().positive()
  }).strict(),
  importedOccupiedDimensionsMm: z.object({
    width: z.number().positive(),
    height: z.number().positive()
  }).strict(),
  requiredMaterialFootprintMm: z.object({
    width: z.number().positive(),
    height: z.number().positive()
  }).strict(),
  partIds: z.array(z.string().min(1)).min(1),
  partDimensionsMm: z.array(z.object({
    partId: z.string().min(1),
    width: z.number().positive(),
    height: z.number().positive()
  }).strict()).min(1),
  operationPathCounts: z.object({
    engrave: z.number().int().nonnegative(),
    score: z.number().int().nonnegative(),
    cut: z.number().int().nonnegative()
  }).strict(),
  scoreTreatmentPathCount: z.number().int().nonnegative()
}).strict().superRefine((value, context) => {
  if (value.scoreTreatmentPathCount > value.operationPathCounts.score) {
    context.addIssue({
      code: "custom",
      path: ["scoreTreatmentPathCount"],
      message: "Registered Score treatment paths cannot exceed the sheet's total Score paths."
    });
  }
});

export const PhysicalConfidencePackageManifestSchema = z.object({
  schemaVersion: z.literal("sketchycut-physical-confidence-package@1.2.0"),
  generatorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  stage: PhysicalConfidenceInputSchema.shape.stage,
  candidateId: z.enum(["basic", "hinged", "sliding"]),
  guidedExampleId: z.enum(["basic-box", "hinged-lid-box", "sliding-lid-box"]),
  canonicalProjectId: z.string().min(1),
  expectedFinishedEnvelopeMm: z.object({
    width: z.number().positive(),
    depth: z.number().positive(),
    height: z.number().positive()
  }).strict(),
  fabricationInput: PhysicalConfidenceInputSchema,
  evaluatedDocumentHash: Sha256Schema,
  geometryHash: Sha256Schema,
  inputHash: Sha256Schema,
  materialProfileHash: Sha256Schema,
  processRecipeHash: Sha256Schema,
  fitProfileHash: Sha256Schema,
  pinProfileHash: Sha256Schema.nullable(),
  runtimeModelCalls: z.literal(0),
  physicalVerification: z.literal("required"),
  compensationOwner: z.literal("SketchyCut"),
  requiredStudioKerfOffset: z.literal("off / 0.00 mm"),
  artifactGroups: z.array(z.object({
    id: z.enum(["product", "material-fit-coupon", "optional-cut-width-fit-test"]),
    compensation: z.enum([
      "sketchycut-compensated-product-cut",
      "sketchycut-compensated-material-fit-cut",
      "uncompensated-fit-test-cut"
    ]),
    sourceDocumentHash: Sha256Schema,
    sheets: z.array(SheetArtifactSchema).min(1)
  }).strict()).length(3),
  files: z.array(PackageFileSchema).min(1),
  limitations: z.array(z.string().min(1)).min(1)
}).strict().superRefine((value, context) => {
  const needsRetainedPin = value.candidateId === "hinged";
  if (needsRetainedPin !== (value.fabricationInput.retainedPin !== null)) {
    context.addIssue({
      code: "custom",
      path: ["fabricationInput", "retainedPin"],
      message: "Only the hinged candidate may retain capability-specific pin input."
    });
  }
  if (needsRetainedPin !== (value.pinProfileHash !== null)) {
    context.addIssue({
      code: "custom",
      path: ["pinProfileHash"],
      message: "Only the hinged candidate may retain a capability-specific pin hash."
    });
  }
});

export type PhysicalConfidencePackageManifest = z.infer<
  typeof PhysicalConfidencePackageManifestSchema
>;

export const PhysicalConfidenceArtifactSetSchema = z.object({
  schemaVersion: z.literal("sketchycut-physical-confidence-artifact-set@1.3.0"),
  generatorVersion: z.literal("1.4.0"),
  stage: PhysicalConfidenceInputSchema.shape.stage,
  inputHash: Sha256Schema,
  runtimeModelCalls: z.literal(0),
  physicalVerification: z.literal("required"),
  material: z.object({
    profileHash: Sha256Schema,
    measuredThicknessMm: z.number().positive(),
    thicknessBasis: z.enum(["nominal-preset", "user-reported-caliper"]),
    batchId: z.string().nullable()
  }).strict(),
  cutWidth: z.object({
    xMm: z.number().positive(),
    yMm: z.number().positive(),
    source: z.enum(["provisional-preset", "fixture-derived"])
  }).strict(),
  fitProfileHashes: z.object({
    basic: Sha256Schema,
    hinged: Sha256Schema,
    sliding: Sha256Schema
  }).strict(),
  processRecipeHash: Sha256Schema,
  retainedPin: z.discriminatedUnion("basis", [
    z.object({
      profileHash: Sha256Schema,
      basis: z.enum(["nominal-preset", "user-reported-caliper"]),
      effectiveDiameterMm: z.number().positive()
    }).strict(),
    z.object({
      profileHash: Sha256Schema,
      basis: z.literal("user-reported-reference-gauge"),
      effectiveDiameterMm: z.number().positive(),
      minimumDiameterMm: z.number().positive(),
      maximumDiameterMm: z.number().positive(),
      stockKind: z.literal("wooden-toothpick"),
      referenceGauge: ReferenceDiameterGaugeEvidenceSchema,
      straightnessEvidence: z.enum(["unverified", "user-reported"])
    }).strict()
  ]),
  packages: z.array(z.object({
    candidateId: z.enum(["basic", "hinged", "sliding"]),
    filename: z.string().min(1),
    sha256: Sha256Schema,
    bytes: z.number().int().positive(),
    manifest: PhysicalConfidencePackageManifestSchema
  }).strict()).length(3)
}).strict();

export type PhysicalConfidenceArtifactSet = z.infer<
  typeof PhysicalConfidenceArtifactSetSchema
>;

const NullableObservationBooleanSchema = z.boolean().nullable();

const PhysicalConfidenceStudioSettingsSchema = z.object({
  powerPercent: z.number().positive().max(100),
  speedMmPerSecond: z.number().positive(),
  passCount: z.number().int().positive()
}).strict();

export const PhysicalConfidenceObservationDraftSchema = z.object({
  schemaVersion: z.literal("sketchycut-physical-observation@1.3.0"),
  binding: z.object({
    stage: PhysicalConfidenceInputSchema.shape.stage,
    candidateId: z.enum(["basic", "hinged", "sliding"]),
    packageSha256: Sha256Schema,
    inputHash: Sha256Schema,
    evaluatedDocumentHash: Sha256Schema,
    geometryHash: Sha256Schema,
    materialProfileHash: Sha256Schema,
    processRecipeHash: Sha256Schema,
    fitProfileHash: Sha256Schema,
    pinProfileHash: Sha256Schema.nullable()
  }).strict(),
  studio: z.object({
    desktopVersion: z.string().min(1).max(40).nullable(),
    firmwareVersion: z.string().min(1).max(80).nullable(),
    importDpi: z.number().positive().nullable(),
    oversizePolicy: z.string().min(1).max(200).nullable(),
    sheets: z.array(z.object({
      sheetId: z.string().min(1),
      svgSha256: Sha256Schema,
      expectedSvgRootDimensionsMm: z.object({
        width: z.number().positive(),
        height: z.number().positive()
      }).strict(),
      expectedImportedOccupiedDimensionsMm: z.object({
        width: z.number().positive(),
        height: z.number().positive()
      }).strict(),
      observedImportedOccupiedDimensionsMm: z.object({
        width: z.number().positive(),
        height: z.number().positive()
      }).strict().nullable(),
      parts: z.array(z.object({
        partId: z.string().min(1),
        expectedDimensionsMm: z.object({
          width: z.number().positive(),
          height: z.number().positive()
        }).strict(),
        observedDimensionsMm: z.object({
          width: z.number().positive(),
          height: z.number().positive()
        }).strict().nullable()
      }).strict()).min(1),
      importedViaUpload: NullableObservationBooleanSchema,
      neverResized: NullableObservationBooleanSchema,
      vectorQualityReviewed: NullableObservationBooleanSchema,
      operations: z.array(z.object({
        operation: z.enum(["engrave", "score", "cut"]),
        expectedPathCount: z.number().int().nonnegative(),
        expectedSettings: PhysicalConfidenceStudioSettingsSchema.nullable(),
        assigned: NullableObservationBooleanSchema,
        outputEnabled: NullableObservationBooleanSchema,
        observedSettings: PhysicalConfidenceStudioSettingsSchema.nullable()
      }).strict()).length(3),
      externalStudioPersonalizations: z.array(z.object({
        personalizationId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        source: z.literal("user-added-in-studio"),
        description: z.string().min(1).max(200),
        affectedPartId: z.string().min(1),
        operation: z.literal("engrave"),
        objectCount: z.number().int().positive(),
        claimedAsSketchyCutOutput: z.literal(false),
        canonicalStructuralPathsModified: z.literal(false),
        withinAffectedPartBoundaryConfirmed: NullableObservationBooleanSchema,
        structuralKeepoutClearConfirmed: NullableObservationBooleanSchema,
        outputEnabled: NullableObservationBooleanSchema,
        observedSettings: PhysicalConfidenceStudioSettingsSchema.nullable()
      }).strict()).max(16).refine(
        (personalizations) => new Set(
          personalizations.map((personalization) => personalization.personalizationId),
        ).size === personalizations.length,
        { message: "External Studio personalization IDs must be unique." },
      ),
      processingOrder: z.array(z.enum(["engrave", "score", "cut"]))
        .min(1)
        .max(3)
        .refine((operations) => new Set(operations).size === operations.length, {
          message: "Processing order cannot repeat an operation."
        })
        .nullable(),
      innerBeforeOuterReviewed: NullableObservationBooleanSchema,
      studioKerfOffsetMm: z.literal(0).nullable()
    }).strict()).min(1)
  }).strict(),
  machineSetup: z.object({
    module: z.literal("xTool M2 20W blue-light").nullable(),
    initializationAndCalibrationState: z.string().min(1).max(400).nullable(),
    cleanLevelBaseplate: NullableObservationBooleanSchema,
    enclosureInterlockConfirmed: NullableObservationBooleanSchema,
    magneticFixtureCount: z.number().int().nonnegative().nullable(),
    minimumToolpathToFixtureClearanceMm: z.number().nonnegative().nullable(),
    allFourCameraViewfinderPointsClear: NullableObservationBooleanSchema,
    framingPathsOnMaterial: NullableObservationBooleanSchema,
    framingFixturesClear: NullableObservationBooleanSchema,
    builtInAirPumpStateConfirmed: NullableObservationBooleanSchema,
    exhaustConfirmed: NullableObservationBooleanSchema,
    continuousSupervisionConfirmed: NullableObservationBooleanSchema,
    fireReadinessConfirmed: NullableObservationBooleanSchema,
    residueCleanupCompleted: NullableObservationBooleanSchema
  }).strict(),
  cut: z.object({
    exactRecipeHashConfirmed: Sha256Schema.nullable(),
    cutThroughConfirmed: NullableObservationBooleanSchema,
    affectedPartsIntact: NullableObservationBooleanSchema
  }).strict(),
  assembly: z.object({
    usedGeneratedInstructionsOnly: NullableObservationBooleanSchema,
    structuralGlueUsed: NullableObservationBooleanSchema,
    assembled: NullableObservationBooleanSchema,
    fingerTabJointsSeatByHand: NullableObservationBooleanSchema,
    noJointFracture: NullableObservationBooleanSchema,
    noSpontaneousJointSeparation: NullableObservationBooleanSchema,
    majorDimensions: z.array(z.object({
      axis: z.enum(["width", "depth", "height"]),
      expectedMm: z.number().positive(),
      observedMm: z.number().positive().nullable()
    }).strict()).length(3)
  }).strict(),
  motion: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }).strict(),
    z.object({
      kind: z.literal("revolute"),
      retainedPinBasis: z.enum([
        "nominal-preset",
        "user-reported-caliper",
        "user-reported-reference-gauge"
      ]),
      effectivePinDiameterMm: z.number().positive(),
      samePinSectionAsCouponConfirmed: NullableObservationBooleanSchema,
      completedFullCycles: z.number().int().nonnegative().nullable(),
      noBinding: NullableObservationBooleanSchema,
      noPinLoss: NullableObservationBooleanSchema,
      noVisibleBoreWebFailure: NullableObservationBooleanSchema
    }).strict(),
    z.object({
      kind: z.literal("prismatic"),
      completedFullCycles: z.number().int().nonnegative().nullable(),
      noBinding: NullableObservationBooleanSchema,
      noUnintendedRelease: NullableObservationBooleanSchema,
      noRailFailure: NullableObservationBooleanSchema
    }).strict()
  ]),
  motif: z.discriminatedUnion("evidence", [
    z.object({
      evidence: z.literal("registered-score-surface-treatment"),
      visible: NullableObservationBooleanSchema,
      structuralKeepoutsUndamaged: NullableObservationBooleanSchema
    }).strict(),
    z.object({
      evidence: z.literal("not-applicable")
    }).strict()
  ]),
  media: z.array(z.object({
    kind: z.enum(["photo", "video"]),
    filename: z.string().min(1).max(200),
    sha256: Sha256Schema
  }).strict()),
  deviations: z.array(z.string().min(1).max(500)),
  generationObservationReview: z.object({
    windowStart: z.iso.datetime().nullable(),
    windowEnd: z.iso.datetime().nullable(),
    eligibleSampleSize: z.number().int().nonnegative().nullable(),
    requestMixLimitation: z.string().min(1).max(500).nullable(),
    broadGeneralizationClaimed: NullableObservationBooleanSchema
  }).strict(),
  usedHistoricalArtifact: NullableObservationBooleanSchema,
  releaseClaimsAligned: NullableObservationBooleanSchema
}).strict();

export type PhysicalConfidenceObservationDraft = z.infer<
  typeof PhysicalConfidenceObservationDraftSchema
>;
