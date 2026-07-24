import { z } from "zod";

import { Sha256Schema } from "../domain/contracts.js";
import { hashCanonical, sha256 } from "../domain/hash.js";
import { CURRENT_CAPABILITY_CATALOG_VERSION } from "./capability-catalog.js";
import { CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION } from "./semantic-atom-registry.js";
import {
  ReferenceRoleConstraintSchema,
  SemanticModelConfigurationSchema,
  SemanticReferenceDescriptorSchema
} from "./semantic-input-contracts.js";
import {
  SourceEvidenceIndexSchema,
  buildSourceEvidenceIndex,
  type SourceEvidenceIndex
} from "./source-evidence.js";
import {
  CURRENT_UNSUPPORTED_SEMANTIC_SIGNATURE_REGISTRY_VERSION
} from "./unsupported-semantic-signatures.js";

export const CURRENT_SEMANTIC_SCHEMA_ID = "semantic-atom-inventory@5.0.0" as const;
export const CURRENT_SEMANTIC_REQUEST_VERSION = "semantic-generation-request-current" as const;
export const CURRENT_PROMPT_IDENTITY = "semantic-interpretation-current" as const;

export const SemanticGenerationRequestSchema = z.object({
  schemaVersion: z.literal("3.0"),
  semanticBrief: z.string().min(1).max(8_000),
  sourceEvidenceIndex: SourceEvidenceIndexSchema,
  references: z.array(SemanticReferenceDescriptorSchema).max(3),
  roleConstraints: z.array(ReferenceRoleConstraintSchema).max(3),
  promptIdentity: z.literal(CURRENT_PROMPT_IDENTITY),
  promptHash: Sha256Schema,
  semanticSchemaId: z.literal(CURRENT_SEMANTIC_SCHEMA_ID),
  atomTemplateVersion: z.literal(CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION),
  capabilityCatalogVersion: z.literal(CURRENT_CAPABILITY_CATALOG_VERSION),
  unsupportedSemanticSignatureRegistryVersion: z.literal(
    CURRENT_UNSUPPORTED_SEMANTIC_SIGNATURE_REGISTRY_VERSION
  ),
  modelConfiguration: SemanticModelConfigurationSchema,
  requestVersion: z.literal(CURRENT_SEMANTIC_REQUEST_VERSION)
}).strict().superRefine((request, context) => {
  const referenceIds = request.references.map((item) => item.referenceId);
  if (new Set(referenceIds).size !== referenceIds.length) {
    context.addIssue({ code: "custom", message: "Reference IDs must be unique." });
  }
  const constraintIds = request.roleConstraints.map((item) => item.referenceId);
  if (new Set(constraintIds).size !== constraintIds.length) {
    context.addIssue({ code: "custom", message: "Role constraints must be unique by reference." });
  }
  if (JSON.stringify(referenceIds) !== JSON.stringify(constraintIds)) {
    context.addIssue({
      code: "custom",
      message: "Every reference requires exactly one ordered maker-selected role constraint."
    });
  }
  for (const id of constraintIds) {
    if (!referenceIds.includes(id)) {
      context.addIssue({ code: "custom", message: `Role constraint references unknown image ${id}.` });
    }
  }
  const expectedConstraintOrder = referenceIds.filter((id) => constraintIds.includes(id));
  if (expectedConstraintOrder.some((id, index) => constraintIds[index] !== id)) {
    context.addIssue({ code: "custom", message: "Role constraints must follow normalized reference order." });
  }
  const indexedReferenceIds = request.sourceEvidenceIndex.references.map((item) => item.referenceId);
  if (indexedReferenceIds.some((id, index) => referenceIds[index] !== id) ||
      indexedReferenceIds.length !== referenceIds.length) {
    context.addIssue({ code: "custom", message: "Source evidence must match normalized reference order." });
  }
});

export type SemanticGenerationRequest = z.infer<typeof SemanticGenerationRequestSchema>;

export type PreparedSemanticGenerationRequest = {
  request: SemanticGenerationRequest;
  requestDigest: string;
  sourceEvidenceIndex: SourceEvidenceIndex;
};

export async function semanticRequestDigest(requestCandidate: unknown): Promise<string> {
  const request = SemanticGenerationRequestSchema.parse(requestCandidate);
  if (await sha256(request.semanticBrief) !== request.sourceEvidenceIndex.semanticBriefDigest) {
    throw new Error("SEMANTIC_REQUEST_SOURCE_BRIEF_DIGEST_MISMATCH");
  }
  const indexWithoutDigest = {
    schemaVersion: request.sourceEvidenceIndex.schemaVersion,
    semanticBriefDigest: request.sourceEvidenceIndex.semanticBriefDigest,
    spans: request.sourceEvidenceIndex.spans,
    references: request.sourceEvidenceIndex.references
  };
  if (await hashCanonical(indexWithoutDigest) !== request.sourceEvidenceIndex.digest) {
    throw new Error("SEMANTIC_REQUEST_SOURCE_INDEX_DIGEST_MISMATCH");
  }
  for (const [index, reference] of request.references.entries()) {
    const evidence = request.sourceEvidenceIndex.references[index];
    if (evidence?.contentDigest !== reference.sha256) {
      throw new Error("SEMANTIC_REQUEST_REFERENCE_DIGEST_MISMATCH");
    }
    const roles = request.roleConstraints.find(
      (item) => item.referenceId === reference.referenceId,
    )?.roles;
    if (roles === undefined) {
      throw new Error("SEMANTIC_REQUEST_REFERENCE_ROLE_MISSING");
    }
    if (JSON.stringify(evidence.declaredRoles) !== JSON.stringify(roles)) {
      throw new Error("SEMANTIC_REQUEST_REFERENCE_ROLE_MISMATCH");
    }
  }
  return hashCanonical(request);
}

function normalizedRoles(roles: readonly ("structure" | "surface")[]) {
  return (["structure", "surface"] as const).filter((role) => roles.includes(role));
}

export async function prepareSemanticGenerationRequest(input: {
  brief: string;
  references: readonly z.input<typeof SemanticReferenceDescriptorSchema>[];
  roleConstraints: readonly z.input<typeof ReferenceRoleConstraintSchema>[];
  promptIdentity: typeof CURRENT_PROMPT_IDENTITY;
  promptHash: string;
  modelConfiguration: z.input<typeof SemanticModelConfigurationSchema>;
}): Promise<PreparedSemanticGenerationRequest> {
  const references = input.references.map((item) => SemanticReferenceDescriptorSchema.parse(item));
  const byReferenceId = new Map(input.roleConstraints.map((item) => [item.referenceId, item]));
  const roleConstraints = references.map((reference) => {
    const constraint = byReferenceId.get(reference.referenceId);
    if (constraint === undefined) {
      throw new Error(`SEMANTIC_REFERENCE_ROLE_REQUIRED:${reference.referenceId}`);
    }
    return {
      referenceId: reference.referenceId,
      roles: normalizedRoles(constraint.roles)
    };
  });
  const source = await buildSourceEvidenceIndex({
    brief: input.brief,
    references,
    roleConstraints
  });
  const request = SemanticGenerationRequestSchema.parse({
    schemaVersion: "3.0",
    semanticBrief: source.semanticBrief,
    sourceEvidenceIndex: source.sourceEvidenceIndex,
    references,
    roleConstraints,
    promptIdentity: input.promptIdentity,
    promptHash: input.promptHash,
    semanticSchemaId: CURRENT_SEMANTIC_SCHEMA_ID,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    capabilityCatalogVersion: CURRENT_CAPABILITY_CATALOG_VERSION,
    unsupportedSemanticSignatureRegistryVersion:
      CURRENT_UNSUPPORTED_SEMANTIC_SIGNATURE_REGISTRY_VERSION,
    modelConfiguration: input.modelConfiguration,
    requestVersion: CURRENT_SEMANTIC_REQUEST_VERSION
  });
  return {
    request,
    requestDigest: await semanticRequestDigest(request),
    sourceEvidenceIndex: source.sourceEvidenceIndex
  };
}
