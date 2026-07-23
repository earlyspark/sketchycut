import {
  FitProfileSchema,
  FabricationContextSchema,
  MachineProfileSchema,
  MaterialProfileSchema,
  ProcessRecipeSchema,
  type CutWidthFixtureEvidence,
  type CutWidthSource,
  type FabricationContext,
  type FitProfile,
  type MachineProfile,
  type MaterialProfile,
  type ProcessRecipe,
  type StockFootprint
} from "./contracts.js";
import { hashCanonical } from "./hash.js";
import {
  quantizeHundredthMm,
  summarizeThicknessSamples
} from "./input-policy.js";

function profileNumber(value: number): string {
  return String(Math.round(value * 1_000));
}

export function basswoodProfile(
  measuredThicknessMm: number,
): MaterialProfile {
  return measuredBasswoodProfile([measuredThicknessMm]);
}

export function measuredBasswoodProfile(
  thicknessSamplesMm: readonly number[],
): MaterialProfile {
  const thicknessMeasurement = summarizeThicknessSamples(thicknessSamplesMm);
  const measuredThicknessMm = thicknessMeasurement.representativeThicknessMm;
  return MaterialProfileSchema.parse({
    schemaVersion: "2.0",
    id: `basswood-${profileNumber(measuredThicknessMm)}`,
    name: `${measuredThicknessMm.toFixed(2)} mm basswood plywood`,
    materialKind: "basswood-plywood",
    nominalThicknessMm: 3,
    measuredThicknessMm,
    thicknessBasis: "user-reported-caliper",
    nominalStock: {
      presetId: "stock-3mm-basswood-laser-plywood",
      presetVersion: "1.0.0",
      policyId: "nominal-three-millimetre-laser-plywood",
      policyVersion: "1.1.0"
    },
    batchId: null,
    grainAxis: "x",
    physicalState: "provisional-preset",
    thicknessMeasurement
  });
}

export function xtoolM2Profile(): MachineProfile {
  return MachineProfileSchema.parse({
    schemaVersion: "2.0",
    id: "xtool-m2-20w-blue-light-flat",
    name: "xTool M2 20W blue-light flat-surface target",
    manufacturer: "xTool",
    model: "M2",
    module: "20W blue-light laser",
    processingMode: "flat-surface-lasering",
    processingEnvelopeMm: {
      width: 426,
      height: 320
    },
    minimumFeatureMm: 0.5,
    exportFormat: "svg",
    downstreamApplication: "xTool Studio",
    minimumStudioDesktopVersion: "1.7.30",
    confidence: "vendor-documented-target"
  });
}

export function defaultFabricationContext(
  stockFootprint: StockFootprint | null = null,
): FabricationContext {
  return FabricationContextSchema.parse({
    stockFootprint,
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
  });
}

export function provisionalProcessRecipe(
  material: MaterialProfile,
  machine: MachineProfile,
  kerfMm: number,
  directionalKerfYMm = kerfMm,
  provenance?: {
    source: CutWidthSource;
    fixtureEvidence?: CutWidthFixtureEvidence;
  },
): ProcessRecipe {
  const normalizedKerfXmm = quantizeHundredthMm(kerfMm);
  const normalizedKerfYmm = quantizeHundredthMm(directionalKerfYMm);
  return ProcessRecipeSchema.parse({
    schemaVersion: "2.0",
    id: `process-unrecorded-k${profileNumber(normalizedKerfXmm)}-${profileNumber(normalizedKerfYmm)}`,
    machineProfileId: machine.id,
    materialProfileId: material.id,
    materialBatchOrSheetId: material.batchId,
    processingMode: machine.processingMode,
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
      xMm: normalizedKerfXmm,
      yMm: normalizedKerfYmm,
      semantics: "full-cut-width",
      source: provenance?.source ?? "provisional-preset",
      ...(provenance?.fixtureEvidence === undefined
        ? {}
        : { fixtureEvidence: provenance.fixtureEvidence }),
      recipeHash: null
    },
    recipeHash: null,
    evidenceStatus: "unrecorded"
  });
}

export function provisionalFabricationProfiles(
  material: MaterialProfile,
  kerfMm: number,
  directionalKerfYMm = kerfMm,
  options: {
    machine?: MachineProfile;
    fit?: FitProfile;
    fabricationContext?: FabricationContext;
    source?: CutWidthSource;
    fixtureEvidence?: CutWidthFixtureEvidence;
  } = {},
) {
  const machine = options.machine ?? xtoolM2Profile();
  const processRecipe = provisionalProcessRecipe(
    material,
    machine,
    kerfMm,
    directionalKerfYMm,
    {
      source: options.source ?? "provisional-preset",
      ...(options.fixtureEvidence === undefined
        ? {}
        : { fixtureEvidence: options.fixtureEvidence })
    },
  );
  return {
    material,
    machine,
    processRecipe,
    fabricationContext: options.fabricationContext ?? defaultFabricationContext(),
    fit: options.fit ?? provisionalFitProfile()
  };
}

export type RecordedProcessRecipeInput = Omit<
  ProcessRecipe,
  "recipeHash" | "cutWidth" | "evidenceStatus"
> & {
  evidenceStatus: "user-reported" | "reviewed";
  cutWidth: Omit<ProcessRecipe["cutWidth"], "recipeHash">;
};

export async function recordedProcessRecipe(
  input: RecordedProcessRecipeInput,
): Promise<ProcessRecipe> {
  const recipeHash = await hashCanonical({
    hashKind: "sketchycut-process-recipe@2.0.0",
    ...input
  });
  return ProcessRecipeSchema.parse({
    ...input,
    cutWidth: { ...input.cutWidth, recipeHash },
    recipeHash
  });
}

export function provisionalFitProfile(): FitProfile {
  return FitProfileSchema.parse({
    schemaVersion: "2.0",
    id: "fit-provisional",
    name: "Provisional plywood fit ladder",
    deltaSemantics: "opening-size-minus-insert-size",
    press: { totalDeltaMm: -0.1, confidence: "provisional" },
    snug: { totalDeltaMm: 0, confidence: "provisional" },
    sliding: { totalDeltaMm: 0.15, confidence: "provisional" },
    rotating: { totalDeltaMm: 0.2, confidence: "provisional" },
    rod: { totalDeltaMm: 0.1, confidence: "provisional" }
  });
}

/**
 * Current application starter fit. The +0.15 mm snug value is the next
 * deterministic step after the hash-bound +0.10 mm product observation.
 * It remains provisional for any other sheet; exact cut-candidate evidence
 * retains its own confidence, source package, and geometry hashes.
 */
export function publicStarterFitProfile(): FitProfile {
  return FitProfileSchema.parse({
    ...provisionalFitProfile(),
    id: "fit-public-starter-current",
    name: "Current provisional plywood starter fit",
    snug: { totalDeltaMm: 0.15, confidence: "provisional" }
  });
}
