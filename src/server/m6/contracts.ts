import { z } from "zod";

import { Sha256Schema, StableIdSchema } from "../../domain/contracts.js";
import type { LiveCallAttempt } from "../../interpretation/live-ledger.js";

export const M6SessionRecordSchema = z.object({
  schemaVersion: z.literal("1.0"),
  sessionId: StableIdSchema,
  issuedAtMs: z.number().int().nonnegative(),
  expiresAtMs: z.number().int().positive(),
  generationDispatches: z.number().int().nonnegative(),
  reservedExposureMicrousd: z.number().int().nonnegative(),
  lastDispatchAtMs: z.number().int().nonnegative().nullable(),
  lastProjectId: StableIdSchema.nullable()
}).strict().superRefine((value, context) => {
  if (value.expiresAtMs <= value.issuedAtMs) {
    context.addIssue({ code: "custom", message: "Session expiry must follow issuance." });
  }
});

export const M6SessionTokenPayloadSchema = z.object({
  v: z.literal(1),
  sid: StableIdSchema,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive()
}).strict();

export const AccessAttemptDecisionSchema = z.object({
  allowed: z.boolean(),
  retryAfterMs: z.number().int().nonnegative(),
  attemptCount: z.number().int().nonnegative()
}).strict();

export const RouteRateDecisionSchema = z.object({
  allowed: z.boolean(),
  retryAfterMs: z.number().int().nonnegative(),
  requestCount: z.number().int().nonnegative()
}).strict();

export const GenerationReservationDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.enum(["reserved", "session-missing", "session-expired", "interval", "session-quota", "session-budget", "client-rate", "global-budget"]),
  retryAfterMs: z.number().int().nonnegative(),
  generationDispatches: z.number().int().nonnegative(),
  reservedExposureMicrousd: z.number().int().nonnegative(),
  globalReservedExposureMicrousd: z.number().int().nonnegative()
}).strict();

export const M61GlobalExposureStateSchema = z.object({
  schemaVersion: z.literal("1.0"),
  authorizedCeilingMicrousd: z.number().int().nonnegative(),
  reservedExposureMicrousd: z.number().int().nonnegative(),
  authorizationVersion: z.number().int().nonnegative()
}).strict().superRefine((value, context) => {
  if (value.reservedExposureMicrousd > value.authorizedCeilingMicrousd) {
    context.addIssue({
      code: "custom",
      message: "Reserved exposure cannot exceed the authorized global ceiling."
    });
  }
});

export const M61LedgerSummarySchema = z.object({
  attemptCount: z.number().int().nonnegative(),
  dispatchedAttemptCount: z.number().int().nonnegative(),
  nonDispatchedAttemptCount: z.number().int().nonnegative(),
  confirmedEstimatedCostMicrousd: z.number().int().nonnegative(),
  unresolvedPotentiallyBilledExposureMicrousd: z.number().int().nonnegative(),
  runtimeOrigins: z.object({
    localDevelopment: z.number().int().nonnegative(),
    deploymentPreview: z.number().int().nonnegative(),
    deploymentProduction: z.number().int().nonnegative(),
    testRecorded: z.number().int().nonnegative(),
    legacyUnattributed: z.number().int().nonnegative()
  }).strict()
}).strict().superRefine((value, context) => {
  if (value.dispatchedAttemptCount + value.nonDispatchedAttemptCount !== value.attemptCount) {
    context.addIssue({ code: "custom", message: "Attempt summary counts must balance." });
  }
  const originCount = Object.values(value.runtimeOrigins).reduce((sum, count) => sum + count, 0);
  if (originCount !== value.attemptCount) {
    context.addIssue({ code: "custom", message: "Runtime-origin summary counts must balance." });
  }
});

export const M61ExposureAuthorizationRecordSchema = z.object({
  schemaVersion: z.literal("1.0"),
  authorizationId: StableIdSchema,
  priorAuthorizedCeilingMicrousd: z.number().int().nonnegative(),
  increaseMicrousd: z.literal(5_000_000),
  resultingAuthorizedCeilingMicrousd: z.number().int().nonnegative(),
  priorReservedExposureMicrousd: z.number().int().nonnegative(),
  priorAuthorizationVersion: z.number().int().nonnegative(),
  ledgerSummary: M61LedgerSummarySchema,
  evidenceSha256: Sha256Schema,
  authorizedAt: z.iso.datetime({ offset: true }),
  reviewNote: z.string().trim().min(1).max(500)
}).strict().superRefine((value, context) => {
  if (value.priorAuthorizedCeilingMicrousd + value.increaseMicrousd !==
      value.resultingAuthorizedCeilingMicrousd) {
    context.addIssue({ code: "custom", message: "Authorization ceiling arithmetic is invalid." });
  }
  if (value.ledgerSummary.attemptCount < 0) {
    context.addIssue({ code: "custom", message: "Ledger summary is invalid." });
  }
});

export const M61ExposureAuthorizationDecisionSchema = z.object({
  applied: z.boolean(),
  reason: z.enum(["applied", "stale-state", "duplicate-authorization"]),
  state: M61GlobalExposureStateSchema
}).strict();

export type M6SessionRecord = z.infer<typeof M6SessionRecordSchema>;
export type M6SessionTokenPayload = z.infer<typeof M6SessionTokenPayloadSchema>;
export type AccessAttemptDecision = z.infer<typeof AccessAttemptDecisionSchema>;
export type RouteRateDecision = z.infer<typeof RouteRateDecisionSchema>;
export type GenerationReservationDecision = z.infer<typeof GenerationReservationDecisionSchema>;
export type M61GlobalExposureState = z.infer<typeof M61GlobalExposureStateSchema>;
export type M61LedgerSummary = z.infer<typeof M61LedgerSummarySchema>;
export type M61ExposureAuthorizationRecord = z.infer<typeof M61ExposureAuthorizationRecordSchema>;
export type M61ExposureAuthorizationDecision = z.infer<typeof M61ExposureAuthorizationDecisionSchema>;

export type SetValueOptions = {
  ttlSeconds: number;
  onlyIfAbsent?: boolean;
};

export type M6Store = {
  getValue(key: string): Promise<string | null>;
  setValue(key: string, value: string, options: SetValueOptions): Promise<boolean>;
  compareAndSetValue(
    key: string,
    expectedValue: string,
    replacementValue: string,
    ttlSeconds: number,
  ): Promise<boolean>;
  deleteIfValue(key: string, expectedValue: string): Promise<boolean>;
  createSession(record: M6SessionRecord, ttlSeconds: number): Promise<void>;
  ensureSession(record: M6SessionRecord, ttlSeconds: number): Promise<M6SessionRecord>;
  readSession(sessionId: string): Promise<M6SessionRecord | null>;
  setLastProject(sessionId: string, projectId: string): Promise<boolean>;
  recordAccessAttempt(input: {
    key: string;
    verified: boolean;
    nowMs: number;
    windowMs: number;
    maximumAttempts: number;
    baseBackoffMs: number;
    maximumBackoffMs: number;
  }): Promise<AccessAttemptDecision>;
  consumeRouteRate(input: {
    key: string;
    nowMs: number;
    windowMs: number;
    maximumRequests: number;
  }): Promise<RouteRateDecision>;
  reserveGeneration(input: {
    sessionId: string;
    clientKey: string;
    nowMs: number;
    minimumIntervalMs: number;
    maximumSessionDispatches: number;
    requestExposureMicrousd: number;
    maximumSessionExposureMicrousd: number;
    clientWindowMs: number;
    maximumClientDispatches: number;
  }): Promise<GenerationReservationDecision>;
  appendLedgerAttempt(attempt: LiveCallAttempt): Promise<void>;
  readLedgerAttempts(): Promise<LiveCallAttempt[]>;
  readGlobalExposureState(): Promise<M61GlobalExposureState>;
  authorizeGlobalExposure(input: {
    expectedState: M61GlobalExposureState;
    record: M61ExposureAuthorizationRecord;
  }): Promise<M61ExposureAuthorizationDecision>;
  readExposureAuthorizations(): Promise<M61ExposureAuthorizationRecord[]>;
};

export const M6StoredCacheEnvelopeSchema = z.object({
  schemaVersion: z.literal("1.0"),
  requestDigest: Sha256Schema,
  value: z.unknown()
}).strict();
