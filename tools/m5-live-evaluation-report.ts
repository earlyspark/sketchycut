import { z } from "zod";

import { LiveCallAttemptSchema } from "../src/interpretation/live-ledger.js";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const M5LiveEvaluationRubricItemSchema = z
  .object({
    id: z.enum([
      "strict-intent-schema",
      "supported-outcome",
      "rigid-structure",
      "explicit-dual-reference-role",
      "mandatory-requirement-evidence",
      "registered-filled-motif",
      "deterministic-compilation",
      "canonical-validation",
      "visible-filled-engraving",
      "single-network-dispatch",
      "model-partitioned-cache-miss",
      "single-runtime-model-call"
    ]),
    passed: z.boolean(),
    evidence: z.string().min(1).max(500)
  })
  .strict();

export const M5LiveEvaluationReportSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    evaluationId: z.string().regex(/^m5-live-[a-z0-9.-]+-attempt-[1-9][0-9]*$/),
    revisionOfEvaluationId: z.string()
      .regex(/^m5-live-[a-z0-9.-]+-attempt-[1-9][0-9]*$/)
      .optional(),
    caseId: z.literal("m5-rigid-structure-and-bilateral-motif"),
    modelId: z.enum(["gpt-5.6-sol", "gpt-5.6-terra"]),
    frozenInput: z
      .object({
        briefSha256: Sha256Schema,
        reference: z
          .object({
            referenceId: z.literal("reference-1"),
            sha256: Sha256Schema,
            mediaType: z.literal("image/png"),
            width: z.literal(160),
            height: z.literal(120),
            assignedRoles: z.tuple([z.literal("structure"), z.literal("motif")])
          })
          .strict(),
        deterministicControlsSha256: Sha256Schema,
        fabricationControlsSha256: Sha256Schema
      })
      .strict(),
    configuration: z
      .object({
        promptSha256: Sha256Schema,
        intentSchemaSha256: Sha256Schema,
        capabilityCatalogSha256: Sha256Schema,
        modelConfigurationSha256: Sha256Schema,
        reasoningEffort: z.literal("low"),
        maxOutputTokens: z.literal(4_000),
        serviceTier: z.literal("default"),
        store: z.literal(false),
        expectedOutcomeKind: z.literal("supported")
      })
      .strict(),
    result: z
      .object({
        kind: z.enum(["supported", "simplified", "concept-only", "failure"]),
        cacheResult: z.enum(["miss", "hit", "singleflight-hit"]).nullable(),
        intentSha256: Sha256Schema.nullable(),
        canonicalDocumentSha256: Sha256Schema.nullable(),
        geometrySha256: Sha256Schema.nullable(),
        validationStatus: z.enum(["pass", "fail"]).nullable(),
        acceptedMotifPrimitives: z.array(z.string().min(1).max(80)),
        motifStatus: z.enum(["applied", "omitted"]).nullable(),
        motifEngraveFeatureCount: z.number().int().nonnegative().nullable(),
        failureStage: z.enum(["input", "transport", "schema", "model", "compilation"]).nullable(),
        failureCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/).nullable(),
        semanticDiagnostics: z.object({
          mappingKind: z.enum(["supported", "simplified", "concept-only"]),
          findingCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/)),
          blockedRequirementKinds: z.array(z.string().min(1).max(80)),
          mustRequirementKinds: z.array(z.string().min(1).max(80)),
          coreIntentRepresentable: z.boolean(),
          unresolvedNeedCount: z.number().int().nonnegative(),
          bodyShapeClasses: z.array(z.string().min(1).max(80)),
          interfaceBehaviors: z.array(z.string().min(1).max(80)),
          requestedMotifPrimitives: z.array(z.string().min(1).max(80))
        }).strict().nullable().optional()
      })
      .strict(),
    rubric: z.array(M5LiveEvaluationRubricItemSchema).length(12),
    passed: z.boolean(),
    attempt: LiveCallAttemptSchema.nullable(),
    privacy: z
      .object({
        rawReferencePersisted: z.literal(false),
        rawProviderResponsePersisted: z.literal(false),
        fullPromptPersistedInReport: z.literal(false),
        syntheticEvaluationInput: z.literal(true)
      })
      .strict(),
    limitations: z.array(z.string().min(1).max(500)).min(1)
  })
  .strict()
  .superRefine((report, context) => {
    const rubricPass = report.rubric.every((item) => item.passed);
    if (rubricPass !== report.passed) {
      context.addIssue({
        code: "custom",
        path: ["passed"],
        message: "The evaluation result must equal the conjunction of the frozen rubric."
      });
    }
    if (new Set(report.rubric.map((item) => item.id)).size !== report.rubric.length) {
      context.addIssue({ code: "custom", path: ["rubric"], message: "Rubric IDs must be unique." });
    }
  });

export type M5LiveEvaluationReport = z.infer<typeof M5LiveEvaluationReportSchema>;
