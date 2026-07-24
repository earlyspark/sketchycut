import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";

export const CURRENT_UNSUPPORTED_SEMANTIC_SIGNATURE_REGISTRY_VERSION =
  "1.0.0" as const;

export const UnsupportedSemanticSignatureIdSchema = z.enum([
  "kerf-flexure-corner-construction"
]);

export type UnsupportedSemanticSignatureId = z.infer<
  typeof UnsupportedSemanticSignatureIdSchema
>;

const UnsupportedSemanticSignatureDefinitionSchema = z.object({
  signatureId: UnsupportedSemanticSignatureIdSchema,
  requiredAccountingReason: z.literal("CAPABILITY_NOT_REGISTERED"),
  requiredAspect: z.literal("structure"),
  semanticClass: z.literal("primary-enclosure-corner-construction"),
  excludedMeaningClasses: z.array(z.enum([
    "surface-treatment",
    "decorative-motif",
    "payload-context",
    "reference-context"
  ])).min(4).max(4)
}).strict();

export const UnsupportedSemanticSignatureRegistrySchema = z.object({
  registryId: z.literal("sketchycut-unsupported-semantic-signatures"),
  version: z.literal(CURRENT_UNSUPPORTED_SEMANTIC_SIGNATURE_REGISTRY_VERSION),
  signatures: z.array(UnsupportedSemanticSignatureDefinitionSchema).length(1)
}).strict();

export const UNSUPPORTED_SEMANTIC_SIGNATURE_REGISTRY =
  UnsupportedSemanticSignatureRegistrySchema.parse({
    registryId: "sketchycut-unsupported-semantic-signatures",
    version: CURRENT_UNSUPPORTED_SEMANTIC_SIGNATURE_REGISTRY_VERSION,
    signatures: [{
      signatureId: "kerf-flexure-corner-construction",
      requiredAccountingReason: "CAPABILITY_NOT_REGISTERED",
      requiredAspect: "structure",
      semanticClass: "primary-enclosure-corner-construction",
      excludedMeaningClasses: [
        "surface-treatment",
        "decorative-motif",
        "payload-context",
        "reference-context"
      ]
    }]
  });

export async function unsupportedSemanticSignatureRegistryHash(): Promise<string> {
  return hashCanonical(UNSUPPORTED_SEMANTIC_SIGNATURE_REGISTRY);
}
