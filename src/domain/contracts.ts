import { z } from "zod";

import { SCHEMA_VERSION } from "../version.js";

export const SchemaVersionSchema = z.literal(SCHEMA_VERSION);
export const StableIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const PositiveMmSchema = z.number().positive();
export const NonNegativeMmSchema = z.number().nonnegative();
export const IntegerUmSchema = z.number().int();
export const PositiveIntegerUmSchema = IntegerUmSchema.positive();

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

export const MaterialProfileSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    name: z.string().min(1).max(120),
    materialKind: z.enum(["basswood-plywood", "birch-plywood", "custom-plywood"]),
    nominalThicknessMm: PositiveMmSchema,
    measuredThicknessMm: PositiveMmSchema,
    batchId: z.string().min(1).max(120).nullable(),
    grainAxis: z.enum(["x", "y", "none"]),
    physicalState: z.enum(["provisional-preset", "coupon-selected", "machine-profiled"])
  })
  .strict();

export const MachineProfileSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    name: z.string().min(1).max(120),
    bedMm: z
      .object({
        width: PositiveMmSchema,
        height: PositiveMmSchema,
        margin: NonNegativeMmSchema
      })
      .strict(),
    kerfMm: z
      .object({
        x: PositiveMmSchema,
        y: PositiveMmSchema
      })
      .strict(),
    minimumFeatureMm: PositiveMmSchema,
    exportFormat: z.literal("svg"),
    downstreamApplication: z.literal("xTool Studio")
  })
  .strict();

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
      "keepout"
    ]),
    operation: z.enum(["cut", "score", "engrave", "none"]),
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
  });

export const SheetPartSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    name: z.string().min(1).max(120),
    role: z.enum(["coupon-base", "coupon-insert", "coupon-pin", "generic-panel"]),
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
    kind: z.enum(["panel-tab-slot", "finger-mate", "pin-bore", "calibration-pair"]),
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
    insertionDirection: UnitVector3Schema
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
      .refine((value) => value.maximum >= value.minimum, "Motion range is inverted.")
  })
  .strict();

export const AssemblyActionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    order: z.number().int().nonnegative(),
    action: z.enum(["align", "insert", "rotate", "verify"]),
    partIds: z.array(StableIdSchema).min(1),
    jointIds: z.array(StableIdSchema),
    direction: UnitVector3Schema.nullable(),
    dependsOnActionIds: z.array(StableIdSchema),
    instructionKey: StableIdSchema
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

export const DesignDocumentV1Schema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    projectId: StableIdSchema,
    request: DesignRequestV1Schema,
    intent: IntentFixtureV1Schema,
    resolvedInputs: z
      .object({
        material: MaterialProfileSchema,
        machine: MachineProfileSchema,
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
    joints: z.array(JointSchema),
    motionConstraints: z.array(MotionConstraintSchema),
    assemblyPlan: z.array(AssemblyActionSchema),
    validation: ValidationReportSchema,
    provenance: z
      .object({
        inputDigest: Sha256Schema,
        modelId: z.null(),
        promptVersion: z.null(),
        operatorVersions: z.record(z.string(), z.string().regex(/^\d+\.\d+\.\d+$/)),
        deterministicSeed: z.string().min(1).max(120),
        runtimeApplicationApiCalls: z.literal(0)
      })
      .strict()
  })
  .strict()
  .superRefine((document, context) => {
    const partById = new Map(document.parts.map((part) => [part.id, part]));
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
  .strict();

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
    placements: z.array(SheetPlacementSchema),
    paths: z.array(ManufacturingPathSchema)
  })
  .strict();

export const FabricationProjectionSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    sourceDocumentHash: Sha256Schema,
    materialProfileId: StableIdSchema,
    machineProfileId: StableIdSchema,
    sheets: z.array(SheetProjectionSchema).min(1),
    svgSha256: Sha256Schema
  })
  .strict();

export const PartMeshSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: StableIdSchema,
    partId: StableIdSchema,
    sourcePartHash: Sha256Schema,
    sourceDocumentHash: Sha256Schema,
    verticesMm: z.array(Vector3MmSchema).min(3),
    triangles: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative()])).min(1)
  })
  .strict();

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
    states: z.array(
      z
        .object({
          id: StableIdSchema,
          kind: z.enum(["assembled", "exploded"]),
          instances: z.array(SceneInstanceSchema)
        })
        .strict(),
    )
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
          sourcePartHash: Sha256Schema
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
    bom: BomProjectionSchema
  })
  .strict()
  .superRefine((bundle, context) => {
    const hashes = [
      bundle.sourceDocumentHash,
      bundle.fabrication.sourceDocumentHash,
      bundle.scene.sourceDocumentHash,
      bundle.bom.sourceDocumentHash
    ];
    if (new Set(hashes).size !== 1) {
      context.addIssue({
        code: "custom",
        message: "All projections must share one source document hash."
      });
    }

    const meshPartIds = new Set(bundle.scene.meshes.map((mesh) => mesh.partId));
    const bomPartIds = new Set(bundle.bom.entries.map((entry) => entry.partId));
    const fabricationPartIds = new Set(
      bundle.fabrication.sheets.flatMap((sheet) => sheet.placements.map((placement) => placement.partId)),
    );
    const allPartIds = new Set([...meshPartIds, ...bomPartIds, ...fabricationPartIds]);
    for (const partId of allPartIds) {
      if (!meshPartIds.has(partId) || !bomPartIds.has(partId) || !fabricationPartIds.has(partId)) {
        context.addIssue({
          code: "custom",
          message: `Part ${partId} is missing from one or more projections.`
        });
      }
    }
  });

export type DesignRequestV1 = z.infer<typeof DesignRequestV1Schema>;
export type IntentFixtureV1 = z.infer<typeof IntentFixtureV1Schema>;
export type MaterialProfile = z.infer<typeof MaterialProfileSchema>;
export type MachineProfile = z.infer<typeof MachineProfileSchema>;
export type FitProfile = z.infer<typeof FitProfileSchema>;
export type PointUm = z.infer<typeof PointUmSchema>;
export type PolylineUm = z.infer<typeof PolylineUmSchema>;
export type Region2D = z.infer<typeof Region2DSchema>;
export type PartFeature = z.infer<typeof PartFeatureSchema>;
export type SheetPart = z.infer<typeof SheetPartSchema>;
export type Joint = z.infer<typeof JointSchema>;
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
export type SceneProjection = z.infer<typeof SceneProjectionSchema>;
export type BomProjection = z.infer<typeof BomProjectionSchema>;
export type ProjectionBundle = z.infer<typeof ProjectionBundleSchema>;
