import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import { z } from "zod";

import { hashCanonical, sha256 } from "../src/domain/hash.js";
import { CAPABILITY_CATALOG_V1 } from "../src/interpretation/capability-catalog.js";
import { INTENT_GRAPH_V1_JSON_SCHEMA } from "../src/interpretation/intent-graph.js";
import { LiveCallAttemptSchema } from "../src/interpretation/live-ledger.js";
import {
  M5_CAPABILITY_CATALOG_ID,
  M5_INTENT_SCHEMA_VERSION
} from "../src/interpretation/semantic-request.js";
import { readM6UpstashConfig } from "../src/server/m6/config.js";
import {
  M6_OPENAI_MAX_RETRIES,
  M6_OPENAI_MODEL,
  M6_PROMPT_VERSION,
  M6_TERRA_PRICE
} from "../src/server/m6/openai-transport.js";
import { UpstashM6Store } from "../src/server/m6/upstash-store.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const evidencePath = path.join(
  repositoryRoot,
  "docs/evidence/m06-1/live/live-evaluation.json",
);

const ManualEvidenceSchema = z.object({
  builderObservation: z.object({
    localBrowserGenerationCompleted: z.literal(true),
    compiledWorkspaceObserved: z.literal(true),
    resultQuality: z.literal("technically-complete-but-below-product-vision"),
    followUpMilestone: z.literal("M6.1.1"),
    physicalFabricationPerformed: z.literal(false)
  }).strict(),
  successfulGateAttemptId: z.string().regex(/^attempt-[a-z0-9]+$/),
  limitations: z.array(z.string().min(1)).min(4)
}).loose();

function loadEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const filename of [".env.local", ".env.vercel.local"]) {
    const absolute = path.join(repositoryRoot, filename);
    if (!existsSync(absolute)) continue;
    const parsed = parseEnv(requireFile(absolute));
    for (const [name, value] of Object.entries(parsed)) {
      const current = environment[name];
      if (current === undefined || current.length === 0) {
        environment[name] = value;
      }
    }
  }
  return environment;
}

function requireFile(absolute: string): string {
  if (!existsSync(absolute)) throw new Error(`M61_LIVE_EVIDENCE_FILE_MISSING:${absolute}`);
  return fileText(absolute);
}

function fileText(absolute: string): string {
  return readFileSync(absolute, "utf8");
}

const manual = ManualEvidenceSchema.parse(JSON.parse(await readFile(evidencePath, "utf8")));
const environment = loadEnvironment();
const store = new UpstashM6Store(readM6UpstashConfig(environment));
const attempts = (await store.readLedgerAttempts())
  .filter((attempt) => attempt.runtimeOrigin === "local-development")
  .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
  .map((attempt) => LiveCallAttemptSchema.parse(attempt));
const exposure = await store.readGlobalExposureState();
if (attempts.length === 0) throw new Error("M61_LIVE_EVIDENCE_LOCAL_ATTEMPTS_MISSING");
if (!attempts.some((attempt) => attempt.attemptId === manual.successfulGateAttemptId)) {
  throw new Error("M61_LIVE_EVIDENCE_SUCCESSFUL_ATTEMPT_MISSING");
}

const prompt = await readFile(
  path.join(repositoryRoot, "docs/evidence/m05/runtime/interpretation-prompt.txt"),
  "utf8",
);
const modelConfiguration = {
  modelId: M6_OPENAI_MODEL,
  reasoningEffort: "low",
  maxOutputTokens: 4_000,
  serviceTier: "default",
  store: false
} as const;
const configuration = {
  promptVersion: M6_PROMPT_VERSION,
  intentSchemaVersion: M5_INTENT_SCHEMA_VERSION,
  capabilityCatalogVersion: M5_CAPABILITY_CATALOG_ID,
  modelConfiguration,
  promptHash: await sha256(prompt),
  schemaHash: await hashCanonical(INTENT_GRAPH_V1_JSON_SCHEMA),
  capabilityCatalogHash: await hashCanonical(CAPABILITY_CATALOG_V1),
  modelConfigurationHash: await hashCanonical(modelConfiguration),
  sdkMaximumRetries: M6_OPENAI_MAX_RETRIES,
  priceSnapshotId: M6_TERRA_PRICE.id
};

for (const attempt of attempts) {
  if (attempt.promptHash !== configuration.promptHash ||
      attempt.schemaHash !== configuration.schemaHash ||
      attempt.capabilityCatalogHash !== configuration.capabilityCatalogHash ||
      attempt.modelConfigurationHash !== configuration.modelConfigurationHash ||
      attempt.modelId !== configuration.modelConfiguration.modelId ||
      attempt.reasoningEffort !== configuration.modelConfiguration.reasoningEffort) {
    throw new Error(`M61_LIVE_EVIDENCE_CONFIGURATION_MISMATCH:${attempt.attemptId}`);
  }
  if (attempt.billing.state === "confirmed-billed" &&
      attempt.billing.priceSnapshotId !== configuration.priceSnapshotId) {
    throw new Error(`M61_LIVE_EVIDENCE_PRICE_SNAPSHOT_MISMATCH:${attempt.attemptId}`);
  }
}

const reported = attempts.flatMap((attempt) =>
  attempt.usage.status === "reported" ? [attempt.usage] : [],
);
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const confirmedCost = sum(attempts.flatMap((attempt) =>
  attempt.billing.state === "confirmed-billed" && attempt.billing.estimatedCostUsd !== null
    ? [attempt.billing.estimatedCostUsd]
    : [],
));
const unresolvedExposure = sum(attempts.flatMap((attempt) =>
  attempt.billing.state === "potentially-billed" &&
      attempt.billing.requestBudgetUpperBoundUsd !== null
    ? [attempt.billing.requestBudgetUpperBoundUsd]
    : [],
));
const networkDispatches = sum(attempts.map((attempt) => attempt.networkDispatchCount));
const linkedRetryAttempts = attempts.filter((attempt) =>
  attempt.retryOfAttemptId !== null || (attempt.retryOfRecordingIncidentId ?? null) !== null,
).length;

const report = {
  schemaVersion: "1.0",
  milestone: "M6.1",
  status: "pass-quality-follow-up-required",
  reviewedAt: "2026-07-18",
  capturedAt: new Date().toISOString(),
  evidenceSource: "durable-upstash-ledger-readback-and-builder-observation",
  configuration,
  builderObservation: manual.builderObservation,
  successfulGateAttemptId: manual.successfulGateAttemptId,
  attempts,
  summary: {
    localAttemptRecords: attempts.length,
    paidModelRequests: attempts.filter((attempt) =>
      attempt.billing.state === "confirmed-billed").length,
    cacheHits: attempts.filter((attempt) => attempt.outcome === "cache-hit").length,
    runtimeApplicationApiCalls: networkDispatches,
    networkDispatches,
    linkedRetryAttempts,
    reportedInputTokens: sum(reported.map((usage) => usage.inputTokens)),
    reportedCachedInputTokens: sum(reported.map((usage) => usage.cachedInputTokens)),
    reportedReasoningTokens: sum(reported.map((usage) => usage.reasoningTokens)),
    reportedOutputTokens: sum(reported.map((usage) => usage.outputTokens)),
    reportedTotalTokens: sum(reported.map((usage) => usage.totalTokens)),
    reportedDispatchLatencyMs: sum(attempts.flatMap((attempt) =>
      attempt.networkDispatchCount === 1 && attempt.latencyMs !== null ? [attempt.latencyMs] : [],
    )),
    confirmedEstimatedCostUsd: Number(confirmedCost.toFixed(8)),
    unresolvedPotentialExposureUsd: Number(unresolvedExposure.toFixed(8)),
    authorizedCeilingMicrousd: exposure.authorizedCeilingMicrousd,
    reservedExposureMicrousd: exposure.reservedExposureMicrousd,
    automaticRetryObserved: false
  },
  limitations: manual.limitations
};

await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `Captured ${String(attempts.length)} privacy-safe local attempts, ${String(networkDispatches)} dispatches, and ${String(report.summary.reportedTotalTokens)} reported tokens without making a model request.\n`,
);
