import {
  BillingReconciliationSchema,
  LiveCallAttemptSchema,
  type BillingReconciliation,
  type LiveCallAttempt
} from "../../interpretation/live-ledger.js";

export function isConclusiveBillingReconciliation(
  reconciliation: BillingReconciliation,
): boolean {
  const parsed = BillingReconciliationSchema.parse(reconciliation);
  return parsed.result === "confirmed-billed" ||
    parsed.result === "confirmed-not-billed" ||
    parsed.result === "administrative-full-bound";
}

export function assertBillingReconciliationAttribution(input: {
  attempt: LiveCallAttempt;
  reconciliation: BillingReconciliation;
}): void {
  const attempt = LiveCallAttemptSchema.parse(input.attempt);
  const reconciliation = BillingReconciliationSchema.parse(
    input.reconciliation,
  );
  if (
    attempt.attemptId !== reconciliation.attemptId ||
    attempt.billing.state !== "potentially-billed"
  ) {
    throw new Error(
      "GENERATION_BILLING_RECONCILIATION_ATTEMPT_NOT_ELIGIBLE",
    );
  }
  const providerConclusive =
    reconciliation.result === "confirmed-billed" ||
    reconciliation.result === "confirmed-not-billed";
  if (
    providerConclusive &&
    attempt.providerRequestId === null &&
    reconciliation.source !== "provider-support"
  ) {
    throw new Error(
      "GENERATION_BILLING_RECONCILIATION_CONCLUSIVE_ATTRIBUTION_REQUIRED",
    );
  }
  if (
    reconciliation.result === "administrative-full-bound" &&
    attempt.billing.requestBudgetUpperBoundUsd === null
  ) {
    throw new Error(
      "GENERATION_BILLING_RECONCILIATION_ADMINISTRATIVE_BOUND_MISSING",
    );
  }
}
