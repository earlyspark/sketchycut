import { z } from "zod";

import { canonicalDocumentHash } from "../compiler/canonical.js";
import type { DesignDocumentV1 } from "../domain/contracts.js";

export const FabricationEvidenceProjectionSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    sourceDocumentHash: z.string().regex(/^[0-9a-f]{64}$/),
    outcome: z.literal("fabrication-candidate"),
    claim: z.string().min(1),
    stockPresetId: z.string().nullable(),
    thickness: z
      .object({
        basis: z.enum([
          "nominal-preset",
          "user-reported-caliper",
          "coupon-selected",
          "reviewed-measurement"
        ]),
        effectiveThicknessMm: z.number().positive(),
        readingCount: z.number().int().nonnegative()
      })
      .strict(),
    cutWidth: z
      .object({
        source: z.enum([
          "provisional-preset",
          "user-reported-manual",
          "fixture-derived",
          "coupon-selected",
          "reviewed-measurement"
        ]),
        xMm: z.number().positive(),
        yMm: z.number().positive()
      })
      .strict(),
    pinDiameterBasis: z.enum(["nominal-preset", "user-reported-caliper"]).nullable(),
    inputFindingCodes: z.array(z.string()),
    deterministicValidation: z.literal("pass"),
    calibrationRequired: z.boolean(),
    physicalVerification: z.literal("required"),
    runtimeApplicationApiCalls: z.literal(0)
  })
  .strict();

export type FabricationEvidenceProjection = z.infer<
  typeof FabricationEvidenceProjectionSchema
>;

export async function buildFabricationEvidenceProjection(
  document: DesignDocumentV1,
): Promise<FabricationEvidenceProjection> {
  const policy = document.provenance.inputPolicyEvaluation;
  if (policy === undefined) {
    throw new Error("Fabrication evidence projection requires input-policy provenance.");
  }
  if (document.validation.status !== "pass") {
    throw new Error("Fabrication candidate evidence cannot project from failed validation.");
  }
  const pin = document.externalStock?.find((item) => item.id === "measured-hinge-pin");
  const usesStarterEstimate =
    policy.thickness.basis === "nominal-preset" ||
    policy.kerf.source === "provisional-preset" ||
    pin?.stockProfile.diameterBasis === "nominal-preset";
  return FabricationEvidenceProjectionSchema.parse({
    schemaVersion: "1.0",
    sourceDocumentHash: await canonicalDocumentHash(document),
    outcome: "fabrication-candidate",
    claim: usesStarterEstimate
      ? "Fabrication candidate generated from starter estimates; input measurement and physical verification are still required."
      : "Fabrication candidate generated from user-reported setup values; physical verification is still required.",
    stockPresetId: document.resolvedInputs.material.nominalStock?.presetId ?? null,
    thickness: {
      basis: policy.thickness.basis,
      effectiveThicknessMm: policy.thickness.effectiveThicknessMm,
      readingCount: policy.thickness.measurement?.samplesMm.length ?? 0
    },
    cutWidth: {
      source: policy.kerf.source,
      xMm: policy.kerf.xMm,
      yMm: policy.kerf.yMm
    },
    pinDiameterBasis: pin?.stockProfile.diameterBasis ?? null,
    inputFindingCodes: policy.findings.map((finding) => finding.code),
    deterministicValidation: "pass",
    calibrationRequired: document.validation.findings.some(
      (finding) => finding.code === "CALIBRATION_REQUIRED",
    ),
    physicalVerification: "required",
    runtimeApplicationApiCalls: document.provenance.runtimeApplicationApiCalls
  });
}
