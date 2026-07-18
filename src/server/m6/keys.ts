import { M6_POLICY, type M6RouteKind } from "./policy.js";

function key(...parts: readonly string[]): string {
  return [M6_POLICY.namespace, ...parts].join(":");
}

export const m6Keys = {
  session: (sessionId: string) => key("session", sessionId),
  accessAttempt: (identifier: string) => key("access-attempt", identifier),
  routeRate: (route: M6RouteKind, identifier: string) => key("route-rate", route, identifier),
  generationClient: (identifier: string) => key("generation-client", identifier),
  cache: (digest: string) => key("semantic-cache", digest),
  cacheLock: (digest: string) => key("semantic-cache-lock", digest),
  project: (projectId: string) => key("project", projectId),
  ledgerAttempt: (attemptId: string) => key("ledger", "attempt", attemptId),
  ledgerClientRequest: (clientRequestId: string) => key("ledger", "client-request", clientRequestId),
  ledgerProviderRequest: (providerRequestId: string) => key("ledger", "provider-request", providerRequestId),
  ledgerAttemptIndex: () => key("ledger", "attempt-index"),
  globalExposure: () => key("exposure", "global"),
  exposureAuthorization: (authorizationId: string) => key("exposure", "authorization", authorizationId),
  exposureAuthorizationIndex: () => key("exposure", "authorization-index")
};
