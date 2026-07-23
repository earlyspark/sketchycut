export const GENERATION_POLICY = {
  // The semantic-inventory cutover changed the strict durable ledger/cache/project
  // contracts. Keep older bytes untouched and invisible rather than teaching the
  // current readers historical shapes.
  namespace: "sketchycut:current:v2",
  sessionTtlSeconds: 60 * 60,
  projectTtlSeconds: 24 * 60 * 60,
  cacheTtlSeconds: 24 * 60 * 60,
  singleflightLockTtlMs: 45_000,
  access: {
    windowMs: 30_000,
    maximumAttempts: 6,
    baseBackoffMs: 500,
    maximumBackoffMs: 8_000
  },
  routeRates: {
    upload: { windowMs: 60_000, maximumRequests: 12 },
    generation: { windowMs: 60_000, maximumRequests: 6 },
    project: { windowMs: 60_000, maximumRequests: 30 },
    export: { windowMs: 60_000, maximumRequests: 8 }
  },
  generation: {
    minimumIntervalMs: 8_000,
    maximumDispatchesPerSession: 4,
    maximumDispatchesPerClientPerHour: 12,
    clientWindowMs: 60 * 60 * 1_000,
    requestBudgetUpperBoundMicrousd: 650_000,
    maximumSessionExposureMicrousd: 2_600_000,
    initialGlobalExposureCeilingMicrousd: 5_000_000
  },
  image: {
    // Vercel Functions admit at most a 4.5 MB request or response payload.
    // Leave headroom for platform framing and JSON/base64 overhead.
    maximumUploadRequestBytes: 4_250_000,
    maximumGenerationRequestBytes: 4_250_000,
    maximumNormalizedBytes: 960 * 1024,
    maximumPixels: 4_000_000,
    maximumEdge: 2_048,
    normalizationPolicyVersion: "reference-normalization-v2",
    maximumReferences: 3
  }
} as const;

export type ProtectedRouteKind = keyof typeof GENERATION_POLICY.routeRates;
