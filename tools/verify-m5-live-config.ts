import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { INTENT_GRAPH_V1_JSON_SCHEMA } from "../src/interpretation/intent-graph.js";
import { LiveCallBillingSchema } from "../src/interpretation/live-ledger.js";
import { LiveEvaluationConfigSchema } from "./m5-live-config.js";
import {
  M5_LIVE_EVALUATION_BRIEF,
  createM5LiveEvaluationReference
} from "./m5-live-evaluation-fixture.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const PricingSourceSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    retrievedAt: z.iso.datetime({ offset: true }),
    sources: z.array(
      z
        .object({
          modelId: z.string().min(1),
          url: z.url(),
          structuredOutputs: z.boolean(),
          imageInput: z.boolean(),
          responsesApi: z.boolean(),
          reasoningEffortsIncludeLow: z.boolean(),
          uncachedInputUsdPerMillion: z.number().nonnegative(),
          cachedInputUsdPerMillion: z.number().nonnegative(),
          outputUsdPerMillion: z.number().nonnegative()
        })
        .strict(),
    ).min(3)
  })
  .strict();

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function filesUnder(directory: string): Promise<string[]> {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(candidate) : [candidate];
  }))).flat().sort();
}

function asRecord(candidate: unknown, location: string): Record<string, unknown> {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new Error(`M5LIVE001_SCHEMA_NODE_INVALID: ${location}`);
  }
  return candidate as Record<string, unknown>;
}

function verifyStrictSchemaNode(candidate: unknown, location: string): void {
  if (typeof candidate !== "object" || candidate === null) return;
  if (Array.isArray(candidate)) {
    candidate.forEach((item, index) => verifyStrictSchemaNode(item, `${location}[${String(index)}]`));
    return;
  }
  const node = asRecord(candidate, location);
  for (const keyword of ["$schema", "allOf", "not", "dependentRequired", "dependentSchemas", "if", "then", "else"]) {
    if (keyword in node) {
      throw new Error(`M5LIVE002_UNSUPPORTED_SCHEMA_KEYWORD: ${location}.${keyword}`);
    }
  }
  if (Array.isArray(node.items)) {
    throw new Error(`M5LIVE002_UNSUPPORTED_TUPLE_ITEMS: ${location}.items`);
  }
  if (node.type === "object") {
    if (node.additionalProperties !== false) {
      throw new Error(`M5LIVE002_OBJECT_NOT_CLOSED: ${location}`);
    }
    const properties = asRecord(node.properties, `${location}.properties`);
    const required = z.array(z.string()).parse(node.required).slice().sort();
    const keys = Object.keys(properties).sort();
    if (JSON.stringify(required) !== JSON.stringify(keys)) {
      throw new Error(`M5LIVE003_OBJECT_FIELDS_NOT_ALL_REQUIRED: ${location}`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== "description" && key !== "default" && key !== "examples") {
      verifyStrictSchemaNode(value, `${location}.${key}`);
    }
  }
}

const [configSource, pricingSource, packageSource, adapterSource, sidecarSource, promptSource] =
  await Promise.all([
    readFile(path.join(repositoryRoot, "docs/evidence/m05/runtime/live-evaluation-config.json"), "utf8"),
    readFile(path.join(repositoryRoot, "docs/evidence/m05/runtime/pricing-source.json"), "utf8"),
    readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    readFile(path.join(repositoryRoot, "tools/m5-live-openai-adapter.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "tools/m5-sidecar.ts"), "utf8"),
    readFile(path.join(repositoryRoot, "docs/evidence/m05/runtime/interpretation-prompt.txt"), "utf8")
  ]);
const config = LiveEvaluationConfigSchema.parse(JSON.parse(configSource) as unknown);
const pricing = PricingSourceSchema.parse(JSON.parse(pricingSource) as unknown);
const packageJson = z.object({ scripts: z.record(z.string(), z.string()) }).loose().parse(
  JSON.parse(packageSource) as unknown,
);

const expectedModels = ["gpt-5.6-sol", "gpt-5.6-terra"] as const;
if (config.promptVersion !== "m5-interpretation-prompt@1.0.2") {
  throw new Error("M5LIVE004_PROMPT_VERSION_DRIFT");
}
if (JSON.stringify(Object.keys(config.models).sort()) !== JSON.stringify([...expectedModels].sort())) {
  throw new Error("M5LIVE004_FROZEN_MODEL_SET_CHANGED");
}
const expectedPrices = {
  "gpt-5.6-sol": [5, 0.5, 30],
  "gpt-5.6-terra": [2.5, 0.25, 15]
} as const;
for (const modelId of expectedModels) {
  const model = config.models[modelId];
  if (model === undefined) throw new Error(`M5LIVE005_MODEL_CONFIGURATION_DRIFT: ${modelId}`);
  if (model.maxOutputTokens !== 4_000 || model.serviceTier !== "default" ||
      model.price.requestBudgetUpperBoundUsd !== 0.25) {
    throw new Error(`M5LIVE005_MODEL_CONFIGURATION_DRIFT: ${modelId}`);
  }
  const source = pricing.sources.find((item) => item.modelId === modelId);
  const expected = expectedPrices[modelId];
  if (source === undefined || !source.structuredOutputs || !source.imageInput ||
      !source.responsesApi || !source.reasoningEffortsIncludeLow ||
      source.uncachedInputUsdPerMillion !== expected[0] ||
      source.cachedInputUsdPerMillion !== expected[1] ||
      source.outputUsdPerMillion !== expected[2] ||
      model.price.uncachedInputUsdPerMillion !== source.uncachedInputUsdPerMillion ||
      model.price.cachedInputUsdPerMillion !== source.cachedInputUsdPerMillion ||
      model.price.outputUsdPerMillion !== source.outputUsdPerMillion) {
    throw new Error(`M5LIVE006_PRICING_OR_CAPABILITY_SNAPSHOT_DRIFT: ${modelId}`);
  }
  LiveCallBillingSchema.parse({
    state: "confirmed-billed",
    estimatedCostUsd: 0,
    requestBudgetUpperBoundUsd: model.price.requestBudgetUpperBoundUsd,
    priceSnapshotId: model.price.id
  });
}
if (promptSource.trim().length < 200 ||
    !/semantic/i.test(promptSource) ||
    !/intent/i.test(promptSource) ||
    !/svg/i.test(promptSource) ||
    !/contour/i.test(promptSource) ||
    !/coordinate/i.test(promptSource) ||
    !/deterministic/i.test(promptSource)) {
  throw new Error("M5LIVE007_PRIVATE_PROMPT_BOUNDARY_INCOMPLETE");
}

verifyStrictSchemaNode(INTENT_GRAPH_V1_JSON_SCHEMA, "$intentGraph");
const rootSchema = asRecord(INTENT_GRAPH_V1_JSON_SCHEMA, "$intentGraph");
if (rootSchema.type !== "object" || "$schema" in rootSchema) {
  throw new Error("M5LIVE008_PROVIDER_SCHEMA_ROOT_INVALID");
}

const firstReference = createM5LiveEvaluationReference();
const secondReference = createM5LiveEvaluationReference();
if (JSON.stringify(firstReference.descriptor) !== JSON.stringify(secondReference.descriptor) ||
    firstReference.dataUrl !== secondReference.dataUrl ||
    !firstReference.dataUrl.startsWith("data:image/png;base64,") ||
    firstReference.descriptor.referenceId !== "reference-1" ||
    createHash("sha256").update(M5_LIVE_EVALUATION_BRIEF).digest("hex").length !== 64) {
  throw new Error("M5LIVE009_FROZEN_SYNTHETIC_INPUT_NOT_DETERMINISTIC");
}
const rawImageDigest = firstReference.descriptor.sha256;
for (const candidate of [
  ...(await filesUnder(path.join(repositoryRoot, "artifacts/m5"))),
  ...(await filesUnder(path.join(repositoryRoot, "public/m5"))),
  ...(await filesUnder(path.join(repositoryRoot, "docs/evidence/m05")))
]) {
  if (candidate.endsWith("interpretation-prompt.txt")) continue;
  const bytes = await readFile(candidate);
  if (bytes.includes(Buffer.from(firstReference.dataUrl)) ||
      (bytes.length > 5_000 && createHash("sha256").update(bytes).digest("hex") === rawImageDigest)) {
    throw new Error(`M5LIVE010_RAW_EVALUATION_IMAGE_PERSISTED: ${path.relative(repositoryRoot, candidate)}`);
  }
}

const exactScripts = {
  "evaluate:m5:sol": "node --import tsx tools/m5-sidecar.ts --mode live --model gpt-5.6-sol --evaluate-once m5-rigid-structure-and-bilateral-motif",
  "evaluate:m5:sol:revision-2": "node --import tsx tools/m5-sidecar.ts --mode live --model gpt-5.6-sol --evaluate-once m5-rigid-structure-and-bilateral-motif --evaluation-attempt 2",
  "evaluate:m5:sol:revision-3": "node --import tsx tools/m5-sidecar.ts --mode live --model gpt-5.6-sol --evaluate-once m5-rigid-structure-and-bilateral-motif --evaluation-attempt 3 --retry-recording-incident incident-sol-revision-2-ledger-validation",
  "evaluate:m5:terra": "node --import tsx tools/m5-sidecar.ts --mode live --model gpt-5.6-terra --evaluate-once m5-rigid-structure-and-bilateral-motif",
  "evaluate:m5:terra:canary-1": "node --import tsx tools/m5-sidecar.ts --mode live --model gpt-5.6-terra --evaluate-once m5-rigid-structure-and-bilateral-motif --integration-canary-after incident-sol-revision-2-ledger-validation",
  "evaluate:m5:terra:revision-2": "node --import tsx tools/m5-sidecar.ts --mode live --model gpt-5.6-terra --evaluate-once m5-rigid-structure-and-bilateral-motif --evaluation-attempt 2 --integration-canary-after incident-sol-revision-2-ledger-validation",
  "evaluate:m5:terra:revision-3": "node --import tsx tools/m5-sidecar.ts --mode live --model gpt-5.6-terra --evaluate-once m5-rigid-structure-and-bilateral-motif --evaluation-attempt 3 --integration-canary-after incident-sol-revision-2-ledger-validation"
};
for (const [script, command] of Object.entries(exactScripts)) {
  if (packageJson.scripts[script] !== command) {
    throw new Error(`M5LIVE011_ONE_SHOT_SCRIPT_DRIFT: ${script}`);
  }
}
for (const [source, pattern, code] of [
  [adapterSource, /maxRetries:\s*OPENAI_SDK_MAX_RETRIES/, "M5LIVE012_SDK_RETRIES_NOT_DISABLED"],
  [adapterSource, /strict:\s*true/, "M5LIVE013_STRUCTURED_OUTPUTS_NOT_STRICT"],
  [adapterSource, /store:\s*false/, "M5LIVE014_PROVIDER_STORAGE_NOT_DISABLED"],
  [sidecarSource, /flag:\s*"wx"/, "M5LIVE015_EVALUATION_REPORT_NOT_IMMUTABLE"],
  [sidecarSource, /M5_TERRA_REQUIRES_MATCHING_RECORDED_SOL_PASS/, "M5LIVE016_TERRA_PASS_GATE_MISSING"],
  [sidecarSource, /M5_LIVE_EVALUATION_RERUN_REQUIRES_PRIOR_FAILURE/, "M5LIVE017_REVISION_RERUN_GATE_MISSING"],
  [sidecarSource, /M5_TERRA_CANARY_REQUIRES_RECORDED_SOL_INCIDENT/, "M5LIVE018_TERRA_CANARY_GATE_MISSING"],
  [sidecarSource, /M5_SOL_REVISION_3_REQUIRES_MATCHING_TERRA_PASS/, "M5LIVE019_SOL_COMPARISON_GATE_MISSING"],
  [sidecarSource, /priorRecordingIncidentId:\s*SOL_REVISION_2_INCIDENT_ID/, "M5LIVE020_SOL_RETRY_LINK_MISSING"]
] as const) {
  if (!pattern.test(source)) throw new Error(code);
}

process.stdout.write(
  `Verified frozen M5 live configuration for ${expectedModels.join(" and ")}; strict schema, pricing, one-shot gates, and in-memory synthetic input are ready without dispatch.\n`,
);
