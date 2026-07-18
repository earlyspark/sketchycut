import {
  M61ExposureAuthorizationRecordSchema,
  M61LedgerSummarySchema,
  type M61ExposureAuthorizationDecision,
  type M61ExposureAuthorizationRecord,
  type M61GlobalExposureState,
  type M61LedgerSummary,
  type M6Store
} from "./contracts.js";
import type { LiveCallAttempt } from "../../interpretation/live-ledger.js";

const AUTHORIZATION_INCREMENT_MICROUSD = 5_000_000 as const;

function microusd(usd: number): number {
  return Math.max(0, Math.round(usd * 1_000_000));
}

export function summarizeM61Ledger(
  attempts: readonly LiveCallAttempt[],
): M61LedgerSummary {
  const runtimeOrigins = {
    localDevelopment: 0,
    deploymentPreview: 0,
    deploymentProduction: 0,
    testRecorded: 0,
    legacyUnattributed: 0
  };
  for (const attempt of attempts) {
    if (attempt.runtimeOrigin === "local-development") runtimeOrigins.localDevelopment += 1;
    else if (attempt.runtimeOrigin === "deployment-preview") runtimeOrigins.deploymentPreview += 1;
    else if (attempt.runtimeOrigin === "deployment-production") runtimeOrigins.deploymentProduction += 1;
    else if (attempt.runtimeOrigin === "test-recorded") runtimeOrigins.testRecorded += 1;
    else runtimeOrigins.legacyUnattributed += 1;
  }
  return M61LedgerSummarySchema.parse({
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

export type M61ExposureReview = {
  state: M61GlobalExposureState;
  ledgerSummary: M61LedgerSummary;
  proposedAuthorization: M61ExposureAuthorizationRecord;
};

export async function reviewM61ExposureIncrease(input: {
  store: M6Store;
  evidenceSha256: string;
  reviewNote: string;
  now?: Date;
  authorizationId?: string;
}): Promise<M61ExposureReview> {
  const state = await input.store.readGlobalExposureState();
  const attempts = await input.store.readLedgerAttempts();
  const ledgerSummary = summarizeM61Ledger(attempts);
  const proposedAuthorization = M61ExposureAuthorizationRecordSchema.parse({
    schemaVersion: "1.0",
    authorizationId: input.authorizationId ??
      `m61-exposure-${crypto.randomUUID().replaceAll("-", "")}`,
    priorAuthorizedCeilingMicrousd: state.authorizedCeilingMicrousd,
    increaseMicrousd: AUTHORIZATION_INCREMENT_MICROUSD,
    resultingAuthorizedCeilingMicrousd:
      state.authorizedCeilingMicrousd + AUTHORIZATION_INCREMENT_MICROUSD,
    priorReservedExposureMicrousd: state.reservedExposureMicrousd,
    priorAuthorizationVersion: state.authorizationVersion,
    ledgerSummary,
    evidenceSha256: input.evidenceSha256,
    authorizedAt: (input.now ?? new Date()).toISOString(),
    reviewNote: input.reviewNote
  });
  return { state, ledgerSummary, proposedAuthorization };
}

export async function applyReviewedM61ExposureIncrease(input: {
  store: M6Store;
  review: M61ExposureReview;
}): Promise<M61ExposureAuthorizationDecision> {
  return input.store.authorizeGlobalExposure({
    expectedState: input.review.state,
    record: input.review.proposedAuthorization
  });
}

export function exposureUsd(microusdValue: number): string {
  return (microusdValue / 1_000_000).toFixed(6);
}
