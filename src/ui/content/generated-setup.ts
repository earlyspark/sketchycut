import { PUBLIC_DEFAULT_STOCK_SHEET_MM } from "../../domain/fabrication-setup.js";
import { NOMINAL_STOCK_PRESETS } from "../../domain/stock-catalog.js";
import { GeneratedFabricationControlsSchema } from "../../interpretation/generated-project-contracts.js";

export { resolveGeneratedFabricationControls } from "../../interpretation/generated-fabrication.js";
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

export const GENERATED_STOCK_OPTIONS = NOMINAL_STOCK_PRESETS.map((preset) => ({
  id: preset.id,
  label: preset.selectionLabel
}));
