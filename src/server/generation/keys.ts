import { GENERATION_POLICY, type ProtectedRouteKind } from "./policy.js";

function key(...parts: readonly string[]): string {
  return [GENERATION_POLICY.namespace, ...parts].join(":");
}

export const generationKeys = {
  session: (sessionId: string) => key("session", sessionId),
  accessAttempt: (identifier: string) => key("access-attempt", identifier),
  routeRate: (route: ProtectedRouteKind, identifier: string) => key("route-rate", route, identifier),
  generationClient: (identifier: string) => key("generation-client", identifier),
  cache: (digest: string) => key("semantic-cache", digest),
  cacheLock: (digest: string) => key("semantic-cache-lock", digest),
  project: (projectId: string) => key("project", projectId),
  ledgerAttempt: (attemptId: string) => key("ledger", "attempt", attemptId),
  ledgerClientRequest: (clientRequestId: string) => key("ledger", "client-request", clientRequestId),
  ledgerProviderRequest: (providerRequestId: string) => key("ledger", "provider-request", providerRequestId),
  ledgerAttemptIndex: () => key("ledger", "attempt-index"),
  ledgerBillingReconciliation: (reconciliationId: string) =>
    key("ledger", "billing-reconciliation", reconciliationId),
  ledgerBillingReconciliationIndex: () =>
    key("ledger", "billing-reconciliation-index"),
  ledgerBillingReconciliationSettlement: (attemptId: string) =>
    key("ledger", "billing-reconciliation-settlement", attemptId),
  globalExposure: () => key("exposure", "global"),
  exposureAuthorization: (authorizationId: string) => key("exposure", "authorization", authorizationId),
  exposureAuthorizationIndex: () => key("exposure", "authorization-index")
};
