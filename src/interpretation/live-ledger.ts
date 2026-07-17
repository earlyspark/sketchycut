import { z } from "zod";

import {
  SchemaVersionSchema,
  Sha256Schema,
  StableIdSchema
} from "../domain/contracts.js";

const NonNegativeIntegerSchema = z.number().int().nonnegative();
const NonNegativeUsdSchema = z.number().nonnegative();

export const LiveCallUsageSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("reported"),
      inputTokens: NonNegativeIntegerSchema,
      cachedInputTokens: NonNegativeIntegerSchema,
      reasoningTokens: NonNegativeIntegerSchema,
      outputTokens: NonNegativeIntegerSchema,
      totalTokens: NonNegativeIntegerSchema
    })
    .strict()
    .superRefine((usage, context) => {
      if (usage.cachedInputTokens > usage.inputTokens) {
        context.addIssue({
          code: "custom",
          message: "Cached input tokens cannot exceed total input tokens.",
          path: ["cachedInputTokens"]
        });
      }
      if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
        context.addIssue({
          code: "custom",
          message: "Total tokens must equal input plus output tokens.",
          path: ["totalTokens"]
        });
      }
    }),
  z
    .object({
      status: z.literal("unavailable"),
      reason: z.enum([
        "not-dispatched",
        "no-response",
        "provider-omitted",
        "authoritative-not-accepted"
      ])
    })
    .strict()
]);

export const LiveCallBillingSchema = z
  .object({
    state: z.enum([
      "not-applicable",
      "confirmed-not-billed",
      "potentially-billed",
      "confirmed-billed"
    ]),
    estimatedCostUsd: NonNegativeUsdSchema.nullable(),
    requestBudgetUpperBoundUsd: NonNegativeUsdSchema.nullable(),
    priceSnapshotId: StableIdSchema.nullable()
  })
  .strict();

export const LiveCallAttemptSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    attemptId: StableIdSchema,
    submissionId: StableIdSchema,
    retryChainId: StableIdSchema,
    retryOfAttemptId: StableIdSchema.nullable(),
    retryOfRecordingIncidentId: StableIdSchema.nullable().optional(),
    initiatedBy: z.enum(["initial-submit", "explicit-user-retry", "live-eval"]),
    attemptOrdinal: z.number().int().positive(),
    semanticRequestDigest: Sha256Schema,
    promptHash: Sha256Schema,
    schemaHash: Sha256Schema,
    capabilityCatalogHash: Sha256Schema,
    modelConfigurationHash: Sha256Schema,
    modelId: z.string().min(1).max(120).nullable(),
    reasoningEffort: z.string().min(1).max(40).nullable(),
    clientRequestId: z
      .string()
      .min(1)
      .max(512)
      .refine(
        (value) => Array.from(value).every((character) => character.charCodeAt(0) <= 127),
        "Client request IDs must contain ASCII characters only.",
      ),
    providerRequestId: z.string().min(1).max(512).nullable(),
    responseId: z.string().min(1).max(512).nullable(),
    dispatchState: z.enum(["not-dispatched", "transport-handoff", "response-observed"]),
    outcome: z.enum([
      "cache-hit",
      "pre-dispatch-failure",
      "provider-not-accepted",
      "completed",
      "model-failure",
      "schema-failure",
      "ambiguous-transport"
    ]),
    occurredAt: z.iso.datetime({ offset: true }),
    latencyMs: NonNegativeIntegerSchema.nullable(),
    cacheResult: z.enum(["hit", "miss", "not-checked"]),
    errorCode: z.string().regex(/^[A-Z][A-Z0-9_]+$/).nullable(),
    networkDispatchCount: z.union([z.literal(0), z.literal(1)]),
    strictParse: z.enum(["not-attempted", "passed", "failed"]),
    schemaFailureIssues: z.array(z.object({
      code: z.string().min(1).max(80),
      path: z.string().max(500)
    }).strict()).max(32).optional(),
    supportStateCorrect: z.boolean().nullable(),
    deterministicCompile: z.enum(["not-run", "passed", "failed"]),
    usage: LiveCallUsageSchema,
    billing: LiveCallBillingSchema
  })
  .strict()
  .superRefine((attempt, context) => {
    const fail = (message: string, path: PropertyKey[]): void => {
      context.addIssue({ code: "custom", message, path });
    };
    const dispatched = attempt.dispatchState !== "not-dispatched";

    if (attempt.networkDispatchCount !== Number(dispatched)) {
      fail("Ledger network dispatch count must match transport dispatch state.", [
        "networkDispatchCount"
      ]);
    }

    const retryReferenceCount = Number(attempt.retryOfAttemptId !== null) +
      Number((attempt.retryOfRecordingIncidentId ?? null) !== null);
    if (attempt.initiatedBy === "explicit-user-retry" && retryReferenceCount !== 1) {
      fail("An explicit retry must reference exactly one prior attempt or recording incident.", [
        "retryOfAttemptId"
      ]);
    }
    if (attempt.initiatedBy !== "explicit-user-retry" && retryReferenceCount !== 0) {
      fail("Only an explicit user retry may reference prior evidence.", ["retryOfAttemptId"]);
    }
    if (dispatched && attempt.modelId === null) {
      fail("A dispatched attempt must record its model ID.", ["modelId"]);
    }
    if (!dispatched && (attempt.providerRequestId !== null || attempt.responseId !== null)) {
      fail("A non-dispatched attempt cannot have provider response identifiers.", [
        "providerRequestId"
      ]);
    }

    if (
      attempt.dispatchState === "not-dispatched" &&
      !["cache-hit", "pre-dispatch-failure"].includes(attempt.outcome)
    ) {
      fail("A non-dispatched attempt must be a cache hit or pre-dispatch failure.", [
        "outcome"
      ]);
    }
    if (
      ["cache-hit", "completed"].includes(attempt.outcome) &&
      attempt.strictParse !== "passed"
    ) {
      fail("Completed and cache-hit outcomes require a strict parsed intent.", ["strictParse"]);
    }
    if (attempt.outcome === "schema-failure" && attempt.strictParse !== "failed") {
      fail("A schema failure must record a failed strict parse.", ["strictParse"]);
    }
    if (attempt.outcome !== "schema-failure" && attempt.schemaFailureIssues !== undefined) {
      fail("Only a schema failure may record strict-parse issue paths.", ["schemaFailureIssues"]);
    }
    if (
      ["ambiguous-transport", "provider-not-accepted", "pre-dispatch-failure"].includes(
        attempt.outcome,
      ) && attempt.deterministicCompile !== "not-run"
    ) {
      fail("A response-free outcome cannot claim deterministic compilation.", [
        "deterministicCompile"
      ]);
    }
    if (
      ["cache-hit", "pre-dispatch-failure"].includes(attempt.outcome) &&
      (attempt.billing.state !== "not-applicable" ||
        attempt.usage.status !== "unavailable" ||
        attempt.usage.reason !== "not-dispatched" ||
        attempt.billing.estimatedCostUsd !== 0)
    ) {
      fail(
        "Cache hits and pre-dispatch failures must be not-applicable for billing, have unavailable not-dispatched usage, and record zero estimated cost.",
        ["billing"]
      );
    }
    if (
      attempt.outcome === "provider-not-accepted" &&
      (attempt.billing.state !== "confirmed-not-billed" ||
        attempt.usage.status !== "unavailable" ||
        attempt.usage.reason !== "authoritative-not-accepted" ||
        attempt.billing.estimatedCostUsd !== 0)
    ) {
      fail(
        "An authoritative provider rejection must be confirmed-not-billed with zero estimated cost.",
        ["billing"]
      );
    }
    if (
      attempt.outcome === "ambiguous-transport" &&
      (attempt.dispatchState === "not-dispatched" ||
        attempt.billing.state !== "potentially-billed" ||
        attempt.billing.estimatedCostUsd !== null ||
        attempt.usage.status !== "unavailable" ||
        attempt.usage.reason !== "no-response")
    ) {
      fail(
        "An ambiguous post-handoff transport outcome must be potentially-billed, keep cost unknown, and record unavailable no-response usage.",
        ["billing"]
      );
    }
    if (
      attempt.outcome === "completed" &&
      (attempt.dispatchState !== "response-observed" ||
        attempt.providerRequestId === null ||
        attempt.billing.state !== "confirmed-billed" ||
        attempt.billing.estimatedCostUsd === null ||
        attempt.billing.priceSnapshotId === null ||
        attempt.usage.status !== "reported" ||
        attempt.errorCode !== null)
    ) {
      fail(
        "A completed call must have an observed response, provider request ID, reported usage, confirmed billing, and no error code.",
        ["outcome"]
      );
    }
    if (
      ["model-failure", "schema-failure"].includes(attempt.outcome) &&
      (attempt.dispatchState !== "response-observed" ||
        attempt.providerRequestId === null ||
        attempt.billing.state !== "confirmed-billed" ||
        attempt.billing.estimatedCostUsd === null ||
        attempt.billing.priceSnapshotId === null ||
        attempt.usage.status !== "reported")
    ) {
      fail(
        "A post-response model or schema failure must retain provider ID and usage and be confirmed-billed.",
        ["outcome"]
      );
    }
    if (
      !["completed", "cache-hit"].includes(attempt.outcome) &&
      attempt.errorCode === null
    ) {
      fail("A failed attempt must record a privacy-safe error code.", ["errorCode"]);
    }
  });

export const BillingReconciliationSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    reconciliationId: StableIdSchema,
    attemptId: StableIdSchema,
    source: z.enum([
      "provider-usage-dashboard",
      "provider-usage-api",
      "provider-support"
    ]),
    reconciledAt: z.iso.datetime({ offset: true }),
    result: z.enum([
      "confirmed-billed",
      "confirmed-not-billed",
      "inconclusive",
      "aggregate-only"
    ]),
    actualCostUsd: NonNegativeUsdSchema.nullable(),
    evidenceDigest: Sha256Schema.nullable(),
    note: z.string().min(1).max(500)
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.result === "confirmed-billed" &&
      (record.actualCostUsd === null || record.evidenceDigest === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Confirmed billing requires an attributed cost and evidence digest."
      });
    }
    if (
      record.result === "confirmed-not-billed" &&
      (record.actualCostUsd !== 0 || record.evidenceDigest === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Confirmed non-billing requires zero cost and an evidence digest."
      });
    }
    if (
      ["inconclusive", "aggregate-only"].includes(record.result) &&
      record.actualCostUsd !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Inconclusive or aggregate-only reconciliation cannot invent attempt cost."
      });
    }
  });

export const LiveCallLedgerV1Schema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    ledgerId: StableIdSchema,
    attempts: z.array(LiveCallAttemptSchema).min(1),
    reconciliations: z.array(BillingReconciliationSchema)
  })
  .strict()
  .superRefine((ledger, context) => {
    const attemptById = new Map(ledger.attempts.map((attempt) => [attempt.attemptId, attempt]));
    const attemptIds = ledger.attempts.map((attempt) => attempt.attemptId);
    if (new Set(attemptIds).size !== attemptIds.length) {
      context.addIssue({
        code: "custom",
        message: "Live-call attempt IDs must be unique.",
        path: ["attempts"]
      });
    }
    const clientRequestIds = ledger.attempts.map((attempt) => attempt.clientRequestId);
    if (new Set(clientRequestIds).size !== clientRequestIds.length) {
      context.addIssue({
        code: "custom",
        message: "Client request IDs must be unique across attempts.",
        path: ["attempts"]
      });
    }
    const providerRequestIds = ledger.attempts.flatMap((attempt) =>
      attempt.providerRequestId === null ? [] : [attempt.providerRequestId],
    );
    if (new Set(providerRequestIds).size !== providerRequestIds.length) {
      context.addIssue({
        code: "custom",
        message: "Observed provider request IDs must be unique across attempts.",
        path: ["attempts"]
      });
    }

    const ordinalsByChain = new Map<string, number[]>();
    for (const [index, attempt] of ledger.attempts.entries()) {
      const ordinals = ordinalsByChain.get(attempt.retryChainId) ?? [];
      ordinals.push(attempt.attemptOrdinal);
      ordinalsByChain.set(attempt.retryChainId, ordinals);

      if (attempt.retryOfAttemptId !== null) {
        const prior = attemptById.get(attempt.retryOfAttemptId);
        if (prior === undefined) {
          context.addIssue({
            code: "custom",
            message: `Retry references unknown attempt ${attempt.retryOfAttemptId}.`,
            path: ["attempts", index, "retryOfAttemptId"]
          });
        } else {
          if (prior.attemptOrdinal >= attempt.attemptOrdinal) {
            context.addIssue({
              code: "custom",
              message: "A retry must have a greater ordinal than its prior attempt.",
              path: ["attempts", index, "attemptOrdinal"]
            });
          }
          for (const field of [
            "retryChainId",
            "semanticRequestDigest",
            "promptHash",
            "schemaHash",
            "capabilityCatalogHash",
            "modelConfigurationHash",
            "modelId",
            "reasoningEffort"
          ] as const) {
            if (attempt[field] !== prior[field]) {
              context.addIssue({
                code: "custom",
                message: `An unchanged explicit retry must preserve ${field}.`,
                path: ["attempts", index, field]
              });
            }
          }
          if (attempt.clientRequestId === prior.clientRequestId) {
            context.addIssue({
              code: "custom",
              message: "Each dispatch attempt requires a new client request ID.",
              path: ["attempts", index, "clientRequestId"]
            });
          }
        }
      }
    }

    for (const [retryChainId, ordinals] of ordinalsByChain) {
      const sorted = [...ordinals].sort((left, right) => left - right);
      const expected = Array.from({ length: sorted.length }, (_, index) => index + 1);
      if (sorted.some((ordinal, index) => ordinal !== expected[index])) {
        context.addIssue({
          code: "custom",
          message: `Retry chain ${retryChainId} must use contiguous ordinals beginning at 1.`,
          path: ["attempts"]
        });
      }
    }

    const reconciliationIds = ledger.reconciliations.map(
      (record) => record.reconciliationId,
    );
    if (new Set(reconciliationIds).size !== reconciliationIds.length) {
      context.addIssue({
        code: "custom",
        message: "Billing reconciliation IDs must be unique.",
        path: ["reconciliations"]
      });
    }
    for (const [index, reconciliation] of ledger.reconciliations.entries()) {
      const attempt = attemptById.get(reconciliation.attemptId);
      if (attempt === undefined) {
        context.addIssue({
          code: "custom",
          message: `Reconciliation references unknown attempt ${reconciliation.attemptId}.`,
          path: ["reconciliations", index, "attemptId"]
        });
      } else if (attempt.billing.state !== "potentially-billed") {
        context.addIssue({
          code: "custom",
          message: "Append-only reconciliation is reserved for potentially-billed attempts.",
          path: ["reconciliations", index, "attemptId"]
        });
      }
    }
  });

export type LiveCallAttempt = z.infer<typeof LiveCallAttemptSchema>;
export type BillingReconciliation = z.infer<typeof BillingReconciliationSchema>;
export type LiveCallLedgerV1 = z.infer<typeof LiveCallLedgerV1Schema>;
