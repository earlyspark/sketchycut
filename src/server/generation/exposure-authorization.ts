import {
  ExposureAuthorizationRecordSchema,
  LedgerSummarySchema,
  type ExposureAuthorizationDecision,
  type ExposureAuthorizationRecord,
  type GlobalExposureState,
  type LedgerSummary,
  type GenerationStore
} from "./contracts.js";
import type { LiveCallAttempt } from "../../interpretation/live-ledger.js";

function microusd(usd: number): number {
  return Math.max(0, Math.round(usd * 1_000_000));
}

export function summarizeLedger(
  attempts: readonly LiveCallAttempt[],
): LedgerSummary {
  const runtimeOrigins = {
    localDevelopment: 0,
    deploymentPreview: 0,
    deploymentProduction: 0,
    testRecorded: 0
  };
  for (const attempt of attempts) {
    if (attempt.runtimeOrigin === "local-development") runtimeOrigins.localDevelopment += 1;
    else if (attempt.runtimeOrigin === "deployment-preview") runtimeOrigins.deploymentPreview += 1;
    else if (attempt.runtimeOrigin === "deployment-production") runtimeOrigins.deploymentProduction += 1;
    else runtimeOrigins.testRecorded += 1;
  }
  return LedgerSummarySchema.parse({
    attemptCount: attempts.length,
    dispatchedAttemptCount: attempts.filter((attempt) =>
      attempt.dispatchState !== "not-dispatched").length,
    nonDispatchedAttemptCount: attempts.filter((attempt) =>
      attempt.dispatchState === "not-dispatched").length,
    confirmedEstimatedCostMicrousd: attempts.reduce((total, attempt) =>
      total + (attempt.billing.state === "confirmed-billed" &&
        attempt.billing.estimatedCostUsd !== null
        ? microusd(attempt.billing.estimatedCostUsd)
        : 0), 0),
    unresolvedPotentiallyBilledExposureMicrousd: attempts.reduce((total, attempt) =>
      total + (attempt.billing.state === "potentially-billed" &&
        attempt.billing.requestBudgetUpperBoundUsd !== null
        ? microusd(attempt.billing.requestBudgetUpperBoundUsd)
        : 0), 0),
    runtimeOrigins
  });
}

export type ExposureReview = {
  state: GlobalExposureState;
  ledgerSummary: LedgerSummary;
  proposedAuthorization: ExposureAuthorizationRecord;
};

export async function reviewExposureIncrease(input: {
  store: GenerationStore;
  increaseMicrousd: number;
  evidenceSha256: string;
  reviewNote: string;
  now?: Date;
  authorizationId?: string;
}): Promise<ExposureReview> {
  const state = await input.store.readGlobalExposureState();
  const attempts = await input.store.readLedgerAttempts();
  const ledgerSummary = summarizeLedger(attempts);
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
  return { state, ledgerSummary, proposedAuthorization };
}

export async function applyReviewedExposureIncrease(input: {
  store: GenerationStore;
  review: ExposureReview;
}): Promise<ExposureAuthorizationDecision> {
  return input.store.authorizeGlobalExposure({
    expectedState: input.review.state,
    record: input.review.proposedAuthorization
  });
}

export function exposureUsd(microusdValue: number): string {
  return (microusdValue / 1_000_000).toFixed(6);
}
