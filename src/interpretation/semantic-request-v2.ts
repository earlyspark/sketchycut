import { z } from "zod";

import { Sha256Schema } from "../domain/contracts.js";
import { hashCanonical, sha256 } from "../domain/hash.js";
import { CURRENT_CAPABILITY_CATALOG_VERSION } from "./capability-catalog.js";
import type {
  ExplicitSizingConstraintV1,
  SizingParserFindingV1
} from "./explicit-sizing.js";
import {
  ReferenceRoleConstraintSchema,
  SemanticModelConfigurationSchema,
  SemanticReferenceDescriptorSchema
} from "./semantic-input-contracts.js";
import {
  SourceEvidenceIndexV1Schema,
  buildSourceEvidenceIndex,
  type SourceEvidenceIndexV1
} from "./source-evidence.js";

export const CURRENT_INTENT_SCHEMA_ID = "intent-graph-v2@2.2.1" as const;
export const CURRENT_SEMANTIC_REQUEST_VERSION = "semantic-generation-request-v3" as const;
export const CURRENT_PROMPT_IDENTITY = "semantic-interpretation-current" as const;

export const SemanticGenerationRequestV2Schema = z.object({
  schemaVersion: z.literal("2.0"),
  semanticBrief: z.string().min(1).max(8_000),
  sourceEvidenceIndex: SourceEvidenceIndexV1Schema,
  references: z.array(SemanticReferenceDescriptorSchema).max(3),
  roleConstraints: z.array(ReferenceRoleConstraintSchema).max(3),
  promptIdentity: z.string().trim().min(1).max(160),
  promptHash: Sha256Schema,
  intentSchemaId: z.literal(CURRENT_INTENT_SCHEMA_ID),
  capabilityCatalogVersion: z.literal(CURRENT_CAPABILITY_CATALOG_VERSION),
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
  if (request.references.length === 0 && request.roleConstraints.length !== 0) {
    context.addIssue({ code: "custom", message: "A text-only request requires empty role constraints." });
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
  if (request.sourceEvidenceIndex.semanticBriefDigest.length !== 64) {
    context.addIssue({ code: "custom", message: "Source evidence must bind the semantic brief." });
  }
});

export type SemanticGenerationRequestV2 = z.infer<typeof SemanticGenerationRequestV2Schema>;

export type PreparedSemanticGenerationRequestV2 = {
  request: SemanticGenerationRequestV2;
  requestDigest: string;
  sourceEvidenceIndex: SourceEvidenceIndexV1;
  parsedConstraints: ExplicitSizingConstraintV1[];
  parserFindings: SizingParserFindingV1[];
};

export async function semanticRequestDigestV2(requestCandidate: unknown): Promise<string> {
  const request = SemanticGenerationRequestV2Schema.parse(requestCandidate);
  if (await sha256(request.semanticBrief) !== request.sourceEvidenceIndex.semanticBriefDigest) {
    throw new Error("SEMANTIC_REQUEST_SOURCE_BRIEF_DIGEST_MISMATCH");
  }
  const indexWithoutDigest = {
    schemaVersion: request.sourceEvidenceIndex.schemaVersion,
    semanticBriefDigest: request.sourceEvidenceIndex.semanticBriefDigest,
    spans: request.sourceEvidenceIndex.spans,
    references: request.sourceEvidenceIndex.references,
    measurementLinks: request.sourceEvidenceIndex.measurementLinks
  };
  if (await hashCanonical(indexWithoutDigest) !== request.sourceEvidenceIndex.digest) {
    throw new Error("SEMANTIC_REQUEST_SOURCE_INDEX_DIGEST_MISMATCH");
  }
  for (const [index, reference] of request.references.entries()) {
    const evidence = request.sourceEvidenceIndex.references[index];
    if (evidence?.contentDigest !== reference.sha256) {
      throw new Error("SEMANTIC_REQUEST_REFERENCE_DIGEST_MISMATCH");
    }
    const roles = request.roleConstraints.find((item) => item.referenceId === reference.referenceId)?.roles ?? [];
    if (JSON.stringify(evidence.declaredRoles) !== JSON.stringify(roles)) {
      throw new Error("SEMANTIC_REQUEST_REFERENCE_ROLE_MISMATCH");
    }
  }
  return hashCanonical(request);
}

function normalizedRoles(roles: readonly ("structure" | "motif")[]) {
  return (["structure", "motif"] as const).filter((role) => roles.includes(role));
}

export async function prepareSemanticGenerationRequestV2(input: {
  brief: string;
  references: readonly z.input<typeof SemanticReferenceDescriptorSchema>[];
  roleConstraints: readonly z.input<typeof ReferenceRoleConstraintSchema>[];
  promptIdentity: string;
  promptHash: string;
  modelConfiguration: z.input<typeof SemanticModelConfigurationSchema>;
}): Promise<PreparedSemanticGenerationRequestV2> {
  const references = input.references.map((item) => SemanticReferenceDescriptorSchema.parse(item));
  const byReferenceId = new Map(input.roleConstraints.map((item) => [item.referenceId, item]));
  const roleConstraints = references.flatMap((reference) => {
    const constraint = byReferenceId.get(reference.referenceId);
    return constraint === undefined ? [] : [{
      referenceId: reference.referenceId,
      roles: normalizedRoles(constraint.roles)
    }];
  });
  const source = await buildSourceEvidenceIndex({
    brief: input.brief,
    references,
    roleConstraints
  });
  const request = SemanticGenerationRequestV2Schema.parse({
    schemaVersion: "2.0",
    semanticBrief: source.semanticBrief,
    sourceEvidenceIndex: source.sourceEvidenceIndex,
    references,
    roleConstraints,
    promptIdentity: input.promptIdentity,
    promptHash: input.promptHash,
    intentSchemaId: CURRENT_INTENT_SCHEMA_ID,
    capabilityCatalogVersion: CURRENT_CAPABILITY_CATALOG_VERSION,
    modelConfiguration: input.modelConfiguration,
    requestVersion: CURRENT_SEMANTIC_REQUEST_VERSION
  });
  return {
    request,
    requestDigest: await semanticRequestDigestV2(request),
    sourceEvidenceIndex: source.sourceEvidenceIndex,
    parsedConstraints: source.parsedConstraints,
    parserFindings: source.parserFindings
  };
}
