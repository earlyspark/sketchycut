import {
  ExposureAuthorizationRecordSchema,
  LedgerSummarySchema,
  type ExposureAuthorizationDecision,
  type ExposureAuthorizationRecord,
  type GlobalExposureState,
  type BillingReconciliationGenerationStore,
  type GenerationStore,
  type LedgerSummary
} from "./contracts.js";
import {
  BillingReconciliationSchema,
  LiveCallAttemptSchema,
  type BillingReconciliation,
  type LiveCallAttempt
} from "../../interpretation/live-ledger.js";
import {
  assertBillingReconciliationAttribution,
  isConclusiveBillingReconciliation
} from "./billing-reconciliation.js";

function microusd(usd: number): number {
  return Math.max(0, Math.round(usd * 1_000_000));
}

export function summarizeLedger(
  attempts: readonly LiveCallAttempt[],
  reconciliations: readonly BillingReconciliation[] = [],
): LedgerSummary {
  const parsedAttempts = attempts.map((attempt) =>
    LiveCallAttemptSchema.parse(attempt));
  const parsedReconciliations = reconciliations.map((reconciliation) =>
    BillingReconciliationSchema.parse(reconciliation));
  const attemptById = new Map(
    parsedAttempts.map((attempt) => [attempt.attemptId, attempt]),
  );
  const reconciliationIds = new Set<string>();
  const settledByAttemptId = new Map<string, BillingReconciliation>();
  for (const reconciliation of parsedReconciliations) {
    if (reconciliationIds.has(reconciliation.reconciliationId)) {
      throw new Error("GENERATION_BILLING_RECONCILIATION_DUPLICATE_IDENTITY");
    }
    reconciliationIds.add(reconciliation.reconciliationId);
    const attempt = attemptById.get(reconciliation.attemptId);
    if (attempt === undefined) {
      throw new Error(
        "GENERATION_BILLING_RECONCILIATION_ATTEMPT_NOT_ELIGIBLE",
      );
    }
    assertBillingReconciliationAttribution({ attempt, reconciliation });
    if (isConclusiveBillingReconciliation(reconciliation)) {
      if (settledByAttemptId.has(reconciliation.attemptId)) {
        throw new Error(
          "GENERATION_BILLING_RECONCILIATION_ALREADY_CONCLUSIVE",
        );
      }
      settledByAttemptId.set(reconciliation.attemptId, reconciliation);
    }
  }
  const runtimeOrigins = {
    localDevelopment: 0,
    deploymentPreview: 0,
    deploymentProduction: 0,
    testRecorded: 0
  };
  for (const attempt of parsedAttempts) {
    if (attempt.runtimeOrigin === "local-development") runtimeOrigins.localDevelopment += 1;
    else if (attempt.runtimeOrigin === "deployment-preview") runtimeOrigins.deploymentPreview += 1;
    else if (attempt.runtimeOrigin === "deployment-production") runtimeOrigins.deploymentProduction += 1;
    else runtimeOrigins.testRecorded += 1;
  }
  const confirmedAttemptCostMicrousd = parsedAttempts.reduce(
    (total, attempt) =>
      total + (
        attempt.billing.state === "confirmed-billed" &&
        attempt.billing.estimatedCostUsd !== null
          ? microusd(attempt.billing.estimatedCostUsd)
          : 0
      ),
    0,
  );
  const confirmedReconciliationCostMicrousd = [
    ...settledByAttemptId.values()
  ].reduce(
    (total, reconciliation) =>
      total + (
        reconciliation.result === "confirmed-billed" &&
        reconciliation.actualCostUsd !== null
          ? microusd(reconciliation.actualCostUsd)
          : 0
      ),
    0,
  );
  return LedgerSummarySchema.parse({
    attemptCount: parsedAttempts.length,
    dispatchedAttemptCount: parsedAttempts.filter((attempt) =>
      attempt.dispatchState !== "not-dispatched").length,
    nonDispatchedAttemptCount: parsedAttempts.filter((attempt) =>
      attempt.dispatchState === "not-dispatched").length,
    confirmedEstimatedCostMicrousd:
      confirmedAttemptCostMicrousd +
      confirmedReconciliationCostMicrousd,
    unresolvedPotentiallyBilledExposureMicrousd:
      parsedAttempts.reduce((total, attempt) =>
        total + (
          attempt.billing.state === "potentially-billed" &&
          !settledByAttemptId.has(attempt.attemptId) &&
          attempt.billing.requestBudgetUpperBoundUsd !== null
            ? microusd(attempt.billing.requestBudgetUpperBoundUsd)
            : 0
        ), 0),
    runtimeOrigins
  });
}

export type ExposureReview = {
  state: GlobalExposureState;
  ledgerSummary: LedgerSummary;
  billingReconciliationCount: number;
  proposedAuthorization: ExposureAuthorizationRecord;
};

function billingReconciliationStore(
  store: GenerationStore,
): BillingReconciliationGenerationStore {
  const candidate = store as Partial<BillingReconciliationGenerationStore>;
  if (
    typeof candidate.appendBillingReconciliation !== "function" ||
    typeof candidate.readBillingReconciliations !== "function"
  ) {
    throw new Error("GENERATION_BILLING_RECONCILIATION_STORE_UNAVAILABLE");
  }
  return candidate as BillingReconciliationGenerationStore;
}

export async function reviewExposureIncrease(input: {
  store: GenerationStore;
  increaseMicrousd: number;
  evidenceSha256: string;
  reviewNote: string;
  now?: Date;
  authorizationId?: string;
}): Promise<ExposureReview> {
  const reconciliationStore = billingReconciliationStore(input.store);
  const [state, attempts, billingReconciliations] = await Promise.all([
    input.store.readGlobalExposureState(),
    input.store.readLedgerAttempts(),
    reconciliationStore.readBillingReconciliations()
  ]);
  const ledgerSummary = summarizeLedger(attempts, billingReconciliations);
  const proposedAuthorization = ExposureAuthorizationRecordSchema.parse({
    schemaVersion: "1.0",
    authorizationId: input.authorizationId ??
      `exposure-${crypto.randomUUID().replaceAll("-", "")}`,
    priorAuthorizedCeilingMicrousd: state.authorizedCeilingMicrousd,
    increaseMicrousd: input.increaseMicrousd,
    resultingAuthorizedCeilingMicrousd:
      state.authorizedCeilingMicrousd + input.increaseMicrousd,
    priorReservedExposureMicrousd: state.reservedExposureMicrousd,
    priorAuthorizationVersion: state.authorizationVersion,
    ledgerSummary,
    evidenceSha256: input.evidenceSha256,
    authorizedAt: (input.now ?? new Date()).toISOString(),
    reviewNote: input.reviewNote
  });
  return {
    state,
    ledgerSummary,
    billingReconciliationCount: billingReconciliations.length,
    proposedAuthorization
  };
}

export async function applyReviewedExposureIncrease(input: {
  store: GenerationStore;
  review: ExposureReview;
}): Promise<ExposureAuthorizationDecision> {
  return input.store.authorizeGlobalExposure({
    expectedState: input.review.state,
    expectedBillingReconciliationCount:
      input.review.billingReconciliationCount,
    record: input.review.proposedAuthorization
  });
}

export function exposureUsd(microusdValue: number): string {
  return (microusdValue / 1_000_000).toFixed(6);
}
