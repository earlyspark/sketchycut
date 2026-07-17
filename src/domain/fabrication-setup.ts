import type {
  CutWidthFixtureEvidence,
  CutWidthSource,
  InputPolicyEvaluation,
  MachineProfile,
  MaterialProfile,
  ThicknessBasis
} from "./contracts.js";
import {
  evaluateStockInputs,
  quantizeHundredthMm,
  requireSupportedStockInputs
} from "./input-policy.js";
import { provisionalFitProfile, xtoolM2Profile } from "./profiles.js";
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

export type AppliedFabricationSetup = {
  stockPresetId: NominalStockPresetId;
  thickness: AppliedThicknessSetup;
  cutWidth: AppliedCutWidthSetup;
  pin: AppliedPinSetup;
};

export type ResolvedFabricationSetup = {
  applied: AppliedFabricationSetup;
  material: MaterialProfile;
  machine: MachineProfile;
  fit: ReturnType<typeof provisionalFitProfile>;
  inputPolicyEvaluation: InputPolicyEvaluation;
};

export function createStarterFabricationSetup(
  stockPresetId: NominalStockPresetId = "stock-3mm-basswood-laser-plywood",
): AppliedFabricationSetup {
  const stock = resolveNominalStockPreset(stockPresetId);
  return {
    stockPresetId: stock.id,
    thickness: {
      basis: "nominal-preset",
      effectiveThicknessMm: stock.defaultEffectiveThicknessMm
    },
    cutWidth: {
      source: "provisional-preset",
      xMm: stock.defaultFullCutWidthMm,
      yMm: stock.defaultFullCutWidthMm
    },
    pin: {
      basis: "nominal-preset",
      effectiveDiameterMm: 3
    }
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
  const pinDiameterMm = quantizeHundredthMm(setup.pin.effectiveDiameterMm);
  if (pinDiameterMm <= 0) {
    throw new RangeError("Pin diameter must be a positive caliper value or registered starter estimate.");
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
  const machine = xtoolM2Profile(cutXmm, cutYmm, {
    source: setup.cutWidth.source,
    ...(setup.cutWidth.fixtureEvidence === undefined
      ? {}
      : { fixtureEvidence: setup.cutWidth.fixtureEvidence })
  });
  return {
    applied: {
      ...setup,
      cutWidth: { ...setup.cutWidth, xMm: cutXmm, yMm: cutYmm },
      pin: { ...setup.pin, effectiveDiameterMm: pinDiameterMm }
    },
    material,
    machine,
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
