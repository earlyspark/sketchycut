import {
  AccessAttemptDecisionSchema,
  GenerationReservationDecisionSchema,
  ExposureAuthorizationDecisionSchema,
  ExposureAuthorizationRecordSchema,
  GlobalExposureStateSchema,
  SessionRecordSchema,
  RouteRateDecisionSchema,
  type AccessAttemptDecision,
  type GenerationReservationDecision,
  type ExposureAuthorizationDecision,
  type ExposureAuthorizationRecord,
  type GlobalExposureState,
  type SessionRecord,
  type GenerationStore,
  type RouteRateDecision,
  type SetValueOptions
} from "./contracts.js";
import { LiveCallAttemptSchema, type LiveCallAttempt } from "../../interpretation/live-ledger.js";
import { GENERATION_POLICY } from "./policy.js";

type ExpiringValue = { value: string; expiresAtMs: number };
type AccessState = { count: number; windowStartedAtMs: number; blockedUntilMs: number };
type WindowState = { count: number; windowStartedAtMs: number };

export class MemoryGenerationStore implements GenerationStore {
  readonly #clock: () => number;
  readonly #values = new Map<string, ExpiringValue>();
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #sessionExpiry = new Map<string, number>();
  readonly #access = new Map<string, AccessState>();
  readonly #rates = new Map<string, WindowState>();
  readonly #generationClients = new Map<string, WindowState>();
  readonly #ledger: LiveCallAttempt[] = [];
  readonly #exposureAuthorizations: ExposureAuthorizationRecord[] = [];
  #globalExposure: GlobalExposureState;

  constructor(clock: () => number = Date.now) {
    this.#clock = clock;
    this.#globalExposure = GlobalExposureStateSchema.parse({
      schemaVersion: "1.0",
      authorizedCeilingMicrousd: GENERATION_POLICY.generation.initialGlobalExposureCeilingMicrousd,
      reservedExposureMicrousd: 0,
      authorizationVersion: 0
    });
  }

  #readValue(key: string): string | null {
    const current = this.#values.get(key);
    if (current === undefined) return null;
    if (current.expiresAtMs <= this.#clock()) {
      this.#values.delete(key);
      return null;
    }
    return current.value;
  }

  getValue(key: string): Promise<string | null> {
    return Promise.resolve(this.#readValue(key));
  }

  setValue(key: string, value: string, options: SetValueOptions): Promise<boolean> {
    if (options.onlyIfAbsent === true && this.#readValue(key) !== null) return Promise.resolve(false);
    this.#values.set(key, {
      value,
      expiresAtMs: this.#clock() + options.ttlSeconds * 1_000
    });
    return Promise.resolve(true);
  }

  compareAndSetValue(
    key: string,
    expectedValue: string,
    replacementValue: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (this.#readValue(key) !== expectedValue) return Promise.resolve(false);
    this.#values.set(key, {
      value: replacementValue,
      expiresAtMs: this.#clock() + ttlSeconds * 1_000
    });
    return Promise.resolve(true);
  }

  deleteIfValue(key: string, expectedValue: string): Promise<boolean> {
    const current = this.#readValue(key);
    if (current !== expectedValue) return Promise.resolve(false);
    return Promise.resolve(this.#values.delete(key));
  }

  createSession(recordCandidate: SessionRecord, ttlSeconds: number): Promise<void> {
    const record = SessionRecordSchema.parse(recordCandidate);
    this.#sessions.set(record.sessionId, structuredClone(record));
    this.#sessionExpiry.set(record.sessionId, this.#clock() + ttlSeconds * 1_000);
    return Promise.resolve();
  }

  ensureSession(
    recordCandidate: SessionRecord,
    ttlSeconds: number,
  ): Promise<SessionRecord> {
    const record = SessionRecordSchema.parse(recordCandidate);
    const existing = this.#readSession(record.sessionId);
    if (existing !== null) return Promise.resolve(existing);
    this.#sessions.set(record.sessionId, structuredClone(record));
    this.#sessionExpiry.set(record.sessionId, this.#clock() + ttlSeconds * 1_000);
    return Promise.resolve(structuredClone(record));
  }

  #readSession(sessionId: string): SessionRecord | null {
    const expiry = this.#sessionExpiry.get(sessionId);
    const record = this.#sessions.get(sessionId);
    if (expiry === undefined || record === undefined || expiry <= this.#clock()) {
      this.#sessionExpiry.delete(sessionId);
      this.#sessions.delete(sessionId);
      return null;
    }
    return SessionRecordSchema.parse(structuredClone(record));
  }

  readSession(sessionId: string): Promise<SessionRecord | null> {
    return Promise.resolve(this.#readSession(sessionId));
  }

  setLastProject(sessionId: string, projectId: string): Promise<boolean> {
    const record = this.#readSession(sessionId);
    if (record === null) return Promise.resolve(false);
    this.#sessions.set(sessionId, SessionRecordSchema.parse({ ...record, lastProjectId: projectId }));
    return Promise.resolve(true);
  }

  recordAccessAttempt(input: {
    key: string;
    verified: boolean;
    nowMs: number;
    windowMs: number;
    maximumAttempts: number;
    baseBackoffMs: number;
    maximumBackoffMs: number;
  }): Promise<AccessAttemptDecision> {
    let state = this.#access.get(input.key) ?? {
      count: 0,
      windowStartedAtMs: input.nowMs,
      blockedUntilMs: 0
    };
    if (input.nowMs - state.windowStartedAtMs >= input.windowMs) {
      state = { count: 0, windowStartedAtMs: input.nowMs, blockedUntilMs: 0 };
    }
    if (input.nowMs < state.blockedUntilMs) {
      return Promise.resolve(AccessAttemptDecisionSchema.parse({
        allowed: false,
        retryAfterMs: state.blockedUntilMs - input.nowMs,
        attemptCount: state.count
      }));
    }
    if (input.verified && state.count < input.maximumAttempts &&
        input.nowMs >= state.blockedUntilMs) {
      this.#access.delete(input.key);
      return Promise.resolve(AccessAttemptDecisionSchema.parse({ allowed: true, retryAfterMs: 0, attemptCount: state.count }));
    }
    if (!input.verified) {
      state.count += 1;
      const exponent = Math.max(0, Math.min(20, state.count - 1));
      const delay = Math.min(input.maximumBackoffMs, input.baseBackoffMs * 2 ** exponent);
      state.blockedUntilMs = Math.max(state.blockedUntilMs, input.nowMs + delay);
      if (state.count >= input.maximumAttempts) {
        state.blockedUntilMs = state.windowStartedAtMs + input.windowMs;
      }
      this.#access.set(input.key, state);
    }
    return Promise.resolve(AccessAttemptDecisionSchema.parse({
      allowed: false,
      retryAfterMs: Math.max(0, state.blockedUntilMs - input.nowMs),
      attemptCount: state.count
    }));
  }

  consumeRouteRate(input: {
    key: string;
    nowMs: number;
    windowMs: number;
    maximumRequests: number;
  }): Promise<RouteRateDecision> {
    let state = this.#rates.get(input.key) ?? { count: 0, windowStartedAtMs: input.nowMs };
    if (input.nowMs - state.windowStartedAtMs >= input.windowMs) {
      state = { count: 0, windowStartedAtMs: input.nowMs };
    }
    state.count += 1;
    this.#rates.set(input.key, state);
    const allowed = state.count <= input.maximumRequests;
    return Promise.resolve(RouteRateDecisionSchema.parse({
      allowed,
      retryAfterMs: allowed ? 0 : Math.max(0, state.windowStartedAtMs + input.windowMs - input.nowMs),
      requestCount: state.count
    }));
  }

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
  }): Promise<GenerationReservationDecision> {
    const session = this.#readSession(input.sessionId);
    if (session === null) return Promise.resolve(this.#reservation("session-missing", 0, 0, 0));
    if (session.expiresAtMs <= input.nowMs) {
      return Promise.resolve(this.#reservation("session-expired", 0, session.generationDispatches, session.reservedExposureMicrousd));
    }
    if (session.lastDispatchAtMs !== null &&
        input.nowMs - session.lastDispatchAtMs < input.minimumIntervalMs) {
      return Promise.resolve(this.#reservation(
        "interval",
        input.minimumIntervalMs - (input.nowMs - session.lastDispatchAtMs),
        session.generationDispatches,
        session.reservedExposureMicrousd,
      ));
    }
    if (session.generationDispatches >= input.maximumSessionDispatches) {
      return Promise.resolve(this.#reservation("session-quota", 0, session.generationDispatches, session.reservedExposureMicrousd));
    }
    if (session.reservedExposureMicrousd + input.requestExposureMicrousd >
        input.maximumSessionExposureMicrousd) {
      return Promise.resolve(this.#reservation("session-budget", 0, session.generationDispatches, session.reservedExposureMicrousd));
    }
    let client = this.#generationClients.get(input.clientKey) ?? {
      count: 0,
      windowStartedAtMs: input.nowMs
    };
    if (input.nowMs - client.windowStartedAtMs >= input.clientWindowMs) {
      client = { count: 0, windowStartedAtMs: input.nowMs };
    }
    if (client.count >= input.maximumClientDispatches) {
      return Promise.resolve(this.#reservation(
        "client-rate",
        Math.max(0, client.windowStartedAtMs + input.clientWindowMs - input.nowMs),
        session.generationDispatches,
        session.reservedExposureMicrousd,
      ));
    }
    if (this.#globalExposure.reservedExposureMicrousd + input.requestExposureMicrousd >
        this.#globalExposure.authorizedCeilingMicrousd) {
      return Promise.resolve(this.#reservation(
        "global-budget",
        0,
        session.generationDispatches,
        session.reservedExposureMicrousd,
      ));
    }
    const next = SessionRecordSchema.parse({
      ...session,
      generationDispatches: session.generationDispatches + 1,
      reservedExposureMicrousd: session.reservedExposureMicrousd + input.requestExposureMicrousd,
      lastDispatchAtMs: input.nowMs
    });
    this.#sessions.set(session.sessionId, next);
    client.count += 1;
    this.#generationClients.set(input.clientKey, client);
    this.#globalExposure = GlobalExposureStateSchema.parse({
      ...this.#globalExposure,
      reservedExposureMicrousd:
        this.#globalExposure.reservedExposureMicrousd + input.requestExposureMicrousd
    });
    return Promise.resolve(this.#reservation("reserved", 0, next.generationDispatches, next.reservedExposureMicrousd));
  }

  #reservation(
    reason: GenerationReservationDecision["reason"],
    retryAfterMs: number,
    generationDispatches: number,
    reservedExposureMicrousd: number,
  ): GenerationReservationDecision {
    return GenerationReservationDecisionSchema.parse({
      allowed: reason === "reserved",
      reason,
      retryAfterMs,
      generationDispatches,
      reservedExposureMicrousd,
      globalReservedExposureMicrousd: this.#globalExposure.reservedExposureMicrousd
    });
  }

  appendLedgerAttempt(attemptCandidate: LiveCallAttempt): Promise<void> {
    const attempt = LiveCallAttemptSchema.parse(attemptCandidate);
    if (this.#ledger.some((item) => item.attemptId === attempt.attemptId ||
      item.clientRequestId === attempt.clientRequestId ||
      (attempt.providerRequestId !== null && item.providerRequestId === attempt.providerRequestId))) {
      return Promise.reject(new Error("GENERATION_LEDGER_DUPLICATE_IDENTITY"));
    }
    this.#ledger.push(structuredClone(attempt));
    return Promise.resolve();
  }

  readLedgerAttempts(): Promise<LiveCallAttempt[]> {
    return Promise.resolve(
      this.#ledger.map((attempt) => LiveCallAttemptSchema.parse(structuredClone(attempt))),
    );
  }

  readGlobalExposureState(): Promise<GlobalExposureState> {
    return Promise.resolve(GlobalExposureStateSchema.parse(structuredClone(this.#globalExposure)));
  }

  authorizeGlobalExposure(input: {
    expectedState: GlobalExposureState;
    record: ExposureAuthorizationRecord;
  }): Promise<ExposureAuthorizationDecision> {
    const expected = GlobalExposureStateSchema.parse(input.expectedState);
    const record = ExposureAuthorizationRecordSchema.parse(input.record);
    if (this.#exposureAuthorizations.some((item) =>
      item.authorizationId === record.authorizationId)) {
      return Promise.resolve(ExposureAuthorizationDecisionSchema.parse({
        applied: false,
        reason: "duplicate-authorization",
        state: this.#globalExposure
      }));
    }
    const stale = JSON.stringify(expected) !== JSON.stringify(this.#globalExposure) ||
      record.priorAuthorizedCeilingMicrousd !== expected.authorizedCeilingMicrousd ||
      record.priorReservedExposureMicrousd !== expected.reservedExposureMicrousd ||
      record.priorAuthorizationVersion !== expected.authorizationVersion ||
      record.ledgerSummary.attemptCount !== this.#ledger.length;
    if (stale) {
      return Promise.resolve(ExposureAuthorizationDecisionSchema.parse({
        applied: false,
        reason: "stale-state",
        state: this.#globalExposure
      }));
    }
    this.#globalExposure = GlobalExposureStateSchema.parse({
      ...this.#globalExposure,
      authorizedCeilingMicrousd: record.resultingAuthorizedCeilingMicrousd,
      authorizationVersion: this.#globalExposure.authorizationVersion + 1
    });
    this.#exposureAuthorizations.push(structuredClone(record));
    return Promise.resolve(ExposureAuthorizationDecisionSchema.parse({
      applied: true,
      reason: "applied",
      state: this.#globalExposure
    }));
  }

  readExposureAuthorizations(): Promise<ExposureAuthorizationRecord[]> {
    return Promise.resolve(this.#exposureAuthorizations.map((record) =>
      ExposureAuthorizationRecordSchema.parse(structuredClone(record))));
  }
}
