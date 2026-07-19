import { strToU8, zipSync, type Zippable } from "fflate";
import { z } from "zod";

import { Sha256Schema } from "../../domain/contracts.js";
import { sha256, stableJson } from "../../domain/hash.js";
import { GENERATOR_VERSION, SCHEMA_VERSION } from "../../version.js";
import { compileAccumulatedKerfGauge } from "../../operators/accumulated-kerf-gauge.js";
import { compileMaterialFitCoupon } from "../../operators/calibration-coupon.js";
import { buildMultiSheetProjectionBundle, buildProjectionBundle } from "../../projections/bundle.js";
import { nestParts, nestPartsAcrossSheets } from "../../projections/fabrication/nesting.js";
import {
  buildXToolStudioHandoff
} from "../../projections/handoff.js";
import { renderSceneSvg } from "../../projections/mesh/render-svg.js";
import { validateFabricationProjection } from "../../validation/sheet.js";
import { resolveGeneratedFabricationControls } from "../../interpretation/generated-fabrication.js";
import type { GeneratedCompiledProject } from "../../interpretation/generated-project-contracts.js";

import {
  PersistedProjectSchema,
  recompilePersistedProject,
  type PersistedProject
} from "./project-persistence.js";

export const GENERATION_PACKAGE_GENERATOR_VERSION = "1.0.0" as const;
export const GENERATION_IMPORT_COMPLEXITY_BUDGET = {
  policy: "current-product-svg-complexity-limit",
  studioDesktopVersion: "1.7.30",
  maximumPathCount: 66,
  maximumSegmentCount: 599,
  maximumVertexCount: 614,
  maximumSvgByteSize: 30_358
} as const;

const PackageSheetSchema = z.object({
  sheetId: z.string().min(1),
  path: z.string().min(1),
  svgSha256: Sha256Schema,
  units: z.literal("mm"),
  partIds: z.array(z.string().min(1)),
  rootDimensionsMm: z.object({ width: z.number().positive(), height: z.number().positive() }).strict(),
  occupiedBoundsUm: z.object({
    minXUm: z.number().int(),
    minYUm: z.number().int(),
    maxXUm: z.number().int(),
    maxYUm: z.number().int()
  }).strict(),
  requiredMaterialFootprintMm: z.object({
    width: z.number().positive(),
    height: z.number().positive()
  }).strict(),
  operationPathCounts: z.object({
    cut: z.number().int().nonnegative(),
    score: z.number().int().nonnegative(),
    engrave: z.number().int().nonnegative()
  }).strict(),
  complexity: z.object({
    pathCount: z.number().int().nonnegative(),
    segmentCount: z.number().int().nonnegative(),
    vertexCount: z.number().int().nonnegative(),
    svgByteSize: z.number().int().positive()
  }).strict(),
  importComplexityBudget: z.object({
    policy: z.literal(GENERATION_IMPORT_COMPLEXITY_BUDGET.policy),
    withinCurrentLimit: z.literal(true)
  }).strict()
}).strict();

export const FabricationPackageManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  packageGeneratorVersion: z.literal(GENERATION_PACKAGE_GENERATOR_VERSION),
  kernelGeneratorVersion: z.string().min(1),
  canonicalSchemaVersion: z.literal(SCHEMA_VERSION),
  persistedProjectId: z.string().min(1),
  projectId: z.string().min(1),
  sourceDocumentHash: Sha256Schema,
  geometryHash: Sha256Schema,
  runtimeApplicationApiCalls: z.union([z.literal(0), z.literal(1)]),
  outcome: z.literal("fabrication-candidate"),
  physicalVerification: z.literal("required"),
  compensationOwner: z.literal("SketchyCut"),
  requiredStudioKerfOffset: z.literal("off / 0.00 mm"),
  studioHandoff: z.object({
    minimumStudioDesktopVersion: z.string().min(1),
    svgDpi: z.object({ status: z.literal("must-check-record"), exactValue: z.null() }).strict(),
    vectorQuality: z.object({ status: z.literal("must-check-record"), exactValue: z.null() }).strict(),
    oversizedImportPreference: z.literal("ask-every-time"),
    silentAutoScaleAllowed: z.literal(false),
    operationMap: z.array(z.object({
      order: z.number().int().min(1).max(3),
      operation: z.enum(["engrave", "score", "cut"]),
      color: z.string().regex(/^#[0-9a-f]{6}$/),
      nonColorLabel: z.string().min(1),
      manualStudioAssignmentRequired: z.literal(true),
      outputEnabledCheckRequired: z.literal(true),
      studioKerfOffsetMm: z.literal(0)
    }).strict()).length(3),
    processingPreviewRequired: z.literal(true),
    interiorCutsBeforeReleasedOuterContours: z.literal(true),
    placementAndSafetyChecks: z.array(z.string().min(1)).min(1)
  }).strict(),
  importComplexityBudget: z.object({
    policy: z.literal(GENERATION_IMPORT_COMPLEXITY_BUDGET.policy),
    studioDesktopVersion: z.literal(GENERATION_IMPORT_COMPLEXITY_BUDGET.studioDesktopVersion),
    maximumPathCount: z.literal(GENERATION_IMPORT_COMPLEXITY_BUDGET.maximumPathCount),
    maximumSegmentCount: z.literal(GENERATION_IMPORT_COMPLEXITY_BUDGET.maximumSegmentCount),
    maximumVertexCount: z.literal(GENERATION_IMPORT_COMPLEXITY_BUDGET.maximumVertexCount),
    maximumSvgByteSize: z.literal(GENERATION_IMPORT_COMPLEXITY_BUDGET.maximumSvgByteSize)
  }).strict(),
  artifactGroups: z.array(z.object({
    id: z.enum(["product", "material-fit-coupon", "optional-cut-width-fit-test"]),
    sourceDocumentHash: Sha256Schema,
    compensation: z.enum([
      "sketchycut-compensated-product-cut",
      "sketchycut-compensated-material-fit-cut",
      "uncompensated-fit-test-cut"
    ]),
    sheetCount: z.number().int().positive(),
    sheets: z.array(PackageSheetSchema).min(1)
  }).strict()).length(3),
  files: z.array(z.object({
    path: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: Sha256Schema
  }).strict()).min(1),
  limitations: z.array(z.string().min(1)).min(1)
}).strict();

export type FabricationPackageManifest = z.infer<typeof FabricationPackageManifestSchema>;
export type FabricationPackage = {
  filename: string;
  bytes: Uint8Array;
  sha256: string;
  manifest: FabricationPackageManifest;
};

type ProjectionArtifacts = Awaited<ReturnType<typeof buildProjectionBundle>>;

function json(value: unknown): string {
  return `${stableJson(value)}\n`;
}

function markdownTitle(value: string): string {
  return value.replaceAll("-", " ");
}

function instructionMarkdown(compiled: GeneratedCompiledProject): string {
  const legend = compiled.bundle.legend;
  const instructions = compiled.bundle.instructions;
  if (legend === undefined || instructions === undefined) {
    throw new Error("GENERATION_PACKAGE_LINKED_BUILD_PROJECTIONS_MISSING");
  }
  const markByPart = new Map(legend.entries.map((entry) => [entry.partId, entry.markingCode]));
  const lines = [
    "# Numbered assembly instructions",
    "",
    `Project: ${compiled.document.projectId}`,
    `Source document: ${compiled.bundle.sourceDocumentHash}`,
    ""
  ];
  for (const step of instructions.steps) {
    const marks = [...new Set(step.partIds.map((id) => markByPart.get(id)).filter(
      (value): value is string => value !== undefined,
    ))].sort();
    lines.push(
      `${String(step.order + 1)}. **${markdownTitle(step.instructionKey)}** — ${
        marks.length === 1 ? "mark" : "marks"
      } ${marks.join(", ")}; ${step.sheetIds.join(", ")}${
        step.stockItemIds === undefined ? "" : `; stock ${step.stockItemIds.join(", ")}`
      }.`,
    );
  }
  lines.push(
    "",
    "Use only the declared sheet parts and permitted wooden stock. Structural glue is forbidden.",
    "Physical verification is required before relying on fit, motion, strength, or durability.",
    ""
  );
  return lines.join("\n");
}

function limitations(compiled: GeneratedCompiledProject) {
  return {
    schemaVersion: "1.0",
    projectId: compiled.document.projectId,
    sourceDocumentHash: compiled.bundle.sourceDocumentHash,
    geometryHash: compiled.geometryHash,
    canonicalValidation: compiled.document.validation,
    evidence: compiled.evidence,
    limitations: [
      "Fabrication candidate only; physical verification is required.",
      "xTool Studio import verification is required for these exact SVG bytes.",
      "No cut-through, fit, motion, strength, durability, or safety claim is made.",
      "Power, speed, passes, focus, air-pump state, exhaust, support, and material recipe must be confirmed manually.",
      "Framing and camera placement prove neither dimensions nor joint or mechanism clearance."
    ]
  };
}

function bomAndStock(compiled: GeneratedCompiledProject) {
  return {
    schemaVersion: "1.0",
    projectId: compiled.document.projectId,
    sourceDocumentHash: compiled.bundle.sourceDocumentHash,
    sheetMaterial: compiled.document.resolvedInputs.material,
    bom: compiled.bundle.bom,
    externalStock: compiled.document.externalStock ?? [],
    hardwarePolicy: compiled.document.resolvedInputs.hardwarePolicy
  };
}

function operationCounts(sheet: GeneratedCompiledProject["bundle"]["fabrication"]["sheets"][number]) {
  return {
    cut: sheet.paths.filter((path) => path.operation === "cut").length,
    score: sheet.paths.filter((path) => path.operation === "score").length,
    engrave: sheet.paths.filter((path) => path.operation === "engrave").length
  };
}

function segmentCount(sheet: GeneratedCompiledProject["bundle"]["fabrication"]["sheets"][number]) {
  return sheet.paths.reduce(
    (sum, path) => sum + Math.max(0, path.contour.points.length - (path.closed ? 0 : 1)),
    0,
  );
}

function assertPlainFabricationSvg(svg: string): void {
  const forbidden = [/<text\b/i, /<image\b/i, /<style\b/i, /\btransform\s*=/i, /(?:href|src)\s*=\s*["'](?:https?:|data:)/i];
  if (forbidden.some((pattern) => pattern.test(svg))) {
    throw new Error("GENERATION_PACKAGE_SVG_NOT_PLAIN");
  }
  if (!/<svg\b[^>]*\bwidth="[0-9.]+mm"[^>]*\bheight="[0-9.]+mm"/i.test(svg)) {
    throw new Error("GENERATION_PACKAGE_SVG_MM_ROOT_MISSING");
  }
}

function groupManifest(input: {
  id: "product" | "material-fit-coupon" | "optional-cut-width-fit-test";
  compensation: "sketchycut-compensated-product-cut" | "sketchycut-compensated-material-fit-cut" | "uncompensated-fit-test-cut";
  prefix: string;
  artifacts: ProjectionArtifacts;
}) {
  const svgBySheet = new Map(input.artifacts.svgs.map((item) => [item.sheetId, item]));
  const sheets = input.artifacts.bundle.fabrication.sheets.map((sheet) => {
    const svg = svgBySheet.get(sheet.id);
    if (svg === undefined) throw new Error("GENERATION_PACKAGE_SVG_MISSING");
    assertPlainFabricationSvg(svg.svg);
    const complexity = {
      pathCount: sheet.paths.length,
      segmentCount: segmentCount(sheet),
      vertexCount: sheet.paths.reduce((sum, path) => sum + path.contour.points.length, 0),
      svgByteSize: strToU8(svg.svg).byteLength
    };
    if (
      complexity.pathCount > GENERATION_IMPORT_COMPLEXITY_BUDGET.maximumPathCount ||
      complexity.segmentCount > GENERATION_IMPORT_COMPLEXITY_BUDGET.maximumSegmentCount ||
      complexity.vertexCount > GENERATION_IMPORT_COMPLEXITY_BUDGET.maximumVertexCount ||
      complexity.svgByteSize > GENERATION_IMPORT_COMPLEXITY_BUDGET.maximumSvgByteSize
    ) {
      throw new Error("GENERATION_PACKAGE_IMPORT_COMPLEXITY_BUDGET_EXCEEDED");
    }
    return PackageSheetSchema.parse({
      sheetId: sheet.id,
      path: `${input.prefix}/${sheet.id}.svg`,
      svgSha256: svg.sha256,
      units: "mm",
      partIds: sheet.placements.map((placement) => placement.partId).sort(),
      rootDimensionsMm: { width: sheet.widthMm, height: sheet.heightMm },
      occupiedBoundsUm: sheet.occupiedBoundsUm,
      requiredMaterialFootprintMm: sheet.requiredMaterialFootprintMm,
      operationPathCounts: operationCounts(sheet),
      complexity,
      importComplexityBudget: {
        policy: GENERATION_IMPORT_COMPLEXITY_BUDGET.policy,
        withinCurrentLimit: true
      }
    });
  });
  return {
    id: input.id,
    sourceDocumentHash: input.artifacts.bundle.sourceDocumentHash,
    compensation: input.compensation,
    sheetCount: sheets.length,
    sheets
  };
}

type PackageArtifactGroup = ReturnType<typeof groupManifest>;

function packageStudioHandoff(handoff: Awaited<ReturnType<typeof buildXToolStudioHandoff>>) {
  return {
    minimumStudioDesktopVersion: handoff.target.minimumStudioDesktopVersion,
    svgDpi: handoff.importSettings.svgDpi,
    vectorQuality: handoff.importSettings.vectorQuality,
    oversizedImportPreference: handoff.importSettings.oversizedImportPreference,
    silentAutoScaleAllowed: handoff.importSettings.silentAutoScaleAllowed,
    operationMap: handoff.operationMap,
    processingPreviewRequired: handoff.processingPreview.required,
    interiorCutsBeforeReleasedOuterContours:
      handoff.processingPreview.interiorCutsBeforeReleasedOuterContours,
    placementAndSafetyChecks: handoff.placementAndSafetyChecks
  };
}

function renderCompletePackageChecklist(input: {
  project: PersistedProject;
  compiled: GeneratedCompiledProject;
  groups: readonly PackageArtifactGroup[];
  handoff: Awaited<ReturnType<typeof buildXToolStudioHandoff>>;
}): string {
  const lines = [
    "# xTool Studio complete-package checklist",
    "",
    `Persisted project: ${input.project.projectId}`,
    `Canonical project: ${input.compiled.document.projectId}`,
    `Source document: ${input.compiled.bundle.sourceDocumentHash}`,
    `Schema: ${SCHEMA_VERSION}; kernel generator: ${GENERATOR_VERSION}; package generator: ${GENERATION_PACKAGE_GENERATOR_VERSION}.`,
    `Target: ${input.handoff.target.manufacturer} ${input.handoff.target.model} · ${input.handoff.target.module} · ${input.handoff.target.processingMode}.`,
    `Use xTool Studio Desktop ${input.handoff.target.minimumStudioDesktopVersion} or later and record the exact version used.`,
    "",
    "## Exact SVG groups and dimensions",
    ""
  ];
  for (const group of input.groups) {
    lines.push(`- ${group.id}: ${group.compensation}; source document \`${group.sourceDocumentHash}\`.`);
    for (const sheet of group.sheets) {
      const occupiedWidthMm = (sheet.occupiedBoundsUm.maxXUm - sheet.occupiedBoundsUm.minXUm) / 1_000;
      const occupiedHeightMm = (sheet.occupiedBoundsUm.maxYUm - sheet.occupiedBoundsUm.minYUm) / 1_000;
      lines.push(
        `  - ${sheet.sheetId}: \`${sheet.svgSha256}\`; ${sheet.rootDimensionsMm.width.toFixed(2)} × ${sheet.rootDimensionsMm.height.toFixed(2)} ${sheet.units} root; ${occupiedWidthMm.toFixed(2)} × ${occupiedHeightMm.toFixed(2)} ${sheet.units} occupied; required stock ${sheet.requiredMaterialFootprintMm.width.toFixed(2)} × ${sheet.requiredMaterialFootprintMm.height.toFixed(2)} ${sheet.units}; ${String(sheet.complexity.pathCount)} paths, ${String(sheet.complexity.segmentCount)} segments, ${String(sheet.complexity.svgByteSize)} bytes.`,
      );
    }
  }
  lines.push(
    "",
    "## Import and assignment",
    "",
    "- Record exact SVG DPI and vector-quality settings for every imported sheet; never manually rescale a mismatch.",
    "- Set oversized-import preference to Ask every time; silent auto-scaling is forbidden.",
  );
  for (const operation of input.handoff.operationMap) {
    lines.push(
      `- ${String(operation.order)}. ${operation.nonColorLabel} (${operation.color} selection aid): assign ${operation.operation} manually, enable Output, and confirm Studio Kerf Offset ${operation.studioKerfOffsetMm.toFixed(2)} mm for every applicable object or layer.`,
    );
  }
  lines.push(
    "- Review the processing preview and keep interior cuts before released outer contours; the preview does not prove the Kerf Offset parameter state.",
    `- Compensation owner: ${input.handoff.compensationOwner}. Required Studio Kerf Offset: ${input.handoff.requiredStudioKerfOffset}.`,
    "- Confirm power, speed, passes, focus/focus descent, built-in air-pump state, exhaust, support, orientation, and material recipe manually.",
    "",
    "## Flat-stock placement and safety",
    "",
    ...input.handoff.placementAndSafetyChecks.map((check) => `- ${check.replaceAll("-", " ")}.`),
    "- Keep every processing path at least 5 mm from every magnetic fixture and all four camera viewfinder points unobstructed.",
    "- Manual framing confirms placement and fixture avoidance only; it is not caliper evidence, joint-fit proof, or mechanical-clearance proof.",
    "",
    "No proprietary Studio project is generated. Import verification and physical verification remain required.",
    ""
  );
  return lines.join("\n");
}

function addArtifacts(
  files: Map<string, string>,
  prefix: string,
  artifacts: ProjectionArtifacts,
): void {
  for (const svg of artifacts.svgs) files.set(`${prefix}/${svg.sheetId}.svg`, svg.svg);
}

async function fileEntries(files: ReadonlyMap<string, string>) {
  return Promise.all([...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(async ([path, contents]) => ({
      path,
      bytes: strToU8(contents).byteLength,
      sha256: await sha256(contents)
    })));
}

export async function buildFabricationPackage(projectCandidate: PersistedProject): Promise<FabricationPackage> {
  const project = PersistedProjectSchema.parse(projectCandidate);
  const compiled = await recompilePersistedProject(project);
  if (
    compiled.document.validation.status !== "pass" ||
    compiled.bundle.sourceDocumentHash !== project.lastDocumentHash ||
    compiled.geometryHash !== project.lastGeometryHash
  ) {
    throw new Error("GENERATION_PACKAGE_PROJECT_REVALIDATION_MISMATCH");
  }
  const fabrication = resolveGeneratedFabricationControls(project.fabricationControls);
  const couponDocument = await compileMaterialFitCoupon(
    fabrication.profiles,
    fabrication.inputPolicyEvaluation,
  );
  const couponArtifacts = await buildProjectionBundle(
    couponDocument,
    nestParts(
      couponDocument.parts,
      fabrication.profiles.machine,
      fabrication.profiles.material,
      fabrication.profiles.processRecipe,
      fabrication.profiles.fabricationContext,
    ),
  );
  const gaugeDocument = await compileAccumulatedKerfGauge(
    fabrication.profiles,
    fabrication.inputPolicyEvaluation,
  );
  const gaugeArtifacts = await buildMultiSheetProjectionBundle(
    gaugeDocument,
    nestPartsAcrossSheets(
      gaugeDocument.parts,
      fabrication.profiles.machine,
      fabrication.profiles.material,
      fabrication.profiles.processRecipe,
      fabrication.profiles.fabricationContext,
    ),
  );
  const productArtifacts: ProjectionArtifacts = {
    bundle: compiled.bundle,
    svg: compiled.svgs[0]!.svg,
    svgs: compiled.svgs
  };
  for (const [document, artifacts] of [
    [compiled.document, productArtifacts],
    [couponDocument, couponArtifacts],
    [gaugeDocument, gaugeArtifacts]
  ] as const) {
    if (validateFabricationProjection(artifacts.bundle.fabrication, document.parts).status !== "pass") {
      throw new Error("GENERATION_PACKAGE_FABRICATION_VALIDATION_FAILED");
    }
  }
  const handoff = await buildXToolStudioHandoff(
    fabrication.profiles.machine,
    { fabrication: compiled.bundle.fabrication, svgs: compiled.svgs },
    { fabrication: gaugeArtifacts.bundle.fabrication, svgs: gaugeArtifacts.svgs },
    compiled.document.provenance.runtimeApplicationApiCalls,
  );
  const groups = [
    groupManifest({ id: "product", compensation: "sketchycut-compensated-product-cut", prefix: "product", artifacts: productArtifacts }),
    groupManifest({ id: "material-fit-coupon", compensation: "sketchycut-compensated-material-fit-cut", prefix: "material-fit-coupon", artifacts: couponArtifacts }),
    groupManifest({ id: "optional-cut-width-fit-test", compensation: "uncompensated-fit-test-cut", prefix: "optional-cut-width-fit-test", artifacts: gaugeArtifacts })
  ];
  const studioHandoff = packageStudioHandoff(handoff);
  const files = new Map<string, string>();
  addArtifacts(files, "product", productArtifacts);
  addArtifacts(files, "material-fit-coupon", couponArtifacts);
  addArtifacts(files, "optional-cut-width-fit-test", gaugeArtifacts);
  for (const svg of compiled.svgs) files.set(`previews/sheets/${svg.sheetId}.svg`, svg.svg);
  files.set("previews/assembled.svg", renderSceneSvg(compiled.bundle.scene, "assembled"));
  files.set("previews/exploded.svg", renderSceneSvg(compiled.bundle.scene, "exploded"));
  files.set("canonical-project.json", json(compiled.document));
  files.set("projection-bundle.json", json(compiled.bundle));
  files.set("bom-and-permitted-stock.json", json(bomAndStock(compiled)));
  files.set("parts-legend.json", json(compiled.bundle.legend));
  files.set("numbered-assembly-instructions.json", json(compiled.bundle.instructions));
  files.set("numbered-assembly-instructions.md", instructionMarkdown(compiled));
  files.set("validation-and-limitations.json", json(limitations(compiled)));
  files.set("handoff/xtool-studio-handoff.json", json({
    schemaVersion: "1.0",
    packageGeneratorVersion: GENERATION_PACKAGE_GENERATOR_VERSION,
    kernelGeneratorVersion: GENERATOR_VERSION,
    canonicalSchemaVersion: SCHEMA_VERSION,
    persistedProjectId: project.projectId,
    projectId: compiled.document.projectId,
    sourceDocumentHash: compiled.bundle.sourceDocumentHash,
    geometryHash: compiled.geometryHash,
    artifactGroups: groups,
    studioHandoff,
    compensationOwner: handoff.compensationOwner,
    requiredStudioKerfOffset: handoff.requiredStudioKerfOffset,
    outputClaim: handoff.outputClaim,
    proprietaryProjectGenerated: handoff.proprietaryProjectGenerated,
    runtimeApplicationApiCalls: handoff.runtimeApplicationApiCalls
  }));
  files.set("handoff/xtool-studio-checklist.md", renderCompletePackageChecklist({
    project,
    compiled,
    groups,
    handoff
  }));
  files.set("material-fit-coupon/canonical-document.json", json(couponDocument));
  files.set("optional-cut-width-fit-test/canonical-document.json", json(gaugeDocument));
  files.set("optional-cut-width-fit-test/measurement-instructions.md", [
    "# Optional accumulated full-cut-width fit test",
    "",
    "This is an uncompensated material/process measurement fixture, not an xTool M2 calibration.",
    "Cut all ten pieces without Studio Kerf Offset, preserve their scored orientation marks, pack them along X and Y, and measure each packed span with calipers.",
    "Full cut width = (nominal packed span − measured packed span) / 10.",
    "Record the matching material/batch, orientation, module, recipe, Studio/firmware versions, and downstream offset state.",
    "Physical verification is required.",
    ""
  ].join("\n"));
  const productGroup = groups[0]!;
  files.set("previews/sheet-selector.json", json({
    schemaVersion: "1.0",
    packageGeneratorVersion: GENERATION_PACKAGE_GENERATOR_VERSION,
    projectId: compiled.document.projectId,
    sourceDocumentHash: compiled.bundle.sourceDocumentHash,
    sheetCount: productGroup.sheetCount,
    selectedSheetId: productGroup.sheets[0]!.sheetId,
    sheets: productGroup.sheets.map((sheet) => ({
      sheetId: sheet.sheetId,
      previewPath: `previews/sheets/${sheet.sheetId}.svg`,
      fabricationPath: sheet.path,
      partIds: sheet.partIds,
      rootDimensionsMm: sheet.rootDimensionsMm,
      occupiedBoundsUm: sheet.occupiedBoundsUm,
      requiredMaterialFootprintMm: sheet.requiredMaterialFootprintMm
    }))
  }));
  files.set("README.md", [
    "# SketchyCut fabrication-candidate package",
    "",
    `Project: ${compiled.document.projectId}`,
    `Source document: ${compiled.bundle.sourceDocumentHash}`,
    `Geometry: ${compiled.geometryHash}`,
    "",
    "Start with `handoff/xtool-studio-checklist.md`. Import each required product sheet separately and compare its exact dimensions with `manifest.json`.",
    "The material/fit coupon is included. The accumulated cut-width test is optional and intentionally uncompensated.",
    "This package does not control the laser and is not evidence of cut-through, fit, motion, strength, durability, or safety.",
    ""
  ].join("\n"));

  const manifest = FabricationPackageManifestSchema.parse({
    schemaVersion: "1.0",
    packageGeneratorVersion: GENERATION_PACKAGE_GENERATOR_VERSION,
    kernelGeneratorVersion: GENERATOR_VERSION,
    canonicalSchemaVersion: SCHEMA_VERSION,
    persistedProjectId: project.projectId,
    projectId: compiled.document.projectId,
    sourceDocumentHash: compiled.bundle.sourceDocumentHash,
    geometryHash: compiled.geometryHash,
    runtimeApplicationApiCalls: compiled.document.provenance.runtimeApplicationApiCalls,
    outcome: "fabrication-candidate",
    physicalVerification: "required",
    compensationOwner: "SketchyCut",
    requiredStudioKerfOffset: "off / 0.00 mm",
    studioHandoff,
    importComplexityBudget: GENERATION_IMPORT_COMPLEXITY_BUDGET,
    artifactGroups: groups,
    files: await fileEntries(files),
    limitations: limitations(compiled).limitations
  });
  files.set("manifest.json", json(manifest));
  const zippable: Zippable = {};
  for (const [path, contents] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    zippable[path] = [strToU8(contents), { mtime: new Date("1980-01-02T00:00:00.000Z"), level: 6 }];
  }
  const bytes = zipSync(zippable, { mtime: new Date("1980-01-02T00:00:00.000Z"), level: 6 });
  return {
    filename: `sketchycut-${project.projectId}.zip`,
    bytes,
    sha256: await sha256(bytes),
    manifest
  };
}
