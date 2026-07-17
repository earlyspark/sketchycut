import { z } from "zod";

import {
  MaterialProfileSchema,
  type MaterialProfile
} from "./contracts.js";
import {
  NOMINAL_3MM_LASER_PLYWOOD_POLICY,
  summarizeThicknessSamples
} from "./input-policy.js";

const NominalStockPresetSchema = z
  .object({
    id: z.enum([
      "stock-3mm-basswood-laser-plywood",
      "stock-3mm-birch-laser-plywood"
    ]),
    version: z.literal("1.0.0"),
    materialKind: z.enum(["basswood-plywood", "birch-plywood"]),
    supplierLabel: z.string().min(1),
    nominalThicknessMm: z.literal(3),
    inputPolicyId: z.literal("nominal-three-millimetre-laser-plywood"),
    inputPolicyVersion: z.literal("1.1.0"),
    defaultEffectiveThicknessMm: z.literal(3),
    defaultFullCutWidthMm: z.literal(0.15),
    confidence: z.literal("provisional-preset"),
    physicalState: z.literal("provisional-preset"),
    selectionLabel: z.string().min(1),
    limitation: z.string().min(1),
    recommendation: z.enum(["recommended", "secondary-provisional"])
  })
  .strict();

export type NominalStockPreset = z.infer<typeof NominalStockPresetSchema>;
export type NominalStockPresetId = NominalStockPreset["id"];

function preset(
  value: Omit<NominalStockPreset, "inputPolicyId" | "inputPolicyVersion">,
): NominalStockPreset {
  return NominalStockPresetSchema.parse({
    ...value,
    inputPolicyId: NOMINAL_3MM_LASER_PLYWOOD_POLICY.id,
    inputPolicyVersion: NOMINAL_3MM_LASER_PLYWOOD_POLICY.version
  });
}

export const NOMINAL_STOCK_PRESETS: readonly NominalStockPreset[] = Object.freeze([
  preset({
    id: "stock-3mm-basswood-laser-plywood",
    version: "1.0.0",
    materialKind: "basswood-plywood",
    supplierLabel: "3 mm laser-grade basswood plywood",
    nominalThicknessMm: 3,
    defaultEffectiveThicknessMm: 3,
    defaultFullCutWidthMm: 0.15,
    confidence: "provisional-preset",
    physicalState: "provisional-preset",
    selectionLabel: "3 mm laser-grade basswood plywood — Recommended",
    limitation: "Starter dimensions and cut width are provisional until this sheet and process are measured.",
    recommendation: "recommended"
  }),
  preset({
    id: "stock-3mm-birch-laser-plywood",
    version: "1.0.0",
    materialKind: "birch-plywood",
    supplierLabel: "3 mm laser-grade birch plywood",
    nominalThicknessMm: 3,
    defaultEffectiveThicknessMm: 3,
    defaultFullCutWidthMm: 0.15,
    confidence: "provisional-preset",
    physicalState: "provisional-preset",
    selectionLabel: "3 mm laser-grade birch plywood — Secondary / provisional",
    limitation: "Birch is a secondary provisional stock; measure the selected sheet before relying on fit.",
    recommendation: "secondary-provisional"
  })
]);

export function resolveNominalStockPreset(id: string): NominalStockPreset {
  const value = NOMINAL_STOCK_PRESETS.find((candidate) => candidate.id === id);
  if (value === undefined) {
    throw new RangeError(`Unknown registered nominal stock preset ${id}.`);
  }
  return value;
}

function materialProfileId(presetValue: NominalStockPreset, thicknessMm: number): string {
  const prefix = presetValue.materialKind === "basswood-plywood" ? "basswood" : "birch";
  return `${prefix}-${String(Math.round(thicknessMm * 1_000))}`;
}

function materialName(presetValue: NominalStockPreset, thicknessMm: number): string {
  const wood = presetValue.materialKind === "basswood-plywood" ? "basswood" : "birch";
  return `${thicknessMm.toFixed(2)} mm ${wood} plywood`;
}

export function nominalMaterialProfileFromStock(
  stockPresetId: NominalStockPresetId,
): MaterialProfile {
  const stock = resolveNominalStockPreset(stockPresetId);
  return MaterialProfileSchema.parse({
    schemaVersion: "1.0",
    id: materialProfileId(stock, stock.defaultEffectiveThicknessMm),
    name: materialName(stock, stock.defaultEffectiveThicknessMm),
    materialKind: stock.materialKind,
    nominalThicknessMm: stock.nominalThicknessMm,
    measuredThicknessMm: stock.defaultEffectiveThicknessMm,
    thicknessBasis: "nominal-preset",
    nominalStock: {
      presetId: stock.id,
      presetVersion: stock.version,
      policyId: stock.inputPolicyId,
      policyVersion: stock.inputPolicyVersion
    },
    batchId: null,
    grainAxis: "x",
    physicalState: stock.physicalState
  });
}

export function measuredMaterialProfileFromStock(
  stockPresetId: NominalStockPresetId,
  readingsMm: readonly number[],
): MaterialProfile {
  if (readingsMm.length !== 1 && readingsMm.length !== 3) {
    throw new RangeError("Public stock measurement requires exactly one or three readings.");
  }
  const stock = resolveNominalStockPreset(stockPresetId);
  const measurement = summarizeThicknessSamples(readingsMm);
  return MaterialProfileSchema.parse({
    schemaVersion: "1.0",
    id: materialProfileId(stock, measurement.representativeThicknessMm),
    name: materialName(stock, measurement.representativeThicknessMm),
    materialKind: stock.materialKind,
    nominalThicknessMm: stock.nominalThicknessMm,
    measuredThicknessMm: measurement.representativeThicknessMm,
    thicknessBasis: "user-reported-caliper",
    nominalStock: {
      presetId: stock.id,
      presetVersion: stock.version,
      policyId: stock.inputPolicyId,
      policyVersion: stock.inputPolicyVersion
    },
    batchId: null,
    grainAxis: "x",
    physicalState: "provisional-preset",
    thicknessMeasurement: measurement
  });
}
