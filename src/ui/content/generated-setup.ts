import {
  FitProfileSchema,
  StockFootprintSchema,
  type FitProfile
} from "../../domain/contracts.js";
import {
  PUBLIC_DEFAULT_STOCK_SHEET_MM,
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../domain/fabrication-setup.js";
import { quantizeHundredthMm } from "../../domain/input-policy.js";
import { NOMINAL_STOCK_PRESETS } from "../../domain/stock-catalog.js";
import { GeneratedFabricationControlsSchema } from "../../interpretation/generated-project-contracts.js";

export { GeneratedFabricationControlsSchema } from "../../interpretation/generated-project-contracts.js";
export type { GeneratedFabricationControls } from "../../interpretation/generated-project-contracts.js";

export const DEFAULT_GENERATED_FABRICATION_CONTROLS =
  GeneratedFabricationControlsSchema.parse({
    stockPresetId: "stock-3mm-basswood-laser-plywood",
    thickness: { basis: "nominal-preset" },
    fullCutWidthMm: 0.15,
    fitBiasMm: 0,
    stockFootprintMm: {
      width: PUBLIC_DEFAULT_STOCK_SHEET_MM.width,
      height: PUBLIC_DEFAULT_STOCK_SHEET_MM.height
    }
  });

function biasedFitProfile(base: FitProfile, biasMm: -0.05 | 0 | 0.05): FitProfile {
  if (biasMm === 0) return base;
  const adjust = (value: number): number => quantizeHundredthMm(value + biasMm);
  const biasId = biasMm < 0 ? "minus-005" : "plus-005";
  return FitProfileSchema.parse({
    ...base,
    id: `${base.id}-${biasId}`,
    name: `${base.name} (${biasMm > 0 ? "+" : ""}${biasMm.toFixed(2)} mm deterministic fit bias)`,
    press: { ...base.press, totalDeltaMm: adjust(base.press.totalDeltaMm) },
    snug: { ...base.snug, totalDeltaMm: adjust(base.snug.totalDeltaMm) },
    sliding: { ...base.sliding, totalDeltaMm: adjust(base.sliding.totalDeltaMm) },
    rotating: { ...base.rotating, totalDeltaMm: adjust(base.rotating.totalDeltaMm) },
    rod: { ...base.rod, totalDeltaMm: adjust(base.rod.totalDeltaMm) }
  });
}

export function resolveGeneratedFabricationControls(candidate: unknown) {
  const controls = GeneratedFabricationControlsSchema.parse(candidate);
  const base = createPublicFabricationSetup(controls.stockPresetId);
  const setup = {
    ...base,
    stockFootprint: StockFootprintSchema.parse({
      ...base.stockFootprint,
      widthMm: quantizeHundredthMm(controls.stockFootprintMm.width),
      heightMm: quantizeHundredthMm(controls.stockFootprintMm.height),
      sheetId: "generated-user-stock-sheet"
    }),
    thickness: controls.thickness.basis === "nominal-preset"
      ? base.thickness
      : {
          basis: "user-reported-caliper" as const,
          readingsMm: [quantizeHundredthMm(controls.thickness.measuredMm)] as const
        },
    cutWidth: {
      source: controls.fullCutWidthMm === 0.15
        ? "provisional-preset" as const
        : "user-reported-manual" as const,
      xMm: quantizeHundredthMm(controls.fullCutWidthMm),
      yMm: quantizeHundredthMm(controls.fullCutWidthMm)
    }
  };
  const resolved = resolveFabricationSetup(setup);
  return {
    controls,
    profiles: {
      material: resolved.material,
      machine: resolved.machine,
      processRecipe: resolved.processRecipe,
      fabricationContext: resolved.fabricationContext,
      fit: biasedFitProfile(resolved.fit, controls.fitBiasMm)
    },
    inputPolicyEvaluation: resolved.inputPolicyEvaluation,
    pin: createStarterPinSetup()
  };
}

export const GENERATED_STOCK_OPTIONS = NOMINAL_STOCK_PRESETS.map((preset) => ({
  id: preset.id,
  label: preset.selectionLabel
}));
