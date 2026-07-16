import {
  FitProfileSchema,
  MachineProfileSchema,
  MaterialProfileSchema,
  type FitProfile,
  type MachineProfile,
  type MaterialProfile
} from "./contracts.js";

function profileNumber(value: number): string {
  return String(Math.round(value * 1_000));
}

export function basswoodProfile(measuredThicknessMm: number): MaterialProfile {
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

export function xtoolM2Profile(kerfMm: number, directionalKerfYMm = kerfMm): MachineProfile {
  return MachineProfileSchema.parse({
    schemaVersion: "1.0",
    id: `xtool-m2-k${profileNumber(kerfMm)}-${profileNumber(directionalKerfYMm)}`,
    name: "xTool M2 20W provisional profile",
    bedMm: {
      width: 426,
      height: 320,
      margin: 5
    },
    kerfMm: {
      x: kerfMm,
      y: directionalKerfYMm
    },
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
