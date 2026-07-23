import { z } from "zod";

import { Sha256Schema } from "../domain/digests.js";
import { StableIdSchema } from "../domain/primitives.js";
import { hashCanonical, sha256 } from "../domain/hash.js";
import { normalizeBrief, SemanticReferenceDescriptorSchema } from "./semantic-input-contracts.js";

const EvidenceSpanSchema = z.object({
  evidenceId: StableIdSchema,
  kind: z.literal("brief-span"),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  semanticDigest: Sha256Schema
}).strict().superRefine((span, context) => {
  if (span.end <= span.start) {
    context.addIssue({ code: "custom", path: ["end"], message: "Evidence spans must be non-empty." });
  }
});

const EvidenceReferenceSchema = z.object({
  evidenceId: StableIdSchema,
  kind: z.literal("reference"),
  referenceId: StableIdSchema,
  referenceIndex: z.number().int().nonnegative().max(2),
  contentDigest: Sha256Schema,
  declaredRoles: z.array(z.enum(["structure", "surface"])).min(1).max(2)
}).strict();

export const SourceEvidenceIndexSchema = z.object({
  schemaVersion: z.literal("3.0"),
  semanticBriefDigest: Sha256Schema,
  spans: z.array(EvidenceSpanSchema).min(1),
  references: z.array(EvidenceReferenceSchema).max(3),
  digest: Sha256Schema
}).strict().superRefine((value, context) => {
  const ids = [...value.spans.map((item) => item.evidenceId), ...value.references.map((item) => item.evidenceId)];
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Source evidence IDs must be unique." });
  }
  for (const [index, span] of value.spans.entries()) {
    if (index > 0 && span.start < value.spans[index - 1]!.end) {
      context.addIssue({ code: "custom", message: "Brief evidence spans must be ordered and non-overlapping." });
    }
  }
});

export type SourceEvidenceIndex = z.infer<typeof SourceEvidenceIndexSchema>;

function spanRanges(brief: string): { start: number; end: number }[] {
  return [{ start: 0, end: brief.length }];
}

function normalizedRoles(roles: readonly ("structure" | "surface")[]) {
  return (["structure", "surface"] as const).filter((role) => roles.includes(role));
}

export async function buildSourceEvidenceIndex(input: {
  brief: string;
  references: readonly z.input<typeof SemanticReferenceDescriptorSchema>[];
  roleConstraints: readonly { referenceId: string; roles: readonly ("structure" | "surface")[] }[];
}): Promise<{
  semanticBrief: string;
  sourceEvidenceIndex: SourceEvidenceIndex;
}> {
  const semanticBrief = normalizeBrief(input.brief);
  const spans = await Promise.all(spanRanges(semanticBrief).map(async (span, index) => {
    const semanticDigest = await sha256(semanticBrief.slice(span.start, span.end));
    return EvidenceSpanSchema.parse({
      evidenceId: `brief-${String(index + 1)}-${semanticDigest.slice(0, 16)}`,
      kind: "brief-span",
      start: span.start,
      end: span.end,
      semanticDigest
    });
  }));
  const references = input.references.map((candidate, index) => {
    const reference = SemanticReferenceDescriptorSchema.parse(candidate);
    const roles = input.roleConstraints.find(
      (item) => item.referenceId === reference.referenceId,
    )?.roles;
    if (roles === undefined) {
      throw new Error(`SEMANTIC_REFERENCE_ROLE_REQUIRED:${reference.referenceId}`);
    }
    return EvidenceReferenceSchema.parse({
      evidenceId: `reference-${String(index + 1)}-${reference.sha256.slice(0, 16)}`,
      kind: "reference",
      referenceId: reference.referenceId,
      referenceIndex: index,
      contentDigest: reference.sha256,
      declaredRoles: normalizedRoles(roles)
    });
  });
  const semanticBriefDigest = await sha256(semanticBrief);
  const indexWithoutDigest = {
    schemaVersion: "3.0" as const,
    semanticBriefDigest,
    spans,
    references
  };
  return {
    semanticBrief,
    sourceEvidenceIndex: SourceEvidenceIndexSchema.parse({
      ...indexWithoutDigest,
      digest: await hashCanonical(indexWithoutDigest)
    })
  };
}

export function authorizedEvidenceIds(index: SourceEvidenceIndex): Set<string> {
  const parsed = SourceEvidenceIndexSchema.parse(index);
  return new Set([
    ...parsed.spans.map((item) => item.evidenceId),
    ...parsed.references.map((item) => item.evidenceId)
  ]);
}
