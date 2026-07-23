import { z } from "zod";

import {
  MachineProfileSchema,
  type DesignDocumentV1,
  type FabricationProjection,
  type MachineProfile,
  type SheetProjection
} from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import { umToMm } from "../domain/units.js";
import { OPERATION_COLORS } from "./fabrication/svg.js";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const ArtifactGroupIdSchema = z.enum(["product", "optional-cut-width-fit-test"]);

const SheetHandoffSchema = z
  .object({
    sheetId: z.string().min(1),
    svgSha256: Sha256Schema,
    units: z.literal("mm"),
    rootDimensionsMm: z.object({ width: z.number().positive(), height: z.number().positive() }).strict(),
    occupiedCompensatedBoundsUm: z
      .object({
        minXUm: z.number().int(),
        minYUm: z.number().int(),
        maxXUm: z.number().int(),
        maxYUm: z.number().int()
      })
      .strict(),
    rootPolicy: z
      .object({
        id: z.string().min(1),
        version: z.string().regex(/^\d+\.\d+\.\d+$/),
        symmetricPaddingMm: z.number().nonnegative()
      })
      .strict(),
    rebaseDeltaUm: z.object({ xUm: z.number().int(), yUm: z.number().int() }).strict(),
    requiredMaterialFootprintMm: z
      .object({ width: z.number().positive(), height: z.number().positive() })
      .strict(),
    effectiveNestingConstraintMm: z
      .object({
        width: z.number().positive(),
        height: z.number().positive(),
        source: z.enum(["processing-envelope", "stock-envelope-intersection"])
      })
      .strict(),
    complexity: z
      .object({
        pathCount: z.number().int().nonnegative(),
        openPathCountByOperation: z
          .object({ cut: z.number().int().nonnegative(), score: z.number().int().nonnegative(), engrave: z.number().int().nonnegative() })
          .strict(),
        closedPathCountByOperation: z
          .object({ cut: z.number().int().nonnegative(), score: z.number().int().nonnegative(), engrave: z.number().int().nonnegative() })
          .strict(),
        segmentCount: z.number().int().nonnegative(),
        vertexCount: z.number().int().nonnegative(),
        compoundRegionCount: z.literal(0),
        svgByteSize: z.number().int().positive(),
        largestOccupiedDimensionMm: z.number().positive()
      })
      .strict()
  })
  .strict();

const ArtifactGroupHandoffSchema = z
  .object({
    id: ArtifactGroupIdSchema,
    sourceDocumentHash: Sha256Schema,
    artifactSetHash: Sha256Schema,
    compensation: z.enum(["sketchycut-compensated-product-cut", "uncompensated-fit-test-cut"]),
    sheets: z.array(SheetHandoffSchema).min(1)
  })
  .strict();

export const XToolStudioHandoffSchema = z
  .object({
    schemaVersion: z.literal("2.0"),
    target: MachineProfileSchema.pick({
      id: true,
      manufacturer: true,
      model: true,
      module: true,
      processingMode: true,
      processingEnvelopeMm: true,
      downstreamApplication: true,
      minimumStudioDesktopVersion: true
    }),
    artifactGroups: z.array(ArtifactGroupHandoffSchema).length(2),
    importSettings: z
      .object({
        svgDpi: z.object({ status: z.literal("must-check-record"), exactValue: z.null() }).strict(),
        vectorQuality: z.object({ status: z.literal("must-check-record"), exactValue: z.null() }).strict(),
        oversizedImportPreference: z.literal("ask-every-time"),
        silentAutoScaleAllowed: z.literal(false)
      })
      .strict(),
    operationMap: z
      .array(
        z
          .object({
            order: z.number().int().min(1).max(3),
            operation: z.enum(["engrave", "score", "cut"]),
            color: z.string().regex(/^#[0-9a-f]{6}$/),
            nonColorLabel: z.string().min(1),
            manualStudioAssignmentRequired: z.literal(true),
            outputEnabledCheckRequired: z.literal(true),
            studioKerfOffsetMm: z.literal(0)
          })
          .strict(),
      )
      .length(3),
    processingPreview: z
      .object({
        required: z.literal(true),
        interiorCutsBeforeReleasedOuterContours: z.literal(true),
        provesKerfOffsetState: z.literal(false)
      })
      .strict(),
    compensationOwner: z.literal("SketchyCut"),
    requiredStudioKerfOffset: z.literal("off / 0.00 mm"),
    kerfOffsetParameterPanelCheckPerObjectOrLayer: z.literal(true),
    manualProcessParameterConfirmationRequired: z.literal(true),
    generatedProcessParameters: z.null(),
    cutThroughApplications: z.array(z.object({
      id: z.string().min(1),
      patternFamily: z.enum(["lattice-grid", "radial-rosette", "circle-field", "ring-aperture"]),
      purpose: z.string().min(1),
      requestedDensity: z.enum(["sparse", "balanced", "dense"]),
      realizedDensity: z.enum(["sparse", "balanced", "dense"]),
      targetPartIds: z.array(z.string().min(1)),
      featureIds: z.array(z.string().min(1))
    }).strict()),
    applicationLimitations: z.array(z.object({
      code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
      message: z.string().min(1),
      relatedIds: z.array(z.string().min(1))
    }).strict()),
    outputClaim: z.literal("xTool Studio-targeted; import verification required"),
    proprietaryProjectGenerated: z.literal(false),
    runtimeApplicationApiCalls: z.union([z.literal(0), z.literal(1)])
  })
  .strict();

export type XToolStudioHandoff = z.infer<typeof XToolStudioHandoffSchema>;

export type ArtifactGroupInput = {
  id: z.infer<typeof ArtifactGroupIdSchema>;
  fabrication: FabricationProjection;
  svgs: readonly { sheetId: string; svg: string; sha256: string }[];
};

export async function canonicalArtifactSetHash(
  id: ArtifactGroupInput["id"],
  sheets: readonly { sheetId: string; svgSha256: string }[],
): Promise<string> {
  return hashCanonical({
    artifactGroupId: id,
    sheets: [...sheets].sort((left, right) => left.sheetId.localeCompare(right.sheetId))
  });
}

function operationCounts(sheet: SheetProjection, closed: boolean) {
  return {
    cut: sheet.paths.filter((path) => path.operation === "cut" && path.closed === closed).length,
    score: sheet.paths.filter((path) => path.operation === "score" && path.closed === closed).length,
    engrave: sheet.paths.filter((path) => path.operation === "engrave" && path.closed === closed).length
  };
}

function projectSheet(
  sheet: SheetProjection,
  artifact: ArtifactGroupInput["svgs"][number],
): z.infer<typeof SheetHandoffSchema> {
  const occupiedWidthUm = sheet.occupiedBoundsUm.maxXUm - sheet.occupiedBoundsUm.minXUm;
  const occupiedHeightUm = sheet.occupiedBoundsUm.maxYUm - sheet.occupiedBoundsUm.minYUm;
  return SheetHandoffSchema.parse({
    sheetId: sheet.id,
    svgSha256: artifact.sha256,
    units: "mm",
    rootDimensionsMm: { width: sheet.widthMm, height: sheet.heightMm },
    occupiedCompensatedBoundsUm: sheet.occupiedBoundsUm,
    rootPolicy: sheet.rootPolicy,
    rebaseDeltaUm: sheet.rebaseDeltaUm,
    requiredMaterialFootprintMm: sheet.requiredMaterialFootprintMm,
    effectiveNestingConstraintMm: sheet.effectiveNestingConstraintMm,
    complexity: {
      pathCount: sheet.paths.length,
      openPathCountByOperation: operationCounts(sheet, false),
      closedPathCountByOperation: operationCounts(sheet, true),
      segmentCount: sheet.paths.reduce(
        (sum, path) => sum + Math.max(0, path.contour.points.length - (path.closed ? 0 : 1)),
        0,
      ),
      vertexCount: sheet.paths.reduce((sum, path) => sum + path.contour.points.length, 0),
      compoundRegionCount: 0,
      svgByteSize: new TextEncoder().encode(artifact.svg).length,
      largestOccupiedDimensionMm: umToMm(Math.max(occupiedWidthUm, occupiedHeightUm))
    }
  });
}

async function projectArtifactGroup(input: ArtifactGroupInput) {
  const artifacts = new Map(input.svgs.map((item) => [item.sheetId, item]));
  const sheets = [...input.fabrication.sheets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((sheet) => {
      const artifact = artifacts.get(sheet.id);
      if (artifact === undefined) throw new Error(`Missing SVG artifact for handoff sheet ${sheet.id}.`);
      return projectSheet(sheet, artifact);
    });
  if (artifacts.size !== sheets.length) {
    throw new Error(`Artifact group ${input.id} contains an SVG not present in its fabrication projection.`);
  }
  return ArtifactGroupHandoffSchema.parse({
    id: input.id,
    sourceDocumentHash: input.fabrication.sourceDocumentHash,
    artifactSetHash: await canonicalArtifactSetHash(
      input.id,
      sheets.map((sheet) => ({ sheetId: sheet.sheetId, svgSha256: sheet.svgSha256 })),
    ),
    compensation: input.id === "product"
      ? "sketchycut-compensated-product-cut"
      : "uncompensated-fit-test-cut",
    sheets
  });
}

export async function buildXToolStudioHandoff(
  machine: MachineProfile,
  product: Omit<ArtifactGroupInput, "id">,
  optionalFitTest: Omit<ArtifactGroupInput, "id">,
  runtimeApplicationApiCalls: 0 | 1 = 0,
  document?: DesignDocumentV1,
): Promise<XToolStudioHandoff> {
  return XToolStudioHandoffSchema.parse({
    schemaVersion: "2.0",
    target: {
      id: machine.id,
      manufacturer: machine.manufacturer,
      model: machine.model,
      module: machine.module,
      processingMode: machine.processingMode,
      processingEnvelopeMm: machine.processingEnvelopeMm,
      downstreamApplication: machine.downstreamApplication,
      minimumStudioDesktopVersion: machine.minimumStudioDesktopVersion
    },
    artifactGroups: await Promise.all([
      projectArtifactGroup({ id: "product", ...product }),
      projectArtifactGroup({ id: "optional-cut-width-fit-test", ...optionalFitTest })
    ]),
    importSettings: {
      svgDpi: { status: "must-check-record", exactValue: null },
      vectorQuality: { status: "must-check-record", exactValue: null },
      oversizedImportPreference: "ask-every-time",
      silentAutoScaleAllowed: false
    },
    operationMap: [
      { order: 1, operation: "engrave", color: OPERATION_COLORS.engrave, nonColorLabel: "Engrave filled areas", manualStudioAssignmentRequired: true, outputEnabledCheckRequired: true, studioKerfOffsetMm: 0 },
      { order: 2, operation: "score", color: OPERATION_COLORS.score, nonColorLabel: "Score centerlines", manualStudioAssignmentRequired: true, outputEnabledCheckRequired: true, studioKerfOffsetMm: 0 },
      { order: 3, operation: "cut", color: OPERATION_COLORS.cut, nonColorLabel: "Cut contours", manualStudioAssignmentRequired: true, outputEnabledCheckRequired: true, studioKerfOffsetMm: 0 }
    ],
    processingPreview: {
      required: true,
      interiorCutsBeforeReleasedOuterContours: true,
      provesKerfOffsetState: false
    },
    compensationOwner: "SketchyCut",
    requiredStudioKerfOffset: "off / 0.00 mm",
    kerfOffsetParameterPanelCheckPerObjectOrLayer: true,
    manualProcessParameterConfirmationRequired: true,
    generatedProcessParameters: null,
    cutThroughApplications: (document?.cutThroughApplications ?? []).map((application) => ({
      id: application.id,
      patternFamily: application.patternFamily,
      purpose: application.purpose,
      requestedDensity: application.requestedDensity,
      realizedDensity: application.realizedDensity,
      targetPartIds: application.targetPartIds,
      featureIds: application.featureIds
    })),
    applicationLimitations: document?.applicationLimitations ?? [],
    outputClaim: "xTool Studio-targeted; import verification required",
    proprietaryProjectGenerated: false,
    runtimeApplicationApiCalls
  });
}

export function renderXToolStudioChecklist(handoff: XToolStudioHandoff): string {
  const lines = [
    "# xTool Studio applied-export checklist",
    "",
    `Target: ${handoff.target.manufacturer} ${handoff.target.model} · ${handoff.target.module} · ${handoff.target.processingMode}`,
    `Studio: Desktop ${handoff.target.minimumStudioDesktopVersion} or later; record the exact version used.`,
    `Claim: ${handoff.outputClaim}.`,
    "",
    "## Exact artifact groups",
    ""
  ];
  for (const group of handoff.artifactGroups) {
    lines.push(
      `- ${group.id}: artifact-set hash \`${group.artifactSetHash}\`; source document \`${group.sourceDocumentHash}\`; ${group.compensation}.`,
    );
    for (const sheet of group.sheets) {
      lines.push(
        `  - ${sheet.sheetId}: \`${sheet.svgSha256}\`; ${sheet.rootDimensionsMm.width.toFixed(2)} × ${sheet.rootDimensionsMm.height.toFixed(2)} mm root; required stock ${sheet.requiredMaterialFootprintMm.width.toFixed(2)} × ${sheet.requiredMaterialFootprintMm.height.toFixed(2)} mm; ${String(sheet.complexity.pathCount)} paths; ${String(sheet.complexity.svgByteSize)} bytes.`,
      );
    }
  }
  if (handoff.cutThroughApplications.length > 0) {
    lines.push("", "## Registered cut-through applications", "");
    for (const application of handoff.cutThroughApplications) {
      lines.push(`- ${application.id}: ${application.patternFamily}; purpose ${application.purpose}; ` +
        `${application.requestedDensity} requested / ${application.realizedDensity} realized; ` +
        `${String(application.featureIds.length)} canonical cut features.`);
    }
  }
  if (handoff.applicationLimitations.length > 0) {
    lines.push("", "## Application limitations", "");
    for (const limitation of handoff.applicationLimitations) {
      lines.push(`- ${limitation.code}: ${limitation.message}`);
    }
  }
  lines.push(
    "",
    "## Import and assignment",
    "",
    "- Record exact SVG DPI and vector-quality settings; never manually rescale a mismatch.",
    "- Set oversized-import preference to Ask every time; silent auto-scaling is forbidden.",
  );
  for (const operation of handoff.operationMap) {
    lines.push(
      `- ${String(operation.order)}. ${operation.nonColorLabel} (${operation.color}): assign the operation manually, enable Output, and confirm Kerf Offset ${operation.studioKerfOffsetMm.toFixed(2)} mm in the parameter panel. This number identifies the operation; it is not a draggable Studio schedule.`,
    );
  }
  lines.push(
    "- Studio Auto owns operation scheduling and runs Cut last. Do not attempt to drag operation cards; confirm the resulting Cut-last sequence in processing preview.",
    "- Review processing preview with interior cuts before released outer contours; preview does not prove Kerf Offset state.",
    `- Compensation owner: ${handoff.compensationOwner}. Required Studio Kerf Offset: ${handoff.requiredStudioKerfOffset}.`,
    "",
    "No proprietary Studio project is generated. Physical verification remains required.",
    ""
  );
  return lines.join("\n");
}
