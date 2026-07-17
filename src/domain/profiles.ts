import {
  FitProfileSchema,
  MachineProfileSchema,
  MaterialProfileSchema,
  type CutWidthFixtureEvidence,
  type CutWidthSource,
  type FitProfile,
  type MachineProfile,
  type MaterialProfile
} from "./contracts.js";
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

/** Frozen adapter for reproducing the pre-M2.1 M1 coupon evidence only. */
export function historicalM1BasswoodProfile(
  measuredThicknessMm: number,
): MaterialProfile {
  return MaterialProfileSchema.parse({
    schemaVersion: "1.0",
    id: `basswood-${profileNumber(measuredThicknessMm)}`,
    name: `${measuredThicknessMm.toFixed(1)} mm basswood plywood`,
    materialKind: "basswood-plywood",
    nominalThicknessMm: 3,
    measuredThicknessMm,
    batchId: null,
    grainAxis: "x",
    physicalState: "provisional-preset"
  });
}

export function measuredBasswoodProfile(
  thicknessSamplesMm: readonly number[],
): MaterialProfile {
  const thicknessMeasurement = summarizeThicknessSamples(thicknessSamplesMm);
  const measuredThicknessMm = thicknessMeasurement.representativeThicknessMm;
  return MaterialProfileSchema.parse({
    schemaVersion: "1.0",
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

export function xtoolM2Profile(
  kerfMm: number,
  directionalKerfYMm = kerfMm,
  provenance?: {
    source: CutWidthSource;
    fixtureEvidence?: CutWidthFixtureEvidence;
  },
): MachineProfile {
  const normalizedKerfXmm = quantizeHundredthMm(kerfMm);
  const normalizedKerfYmm = quantizeHundredthMm(directionalKerfYMm);
  return MachineProfileSchema.parse({
    schemaVersion: "1.0",
    id: `xtool-m2-k${profileNumber(normalizedKerfXmm)}-${profileNumber(normalizedKerfYmm)}`,
    name: "xTool M2 20W provisional profile",
    bedMm: {
      width: 426,
      height: 320,
      margin: 5
    },
    kerfMm: {
      x: normalizedKerfXmm,
      y: normalizedKerfYmm
    },
    ...(provenance === undefined
      ? {}
      : {
          cutWidthSource: provenance.source,
          ...(provenance.fixtureEvidence === undefined
            ? {}
            : { cutWidthFixtureEvidence: provenance.fixtureEvidence })
        }),
    minimumFeatureMm: 0.5,
    exportFormat: "svg",
    downstreamApplication: "xTool Studio"
  });
}

export function provisionalFitProfile(): FitProfile {
  return FitProfileSchema.parse({
    schemaVersion: "1.0",
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
