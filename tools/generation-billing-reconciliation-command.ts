import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  BillingReconciliationSchema,
  type BillingReconciliation
} from "../src/interpretation/live-ledger.js";
import {
  assertBillingReconciliationAttribution,
  isConclusiveBillingReconciliation
} from "../src/server/generation/billing-reconciliation.js";
import type {
  BillingReconciliationGenerationStore
} from "../src/server/generation/contracts.js";
import {
  exposureUsd,
  summarizeLedger
} from "../src/server/generation/exposure-authorization.js";

const DecimalUsdPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u;

export type BillingReconciliationCommandArguments = {
  attemptId: string;
  source: BillingReconciliation["source"];
  result: BillingReconciliation["result"];
  actualCostUsd: number | null;
  evidenceFile: string | null;
  note: string;
  apply: boolean;
};

export function parseBillingReconciliationCommandArguments(
  argv: readonly string[],
): BillingReconciliationCommandArguments {
  const allowed = new Set([
    "--attempt-id",
    "--source",
    "--result",
    "--actual-cost-usd",
    "--evidence-file",
    "--note",
    "--apply"
  ]);
  for (const argument of argv.filter((value) => value.startsWith("--"))) {
    if (!allowed.has(argument)) {
      throw new Error(
        `GENERATION_BILLING_RECONCILIATION_ARGUMENT_UNKNOWN_${argument.slice(2)}`,
      );
    }
  }
  const value = (name: string): string | null => {
    const index = argv.indexOf(name);
    const candidate = index < 0 ? null : argv[index + 1] ?? null;
    return candidate === null || candidate.startsWith("--")
      ? null
      : candidate;
  };
  const attemptId = value("--attempt-id");
  const source = value("--source");
  const result = value("--result");
  const note = value("--note");
  const actualCostInput = value("--actual-cost-usd");
  const evidenceFile = value("--evidence-file");
  if (attemptId === null || source === null || result === null || note === null) {
    throw new Error(
      "GENERATION_BILLING_RECONCILIATION_REQUIRED_ARGUMENT_MISSING",
    );
  }
  if (
    ![
      "provider-usage-dashboard",
      "provider-usage-api",
      "provider-support",
      "administrative-exhaustion"
    ].includes(source)
  ) {
    throw new Error("GENERATION_BILLING_RECONCILIATION_SOURCE_INVALID");
  }
  if (
    ![
      "confirmed-billed",
      "confirmed-not-billed",
      "inconclusive",
      "aggregate-only",
      "administrative-full-bound"
    ].includes(result)
  ) {
    throw new Error("GENERATION_BILLING_RECONCILIATION_RESULT_INVALID");
  }
  const actualCostUsd = actualCostInput === null
    ? null
    : DecimalUsdPattern.test(actualCostInput)
      ? Number(actualCostInput)
      : Number.NaN;
  if (
    actualCostUsd !== null &&
    (!Number.isFinite(actualCostUsd) || actualCostUsd > 100)
  ) {
    throw new Error("GENERATION_BILLING_RECONCILIATION_COST_INVALID");
  }
  const providerConclusive = result === "confirmed-billed" ||
    result === "confirmed-not-billed";
  const administrative = result === "administrative-full-bound";
  if ((providerConclusive || administrative) && evidenceFile === null) {
    throw new Error(
      "GENERATION_BILLING_RECONCILIATION_CONCLUSIVE_EVIDENCE_REQUIRED",
    );
  }
  if (
    (result === "confirmed-billed" && actualCostUsd === null) ||
    (result === "confirmed-not-billed" && actualCostUsd !== 0) ||
    ((!providerConclusive || administrative) && actualCostUsd !== null)
  ) {
    throw new Error("GENERATION_BILLING_RECONCILIATION_COST_INVALID");
  }
  if (
    (administrative && source !== "administrative-exhaustion") ||
    (!administrative && source === "administrative-exhaustion")
  ) {
    throw new Error("GENERATION_BILLING_RECONCILIATION_SOURCE_INVALID");
  }
  return {
    attemptId,
    source: source as BillingReconciliation["source"],
    result: result as BillingReconciliation["result"],
    actualCostUsd,
    evidenceFile,
    note,
    apply: argv.includes("--apply")
  };
}

async function evidenceDigest(
  evidenceFile: string | null,
): Promise<string | null> {
  if (evidenceFile === null) return null;
  let bytes: Uint8Array;
  try {
    bytes = await readFile(evidenceFile);
  } catch {
    throw new Error(
      "GENERATION_BILLING_RECONCILIATION_EVIDENCE_FILE_UNREADABLE",
    );
  }
  if (bytes.byteLength === 0) {
    throw new Error(
      "GENERATION_BILLING_RECONCILIATION_EVIDENCE_FILE_EMPTY",
    );
  }
  return createHash("sha256").update(bytes).digest("hex");
}

export async function runBillingReconciliationCommand(input: {
  store: BillingReconciliationGenerationStore;
  arguments: BillingReconciliationCommandArguments;
  now?: Date;
  reconciliationId?: string;
}): Promise<{ output: string; applied: boolean }> {
  const digest = await evidenceDigest(input.arguments.evidenceFile);
  const [attempts, existing, state] = await Promise.all([
    input.store.readLedgerAttempts(),
    input.store.readBillingReconciliations(),
    input.store.readGlobalExposureState()
  ]);
  const attempt = attempts.find((candidate) =>
    candidate.attemptId === input.arguments.attemptId
  );
  if (attempt === undefined) {
    throw new Error("GENERATION_BILLING_RECONCILIATION_ATTEMPT_NOT_FOUND");
  }
  const reconciliation = BillingReconciliationSchema.parse({
    schemaVersion: "1.0",
    reconciliationId: input.reconciliationId ??
      `reconciliation-${randomUUID().replaceAll("-", "")}`,
    attemptId: input.arguments.attemptId,
    source: input.arguments.source,
    reconciledAt: (input.now ?? new Date()).toISOString(),
    result: input.arguments.result,
    actualCostUsd: input.arguments.actualCostUsd,
    evidenceDigest: digest,
    note: input.arguments.note
  });
  assertBillingReconciliationAttribution({ attempt, reconciliation });
  if (
    isConclusiveBillingReconciliation(reconciliation) &&
    existing.some((record) =>
      record.attemptId === reconciliation.attemptId &&
      isConclusiveBillingReconciliation(record)
    )
  ) {
    throw new Error(
      "GENERATION_BILLING_RECONCILIATION_ALREADY_CONCLUSIVE",
    );
  }
  const before = summarizeLedger(attempts, existing);
  const after = summarizeLedger(attempts, [...existing, reconciliation]);
  const lines = [
    `Mode: ${input.arguments.apply ? "apply" : "dry-run"}`,
    `Attempt: ${attempt.attemptId}`,
    `Proposed result: ${reconciliation.result}`,
    `Evidence SHA-256: ${reconciliation.evidenceDigest ?? "not supplied"}`,
    `Unresolved potentially billed exposure before: $${exposureUsd(before.unresolvedPotentiallyBilledExposureMicrousd)}`,
    `Unresolved potentially billed exposure after: $${exposureUsd(after.unresolvedPotentiallyBilledExposureMicrousd)}`,
    `Confirmed estimated cost before: $${exposureUsd(before.confirmedEstimatedCostMicrousd)}`,
    `Confirmed estimated cost after: $${exposureUsd(after.confirmedEstimatedCostMicrousd)}`,
    `Lifetime reserved exposure remains: $${exposureUsd(state.reservedExposureMicrousd)}`
  ];
  if (reconciliation.result === "administrative-full-bound") {
    lines.push(
      `Administrative full bound retained: $${exposureUsd(Math.round((attempt.billing.requestBudgetUpperBoundUsd ?? 0) * 1_000_000))}`,
      "This is not provider-confirmed billing and does not increase confirmed estimated cost.",
    );
  }
  if (!input.arguments.apply) {
    lines.push(
      "Dry run only; no reconciliation was appended. Add --apply after reviewing the attributed provider evidence.",
    );
    return { output: `${lines.join("\n")}\n`, applied: false };
  }
  await input.store.appendBillingReconciliation(reconciliation);
  const persisted = await input.store.readBillingReconciliations();
  if (!persisted.some((record) =>
    record.reconciliationId === reconciliation.reconciliationId
  )) {
    throw new Error(
      "GENERATION_BILLING_RECONCILIATION_PERSISTENCE_FAILED",
    );
  }
  lines.push(
    `Appended immutable reconciliation ${reconciliation.reconciliationId}.`,
  );
  return { output: `${lines.join("\n")}\n`, applied: true };
}
