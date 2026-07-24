import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";
import { StableIdSchema } from "../domain/primitives.js";
import {
  semanticAtomCandidateSchemaForEvidenceId
} from "../interpretation/semantic-atom-registry.js";
import {
  authorizeSemanticInterpretation,
  SemanticInterpretationCandidateSchema,
  semanticInterpretationCandidateSchema,
  type SemanticInterpretationCandidate
} from "../interpretation/semantic-model-contract.js";
import {
  SourceEvidenceIndexSchema,
  authorizedEvidenceIds,
  type SourceEvidenceIndex
} from "../interpretation/source-evidence.js";
import {
  UnsupportedSemanticSignatureIdSchema
} from "../interpretation/unsupported-semantic-signatures.js";

export const CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION = "1.0.0" as const;
export const CURRENT_BOUNDED_SEMANTIC_REVIEW_PROMPT_IDENTITY =
  "bounded-semantic-review-current" as const;

export const SEMANTIC_REVIEW_TRIGGER_CODES = [
  "ESSENTIAL_UNBOUND",
  "ESSENTIAL_UNCERTAIN",
  "INVENTORY_PROJECTION_COVERAGE_MISMATCH",
  "REFERENCE_ROLE_ACCOUNTING_MISMATCH",
  "CONFLICT_PRECEDENCE_UNVERIFIED",
  "EVIDENCE_BINDING_INCOMPLETE"
] as const;

export const SemanticReviewTriggerCodeSchema = z.enum(
  SEMANTIC_REVIEW_TRIGGER_CODES,
);
export type SemanticReviewTriggerCode = z.infer<
  typeof SemanticReviewTriggerCodeSchema
>;

const AuthorizationFindingSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/u),
  path: z.string().max(500)
}).strict();

export const SemanticReviewTriggerDecisionSchema = z.object({
  schemaVersion: z.literal(CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION),
  eligible: z.boolean(),
  triggerCodes: z.array(SemanticReviewTriggerCodeSchema),
  affectedItemIds: z.array(StableIdSchema),
  authorizationFindingCodes: z.array(
    z.string().regex(/^[A-Z][A-Z0-9_]+$/u),
  )
}).strict().superRefine((decision, context) => {
  const exactUniqueOrder = <T extends string>(
    actual: readonly T[],
    order: readonly T[],
  ): boolean => {
    const expected = order.filter((value) => actual.includes(value));
    return new Set(actual).size === actual.length &&
      JSON.stringify(actual) === JSON.stringify(expected);
  };
  if (!exactUniqueOrder(
    decision.triggerCodes,
    SEMANTIC_REVIEW_TRIGGER_CODES,
  )) {
    context.addIssue({
      code: "custom",
      message: "Semantic review triggers must be unique and registry ordered."
    });
  }
  if (decision.eligible !== (decision.triggerCodes.length > 0)) {
    context.addIssue({
      code: "custom",
      message: "Semantic review eligibility must derive from registered triggers."
    });
  }
  if (
    new Set(decision.affectedItemIds).size !==
      decision.affectedItemIds.length ||
    JSON.stringify(decision.affectedItemIds) !==
      JSON.stringify([...decision.affectedItemIds].toSorted())
  ) {
    context.addIssue({
      code: "custom",
      message: "Affected semantic item IDs must be unique and sorted."
    });
  }
});

export type SemanticReviewTriggerDecision = z.infer<
  typeof SemanticReviewTriggerDecisionSchema
>;

function itemId(index: number): string {
  return StableIdSchema.parse(`inventory-item-${String(index + 1)}`);
}

export function classifySemanticReviewTriggers(input: {
  candidate: unknown;
  authorizationFindings?: readonly z.input<
    typeof AuthorizationFindingSchema
  >[];
}): SemanticReviewTriggerDecision {
  const candidate = SemanticInterpretationCandidateSchema.parse(
    input.candidate,
  );
  const findings = (input.authorizationFindings ?? []).map((finding) =>
    AuthorizationFindingSchema.parse(finding)
  );
  const triggerSet = new Set<SemanticReviewTriggerCode>();
  const affectedItemIds = new Set<string>();
  for (const [index, item] of candidate.items.entries()) {
    if (
      (item.state !== "unbound" && item.state !== "uncertain") ||
      item.importance !== "essential" ||
      item.reason === "CAPABILITY_NOT_REGISTERED"
    ) {
      continue;
    }
    triggerSet.add(
      item.state === "unbound"
        ? "ESSENTIAL_UNBOUND"
        : "ESSENTIAL_UNCERTAIN",
    );
    affectedItemIds.add(itemId(index));
    if (item.reason === "PROJECTION_COVERAGE_MISMATCH") {
      triggerSet.add("INVENTORY_PROJECTION_COVERAGE_MISMATCH");
    }
    if (item.reason === "EVIDENCE_CONFLICT") {
      triggerSet.add("CONFLICT_PRECEDENCE_UNVERIFIED");
    }
  }
  for (const finding of findings) {
    const ordinalMatch = /items\.(\d+)/u.exec(finding.path);
    if (ordinalMatch !== null) {
      affectedItemIds.add(itemId(Number.parseInt(ordinalMatch[1]!, 10)));
    }
    if (finding.code === "REFERENCE_ROLE_ACCOUNTING_MISMATCH") {
      triggerSet.add("REFERENCE_ROLE_ACCOUNTING_MISMATCH");
    }
    if (finding.code === "CONFLICT_PRECEDENCE_UNVERIFIED") {
      triggerSet.add("CONFLICT_PRECEDENCE_UNVERIFIED");
    }
    if ([
      "SEMANTIC_ATOM_EVIDENCE_ASPECT_MISSING",
      "SEMANTIC_ATOM_EVIDENCE_BINDING_UNAUTHORIZED",
      "UNKNOWN_EVIDENCE_ID"
    ].includes(finding.code)) {
      triggerSet.add("EVIDENCE_BINDING_INCOMPLETE");
    }
  }
  const triggerCodes = SEMANTIC_REVIEW_TRIGGER_CODES.filter((code) =>
    triggerSet.has(code)
  );
  return SemanticReviewTriggerDecisionSchema.parse({
    schemaVersion: CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION,
    eligible: triggerCodes.length > 0,
    triggerCodes,
    affectedItemIds: [...affectedItemIds].sort(),
    authorizationFindingCodes: [
      ...new Set(findings.map((finding) => finding.code))
    ].sort()
  });
}

function reviewPatchSchema(input: {
  itemIdSchema: z.ZodType<string>;
  evidenceIdSchema: z.ZodType<string>;
  maximumTargetOrdinal: number;
}) {
  const evidenceBindingSchema = z.object({
    evidenceId: input.evidenceIdSchema,
    aspect: z.enum(["structure", "surface", "operation", "context"]),
    support: z.enum(["direct", "inferred"])
  }).strict();
  const relationshipSchema = z.object({
    kind: z.enum(["supports", "contradicts", "depends-on", "refines"]),
    targetItemOrdinal: z.number().int().min(1).max(
      input.maximumTargetOrdinal,
    )
  }).strict();
  const atomSchema = semanticAtomCandidateSchemaForEvidenceId(
    input.evidenceIdSchema,
  );
  const resolutionSchema = z.discriminatedUnion("state", [
    z.object({
      state: z.literal("bound"),
      atoms: z.array(atomSchema).min(1).max(12)
    }).strict(),
    z.object({
      state: z.literal("deferred")
    }).strict(),
    z.object({
      state: z.literal("unbound"),
      reason: z.enum([
        "CAPABILITY_NOT_REGISTERED",
        "EVIDENCE_INSUFFICIENT",
        "EVIDENCE_CONFLICT",
        "PROJECTION_COVERAGE_MISMATCH"
      ]),
      unsupportedSignatureIds: z.array(
        UnsupportedSemanticSignatureIdSchema,
      ).max(1)
    }).strict(),
    z.object({
      state: z.literal("uncertain"),
      reason: z.enum([
        "CAPABILITY_NOT_REGISTERED",
        "EVIDENCE_INSUFFICIENT",
        "EVIDENCE_CONFLICT",
        "PROJECTION_COVERAGE_MISMATCH"
      ]),
      rationale: z.string().min(1).max(320),
      unsupportedSignatureIds: z.array(
        UnsupportedSemanticSignatureIdSchema,
      ).max(1)
    }).strict()
  ]);
  const common = {
    itemId: input.itemIdSchema,
    expectedItemDigest: z.string().regex(/^[a-f0-9]{64}$/u)
  };
  const operationSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("replace-item-resolution"),
      ...common,
      resolution: resolutionSchema
    }).strict(),
    z.object({
      kind: z.literal("replace-item-evidence-bindings"),
      ...common,
      evidenceBindings: z.array(evidenceBindingSchema).min(1).max(8)
    }).strict(),
    z.object({
      kind: z.literal("replace-item-relationships"),
      ...common,
      relationships: z.array(relationshipSchema).max(12)
    }).strict()
  ]);
  return z.object({
    schemaVersion: z.literal(CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION),
    promptIdentity: z.literal(
      CURRENT_BOUNDED_SEMANTIC_REVIEW_PROMPT_IDENTITY,
    ),
    callACandidateDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    triggerCodes: z.array(SemanticReviewTriggerCodeSchema).min(1),
    operations: z.array(operationSchema).min(1).max(4)
  }).strict().superRefine((patch, context) => {
    const operationTargets = patch.operations.map((operation) =>
      `${operation.kind}:${operation.itemId}`
    );
    if (new Set(operationTargets).size !== operationTargets.length) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message: "A semantic review patch may replace each item field once."
      });
    }
    const expectedTriggerCodes = SEMANTIC_REVIEW_TRIGGER_CODES.filter((code) =>
      patch.triggerCodes.includes(code)
    );
    if (
      JSON.stringify(patch.triggerCodes) !==
        JSON.stringify(expectedTriggerCodes)
    ) {
      context.addIssue({
        code: "custom",
        path: ["triggerCodes"],
        message: "Review patch triggers must be unique and registry ordered."
      });
    }
  });
}

export function semanticReviewPatchSchema(input: {
  candidate: SemanticInterpretationCandidate;
  sourceEvidenceIndex: SourceEvidenceIndex;
}) {
  const candidate = SemanticInterpretationCandidateSchema.parse(
    input.candidate,
  );
  const source = SourceEvidenceIndexSchema.parse(input.sourceEvidenceIndex);
  const itemIds = candidate.items.map((_, index) => itemId(index));
  const evidenceIds = [...authorizedEvidenceIds(source)].sort();
  const contextItemIds = new Set(candidate.items.flatMap((item, index) =>
    item.state === "context" ? [itemId(index)] : []
  ));
  return reviewPatchSchema({
    itemIdSchema: z.enum(itemIds as [string, ...string[]]),
    evidenceIdSchema: z.enum(evidenceIds as [string, ...string[]]),
    maximumTargetOrdinal: candidate.items.length
  }).superRefine((patch, context) => {
    for (const [index, operation] of patch.operations.entries()) {
      if (
        operation.kind === "replace-item-resolution" &&
        contextItemIds.has(operation.itemId)
      ) {
        context.addIssue({
          code: "custom",
          path: ["operations", index, "itemId"],
          message: "Semantic review cannot promote a context item into authority."
        });
      }
    }
  });
}

export type SemanticReviewPatch = z.infer<
  ReturnType<typeof semanticReviewPatchSchema>
>;

export const SemanticReviewPatchApplicationResultSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("applied"),
      patchDigest: z.string().regex(/^[a-f0-9]{64}$/u),
      candidateDigestBefore: z.string().regex(/^[a-f0-9]{64}$/u),
      candidateDigestAfter: z.string().regex(/^[a-f0-9]{64}$/u),
      changedItemIds: z.array(StableIdSchema),
      candidate: SemanticInterpretationCandidateSchema
    }).strict(),
    z.object({
      kind: z.literal("rejected"),
      code: z.enum([
        "PATCH_SCHEMA_INVALID",
        "CALL_A_CANDIDATE_DIGEST_MISMATCH",
        "TRIGGER_IDENTITY_MISMATCH",
        "ITEM_PRECONDITION_DIGEST_MISMATCH",
        "PATCHED_CANDIDATE_INVALID",
        "PATCHED_CANDIDATE_UNAUTHORIZED"
      ])
    }).strict()
  ],
);

export type SemanticReviewPatchApplicationResult = z.infer<
  typeof SemanticReviewPatchApplicationResultSchema
>;

export async function applySemanticReviewPatch(input: {
  candidate: unknown;
  sourceEvidenceIndex: SourceEvidenceIndex;
  triggerDecision: SemanticReviewTriggerDecision;
  patch: unknown;
}): Promise<SemanticReviewPatchApplicationResult> {
  const candidate = SemanticInterpretationCandidateSchema.parse(
    input.candidate,
  );
  const sourceEvidenceIndex = SourceEvidenceIndexSchema.parse(
    input.sourceEvidenceIndex,
  );
  const triggerDecision = SemanticReviewTriggerDecisionSchema.parse(
    input.triggerDecision,
  );
  const schema = semanticReviewPatchSchema({
    candidate,
    sourceEvidenceIndex
  });
  const parsed = schema.safeParse(input.patch);
  if (!parsed.success) {
    return SemanticReviewPatchApplicationResultSchema.parse({
      kind: "rejected",
      code: "PATCH_SCHEMA_INVALID"
    });
  }
  const patch = parsed.data;
  const candidateDigestBefore = await hashCanonical(candidate);
  if (patch.callACandidateDigest !== candidateDigestBefore) {
    return SemanticReviewPatchApplicationResultSchema.parse({
      kind: "rejected",
      code: "CALL_A_CANDIDATE_DIGEST_MISMATCH"
    });
  }
  if (
    JSON.stringify(patch.triggerCodes) !==
      JSON.stringify(triggerDecision.triggerCodes)
  ) {
    return SemanticReviewPatchApplicationResultSchema.parse({
      kind: "rejected",
      code: "TRIGGER_IDENTITY_MISMATCH"
    });
  }
  const originalDigestById = new Map(
    await Promise.all(candidate.items.map(async (item, index) =>
      [itemId(index), await hashCanonical(item)] as const
    )),
  );
  if (patch.operations.some((operation) =>
    originalDigestById.get(operation.itemId) !== operation.expectedItemDigest
  )) {
    return SemanticReviewPatchApplicationResultSchema.parse({
      kind: "rejected",
      code: "ITEM_PRECONDITION_DIGEST_MISMATCH"
    });
  }
  const patched = structuredClone(candidate);
  const changedItemIds = new Set<string>();
  for (const operation of patch.operations) {
    const index = Number.parseInt(
      operation.itemId.slice("inventory-item-".length),
      10,
    ) - 1;
    const item = patched.items[index]!;
    changedItemIds.add(operation.itemId);
    if (operation.kind === "replace-item-evidence-bindings") {
      item.evidenceBindings = operation.evidenceBindings;
      continue;
    }
    if (operation.kind === "replace-item-relationships") {
      item.relationships = operation.relationships;
      continue;
    }
    const common = {
      claim: item.claim,
      importance: item.state === "context" ? "preference" as const :
        item.importance,
      evidenceBindings: item.evidenceBindings,
      relationships: item.relationships,
      measurements: item.measurements
    };
    patched.items[index] = {
      ...common,
      ...operation.resolution
    };
  }
  const strictPatched = semanticInterpretationCandidateSchema(
    sourceEvidenceIndex,
  ).safeParse(patched);
  if (!strictPatched.success) {
    return SemanticReviewPatchApplicationResultSchema.parse({
      kind: "rejected",
      code: "PATCHED_CANDIDATE_INVALID"
    });
  }
  const authorization = authorizeSemanticInterpretation({
    interpretation: strictPatched.data,
    sourceEvidenceIndex
  });
  if (!authorization.success) {
    return SemanticReviewPatchApplicationResultSchema.parse({
      kind: "rejected",
      code: "PATCHED_CANDIDATE_UNAUTHORIZED"
    });
  }
  return SemanticReviewPatchApplicationResultSchema.parse({
    kind: "applied",
    patchDigest: await hashCanonical(patch),
    candidateDigestBefore,
    candidateDigestAfter: await hashCanonical(authorization.candidate),
    changedItemIds: [...changedItemIds].sort(),
    candidate: authorization.candidate
  });
}
