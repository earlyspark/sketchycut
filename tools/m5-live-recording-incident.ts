import { z } from "zod";

import { StableIdSchema } from "../src/domain/contracts.js";

export const M5LiveRecordingIncidentSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    incidentId: StableIdSchema,
    evaluationId: z.literal("m5-live-gpt-5.6-sol-attempt-2"),
    modelId: z.literal("gpt-5.6-sol"),
    recordedAt: z.iso.datetime({ offset: true }),
    command: z.literal("npm run evaluate:m5:sol:revision-2"),
    result: z
      .object({
        networkDispatchCount: z.literal(1),
        providerResponseReachedLocalPipeline: z.literal(true),
        strictParse: z.literal("passed"),
        deterministicCompile: z.literal("passed"),
        supportStateCorrect: z.null(),
        immutableEvaluationReportWritten: z.literal(false),
        ordinaryAttemptLedgerRecordWritten: z.literal(false),
        terraDispatched: z.literal(false)
      })
      .strict(),
    provenance: z
      .object({
        clientRequestId: z.null(),
        providerRequestId: z.null(),
        responseId: z.null(),
        usage: z
          .object({
            status: z.literal("unavailable"),
            reason: z.literal("post-response-local-recording-failure")
          })
          .strict(),
        identifierReason: z.literal("Identifiers existed in process memory but were not persisted before the local ledger rejected the completed attempt.")
      })
      .strict(),
    billing: z
      .object({
        state: z.literal("potentially-billed"),
        estimatedCostUsd: z.null(),
        unresolvedPotentialExposureUsd: z.literal(0.25),
        configuredPriceSnapshotId: z.literal("openai-public-pricing-2026-07-17-gpt-5.6-sol")
      })
      .strict(),
    failure: z
      .object({
        stage: z.literal("local-recording"),
        code: z.literal("LOCAL_LEDGER_PRICE_SNAPSHOT_ID_VALIDATION_AFTER_COMPLETED_RESPONSE"),
        stackLocation: z.literal("src/interpretation/orchestrator.ts:649 -> tools/m5-ledger-store.ts:78"),
        cause: z.literal("The configured price snapshot ID contained dots and failed the ledger StableId schema after the completed response was compiled.")
      })
      .strict(),
    evidenceBasis: z.tuple([
      z.literal("The thrown ZodError identifies billing.priceSnapshotId and the StableId regex."),
      z.literal("The orchestrator stack reached the successful completed-attempt append after strict parse, mapping, and deterministic compilation."),
      z.literal("No attempt-2 evaluation report or ordinary ledger attempt was written, and Terra remained undispatched.")
    ]),
    privacy: z
      .object({
        rawReferencePersisted: z.literal(false),
        rawProviderResponsePersisted: z.literal(false),
        fullPromptPersisted: z.literal(false),
        apiKeyPersisted: z.literal(false)
      })
      .strict(),
    limitations: z.tuple([
      z.literal("The model output, exact support-state result, provider identifiers, token usage, latency, and exact cost cannot be recovered from local evidence."),
      z.literal("This incident proves a completed local interpretation pipeline, not a passing frozen evaluation rubric."),
      z.literal("A further dispatch requires separate explicit builder authorization and must not reuse or overwrite revision-2 evidence.")
    ])
  })
  .strict();

export type M5LiveRecordingIncident = z.infer<typeof M5LiveRecordingIncidentSchema>;
