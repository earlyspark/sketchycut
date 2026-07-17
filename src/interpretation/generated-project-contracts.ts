import { z } from "zod";

import {
  DesignDocumentV1Schema,
  ProjectionBundleSchema,
  Sha256Schema,
  type DesignDocumentV1,
  type ProjectionBundle
} from "../domain/contracts.js";
import {
  MotifApplicationReportSchema,
  MotifRecipeV1Schema,
  type MotifApplicationReport,
  type MotifRecipeV1
} from "../operators/procedural-surface-treatment.js";
import {
  FabricationEvidenceProjectionSchema,
  type FabricationEvidenceProjection
} from "../projections/evidence.js";

export const GeneratedDeterministicControlsSchema = z
  .object({
    dimensionsMm: z
      .object({
        width: z.number().int().min(80).max(180),
        depth: z.number().int().min(60).max(140),
        height: z.number().int().min(38).max(90)
      })
      .strict(),
    scaleSource: z.enum(["disclosed-preset", "user-specified"]),
    motifPlacement: MotifRecipeV1Schema.shape.placement
  })
  .strict();

export const GeneratedFabricationControlsSchema = z
  .object({
    stockPresetId: z.enum([
      "stock-3mm-basswood-laser-plywood",
      "stock-3mm-birch-laser-plywood"
    ]),
    thickness: z.discriminatedUnion("basis", [
      z.object({ basis: z.literal("nominal-preset") }).strict(),
      z
        .object({
          basis: z.literal("user-reported-caliper"),
          measuredMm: z.number().min(2.5).max(3.6)
        })
        .strict()
    ]),
    fullCutWidthMm: z.number().min(0.05).max(0.4),
    fitBiasMm: z.union([z.literal(-0.05), z.literal(0), z.literal(0.05)]),
    stockFootprintMm: z
      .object({
        width: z.number().min(100).max(426),
        height: z.number().min(100).max(320)
      })
      .strict()
  })
  .strict();

export type GeneratedCompiledProject = {
  document: DesignDocumentV1;
  geometryHash: string;
  bundle: ProjectionBundle;
  evidence: FabricationEvidenceProjection;
  svgs: { sheetId: string; svg: string; sha256: string }[];
  motifRecipe: MotifRecipeV1 | null;
  motifReport: MotifApplicationReport | null;
  scaleDisclosure: string | null;
};

export const GeneratedCompiledProjectSchema = z
  .object({
    document: DesignDocumentV1Schema,
    geometryHash: Sha256Schema,
    bundle: ProjectionBundleSchema,
    evidence: FabricationEvidenceProjectionSchema,
    svgs: z.array(
      z
        .object({
          sheetId: z.string().min(1),
          svg: z.string().min(1),
          sha256: Sha256Schema
        })
        .strict(),
    ),
    motifRecipe: MotifRecipeV1Schema.nullable(),
    motifReport: MotifApplicationReportSchema.nullable(),
    scaleDisclosure: z.string().min(1).max(500).nullable()
  })
  .strict();

export type GeneratedDeterministicControls = z.infer<
  typeof GeneratedDeterministicControlsSchema
>;
export type GeneratedFabricationControls = z.infer<
  typeof GeneratedFabricationControlsSchema
>;
