import type {
  CutWidthFixtureEvidence,
  CutWidthSource,
  InputPolicyEvaluation,
  FabricationContext,
  MachineProfile,
  MaterialProfile,
  ProcessRecipe,
  StockFootprint,
  ThicknessBasis
} from "./contracts.js";
import { StockFootprintSchema } from "./contracts.js";
import {
  evaluateStockInputs,
  quantizeHundredthMm,
  requireSupportedStockInputs
} from "./input-policy.js";
import {
  defaultFabricationContext,
  provisionalFitProfile,
  provisionalProcessRecipe,
  xtoolM2Profile
} from "./profiles.js";
import {
  measuredMaterialProfileFromStock,
  nominalMaterialProfileFromStock,
  resolveNominalStockPreset,
  type NominalStockPresetId
} from "./stock-catalog.js";

export type AppliedThicknessSetup =
  | { basis: "nominal-preset"; effectiveThicknessMm: number }
  | { basis: "user-reported-caliper"; readingsMm: readonly [number] | readonly [number, number, number] };

export type AppliedCutWidthSetup = {
  source: CutWidthSource;
  xMm: number;
  yMm: number;
  fixtureEvidence?: CutWidthFixtureEvidence;
};

export type AppliedPinSetup = {
  basis: "nominal-preset" | "user-reported-caliper";
  effectiveDiameterMm: number;
};

export function createStarterPinSetup(): AppliedPinSetup {
  return { basis: "nominal-preset", effectiveDiameterMm: 3 };
}

export function resolvePinSetup(pin: AppliedPinSetup): AppliedPinSetup {
  const effectiveDiameterMm = quantizeHundredthMm(pin.effectiveDiameterMm);
  if (effectiveDiameterMm <= 0) {
    throw new RangeError("Pin diameter must be a positive caliper value or registered starter estimate.");
  }
  return { ...pin, effectiveDiameterMm };
}

export type AppliedFabricationSetup = {
  stockPresetId: NominalStockPresetId;
  stockFootprint: StockFootprint | null;
  thickness: AppliedThicknessSetup;
  cutWidth: AppliedCutWidthSetup;
};

export type ResolvedFabricationSetup = {
  applied: AppliedFabricationSetup;
  material: MaterialProfile;
  machine: MachineProfile;
  processRecipe: ProcessRecipe;
  fabricationContext: FabricationContext;
  fit: ReturnType<typeof provisionalFitProfile>;
  inputPolicyEvaluation: InputPolicyEvaluation;
};

export function createStarterFabricationSetup(
  stockPresetId: NominalStockPresetId = "stock-3mm-basswood-laser-plywood",
): AppliedFabricationSetup {
  const stock = resolveNominalStockPreset(stockPresetId);
  return {
    stockPresetId: stock.id,
    stockFootprint: null,
    thickness: {
      basis: "nominal-preset",
      effectiveThicknessMm: stock.defaultEffectiveThicknessMm
    },
    cutWidth: {
      source: "provisional-preset",
      xMm: stock.defaultFullCutWidthMm,
      yMm: stock.defaultFullCutWidthMm
    }
  };
}

export const PUBLIC_DEFAULT_STOCK_SHEET_MM = Object.freeze({
  width: 304.8,
  height: 304.8
});

/**
 * Current public-workbench default. The older null-footprint starter remains
 * available so historical exact-hash evidence can still be replayed.
 */
export function createPublicFabricationSetup(
  stockPresetId: NominalStockPresetId = "stock-3mm-basswood-laser-plywood",
): AppliedFabricationSetup {
  const starter = createStarterFabricationSetup(stockPresetId);
  const material = nominalMaterialProfileFromStock(stockPresetId);
  return {
    ...starter,
    stockFootprint: StockFootprintSchema.parse({
      schemaVersion: "1.0",
      widthMm: PUBLIC_DEFAULT_STOCK_SHEET_MM.width,
      heightMm: PUBLIC_DEFAULT_STOCK_SHEET_MM.height,
      orientation: "machine-x-y",
      materialProfileId: material.id,
      sheetId: "default-12-inch-square-sheet",
      source: "user-reported",
      confidence: "user-reported-unreviewed",
      evidenceId: null
    })
  };
}

function thicknessInput(applied: AppliedFabricationSetup): {
  thicknessBasis: ThicknessBasis;
  effectiveThicknessMm?: number;
  thicknessSamplesMm?: readonly number[];
} {
  return applied.thickness.basis === "nominal-preset"
    ? {
        thicknessBasis: "nominal-preset",
        effectiveThicknessMm: applied.thickness.effectiveThicknessMm
      }
    : {
        thicknessBasis: "user-reported-caliper",
        thicknessSamplesMm: applied.thickness.readingsMm
      };
}

export function resolveFabricationSetup(
  setup: AppliedFabricationSetup,
): ResolvedFabricationSetup {
  const stock = resolveNominalStockPreset(setup.stockPresetId);
  const material = setup.thickness.basis === "nominal-preset"
    ? nominalMaterialProfileFromStock(stock.id)
    : measuredMaterialProfileFromStock(stock.id, setup.thickness.readingsMm);
  if (
    setup.thickness.basis === "nominal-preset" &&
    quantizeHundredthMm(setup.thickness.effectiveThicknessMm) !==
      material.measuredThicknessMm
  ) {
    throw new RangeError("Starter effective thickness must come from the registered stock preset.");
  }
  const cutXmm = quantizeHundredthMm(setup.cutWidth.xMm);
  const cutYmm = quantizeHundredthMm(setup.cutWidth.yMm);
  const evaluation = requireSupportedStockInputs(evaluateStockInputs({
    materialKind: stock.materialKind,
    ...thicknessInput(setup),
    kerfXmm: cutXmm,
    kerfYmm: cutYmm,
    kerfSource: setup.cutWidth.source,
    ...(setup.cutWidth.fixtureEvidence === undefined
      ? {}
      : { kerfFixtureEvidence: setup.cutWidth.fixtureEvidence })
  }));
  const machine = xtoolM2Profile();
  const processRecipe = provisionalProcessRecipe(material, machine, cutXmm, cutYmm, {
    source: setup.cutWidth.source,
    ...(setup.cutWidth.fixtureEvidence === undefined
      ? {}
      : { fixtureEvidence: setup.cutWidth.fixtureEvidence })
  });
  const stockFootprint = setup.stockFootprint === null
    ? null
    : StockFootprintSchema.parse({
        ...setup.stockFootprint,
        materialProfileId: material.id
      });
  const fabricationContext = defaultFabricationContext(stockFootprint);
  return {
    applied: {
      ...setup,
      stockFootprint,
      cutWidth: { ...setup.cutWidth, xMm: cutXmm, yMm: cutYmm }
    },
    material,
    machine,
    processRecipe,
    fabricationContext,
    fit: provisionalFitProfile(),
    inputPolicyEvaluation: evaluation
  };
}

export function appliedSetupThicknessInput(setup: AppliedFabricationSetup): {
  materialKind: MaterialProfile["materialKind"];
  thicknessBasis: ThicknessBasis;
  effectiveThicknessMm?: number;
  thicknessSamplesMm?: readonly number[];
} {
  const stock = resolveNominalStockPreset(setup.stockPresetId);
  return { materialKind: stock.materialKind, ...thicknessInput(setup) };
}
