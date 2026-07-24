import { describe, expect, it } from "vitest";

import { hashCanonical } from "../../src/domain/hash.js";
import {
  applySemanticReviewPatch,
  classifySemanticReviewTriggers,
  CURRENT_BOUNDED_SEMANTIC_REVIEW_PROMPT_IDENTITY,
  CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION,
  SEMANTIC_REVIEW_TRIGGER_CODES,
  semanticReviewPatchSchema
} from "../../src/evaluation/bounded-semantic-review.js";
import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION
} from "../../src/interpretation/semantic-atom-registry.js";
import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  SemanticInterpretationCandidateSchema,
  type SemanticInterpretationCandidate
} from "../../src/interpretation/semantic-model-contract.js";
import { buildSourceEvidenceIndex } from "../../src/interpretation/source-evidence.js";

async function source() {
  return buildSourceEvidenceIndex({
    brief: "Make one rigid open enclosure for the supplied contents.",
    references: [],
    roleConstraints: []
  });
}

function recoverableCandidate(
  evidenceId: string,
): SemanticInterpretationCandidate {
  return SemanticInterpretationCandidateSchema.parse({
    schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    items: [{
      claim: "The primary enclosure remains semantically recoverable.",
      importance: "essential",
      evidenceBindings: [{
        evidenceId,
        aspect: "structure",
        support: "direct"
      }],
      relationships: [],
      measurements: [],
      state: "unbound",
      reason: "EVIDENCE_INSUFFICIENT",
      unsupportedSignatureIds: []
    }]
  });
}

function boundResolution(evidenceId: string) {
  return {
    state: "bound" as const,
    atoms: [{
      kind: "primary-enclosure" as const,
      enclosure: {
        quantity: null,
        priority: "must" as const,
        evidenceIds: [evidenceId]
      },
      access: {
        kind: "open-top" as const,
        priority: "must" as const,
        evidenceIds: [evidenceId]
      },
      space: {
        layout: "explicit-single-space" as const,
        priority: "must" as const,
        evidenceIds: [evidenceId]
      }
    }]
  };
}

describe("evaluation-only bounded semantic review", () => {
  it("derives only the six registered triggers and excludes unsupported fabrication capability", async () => {
    const evidence = await source();
    const evidenceId = evidence.sourceEvidenceIndex.spans[0]!.evidenceId;
    const common = {
      importance: "essential" as const,
      evidenceBindings: [{
        evidenceId,
        aspect: "structure" as const,
        support: "direct" as const
      }],
      relationships: [],
      measurements: [],
      unsupportedSignatureIds: []
    };
    const candidate = SemanticInterpretationCandidateSchema.parse({
      schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
      atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
      items: [
        {
          ...common,
          claim: "A recoverable unbound item.",
          state: "unbound",
          reason: "EVIDENCE_INSUFFICIENT"
        },
        {
          ...common,
          claim: "A recoverable uncertain item.",
          state: "uncertain",
          reason: "EVIDENCE_INSUFFICIENT",
          rationale: "The evidence permits a bounded semantic correction."
        },
        {
          ...common,
          claim: "A recoverable projection coverage item.",
          state: "unbound",
          reason: "PROJECTION_COVERAGE_MISMATCH"
        },
        {
          ...common,
          claim: "A recoverable evidence conflict item.",
          state: "uncertain",
          reason: "EVIDENCE_CONFLICT",
          rationale: "Typed precedence is incomplete."
        }
      ]
    });
    const decision = classifySemanticReviewTriggers({
      candidate,
      authorizationFindings: [
        {
          code: "REFERENCE_ROLE_ACCOUNTING_MISMATCH",
          path: "items.0"
        },
        {
          code: "CONFLICT_PRECEDENCE_UNVERIFIED",
          path: "items.3.relationships.0"
        },
        {
          code: "SEMANTIC_ATOM_EVIDENCE_ASPECT_MISSING",
          path: "items.1.atoms.0"
        }
      ]
    });
    expect(decision).toMatchObject({
      eligible: true,
      triggerCodes: [...SEMANTIC_REVIEW_TRIGGER_CODES],
      affectedItemIds: [
        "inventory-item-1",
        "inventory-item-2",
        "inventory-item-3",
        "inventory-item-4"
      ]
    });

    const unsupported = structuredClone(recoverableCandidate(evidenceId));
    if (unsupported.items[0]!.state !== "unbound") {
      throw new Error("expected unbound candidate");
    }
    unsupported.items[0]!.reason = "CAPABILITY_NOT_REGISTERED";
    unsupported.items[0]!.unsupportedSignatureIds = [
      "kerf-flexure-corner-construction"
    ];
    expect(classifySemanticReviewTriggers({
      candidate: unsupported
    })).toMatchObject({
      eligible: false,
      triggerCodes: []
    });
  });

  it("applies one strict semantic patch atomically while preserving every unpatched byte", async () => {
    const evidence = await source();
    const sourceEvidenceIndex = evidence.sourceEvidenceIndex;
    const evidenceId = sourceEvidenceIndex.spans[0]!.evidenceId;
    const candidate = recoverableCandidate(evidenceId);
    const triggerDecision = classifySemanticReviewTriggers({ candidate });
    const candidateBefore = structuredClone(candidate);
    const itemDigest = await hashCanonical(candidate.items[0]);
    const patch = {
      schemaVersion: CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION,
      promptIdentity: CURRENT_BOUNDED_SEMANTIC_REVIEW_PROMPT_IDENTITY,
      callACandidateDigest: await hashCanonical(candidate),
      triggerCodes: triggerDecision.triggerCodes,
      operations: [{
        kind: "replace-item-resolution" as const,
        itemId: "inventory-item-1",
        expectedItemDigest: itemDigest,
        resolution: boundResolution(evidenceId)
      }]
    };
    expect(semanticReviewPatchSchema({
      candidate,
      sourceEvidenceIndex
    }).parse(patch)).toEqual(patch);
    const applied = await applySemanticReviewPatch({
      candidate,
      sourceEvidenceIndex,
      triggerDecision,
      patch
    });
    expect(applied).toMatchObject({
      kind: "applied",
      changedItemIds: ["inventory-item-1"]
    });
    expect(candidate).toEqual(candidateBefore);
    if (applied.kind !== "applied") throw new Error("expected applied patch");
    expect(applied.candidate.items[0]).toMatchObject({
      claim: candidate.items[0]!.claim,
      evidenceBindings: candidate.items[0]!.evidenceBindings,
      relationships: candidate.items[0]!.relationships,
      measurements: candidate.items[0]!.measurements,
      state: "bound"
    });
    expect(applied.candidateDigestAfter).not.toBe(
      applied.candidateDigestBefore,
    );
  });

  it("rejects the whole patch on identity, precondition, schema, or authority drift", async () => {
    const evidence = await source();
    const sourceEvidenceIndex = evidence.sourceEvidenceIndex;
    const evidenceId = sourceEvidenceIndex.spans[0]!.evidenceId;
    const candidate = recoverableCandidate(evidenceId);
    const candidateBefore = structuredClone(candidate);
    const triggerDecision = classifySemanticReviewTriggers({ candidate });
    const basePatch = {
      schemaVersion: CURRENT_BOUNDED_SEMANTIC_REVIEW_VERSION,
      promptIdentity: CURRENT_BOUNDED_SEMANTIC_REVIEW_PROMPT_IDENTITY,
      callACandidateDigest: await hashCanonical(candidate),
      triggerCodes: triggerDecision.triggerCodes,
      operations: [{
        kind: "replace-item-resolution" as const,
        itemId: "inventory-item-1",
        expectedItemDigest: await hashCanonical(candidate.items[0]),
        resolution: boundResolution(evidenceId)
      }]
    };
    await expect(applySemanticReviewPatch({
      candidate,
      sourceEvidenceIndex,
      triggerDecision,
      patch: { ...basePatch, callACandidateDigest: "0".repeat(64) }
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "CALL_A_CANDIDATE_DIGEST_MISMATCH"
    });
    await expect(applySemanticReviewPatch({
      candidate,
      sourceEvidenceIndex,
      triggerDecision,
      patch: {
        ...basePatch,
        operations: [{
          ...basePatch.operations[0],
          expectedItemDigest: "0".repeat(64)
        }]
      }
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "ITEM_PRECONDITION_DIGEST_MISMATCH"
    });
    await expect(applySemanticReviewPatch({
      candidate,
      sourceEvidenceIndex,
      triggerDecision,
      patch: {
        ...basePatch,
        operations: [{
          ...basePatch.operations[0],
          rawSvg: "<svg/>"
        }]
      }
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "PATCH_SCHEMA_INVALID"
    });
    await expect(applySemanticReviewPatch({
      candidate,
      sourceEvidenceIndex,
      triggerDecision,
      patch: {
        ...basePatch,
        operations: [{
          kind: "replace-item-evidence-bindings",
          itemId: "inventory-item-1",
          expectedItemDigest: await hashCanonical(candidate.items[0]),
          evidenceBindings: [{
            evidenceId: "invented-evidence",
            aspect: "structure",
            support: "direct"
          }]
        }]
      }
    })).resolves.toMatchObject({
      kind: "rejected",
      code: "PATCH_SCHEMA_INVALID"
    });
    expect(candidate).toEqual(candidateBefore);
  });
});
