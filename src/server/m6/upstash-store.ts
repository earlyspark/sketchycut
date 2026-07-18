import { Redis } from "@upstash/redis";

import { LiveCallAttemptSchema, type LiveCallAttempt } from "../../interpretation/live-ledger.js";
import {
  AccessAttemptDecisionSchema,
  GenerationReservationDecisionSchema,
  M61ExposureAuthorizationDecisionSchema,
  M61ExposureAuthorizationRecordSchema,
  M61GlobalExposureStateSchema,
  M6SessionRecordSchema,
  RouteRateDecisionSchema,
  type AccessAttemptDecision,
  type GenerationReservationDecision,
  type M61ExposureAuthorizationDecision,
  type M61ExposureAuthorizationRecord,
  type M61GlobalExposureState,
  type M6SessionRecord,
  type M6Store,
  type RouteRateDecision,
  type SetValueOptions
} from "./contracts.js";
import { m6Keys } from "./keys.js";
import { M6_POLICY } from "./policy.js";

const DELETE_IF_VALUE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

const COMPARE_AND_SET_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0
`;

const ENSURE_SESSION_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  redis.call('HSET', KEYS[1],
    'schemaVersion', ARGV[1],
    'sessionId', ARGV[2],
    'issuedAtMs', ARGV[3],
    'expiresAtMs', ARGV[4],
    'generationDispatches', ARGV[5],
    'reservedExposureMicrousd', ARGV[6],
    'lastDispatchAtMs', ARGV[7],
    'lastProjectId', ARGV[8])
  redis.call('EXPIRE', KEYS[1], ARGV[9])
end
return redis.call('HGETALL', KEYS[1])
`;

const ACCESS_ATTEMPT_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local maximum = tonumber(ARGV[3])
local base = tonumber(ARGV[4])
local max_backoff = tonumber(ARGV[5])
local verified = ARGV[6] == '1'
local count = tonumber(redis.call('HGET', KEYS[1], 'count') or '0')
local started = tonumber(redis.call('HGET', KEYS[1], 'started') or tostring(now))
local blocked = tonumber(redis.call('HGET', KEYS[1], 'blocked') or '0')
if now - started >= window then
  count = 0
  started = now
  blocked = 0
end
if verified and count < maximum and now >= blocked then
  redis.call('DEL', KEYS[1])
  return {1, 0, count}
end
if not verified then
  count = count + 1
  local exponent = math.min(20, math.max(0, count - 1))
  local delay = math.min(max_backoff, base * (2 ^ exponent))
  blocked = math.max(blocked, now + delay)
  if count >= maximum then
    blocked = math.max(blocked, started + window)
  end
  redis.call('HSET', KEYS[1], 'count', count, 'started', started, 'blocked', blocked)
  redis.call('PEXPIRE', KEYS[1], window + max_backoff)
end
return {0, math.max(0, blocked - now), count}
`;

const ROUTE_RATE_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local maximum = tonumber(ARGV[3])
local count = tonumber(redis.call('HGET', KEYS[1], 'count') or '0')
local started = tonumber(redis.call('HGET', KEYS[1], 'started') or tostring(now))
if now - started >= window then
  count = 0
  started = now
end
count = count + 1
redis.call('HSET', KEYS[1], 'count', count, 'started', started)
redis.call('PEXPIRE', KEYS[1], window)
if count <= maximum then
  return {1, 0, count}
end
return {0, math.max(0, started + window - now), count}
`;

const RESERVE_GENERATION_SCRIPT = `
local now = tonumber(ARGV[1])
local minimum_interval = tonumber(ARGV[2])
local max_session = tonumber(ARGV[3])
local request_exposure = tonumber(ARGV[4])
local max_exposure = tonumber(ARGV[5])
local client_window = tonumber(ARGV[6])
local max_client = tonumber(ARGV[7])
local initial_global_ceiling = tonumber(ARGV[8])
redis.call('HSETNX', KEYS[3], 'schemaVersion', '1.0')
redis.call('HSETNX', KEYS[3], 'authorizedCeilingMicrousd', initial_global_ceiling)
redis.call('HSETNX', KEYS[3], 'reservedExposureMicrousd', 0)
redis.call('HSETNX', KEYS[3], 'authorizationVersion', 0)
local global_ceiling = tonumber(redis.call('HGET', KEYS[3], 'authorizedCeilingMicrousd') or tostring(initial_global_ceiling))
local global_exposure = tonumber(redis.call('HGET', KEYS[3], 'reservedExposureMicrousd') or '0')
if redis.call('EXISTS', KEYS[1]) == 0 then return {0, 1, 0, 0, 0, global_exposure} end
local expires = tonumber(redis.call('HGET', KEYS[1], 'expiresAtMs') or '0')
local count = tonumber(redis.call('HGET', KEYS[1], 'generationDispatches') or '0')
local exposure = tonumber(redis.call('HGET', KEYS[1], 'reservedExposureMicrousd') or '0')
local last = tonumber(redis.call('HGET', KEYS[1], 'lastDispatchAtMs') or '-1')
if expires <= now then return {0, 2, 0, count, exposure, global_exposure} end
if last >= 0 and now - last < minimum_interval then
  return {0, 3, minimum_interval - (now - last), count, exposure, global_exposure}
end
if count >= max_session then return {0, 4, 0, count, exposure, global_exposure} end
if exposure + request_exposure > max_exposure then return {0, 5, 0, count, exposure, global_exposure} end
local client_count = tonumber(redis.call('HGET', KEYS[2], 'count') or '0')
local client_started = tonumber(redis.call('HGET', KEYS[2], 'started') or tostring(now))
if now - client_started >= client_window then
  client_count = 0
  client_started = now
end
if client_count >= max_client then
  return {0, 6, math.max(0, client_started + client_window - now), count, exposure, global_exposure}
end
if global_exposure + request_exposure > global_ceiling then
  return {0, 7, 0, count, exposure, global_exposure}
end
count = count + 1
exposure = exposure + request_exposure
global_exposure = global_exposure + request_exposure
client_count = client_count + 1
redis.call('HSET', KEYS[1], 'generationDispatches', count, 'reservedExposureMicrousd', exposure, 'lastDispatchAtMs', now)
redis.call('HSET', KEYS[2], 'count', client_count, 'started', client_started)
redis.call('HSET', KEYS[3], 'reservedExposureMicrousd', global_exposure)
redis.call('PEXPIRE', KEYS[2], client_window)
return {1, 0, 0, count, exposure, global_exposure}
`;

const INITIALIZE_GLOBAL_EXPOSURE_SCRIPT = `
local initial_ceiling = tonumber(ARGV[1])
redis.call('HSETNX', KEYS[1], 'schemaVersion', '1.0')
redis.call('HSETNX', KEYS[1], 'authorizedCeilingMicrousd', initial_ceiling)
redis.call('HSETNX', KEYS[1], 'reservedExposureMicrousd', 0)
redis.call('HSETNX', KEYS[1], 'authorizationVersion', 0)
return {
  tonumber(redis.call('HGET', KEYS[1], 'authorizedCeilingMicrousd')),
  tonumber(redis.call('HGET', KEYS[1], 'reservedExposureMicrousd')),
  tonumber(redis.call('HGET', KEYS[1], 'authorizationVersion'))
}
`;

const AUTHORIZE_GLOBAL_EXPOSURE_SCRIPT = `
local initial_ceiling = tonumber(ARGV[1])
local expected_ceiling = tonumber(ARGV[2])
local expected_reserved = tonumber(ARGV[3])
local expected_version = tonumber(ARGV[4])
local expected_attempt_count = tonumber(ARGV[5])
local resulting_ceiling = tonumber(ARGV[6])
redis.call('HSETNX', KEYS[1], 'schemaVersion', '1.0')
redis.call('HSETNX', KEYS[1], 'authorizedCeilingMicrousd', initial_ceiling)
redis.call('HSETNX', KEYS[1], 'reservedExposureMicrousd', 0)
redis.call('HSETNX', KEYS[1], 'authorizationVersion', 0)
local ceiling = tonumber(redis.call('HGET', KEYS[1], 'authorizedCeilingMicrousd'))
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reservedExposureMicrousd'))
local version = tonumber(redis.call('HGET', KEYS[1], 'authorizationVersion'))
if redis.call('EXISTS', KEYS[2]) == 1 then return {0, 2, ceiling, reserved, version} end
if ceiling ~= expected_ceiling or reserved ~= expected_reserved or version ~= expected_version or
   redis.call('LLEN', KEYS[4]) ~= expected_attempt_count then
  return {0, 1, ceiling, reserved, version}
end
redis.call('SET', KEYS[2], ARGV[7])
redis.call('RPUSH', KEYS[3], ARGV[8])
redis.call('HSET', KEYS[1], 'authorizedCeilingMicrousd', resulting_ceiling,
  'authorizationVersion', version + 1)
return {1, 0, resulting_ceiling, reserved, version + 1}
`;

const APPEND_LEDGER_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
if ARGV[3] == '1' and redis.call('EXISTS', KEYS[4]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[3], ARGV[2])
if ARGV[3] == '1' then redis.call('SET', KEYS[4], ARGV[2]) end
redis.call('RPUSH', KEYS[2], ARGV[2])
return 1
`;

function numbers(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error("M6_STORE_RESULT_INVALID");
  const parsed = value.map((item) => Number(item));
  if (parsed.some((item) => !Number.isFinite(item))) throw new Error("M6_STORE_RESULT_INVALID");
  return parsed;
}

const RESERVATION_REASONS = [
  "reserved",
  "session-missing",
  "session-expired",
  "interval",
  "session-quota",
  "session-budget",
  "client-rate",
  "global-budget"
] as const;

export class UpstashM6Store implements M6Store {
  readonly #redis: Redis;

  constructor(input: { url: string; token: string; redis?: Redis }) {
    if (process.env.SKETCHYCUT_TEST_MODE === "1" && input.redis === undefined) {
      throw new Error("M61_TEST_UPSTASH_CLIENT_FORBIDDEN");
    }
    this.#redis = input.redis ?? new Redis({
      url: input.url,
      token: input.token,
      automaticDeserialization: false,
      enableTelemetry: false,
      retry: { retries: 0 }
    });
  }

  async getValue(key: string): Promise<string | null> {
    return this.#redis.get<string>(key);
  }

  async setValue(key: string, value: string, options: SetValueOptions): Promise<boolean> {
    const result = await this.#redis.set(
      key,
      value,
      options.onlyIfAbsent === true
        ? { ex: options.ttlSeconds, nx: true }
        : { ex: options.ttlSeconds },
    );
    return result === "OK";
  }

  async compareAndSetValue(
    key: string,
    expectedValue: string,
    replacementValue: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    return Number(await this.#redis.eval(
      COMPARE_AND_SET_SCRIPT,
      [key],
      [expectedValue, replacementValue, ttlSeconds],
    )) === 1;
  }

  async deleteIfValue(key: string, expectedValue: string): Promise<boolean> {
    return Number(await this.#redis.eval(DELETE_IF_VALUE_SCRIPT, [key], [expectedValue])) === 1;
  }

  async createSession(recordCandidate: M6SessionRecord, ttlSeconds: number): Promise<void> {
    const record = M6SessionRecordSchema.parse(recordCandidate);
    const key = m6Keys.session(record.sessionId);
    const transaction = this.#redis.multi();
    transaction.hset(key, {
      schemaVersion: record.schemaVersion,
      sessionId: record.sessionId,
      issuedAtMs: record.issuedAtMs,
      expiresAtMs: record.expiresAtMs,
      generationDispatches: record.generationDispatches,
      reservedExposureMicrousd: record.reservedExposureMicrousd,
      lastDispatchAtMs: record.lastDispatchAtMs ?? -1,
      lastProjectId: record.lastProjectId ?? ""
    });
    transaction.expire(key, ttlSeconds);
    await transaction.exec();
  }

  async ensureSession(
    recordCandidate: M6SessionRecord,
    ttlSeconds: number,
  ): Promise<M6SessionRecord> {
    const record = M6SessionRecordSchema.parse(recordCandidate);
    const reply: unknown = await this.#redis.eval(
      ENSURE_SESSION_SCRIPT,
      [m6Keys.session(record.sessionId)],
      [
        record.schemaVersion,
        record.sessionId,
        record.issuedAtMs,
        record.expiresAtMs,
        record.generationDispatches,
        record.reservedExposureMicrousd,
        record.lastDispatchAtMs ?? -1,
        record.lastProjectId ?? "",
        ttlSeconds
      ],
    );
    return this.#parseSessionReply(reply);
  }

  #parseSessionReply(reply: unknown): M6SessionRecord {
    if (!Array.isArray(reply) || reply.length === 0) {
      throw new Error("M6_UPSTASH_HGETALL_SHAPE_UNEXPECTED");
    }
    const raw: Record<string, string> = {};
    for (let index = 0; index + 1 < reply.length; index += 2) {
      raw[String(reply[index])] = String(reply[index + 1]);
    }
    return M6SessionRecordSchema.parse({
      schemaVersion: raw.schemaVersion,
      sessionId: raw.sessionId,
      issuedAtMs: Number(raw.issuedAtMs),
      expiresAtMs: Number(raw.expiresAtMs),
      generationDispatches: Number(raw.generationDispatches),
      reservedExposureMicrousd: Number(raw.reservedExposureMicrousd),
      lastDispatchAtMs: Number(raw.lastDispatchAtMs) < 0 ? null : Number(raw.lastDispatchAtMs),
      lastProjectId: raw.lastProjectId === "" ? null : raw.lastProjectId
    });
  }

  async readSession(sessionId: string): Promise<M6SessionRecord | null> {
    // With automaticDeserialization disabled, the REST client returns HGETALL
    // replies as the flat [field, value, ...] array, not a field/value object.
    const reply: unknown = await this.#redis.hgetall(m6Keys.session(sessionId));
    if (reply === null) return null;
    if (!Array.isArray(reply)) throw new Error("M6_UPSTASH_HGETALL_SHAPE_UNEXPECTED");
    if (reply.length === 0) return null;
    return this.#parseSessionReply(reply);
  }

  async setLastProject(sessionId: string, projectId: string): Promise<boolean> {
    const key = m6Keys.session(sessionId);
    if (await this.#redis.exists(key) !== 1) return false;
    await this.#redis.hset(key, { lastProjectId: projectId });
    return true;
  }

  async recordAccessAttempt(input: {
    key: string;
    verified: boolean;
    nowMs: number;
    windowMs: number;
    maximumAttempts: number;
    baseBackoffMs: number;
    maximumBackoffMs: number;
  }): Promise<AccessAttemptDecision> {
    const result = numbers(await this.#redis.eval(ACCESS_ATTEMPT_SCRIPT, [input.key], [
      input.nowMs,
      input.windowMs,
      input.maximumAttempts,
      input.baseBackoffMs,
      input.maximumBackoffMs,
      input.verified ? "1" : "0"
    ]), 3);
    return AccessAttemptDecisionSchema.parse({
      allowed: result[0] === 1,
      retryAfterMs: result[1],
      attemptCount: result[2]
    });
  }

  async consumeRouteRate(input: {
    key: string;
    nowMs: number;
    windowMs: number;
    maximumRequests: number;
  }): Promise<RouteRateDecision> {
    const result = numbers(await this.#redis.eval(ROUTE_RATE_SCRIPT, [input.key], [
      input.nowMs,
      input.windowMs,
      input.maximumRequests
    ]), 3);
    return RouteRateDecisionSchema.parse({
      allowed: result[0] === 1,
      retryAfterMs: result[1],
      requestCount: result[2]
    });
  }

  async reserveGeneration(input: {
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
    const result = numbers(await this.#redis.eval(
      RESERVE_GENERATION_SCRIPT,
      [m6Keys.session(input.sessionId), input.clientKey, m6Keys.globalExposure()],
      [
        input.nowMs,
        input.minimumIntervalMs,
        input.maximumSessionDispatches,
        input.requestExposureMicrousd,
        input.maximumSessionExposureMicrousd,
        input.clientWindowMs,
        input.maximumClientDispatches,
        M6_POLICY.generation.initialGlobalExposureCeilingMicrousd
      ],
    ), 6);
    return GenerationReservationDecisionSchema.parse({
      allowed: result[0] === 1,
      reason: RESERVATION_REASONS[result[1] ?? -1],
      retryAfterMs: result[2],
      generationDispatches: result[3],
      reservedExposureMicrousd: result[4],
      globalReservedExposureMicrousd: result[5]
    });
  }

  async appendLedgerAttempt(attemptCandidate: LiveCallAttempt): Promise<void> {
    const attempt = LiveCallAttemptSchema.parse(attemptCandidate);
    const serialized = JSON.stringify(attempt);
    const providerKey = m6Keys.ledgerProviderRequest(attempt.providerRequestId ?? "none");
    const result = Number(await this.#redis.eval(
      APPEND_LEDGER_SCRIPT,
      [
        m6Keys.ledgerAttempt(attempt.attemptId),
        m6Keys.ledgerAttemptIndex(),
        m6Keys.ledgerClientRequest(attempt.clientRequestId),
        providerKey
      ],
      [serialized, attempt.attemptId, attempt.providerRequestId === null ? "0" : "1"],
    ));
    if (result !== 1) throw new Error("M6_LEDGER_DUPLICATE_IDENTITY");
  }

  async readLedgerAttempts(): Promise<LiveCallAttempt[]> {
    const ids = await this.#redis.lrange(m6Keys.ledgerAttemptIndex(), 0, -1);
    if (ids.length === 0) return [];
    const values = await this.#redis.mget<(string | null)[]>(
      ids.map((id) => m6Keys.ledgerAttempt(id)),
    );
    if (values.some((value) => value === null)) throw new Error("M6_LEDGER_INDEX_INCOMPLETE");
    return values.map((value) => LiveCallAttemptSchema.parse(JSON.parse(value!) as unknown));
  }

  async readGlobalExposureState(): Promise<M61GlobalExposureState> {
    const result = numbers(await this.#redis.eval(
      INITIALIZE_GLOBAL_EXPOSURE_SCRIPT,
      [m6Keys.globalExposure()],
      [M6_POLICY.generation.initialGlobalExposureCeilingMicrousd],
    ), 3);
    return M61GlobalExposureStateSchema.parse({
      schemaVersion: "1.0",
      authorizedCeilingMicrousd: result[0],
      reservedExposureMicrousd: result[1],
      authorizationVersion: result[2]
    });
  }

  async authorizeGlobalExposure(input: {
    expectedState: M61GlobalExposureState;
    record: M61ExposureAuthorizationRecord;
  }): Promise<M61ExposureAuthorizationDecision> {
    const expected = M61GlobalExposureStateSchema.parse(input.expectedState);
    const record = M61ExposureAuthorizationRecordSchema.parse(input.record);
    const result = numbers(await this.#redis.eval(
      AUTHORIZE_GLOBAL_EXPOSURE_SCRIPT,
      [
        m6Keys.globalExposure(),
        m6Keys.exposureAuthorization(record.authorizationId),
        m6Keys.exposureAuthorizationIndex(),
        m6Keys.ledgerAttemptIndex()
      ],
      [
        M6_POLICY.generation.initialGlobalExposureCeilingMicrousd,
        expected.authorizedCeilingMicrousd,
        expected.reservedExposureMicrousd,
        expected.authorizationVersion,
        record.ledgerSummary.attemptCount,
        record.resultingAuthorizedCeilingMicrousd,
        JSON.stringify(record),
        record.authorizationId
      ],
    ), 5);
    const reasons = ["applied", "stale-state", "duplicate-authorization"] as const;
    return M61ExposureAuthorizationDecisionSchema.parse({
      applied: result[0] === 1,
      reason: reasons[result[1] ?? -1],
      state: {
        schemaVersion: "1.0",
        authorizedCeilingMicrousd: result[2],
        reservedExposureMicrousd: result[3],
        authorizationVersion: result[4]
      }
    });
  }

  async readExposureAuthorizations(): Promise<M61ExposureAuthorizationRecord[]> {
    const ids = await this.#redis.lrange(m6Keys.exposureAuthorizationIndex(), 0, -1);
    if (ids.length === 0) return [];
    const values = await this.#redis.mget<(string | null)[]>(
      ids.map((id) => m6Keys.exposureAuthorization(id)),
    );
    if (values.some((value) => value === null)) {
      throw new Error("M61_EXPOSURE_AUTHORIZATION_INDEX_INCOMPLETE");
    }
    return values.map((value) =>
      M61ExposureAuthorizationRecordSchema.parse(JSON.parse(value!) as unknown));
  }
}
