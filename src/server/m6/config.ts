import { createHash } from "node:crypto";

import { z } from "zod";

const Base64UrlSecretSchema = z.string().regex(/^[A-Za-z0-9_-]+$/).transform((value, context) => {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < 32) {
    context.addIssue({ code: "custom", message: "Secret must contain at least 32 random bytes." });
    return z.NEVER;
  }
  return decoded;
});

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

export type M6SecurityConfig = {
  accessCodeDigest: Buffer;
  signingSecret: Buffer;
  secureCookies: boolean;
};

export type M6RuntimeMode = "memory" | "upstash";

export type M6RuntimeConfig = {
  security: M6SecurityConfig;
  storeMode: M6RuntimeMode;
  upstash: { url: string; token: string } | null;
  generationEnabled: boolean;
  generationMode: "replay" | "live";
  generationExperience: "live" | "replay-fixture";
  liveTransport: {
    apiKey: string;
    interpretationPrompt: string;
  } | null;
};

function requiredEnvironment(name: string, environment: NodeJS.ProcessEnv): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) throw new Error(`M6_CONFIG_${name}_MISSING`);
  return value;
}

function requiredEnvironmentAlias(
  names: readonly string[],
  missingName: string,
  environment: NodeJS.ProcessEnv,
): string {
  for (const name of names) {
    const value = environment[name];
    if (value !== undefined && value.length > 0) return value;
  }
  throw new Error(`M6_CONFIG_${missingName}_MISSING`);
}

export function readM6UpstashConfig(
  environment: NodeJS.ProcessEnv = process.env,
): { url: string; token: string } {
  return {
    url: requiredEnvironmentAlias(
      ["UPSTASH_REDIS_REST_URL", "sketchycut_KV_REST_API_URL", "KV_REST_API_URL"],
      "UPSTASH_REDIS_REST_URL",
      environment,
    ),
    token: requiredEnvironmentAlias(
      ["UPSTASH_REDIS_REST_TOKEN", "sketchycut_KV_REST_API_TOKEN", "KV_REST_API_TOKEN"],
      "UPSTASH_REDIS_REST_TOKEN",
      environment,
    )
  };
}

export function readM6RuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): M6RuntimeConfig {
  const accessCodeDigest = Buffer.from(
    Sha256HexSchema.parse(requiredEnvironment("SKETCHYCUT_ACCESS_CODE_SHA256", environment)),
    "hex",
  );
  const signingSecret = Base64UrlSecretSchema.parse(
    requiredEnvironment("SKETCHYCUT_SESSION_SIGNING_SECRET", environment),
  );
  const requestedMode = environment.SKETCHYCUT_M6_STORE ?? "upstash";
  if (requestedMode !== "memory" && requestedMode !== "upstash") {
    throw new Error("M6_CONFIG_STORE_MODE_INVALID");
  }
  if (requestedMode === "memory" && environment.NODE_ENV === "production" &&
      environment.SKETCHYCUT_TEST_MODE !== "1") {
    throw new Error("M6_CONFIG_MEMORY_STORE_FORBIDDEN_IN_PRODUCTION");
  }
  const upstash = requestedMode === "upstash" ? readM6UpstashConfig(environment) : null;
  const generationMode = environment.SKETCHYCUT_GENERATION_MODE ?? "live";
  if (generationMode !== "replay" && generationMode !== "live") {
    throw new Error("M6_CONFIG_GENERATION_MODE_INVALID");
  }
  if (generationMode === "replay" && environment.SKETCHYCUT_FIXTURE_MODE !== "1" &&
      environment.NODE_ENV !== "test") {
    throw new Error("M61_CONFIG_REPLAY_FIXTURE_GUARD_MISSING");
  }
  const generationEnabled = environment.SKETCHYCUT_GENERATION_ENABLED === "1";
  let liveTransport: M6RuntimeConfig["liveTransport"] = null;
  if (generationEnabled && generationMode === "live") {
    liveTransport = {
      apiKey: requiredEnvironment("OPENAI_API_KEY", environment),
      interpretationPrompt: requiredEnvironment("SKETCHYCUT_INTERPRETATION_PROMPT", environment)
    };
  }
  return {
    security: {
      accessCodeDigest,
      signingSecret,
      secureCookies: environment.NODE_ENV === "production" || environment.VERCEL === "1"
    },
    storeMode: requestedMode,
    upstash,
    generationEnabled,
    generationMode,
    generationExperience: generationMode === "live" ? "live" : "replay-fixture",
    liveTransport
  };
}

export function accessCodeDigestHex(accessCode: string): string {
  return createHash("sha256").update(accessCode, "utf8").digest("hex");
}
