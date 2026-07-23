import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";

import { canonicalGeometryHash } from "../../compiler/canonical.js";
import {
  DesignDocumentV1Schema,
  type DesignDocumentV1,
  FabricationContextSchema,
  FitProfileSchema,
  MaterialProfileSchema,
  type FitProfile,
  type InputPolicyEvaluation
} from "../../domain/contracts.js";
import {
  createPublicFabricationSetup,
  resolveFabricationSetup,
  type AppliedFabricationSetup
} from "../../domain/fabrication-setup.js";
import { hashCanonical, sha256, stableJson } from "../../domain/hash.js";
import { quantizeHundredthMm } from "../../domain/input-policy.js";
import { provisionalFitProfile, recordedProcessRecipe } from "../../domain/profiles.js";
import { compileAccumulatedKerfGauge } from "../../operators/accumulated-kerf-gauge.js";
import { compileMaterialFitCoupon } from "../../operators/calibration-coupon.js";
import {
  buildMultiSheetProjectionBundle,
  buildProjectionBundle,
  type ProjectionArtifacts
} from "../../projections/bundle.js";
import { nestParts, nestPartsAcrossSheets } from "../../projections/fabrication/nesting.js";
import { buildXToolStudioHandoff } from "../../projections/handoff.js";
import { renderSceneSvg } from "../../projections/mesh/render-svg.js";
import { validateFabricationProjection } from "../../validation/sheet.js";
import {
  GUIDED_EXAMPLE_CATALOG,
  buildGuidedProductCompileRequest,
  type AvailableGuidedExample
} from "./guided-examples.js";
import { compileProductRequest } from "../../workers/compile-service.js";
import type { ProductCompileWorkerSuccess } from "../../workers/protocol.js";

import {
  PhysicalConfidenceArtifactSetSchema,
  PhysicalConfidenceInputSchema,
  PhysicalConfidencePackageManifestSchema,
  type PhysicalConfidenceArtifactSet,
  type PhysicalConfidenceInput,
  type PhysicalConfidencePackageManifest
} from "./physical-confidence-contracts.js";
import { buildPhysicalConfidenceObservationDraft } from "./physical-confidence-observation.js";

export const PHYSICAL_CONFIDENCE_GENERATOR_VERSION = "2.0.0" as const;

export type VerifiedProductAdjustmentSource = {
  packageSha256: string;
  manifest: PhysicalConfidencePackageManifest;
  packageBytes: Uint8Array;
  reviewFiles: ReadonlyMap<string, string>;
};

export type VerifiedPhysicalConfidencePackage = {
  packageSha256: string;
  manifest: PhysicalConfidencePackageManifest;
  packageBytes: Uint8Array;
};

export type PhysicalConfidenceBuildOptions = {
  productAdjustmentSources?: readonly VerifiedProductAdjustmentSource[];
};

async function verifyPhysicalConfidencePackageArchive(
  packageBytes: Uint8Array,
  mode: "current-package" | "immutable-adjustment-evidence" = "current-package",
): Promise<VerifiedPhysicalConfidencePackage & {
  files: Readonly<Record<string, Uint8Array>>;
}> {
  const packageSha256 = await sha256(packageBytes);
  const files = unzipSync(packageBytes);
  const rawManifest = files["manifest.json"];
  if (rawManifest === undefined) {
    throw new Error("PHYSICAL_CONFIDENCE_PACKAGE_MANIFEST_MISSING");
  }
  const manifest = PhysicalConfidencePackageManifestSchema.parse(
    JSON.parse(strFromU8(rawManifest)) as unknown,
  );
  for (const entry of manifest.files) {
    const bytes = files[entry.path];
    if (
      bytes?.byteLength !== entry.bytes ||
      await sha256(bytes) !== entry.sha256
    ) {
      throw new Error(`PHYSICAL_CONFIDENCE_PACKAGE_FILE_MISMATCH:${entry.path}`);
    }
  }
  if (mode === "current-package") {
    const canonicalProjectBytes = files["canonical-project.json"];
    if (canonicalProjectBytes === undefined) {
      throw new Error("PHYSICAL_CONFIDENCE_PACKAGE_CANONICAL_PROJECT_MISSING");
    }
    const sourceDocument = DesignDocumentV1Schema.parse(
      JSON.parse(strFromU8(canonicalProjectBytes)) as unknown,
    );
    const treatmentFeatureIds = new Set(sourceDocument.parts.flatMap((part) =>
      part.features
        .filter((feature) => feature.kind === "treatment" && feature.operation === "score")
        .map((feature) => feature.id)
    ));
    for (const group of manifest.artifactGroups) {
      for (const sheet of group.sheets) {
        const svgBytes = files[sheet.path];
        if (svgBytes === undefined) {
          throw new Error(`PHYSICAL_CONFIDENCE_PACKAGE_SVG_MISSING:${sheet.path}`);
        }
        const svg = strFromU8(svgBytes);
        const scoreTreatmentPathCount = group.id === "product"
          ? [...treatmentFeatureIds].reduce((total, featureId) =>
              total + svg.split(`data-feature-id="${featureId}"`).length - 1,
            0)
          : 0;
        if (
          sheet.scoreTreatmentPathCount !== scoreTreatmentPathCount
        ) {
          throw new Error(
            `PHYSICAL_CONFIDENCE_PACKAGE_TREATMENT_COUNT_MISMATCH:${sheet.path}`,
          );
        }
      }
    }
  }
  return { packageSha256, manifest, packageBytes, files };
}

export async function verifyPhysicalConfidencePackage(
  packageBytes: Uint8Array,
): Promise<VerifiedPhysicalConfidencePackage> {
  const verified = await verifyPhysicalConfidencePackageArchive(packageBytes);
  return {
    packageSha256: verified.packageSha256,
    manifest: verified.manifest,
    packageBytes: verified.packageBytes
  };
}

export async function verifyPhysicalConfidenceAdjustmentSource(
  packageBytes: Uint8Array,
): Promise<VerifiedProductAdjustmentSource> {
  // A product-observation source is immutable hash-bound evidence, not a
  // current project input. Verify its manifest and every archived byte without
  // teaching the current DesignDocument reader to accept an obsolete schema.
  const verified = await verifyPhysicalConfidencePackageArchive(
    packageBytes,
    "immutable-adjustment-evidence",
  );
  const { packageSha256, manifest, files } = verified;
  if (
    manifest.stage !== "cut-candidate" ||
    !["basic", "hinged", "sliding"].includes(manifest.candidateId)
  ) {
    throw new Error("PHYSICAL_CONFIDENCE_ADJUSTMENT_SOURCE_NOT_ELIGIBLE_CUT_CANDIDATE");
  }
  const fitEvidenceBytes = files["fit-selection-evidence.json"];
  if (
    manifest.fabricationInput.fit.basis !== "coupon-observed" ||
    fitEvidenceBytes === undefined ||
    stableJson(JSON.parse(strFromU8(fitEvidenceBytes)) as unknown) !==
      stableJson(manifest.fabricationInput.fit)
  ) {
    throw new Error("PHYSICAL_CONFIDENCE_ADJUSTMENT_SOURCE_FIT_EVIDENCE_MISMATCH");
  }
  const reviewFiles = new Map<string, string>();
  const assembled = files["previews/assembled.svg"];
  const exploded = files["previews/exploded.svg"];
  if (assembled === undefined || exploded === undefined) {
    throw new Error("PHYSICAL_CONFIDENCE_ADJUSTMENT_SOURCE_PREVIEW_MISSING");
  }
  reviewFiles.set(`${manifest.candidateId}-assembled.svg`, strFromU8(assembled));
  reviewFiles.set(`${manifest.candidateId}-exploded.svg`, strFromU8(exploded));
  const product = manifest.artifactGroups.find((group) => group.id === "product");
  if (product === undefined) {
    throw new Error("PHYSICAL_CONFIDENCE_ADJUSTMENT_SOURCE_PRODUCT_GROUP_MISSING");
  }
  for (const sheet of product.sheets) {
    const svg = files[sheet.path];
    if (svg === undefined) {
      throw new Error(`PHYSICAL_CONFIDENCE_ADJUSTMENT_SOURCE_SVG_MISSING:${sheet.path}`);
    }
    reviewFiles.set(`${manifest.candidateId}-${sheet.sheetId}.svg`, strFromU8(svg));
  }
  return { packageSha256, manifest, packageBytes: verified.packageBytes, reviewFiles };
}

export type PhysicalConfidencePackage = {
  candidateId: "basic" | "hinged" | "sliding";
  filename: string;
  bytes: Uint8Array;
  sha256: string;
  manifest: PhysicalConfidencePackageManifest;
  reviewFiles: ReadonlyMap<string, string>;
};

export type BuiltPhysicalConfidenceArtifactSet = {
  summary: PhysicalConfidenceArtifactSet;
  packages: readonly PhysicalConfidencePackage[];
  sharedReviewFiles: ReadonlyMap<string, string>;
};

const CANDIDATES = [
  { candidateId: "basic", guidedExampleId: "basic-box" },
  { candidateId: "hinged", guidedExampleId: "hinged-lid-box" },
  { candidateId: "sliding", guidedExampleId: "sliding-lid-box" }
] as const;

function json(value: unknown): string {
  return `${stableJson(value)}\n`;
}

export function assembledPhysicalEnvelopeMm(document: DesignDocumentV1): {
  width: number;
  depth: number;
  height: number;
} {
  const points = document.parts.flatMap((part) =>
    part.nominalRegion.outer.points.flatMap((point) =>
      [0, part.thicknessUm].map((thicknessUm) => ({
        xUm: part.assembledFrame.origin.xUm +
          point.xUm * part.assembledFrame.xAxis.x +
          point.yUm * part.assembledFrame.yAxis.x +
          thicknessUm * part.assembledFrame.zAxis.x,
        yUm: part.assembledFrame.origin.yUm +
          point.xUm * part.assembledFrame.xAxis.y +
          point.yUm * part.assembledFrame.yAxis.y +
          thicknessUm * part.assembledFrame.zAxis.y,
        zUm: part.assembledFrame.origin.zUm +
          point.xUm * part.assembledFrame.xAxis.z +
          point.yUm * part.assembledFrame.yAxis.z +
          thicknessUm * part.assembledFrame.zAxis.z
      }))
    )
  );
  if (points.length === 0) throw new Error("PHYSICAL_CONFIDENCE_ASSEMBLED_BOUNDS_EMPTY");
  const dimension = (axis: "xUm" | "yUm" | "zUm") => {
    const values = points.map((point) => point[axis]);
    return (Math.max(...values) - Math.min(...values)) / 1_000;
  };
  return { width: dimension("xUm"), depth: dimension("yUm"), height: dimension("zUm") };
}

function selectedFit(
  input: PhysicalConfidenceInput,
  mode: "effective" | "coupon-baseline" = "effective",
) {
  if (input.fit.basis === "provisional") return null;
  const provisional = provisionalFitProfile();
  const fitClass = (
    name: keyof Pick<FitProfile, "press" | "snug" | "sliding" | "rotating" | "rod">,
  ) => {
    const evidence = input.fit.basis === "coupon-observed"
      ? input.fit.classes[name]
      : undefined;
    if (evidence === undefined) return provisional[name];
    if (mode === "coupon-baseline" && evidence.adjustment !== undefined) {
      return {
        totalDeltaMm: evidence.adjustment.baselineTotalDeltaMm,
        confidence: "coupon-selected" as const
      };
    }
    return { totalDeltaMm: evidence.totalDeltaMm, confidence: evidence.confidence };
  };
  return FitProfileSchema.parse({
    schemaVersion: "2.0",
    id: "fit-capability-scoped-current",
    name: "Current capability-scoped coupon fit profile",
    deltaSemantics: "opening-size-minus-insert-size",
    press: fitClass("press"),
    snug: fitClass("snug"),
    sliding: fitClass("sliding"),
    rotating: fitClass("rotating"),
    rod: fitClass("rod")
  });
}

type FitClassName = keyof Pick<FitProfile, "press" | "snug" | "sliding" | "rotating" | "rod">;

function requiredFitClasses(document: DesignDocumentV1): readonly FitClassName[] {
  return [...new Set<FitClassName>(document.parts.flatMap((part) => part.features.flatMap((feature) =>
    feature.fitClass === null ? [] : [feature.fitClass]
  )))].sort();
}

function requireSelectedFitCoverage(
  document: DesignDocumentV1,
  fit: FitProfile,
  stage: PhysicalConfidenceInput["stage"],
): readonly FitClassName[] {
  const required = requiredFitClasses(document);
  if (stage !== "cut-candidate") return required;
  const missing = required.filter((fitClass) =>
    !["coupon-selected", "product-observed"].includes(fit[fitClass].confidence)
  );
  if (missing.length > 0) {
    throw new Error(`PHYSICAL_CONFIDENCE_REQUIRED_FIT_UNSELECTED:${missing.join(",")}`);
  }
  return required;
}

function scopeFitEvidence(
  input: PhysicalConfidenceInput,
  required: readonly FitClassName[],
  candidateId: (typeof CANDIDATES)[number]["candidateId"],
): PhysicalConfidenceInput["fit"] {
  if (input.fit.basis !== "coupon-observed") return input.fit;
  return {
    ...input.fit,
    classes: Object.fromEntries(required.flatMap((fitClass) => {
      const evidence = input.fit.basis === "coupon-observed"
        ? input.fit.classes[fitClass]
        : undefined;
      if (evidence === undefined) return [];
      if (candidateId === "basic" && evidence.adjustment !== undefined) {
        return [[fitClass, {
          totalDeltaMm: evidence.adjustment.baselineTotalDeltaMm,
          confidence: "coupon-selected" as const,
          observations: evidence.observations
        }]];
      }
      return [[fitClass, evidence]];
    }))
  };
}

function fixtureEvidence(input: PhysicalConfidenceInput) {
  if (input.cutWidth.source === "provisional-preset") return undefined;
  return input.cutWidth.fixtureEvidence;
}

function adjustmentEvidence(input: PhysicalConfidenceInput) {
  if (input.fit.basis !== "coupon-observed") return [];
  return Object.entries(input.fit.classes).flatMap(([fitClass, evidence]) =>
    evidence?.adjustment === undefined
      ? []
      : [{ fitClass, fitEvidence: evidence, adjustment: evidence.adjustment }]
  );
}

function requireVerifiedProductAdjustments(
  resolved: Awaited<ReturnType<typeof resolveInput>>,
  options: PhysicalConfidenceBuildOptions,
): void {
  const adjustments = adjustmentEvidence(resolved.input);
  if (adjustments.length === 0) return;
  if (adjustments.length !== 1 || adjustments[0]!.fitClass !== "snug") {
    throw new Error("PHYSICAL_CONFIDENCE_PRODUCT_ADJUSTMENT_SCOPE_INVALID");
  }
  const { fitEvidence, adjustment } = adjustments[0]!;
  const source = options.productAdjustmentSources?.find(
    (candidate) => candidate.packageSha256 === adjustment.sourcePackageSha256,
  );
  if (source === undefined) {
    throw new Error("PHYSICAL_CONFIDENCE_PRODUCT_ADJUSTMENT_SOURCE_REQUIRED");
  }
  const product = source.manifest.artifactGroups.find((group) => group.id === "product");
  const sourceFit = source.manifest.fabricationInput.fit;
  const sourceSnug = sourceFit.basis === "coupon-observed"
    ? sourceFit.classes.snug
    : undefined;
  const sourceProductHashes = product?.sheets.map((sheet) => sheet.svgSha256) ?? [];
  const currentCouponHash = resolved.input.fit.basis === "coupon-observed"
    ? resolved.input.fit.couponSvgSha256
    : null;
  const expectedCurrentDeltaMm = Math.round((
    adjustment.baselineTotalDeltaMm + adjustment.adjustmentMm
  ) * 100) / 100;
  const sourceFitMatches = adjustment.sourceCandidateId === "basic"
    ? (
        sourceSnug?.confidence === "coupon-selected" &&
        sourceSnug.adjustment === undefined &&
        sourceSnug.totalDeltaMm === adjustment.baselineTotalDeltaMm
      )
    : (
        sourceSnug?.confidence === "product-observed" &&
        sourceSnug.adjustment !== undefined &&
        sourceSnug.totalDeltaMm > adjustment.baselineTotalDeltaMm &&
        sourceSnug.totalDeltaMm < expectedCurrentDeltaMm
      );
  if (
    source.manifest.candidateId !== adjustment.sourceCandidateId ||
    !sourceProductHashes.includes(adjustment.sourceProductSvgSha256) ||
    currentCouponHash === null ||
    sourceFit.basis !== "coupon-observed" ||
    sourceFit.couponSvgSha256 !== currentCouponHash ||
    !sourceFitMatches ||
    fitEvidence.totalDeltaMm !== expectedCurrentDeltaMm ||
    source.manifest.materialProfileHash !== resolved.hashes.materialProfileHash ||
    source.manifest.processRecipeHash !== resolved.hashes.processRecipeHash
  ) {
    throw new Error("PHYSICAL_CONFIDENCE_PRODUCT_ADJUSTMENT_SOURCE_MISMATCH");
  }
}

async function resolveInput(inputCandidate: PhysicalConfidenceInput) {
  const input = PhysicalConfidenceInputSchema.parse(inputCandidate);
  if (input.retainedPin === null) {
    throw new Error("PHYSICAL_CONFIDENCE_RETAINED_PIN_REQUIRED");
  }
  const pin = input.retainedPin;
  const initial = createPublicFabricationSetup(input.stock.presetId);
  const evidence = fixtureEvidence(input);
  const setup: AppliedFabricationSetup = {
    ...initial,
    stockFootprint: {
      ...initial.stockFootprint!,
      widthMm: quantizeHundredthMm(input.stock.footprintMm.width),
      heightMm: quantizeHundredthMm(input.stock.footprintMm.height),
      sheetId: "m7-current-sheet",
      evidenceId: null
    },
    thickness: input.stock.thickness.basis === "nominal-preset"
      ? initial.thickness
      : {
          basis: "user-reported-caliper",
          readingsMm: input.stock.thickness.readingsMm
        },
    cutWidth: evidence === undefined
      ? initial.cutWidth
      : {
          source: "fixture-derived",
          xMm: evidence.normalizedFullCutWidthMm.x,
          yMm: evidence.normalizedFullCutWidthMm.y,
          fixtureEvidence: evidence
        }
  };
  const resolved = resolveFabricationSetup(setup);
  if (
    evidence?.method === "joint-fit-offset-selection" &&
    evidence.boardThicknessMm !== resolved.material.measuredThicknessMm
  ) {
    throw new Error("PHYSICAL_CONFIDENCE_JOINT_FIXTURE_THICKNESS_MISMATCH");
  }
  const material = MaterialProfileSchema.parse({
    ...resolved.material,
    batchId: input.stock.batchId,
    grainAxis: input.stock.grainAxis === "machine-x-grain-x" ? "x" : "y"
  });
  const fabricationContext = FabricationContextSchema.parse({
    ...resolved.fabricationContext,
    stockFootprint: resolved.fabricationContext.stockFootprint === null
      ? null
      : {
          ...resolved.fabricationContext.stockFootprint,
          materialProfileId: material.id
        }
  });
  const fit = selectedFit(input) ?? resolved.fit;
  const couponBaselineFit = selectedFit(input, "coupon-baseline") ?? resolved.fit;
  const processRecipe = input.process === null
    ? resolved.processRecipe
    : await recordedProcessRecipe({
        schemaVersion: "2.0",
        id: `process-current-${input.stage}`,
        machineProfileId: resolved.machine.id,
        materialProfileId: material.id,
        materialBatchOrSheetId: material.batchId,
        processingMode: "flat-surface-lasering",
        studioDesktopVersion: input.process.studioDesktopVersion,
        firmwareVersion: input.process.firmwareVersion,
        materialPresetSource: input.process.materialPresetSource,
        powerPercent: input.process.powerPercent,
        speedMmPerSecond: input.process.speedMmPerSecond,
        passCount: input.process.passCount,
        focusMode: input.process.focusMode,
        focusDescentMm: input.process.focusDescentMm,
        builtInAirPump: input.process.builtInAirPump,
        sheetOrientation: input.stock.grainAxis,
        supportArrangement: input.process.supportArrangement,
        studioKerfOffsetMm: input.process.studioKerfOffsetMm,
        cutWidth: {
          xMm: resolved.processRecipe.cutWidth.xMm,
          yMm: resolved.processRecipe.cutWidth.yMm,
          semantics: "full-cut-width",
          source: resolved.processRecipe.cutWidth.source,
          ...(resolved.processRecipe.cutWidth.fixtureEvidence === undefined
            ? {}
            : { fixtureEvidence: resolved.processRecipe.cutWidth.fixtureEvidence })
        },
        evidenceStatus: input.process.evidenceStatus
      });
  const profiles = {
    material,
    machine: resolved.machine,
    processRecipe,
    fabricationContext,
    fit
  };
  return {
    input,
    inputHash: await hashCanonical(input),
    profiles,
    couponBaselineProfiles: { ...profiles, fit: couponBaselineFit },
    inputPolicyEvaluation: resolved.inputPolicyEvaluation,
    pin,
    hashes: {
      materialProfileHash: await hashCanonical(material),
      processRecipeHash: await hashCanonical(processRecipe),
      fitProfileHash: await hashCanonical(fit),
      couponBaselineFitProfileHash: await hashCanonical(couponBaselineFit),
      pinProfileHash: await hashCanonical(pin)
    }
  };
}

async function sharedFixtures(
  profiles: Awaited<ReturnType<typeof resolveInput>>["profiles"],
  inputPolicyEvaluation: InputPolicyEvaluation,
  pinDiameterMm: number,
) {
  const generalCouponDocument = await compileMaterialFitCoupon(
    profiles,
    inputPolicyEvaluation,
  );
  const generalCouponArtifacts = await buildProjectionBundle(
    generalCouponDocument,
    nestParts(
      generalCouponDocument.parts,
      profiles.machine,
      profiles.material,
      profiles.processRecipe,
      profiles.fabricationContext,
    ),
  );
  const retainedPinCouponDocument = await compileMaterialFitCoupon(
    profiles,
    inputPolicyEvaluation,
    pinDiameterMm,
  );
  const retainedPinCouponArtifacts = await buildProjectionBundle(
    retainedPinCouponDocument,
    nestParts(
      retainedPinCouponDocument.parts,
      profiles.machine,
      profiles.material,
      profiles.processRecipe,
      profiles.fabricationContext,
    ),
  );
  const gaugeDocument = await compileAccumulatedKerfGauge(profiles, inputPolicyEvaluation);
  const gaugeArtifacts = await buildMultiSheetProjectionBundle(
    gaugeDocument,
    nestPartsAcrossSheets(
      gaugeDocument.parts,
      profiles.machine,
      profiles.material,
      profiles.processRecipe,
      profiles.fabricationContext,
    ),
  );
  return {
    generalCouponDocument,
    generalCouponArtifacts,
    retainedPinCouponDocument,
    retainedPinCouponArtifacts,
    gaugeDocument,
    gaugeArtifacts
  };
}

function entry(id: string): AvailableGuidedExample {
  const value = GUIDED_EXAMPLE_CATALOG.find((item) => item.id === id);
  if (value === undefined) throw new Error(`PHYSICAL_CONFIDENCE_GUIDED_EXAMPLE_MISSING:${id}`);
  return value;
}

async function compileCandidate(
  candidate: (typeof CANDIDATES)[number],
  resolved: Awaited<ReturnType<typeof resolveInput>>,
): Promise<ProductCompileWorkerSuccess> {
  const profiles = candidate.candidateId === "basic"
    ? resolved.couponBaselineProfiles
    : resolved.profiles;
  return compileProductRequest(buildGuidedProductCompileRequest(
    entry(candidate.guidedExampleId),
    {
      requestId: `physical-confidence-${candidate.candidateId}`,
      presetId: "medium",
      profiles,
      inputPolicyEvaluation: resolved.inputPolicyEvaluation,
      retainedPin: resolved.pin
    },
  ));
}

function operationCounts(sheet: ProjectionArtifacts["bundle"]["fabrication"]["sheets"][number]) {
  return {
    engrave: sheet.paths.filter((item) => item.operation === "engrave").length,
    score: sheet.paths.filter((item) => item.operation === "score").length,
    cut: sheet.paths.filter((item) => item.operation === "cut").length
  };
}

function partDimensions(
  sheet: ProjectionArtifacts["bundle"]["fabrication"]["sheets"][number],
) {
  const transform = (
    point: { xUm: number; yUm: number },
    placement: (typeof sheet.placements)[number],
  ) => {
    const rotated = (() => {
      switch (placement.rotationDegrees) {
        case 0: return point;
        case 90: return { xUm: -point.yUm, yUm: point.xUm };
        case 180: return { xUm: -point.xUm, yUm: -point.yUm };
        case 270: return { xUm: point.yUm, yUm: -point.xUm };
      }
    })();
    return {
      xUm: rotated.xUm + placement.xUm,
      yUm: rotated.yUm + placement.yUm
    };
  };
  return sheet.placements.map((placement) => {
    const points = sheet.paths
      .filter((path) => path.partId === placement.partId)
      .flatMap((path) => path.contour.points.map((point) => transform(point, placement)));
    if (points.length === 0) throw new Error("PHYSICAL_CONFIDENCE_PART_PATHS_MISSING");
    const xs = points.map((point) => point.xUm);
    const ys = points.map((point) => point.yUm);
    return {
      partId: placement.partId,
      width: (Math.max(...xs) - Math.min(...xs)) / 1_000,
      height: (Math.max(...ys) - Math.min(...ys)) / 1_000
    };
  }).sort((left, right) => left.partId.localeCompare(right.partId));
}

function importedOccupiedDimensions(
  sheet: ProjectionArtifacts["bundle"]["fabrication"]["sheets"][number],
) {
  const dimensions = partDimensions(sheet);
  const placedPoints = sheet.placements.flatMap((placement) => {
    const transform = (point: { xUm: number; yUm: number }) => {
      const rotated = (() => {
        switch (placement.rotationDegrees) {
          case 0: return point;
          case 90: return { xUm: -point.yUm, yUm: point.xUm };
          case 180: return { xUm: -point.xUm, yUm: -point.yUm };
          case 270: return { xUm: point.yUm, yUm: -point.xUm };
        }
      })();
      return {
        xUm: rotated.xUm + placement.xUm,
        yUm: rotated.yUm + placement.yUm
      };
    };
    return sheet.paths
      .filter((path) => path.partId === placement.partId)
      .flatMap((path) => path.contour.points.map(transform));
  });
  if (dimensions.length === 0 || placedPoints.length === 0) {
    throw new Error("PHYSICAL_CONFIDENCE_SHEET_PATHS_MISSING");
  }
  const xs = placedPoints.map((point) => point.xUm);
  const ys = placedPoints.map((point) => point.yUm);
  return {
    width: (Math.max(...xs) - Math.min(...xs)) / 1_000,
    height: (Math.max(...ys) - Math.min(...ys)) / 1_000
  };
}

function group(
  id: "product" | "material-fit-coupon" | "optional-cut-width-fit-test",
  compensation: "sketchycut-compensated-product-cut" | "sketchycut-compensated-material-fit-cut" | "uncompensated-fit-test-cut",
  prefix: string,
  artifacts: ProjectionArtifacts,
  document: DesignDocumentV1,
) {
  const svgBySheet = new Map(artifacts.svgs.map((item) => [item.sheetId, item]));
  const scoreTreatmentFeatureIds = new Set(document.parts.flatMap((part) =>
    part.features
      .filter((feature) => feature.kind === "treatment" && feature.operation === "score")
      .map((feature) => feature.id)
  ));
  return {
    id,
    compensation,
    sourceDocumentHash: artifacts.bundle.sourceDocumentHash,
    sheets: artifacts.bundle.fabrication.sheets.map((sheet) => {
      const svg = svgBySheet.get(sheet.id);
      if (svg === undefined) throw new Error("PHYSICAL_CONFIDENCE_SVG_MISSING");
      return {
        sheetId: sheet.id,
        path: `${prefix}/${sheet.id}.svg`,
        svgSha256: svg.sha256,
        rootDimensionsMm: { width: sheet.widthMm, height: sheet.heightMm },
        importedOccupiedDimensionsMm: importedOccupiedDimensions(sheet),
        requiredMaterialFootprintMm: sheet.requiredMaterialFootprintMm,
        partIds: sheet.placements.map((placement) => placement.partId).sort(),
        partDimensionsMm: partDimensions(sheet),
        operationPathCounts: operationCounts(sheet),
        scoreTreatmentPathCount: sheet.paths.filter((path) =>
          path.featureId !== null && scoreTreatmentFeatureIds.has(path.featureId)
        ).length
      };
    })
  };
}

function addSvgs(files: Map<string, string>, prefix: string, artifacts: ProjectionArtifacts): void {
  for (const svg of artifacts.svgs) files.set(`${prefix}/${svg.sheetId}.svg`, svg.svg);
}

function instructionMarkdown(compiled: ProductCompileWorkerSuccess): string {
  const legend = compiled.bundle.legend;
  const instructions = compiled.bundle.instructions;
  if (legend === undefined || instructions === undefined) {
    throw new Error("PHYSICAL_CONFIDENCE_LINKED_INSTRUCTIONS_MISSING");
  }
  const markByPart = new Map(legend.entries.map((item) => [item.partId, item.markingCode]));
  const lines = ["# Numbered assembly instructions", ""];
  for (const step of instructions.steps) {
    const marks = [...new Set(step.partIds.flatMap((partId) => {
      const mark = markByPart.get(partId);
      return mark === undefined ? [] : [mark];
    }))].sort();
    lines.push(`${String(step.order + 1)}. ${step.instructionKey.replaceAll("-", " ")} — marks ${marks.join(", ")}${
      step.cutThroughApplicationIds === undefined
        ? ""
        : `; cut-through applications ${step.cutThroughApplicationIds.join(", ")}; features ${step.cutThroughFeatureIds?.join(", ") ?? "none"}; purposes ${step.cutThroughPurposes?.join(", ") ?? "none"}`
    }${step.limitationCodes === undefined ? "" : `; limitations ${step.limitationCodes.join(", ")}`} .`);
  }
  if ((compiled.document.applicationLimitations ?? []).length > 0) {
    lines.push("", "## Application limitations", "");
    for (const limitation of compiled.document.applicationLimitations ?? []) {
      lines.push(`- ${limitation.code}: ${limitation.message}`);
    }
  }
  lines.push("", "Structural glue is forbidden. Physical verification is required.", "");
  return lines.join("\n");
}

function checklist(
  compiled: ProductCompileWorkerSuccess,
  groups: ReturnType<typeof group>[],
  minimumStudioVersion: string,
): string {
  const lines = [
    "# xTool Studio import and cut checklist",
    "",
    `Canonical project: ${compiled.document.projectId}`,
    `Source document: ${compiled.bundle.sourceDocumentHash}`,
    `Use xTool Studio Desktop ${minimumStudioVersion} or later and record the exact version.`,
    "Keep SketchyCut compensation authoritative: Studio Kerf Offset off / 0.00 mm.",
    ""
  ];
  for (const artifactGroup of groups) {
    lines.push(`## ${artifactGroup.id}`, "");
    for (const sheet of artifactGroup.sheets) {
      lines.push(
        `- ${sheet.path}: ${sheet.rootDimensionsMm.width.toFixed(2)} × ${sheet.rootDimensionsMm.height.toFixed(2)} mm root; ` +
        `${sheet.importedOccupiedDimensionsMm.width.toFixed(2)} × ${sheet.importedOccupiedDimensionsMm.height.toFixed(2)} mm occupied after Studio import; ` +
        `${sheet.requiredMaterialFootprintMm.width.toFixed(2)} × ${sheet.requiredMaterialFootprintMm.height.toFixed(2)} mm required footprint; ` +
        `SHA-256 ${sheet.svgSha256}.`,
      );
      lines.push(
        `  Known imported part bounds: ${sheet.partDimensionsMm.map((part) =>
          `${part.partId} ${part.width.toFixed(2)} × ${part.height.toFixed(2)} mm`
        ).join("; ")}.`,
      );
    }
    lines.push("");
  }
  lines.push(
    "- Import through Upload; record SVG DPI, vector quality, and oversized-import preference. Never resize.",
    "- Assign every operation that has paths manually by operation label/color and enable Output; omit operations with zero paths. Studio Auto owns scheduling and runs Cut last, so do not attempt to drag operation cards. Confirm Cut-last and inner-before-outer contour handling in processing preview.",
    ""
  );
  return lines.join("\n");
}

async function fileEntries(files: ReadonlyMap<string, string>) {
  return Promise.all([...files.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
    async ([path, contents]) => ({
      path,
      bytes: strToU8(contents).byteLength,
      sha256: await sha256(contents)
    }),
  ));
}

async function buildPackage(
  candidate: (typeof CANDIDATES)[number],
  compiled: ProductCompileWorkerSuccess,
  resolved: Awaited<ReturnType<typeof resolveInput>>,
  fixtures: Awaited<ReturnType<typeof sharedFixtures>>,
): Promise<PhysicalConfidencePackage> {
  const retainedPinCandidate = candidate.candidateId === "hinged";
  const candidateProfiles = candidate.candidateId === "basic"
    ? resolved.couponBaselineProfiles
    : resolved.profiles;
  const requiredFits = requireSelectedFitCoverage(
    compiled.document,
    candidateProfiles.fit,
    resolved.input.stage,
  );
  const couponDocument = retainedPinCandidate
    ? fixtures.retainedPinCouponDocument
    : fixtures.generalCouponDocument;
  const couponArtifacts = retainedPinCandidate
    ? fixtures.retainedPinCouponArtifacts
    : fixtures.generalCouponArtifacts;
  const fabricationInput: PhysicalConfidenceInput = retainedPinCandidate
    ? {
        ...resolved.input,
        fit: scopeFitEvidence(resolved.input, requiredFits, candidate.candidateId)
      }
    : {
        ...resolved.input,
        fit: scopeFitEvidence(resolved.input, requiredFits, candidate.candidateId),
        retainedPin: null
      };
  const inputHash = await hashCanonical(fabricationInput);
  const pinProfileHash = retainedPinCandidate ? resolved.hashes.pinProfileHash : null;
  const fitProfileHash = candidate.candidateId === "basic"
    ? resolved.hashes.couponBaselineFitProfileHash
    : resolved.hashes.fitProfileHash;
  const hasProductAdjustment = fabricationInput.fit.basis === "coupon-observed" &&
    Object.values(fabricationInput.fit.classes).some((fitClass) =>
      fitClass?.adjustment !== undefined
    );
  const productArtifacts: ProjectionArtifacts = {
    bundle: compiled.bundle,
    svg: compiled.svgs[0]!.svg,
    svgs: compiled.svgs
  };
  for (const [document, artifacts] of [
    [compiled.document, productArtifacts],
    [couponDocument, couponArtifacts],
    [fixtures.gaugeDocument, fixtures.gaugeArtifacts]
  ] as const) {
    if (validateFabricationProjection(artifacts.bundle.fabrication, document.parts).status !== "pass") {
      throw new Error("PHYSICAL_CONFIDENCE_FABRICATION_VALIDATION_FAILED");
    }
  }
  const handoff = await buildXToolStudioHandoff(
    resolved.profiles.machine,
    { fabrication: productArtifacts.bundle.fabrication, svgs: productArtifacts.svgs },
    { fabrication: fixtures.gaugeArtifacts.bundle.fabrication, svgs: fixtures.gaugeArtifacts.svgs },
    0,
    compiled.document,
  );
  const groups = [
    group(
      "product",
      "sketchycut-compensated-product-cut",
      "product",
      productArtifacts,
      compiled.document,
    ),
    group(
      "material-fit-coupon",
      "sketchycut-compensated-material-fit-cut",
      "material-fit-coupon",
      couponArtifacts,
      couponDocument,
    ),
    group(
      "optional-cut-width-fit-test",
      "uncompensated-fit-test-cut",
      "optional-cut-width-fit-test",
      fixtures.gaugeArtifacts,
      fixtures.gaugeDocument,
    )
  ];
  const files = new Map<string, string>();
  addSvgs(files, "product", productArtifacts);
  addSvgs(files, "material-fit-coupon", couponArtifacts);
  addSvgs(files, "optional-cut-width-fit-test", fixtures.gaugeArtifacts);
  for (const svg of compiled.svgs) files.set(`previews/sheets/${svg.sheetId}.svg`, svg.svg);
  files.set("previews/assembled.svg", renderSceneSvg(compiled.bundle.scene, "assembled"));
  files.set("previews/exploded.svg", renderSceneSvg(compiled.bundle.scene, "exploded"));
  files.set("canonical-project.json", json(compiled.document));
  files.set("projection-bundle.json", json(compiled.bundle));
  files.set("fabrication-evidence.json", json(compiled.evidence));
  files.set("fabrication-input.json", json(fabricationInput));
  if (fabricationInput.fit.basis === "coupon-observed") {
    files.set("fit-selection-evidence.json", json(fabricationInput.fit));
  }
  if (resolved.profiles.processRecipe.cutWidth.fixtureEvidence !== undefined) {
    files.set(
      "cut-width-fixture-evidence.json",
      json(resolved.profiles.processRecipe.cutWidth.fixtureEvidence),
    );
  }
  files.set("bom-and-permitted-stock.json", json({
    sheetMaterial: compiled.document.resolvedInputs.material,
    bom: compiled.bundle.bom,
    externalStock: compiled.document.externalStock ?? [],
    hardwarePolicy: compiled.document.resolvedInputs.hardwarePolicy
  }));
  files.set("parts-legend.json", json(compiled.bundle.legend));
  files.set("numbered-assembly-instructions.json", json(compiled.bundle.instructions));
  files.set("numbered-assembly-instructions.md", instructionMarkdown(compiled));
  files.set("material-fit-coupon/canonical-document.json", json(couponDocument));
  const retainedPinMeasurementLines = resolved.pin.basis === "user-reported-reference-gauge"
    ? [
        `This hinged-candidate coupon uses the retained toothpick section's deterministic ${resolved.pin.effectiveDiameterMm.toFixed(2)} mm midpoint between the reported ${resolved.pin.minimumDiameterMm.toFixed(2)}–${resolved.pin.maximumDiameterMm.toFixed(2)} mm reference bounds.`,
        "Use a visually straight section of the same toothpick. The left circular bore checks rotating clearance; the right circular bore checks rod/retention fit."
      ]
    : [
        `This hinged-candidate coupon uses the retained pin diameter ${resolved.pin.effectiveDiameterMm.toFixed(2)} mm.`,
        "Use the same retained pin stock. The left circular bore checks rotating clearance; the right circular bore checks rod/retention fit."
      ];
  files.set("material-fit-coupon/measurement-instructions.md", [
    "# Material and fit coupon observations",
    "",
    "Use the numbered slot ladder with the matching insert to confirm that press, snug, and sliding behavior feels appropriate before cutting product sheets.",
    "Never substitute a nearby setting for the exact physical observation; regenerate only from retained evidence.",
    ...(retainedPinCandidate ? [
      "",
      ...retainedPinMeasurementLines,
      "Do not force the toothpick or crack the coupon. Record whether each bore will not admit it, requires force, moves smoothly and remains retained, or is loose."
    ] : [
      "",
      "The circular bores are generic coupon features and are not evidence for this non-hinged candidate."
    ]),
    ""
  ].join("\n"));
  files.set("optional-cut-width-fit-test/canonical-document.json", json(fixtures.gaugeDocument));
  files.set("optional-cut-width-fit-test/measurement-instructions.md", [
    "# Optional accumulated full-cut-width measurement",
    "",
    "This optional uncompensated fixture is a caliper-based refinement, not M2 calibration and not a prerequisite for the no-tool joint-fit selection retained in cut-width-fixture-evidence.json.",
    "If calipers are available, cut all ten pieces with Studio Kerf Offset off/0, preserve the scored orientation marks, pack them along X and Y, and measure both packed spans.",
    "Full cut width = (nominal packed span − measured packed span) / 10.",
    "A refinement is new evidence: record the matching material/batch, grain orientation, exact process recipe, Studio and firmware versions, and downstream offset state before regenerating product bytes.",
    ""
  ].join("\n"));
  files.set("handoff/xtool-studio-handoff.json", json(handoff));
  files.set("handoff/xtool-studio-checklist.md", checklist(
    compiled,
    groups,
    resolved.profiles.machine.minimumStudioDesktopVersion,
  ));
  files.set("validation-and-limitations.json", json({
    canonicalValidation: compiled.document.validation,
    physicalVerification: "required",
    limitations: [
      "Fabrication candidate only; physical verification is required.",
      hasProductAdjustment
        ? "Only fit classes consumed by this candidate are evidence-backed and claimed; the product-observed snug adjustment retains its exact source-product hashes and unrelated fit samples are not product evidence."
        : "Only fit classes consumed by this candidate are coupon-selected and claimed; unrelated fit samples are not product evidence.",
      "The M6.3 broad semantic-generalization gate remains failed and is unrelated to this pre-interpreted candidate.",
      "Studio import, cut-through, fit, motion, strength, and durability are not proved by these bytes."
    ]
  }));
  const evaluatedDocumentHash = compiled.bundle.sourceDocumentHash;
  const geometryHash = await canonicalGeometryHash(compiled.document);
  if (geometryHash !== compiled.geometryHash) throw new Error("PHYSICAL_CONFIDENCE_GEOMETRY_HASH_MISMATCH");
  const manifest = PhysicalConfidencePackageManifestSchema.parse({
    schemaVersion: "sketchycut-physical-confidence-package@2.0.0",
    generatorVersion: PHYSICAL_CONFIDENCE_GENERATOR_VERSION,
    stage: resolved.input.stage,
    candidateId: candidate.candidateId,
    guidedExampleId: candidate.guidedExampleId,
    canonicalProjectId: compiled.document.projectId,
    expectedFinishedEnvelopeMm: assembledPhysicalEnvelopeMm(compiled.document),
    fabricationInput,
    evaluatedDocumentHash,
    geometryHash,
    inputHash,
    materialProfileHash: resolved.hashes.materialProfileHash,
    processRecipeHash: resolved.hashes.processRecipeHash,
    fitProfileHash,
    pinProfileHash,
    runtimeModelCalls: 0,
    physicalVerification: "required",
    compensationOwner: "SketchyCut",
    requiredStudioKerfOffset: "off / 0.00 mm",
    artifactGroups: groups,
    files: await fileEntries(files),
    limitations: [
      "Physical verification is required for these exact bytes.",
      "Only fit classes consumed by this candidate are claimed; unused press fit remains provisional and unverified.",
      "No broad semantic-reliability, Studio-ready, machine-compatibility, cut-through, fit, motion, strength, or durability claim is made."
    ]
  });
  files.set("manifest.json", json(manifest));
  const zippable: Zippable = {};
  for (const [path, contents] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    zippable[path] = [strToU8(contents), { mtime: new Date("1980-01-02T00:00:00.000Z"), level: 6 }];
  }
  const bytes = zipSync(zippable, { mtime: new Date("1980-01-02T00:00:00.000Z"), level: 6 });
  const packageSha256 = await sha256(bytes);
  const observationDraft = json(buildPhysicalConfidenceObservationDraft(packageSha256, manifest));
  return {
    candidateId: candidate.candidateId,
    filename: `sketchycut-${candidate.candidateId}-physical-confidence.zip`,
    bytes,
    sha256: packageSha256,
    manifest,
    reviewFiles: new Map([
      [`${candidate.candidateId}-assembled.svg`, files.get("previews/assembled.svg")!],
      [`${candidate.candidateId}-exploded.svg`, files.get("previews/exploded.svg")!],
      [`${candidate.candidateId}-physical-observation-template.json`, observationDraft],
      ...compiled.svgs.map((svg) => [`${candidate.candidateId}-${svg.sheetId}.svg`, svg.svg] as const)
    ])
  };
}

export async function buildPhysicalConfidenceArtifactSet(
  inputCandidate: PhysicalConfidenceInput,
  options: PhysicalConfidenceBuildOptions = {},
): Promise<BuiltPhysicalConfidenceArtifactSet> {
  const resolved = await resolveInput(inputCandidate);
  requireVerifiedProductAdjustments(resolved, options);
  const fixtures = await sharedFixtures(
    resolved.couponBaselineProfiles,
    resolved.inputPolicyEvaluation,
    resolved.pin.effectiveDiameterMm,
  );
  if (resolved.input.stage === "cut-candidate") {
    const observedCouponHash = resolved.input.fit.basis === "coupon-observed"
      ? resolved.input.fit.couponSvgSha256
      : null;
    const generatedCouponHashes = await Promise.all(
      fixtures.retainedPinCouponArtifacts.svgs.map((svg) => sha256(svg.svg)),
    );
    if (
      observedCouponHash === null ||
      !generatedCouponHashes.includes(observedCouponHash)
    ) {
      throw new Error("PHYSICAL_CONFIDENCE_COUPON_SOURCE_HASH_MISMATCH");
    }
  }
  const packages = await Promise.all(CANDIDATES.map(async (candidate) => buildPackage(
    candidate,
    await compileCandidate(candidate, resolved),
    resolved,
    fixtures,
  )));
  const summary = PhysicalConfidenceArtifactSetSchema.parse({
    schemaVersion: "sketchycut-physical-confidence-artifact-set@2.0.0",
    generatorVersion: PHYSICAL_CONFIDENCE_GENERATOR_VERSION,
    stage: resolved.input.stage,
    inputHash: resolved.inputHash,
    runtimeModelCalls: 0,
    physicalVerification: "required",
    material: {
      profileHash: resolved.hashes.materialProfileHash,
      measuredThicknessMm: resolved.profiles.material.measuredThicknessMm,
      thicknessBasis: resolved.profiles.material.thicknessBasis,
      batchId: resolved.profiles.material.batchId
    },
    cutWidth: {
      xMm: resolved.profiles.processRecipe.cutWidth.xMm,
      yMm: resolved.profiles.processRecipe.cutWidth.yMm,
      source: resolved.profiles.processRecipe.cutWidth.source
    },
    fitProfileHashes: {
      basic: resolved.hashes.couponBaselineFitProfileHash,
      hinged: resolved.hashes.fitProfileHash,
      sliding: resolved.hashes.fitProfileHash
    },
    processRecipeHash: resolved.hashes.processRecipeHash,
    retainedPin: {
      profileHash: resolved.hashes.pinProfileHash,
      ...resolved.pin
    },
    packages: packages.map((item) => ({
      candidateId: item.candidateId,
      filename: item.filename,
      sha256: item.sha256,
      bytes: item.bytes.byteLength,
      manifest: item.manifest
    }))
  });
  const sharedReviewFiles = new Map<string, string>([
    ...fixtures.retainedPinCouponArtifacts.svgs.map((svg) => [
      `material-fit-coupon-${svg.sheetId}.svg`,
      svg.svg
    ] as const),
    ...fixtures.gaugeArtifacts.svgs.map((svg) => [
      `optional-cut-width-test-${svg.sheetId}.svg`,
      svg.svg
    ] as const)
  ]);
  return { summary, packages, sharedReviewFiles };
}
