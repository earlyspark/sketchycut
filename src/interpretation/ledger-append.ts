import {
  BillingReconciliationSchema,
  LiveCallAttemptSchema,
  LiveCallLedgerV1Schema,
  type BillingReconciliation,
  type LiveCallAttempt,
  type LiveCallLedgerV1
} from "./live-ledger.js";

export function appendAttempt(
  existingCandidate: unknown,
  ledgerId: string,
  attemptCandidate: unknown,
): LiveCallLedgerV1 {
  const attempt = LiveCallAttemptSchema.parse(attemptCandidate);
  const previous = existingCandidate === null
    ? null
    : LiveCallLedgerV1Schema.parse(existingCandidate);
  if (previous !== null && previous.ledgerId !== ledgerId) {
    throw new Error("LEDGER_ID_MISMATCH");
  }
  return LiveCallLedgerV1Schema.parse({
    schemaVersion: "1.0",
    ledgerId,
    attempts: [...(previous?.attempts ?? []), attempt],
    reconciliations: [...(previous?.reconciliations ?? [])]
  });
}

export function appendBillingReconciliation(
  existingCandidate: unknown,
  reconciliationCandidate: unknown,
): LiveCallLedgerV1 {
  const previous = LiveCallLedgerV1Schema.parse(existingCandidate);
  const reconciliation = BillingReconciliationSchema.parse(reconciliationCandidate);
  return LiveCallLedgerV1Schema.parse({
    ...previous,
    attempts: [...previous.attempts],
    reconciliations: [...previous.reconciliations, reconciliation]
  });
}

export function summarizeLiveCallLedger(ledgerCandidate: unknown): {
  attemptCount: number;
  dispatchCount: number;
  confirmedCostUsd: number;
  unresolvedPotentiallyBilledAttempts: number;
  unresolvedRequestBudgetUpperBoundUsd: number;
} {
  const ledger = LiveCallLedgerV1Schema.parse(ledgerCandidate);
  const conclusiveAttemptIds = new Set(ledger.reconciliations
    .filter((record) => [
      "confirmed-billed",
      "confirmed-not-billed",
      "administrative-full-bound"
    ].includes(record.result))
    .map((record) => record.attemptId));
  const completedCosts = ledger.attempts
    .filter((attempt) => attempt.billing.state === "confirmed-billed")
    .reduce((total, attempt) => total + (attempt.billing.estimatedCostUsd ?? 0), 0);
  const reconciledCosts = ledger.reconciliations
    .filter((record) => record.result === "confirmed-billed")
    .reduce((total, record) => total + (record.actualCostUsd ?? 0), 0);
  const unresolved = ledger.attempts.filter((attempt) =>
    attempt.billing.state === "potentially-billed" && !conclusiveAttemptIds.has(attempt.attemptId)
  );
  return {
    attemptCount: ledger.attempts.length,
    dispatchCount: ledger.attempts.reduce(
      (total, attempt) => total + attempt.networkDispatchCount,
      0,
    ),
    confirmedCostUsd: completedCosts + reconciledCosts,
    unresolvedPotentiallyBilledAttempts: unresolved.length,
    unresolvedRequestBudgetUpperBoundUsd: unresolved.reduce(
      (total, attempt) => total + (attempt.billing.requestBudgetUpperBoundUsd ?? 0),
      0,
    )
  };
}

export type { BillingReconciliation, LiveCallAttempt, LiveCallLedgerV1 };
