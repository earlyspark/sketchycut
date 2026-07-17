import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { z } from "zod";

import { canonicalDocumentHash } from "../src/compiler/canonical.js";
import { hashCanonical } from "../src/domain/hash.js";
import { capabilityCatalogHash } from "../src/interpretation/capability-catalog.js";

import {
  GenerationOutcomeV1Schema,
  GenerationSubmissionV1Schema,
  type GenerationOutcomeV1,
  type GenerationSubmissionV1
} from "../src/interpretation/generation-protocol.js";
import { ExactSemanticCache } from "../src/interpretation/semantic-cache.js";
import { INTENT_GRAPH_V1_JSON_SCHEMA } from "../src/interpretation/intent-graph.js";
import { normalizeSemanticGenerationRequest } from "../src/interpretation/semantic-request.js";
import { M5ReplayOrchestrator } from "../src/interpretation/replay-orchestrator.js";
import { GeneratedProjectOrchestrator } from "../src/interpretation/orchestrator.js";
import { compileGeneratedProject } from "../src/ui/content/generated-projects.js";
import { resolveGeneratedFabricationControls } from "../src/ui/content/generated-setup.js";

import { AppendOnlyM5LedgerStore } from "./m5-ledger-store.js";
import { M5LiveOpenAITransport } from "./m5-live-openai-adapter.js";
import { LiveEvaluationConfigSchema } from "./m5-live-config.js";
import {
  M5_LIVE_EVALUATION_BRIEF,
  M5_LIVE_EVALUATION_CASE_ID,
  createM5LiveEvaluationReference
} from "./m5-live-evaluation-fixture.js";
import { M5LiveEvaluationReportSchema } from "./m5-live-evaluation-report.js";
import { M5LiveRecordingIncidentSchema } from "./m5-live-recording-incident.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const host = "127.0.0.1";
const SOL_REVISION_2_INCIDENT_ID = "incident-sol-revision-2-ledger-validation";

type SidecarMode = "replay" | "live";

function argument(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1] ?? null;
}

function requiredIntegerArgument(name: string, fallback: number): number {
  const raw = argument(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`Invalid ${name} value.`);
  }
  return value;
}

function parseEnvLocal(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function readLiveRuntime(modelId: string) {
  const [environmentSource, configSource] = await Promise.all([
    readFile(path.join(repositoryRoot, ".env.local"), "utf8"),
    readFile(
      path.join(repositoryRoot, "docs/evidence/m05/runtime/live-evaluation-config.json"),
      "utf8",
    )
  ]);
  const environment = parseEnvLocal(environmentSource);
  const apiKey = environment.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("OPENAI_API_KEY is absent from .env.local.");
  }
  const config = LiveEvaluationConfigSchema.parse(JSON.parse(configSource) as unknown);
  const model = config.models[modelId];
  if (model === undefined) throw new Error(`No frozen live configuration exists for ${modelId}.`);
  const promptPath = path.resolve(repositoryRoot, config.promptPath);
  if (!promptPath.startsWith(path.join(repositoryRoot, "docs") + path.sep)) {
    throw new Error("The private live prompt must remain under ignored docs/.");
  }
  const prompt = await readFile(promptPath, "utf8");
  if (prompt.trim().length === 0) throw new Error("The private live prompt is empty.");
  return { apiKey, prompt, promptVersion: config.promptVersion, model };
}

function dataUrlBytes(dataUrl: string): { mediaType: string; bytes: Buffer } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (match === null) throw new Error("REFERENCE_DATA_URL_INVALID");
  return { mediaType: match[1]!, bytes: Buffer.from(match[2]!, "base64") };
}

function verifyReferencePayloads(submission: GenerationSubmissionV1): void {
  for (const reference of submission.references) {
    const decoded = dataUrlBytes(reference.dataUrl);
    if (decoded.mediaType !== reference.descriptor.mediaType) {
      throw new Error("REFERENCE_MEDIA_TYPE_MISMATCH");
    }
    const digest = createHash("sha256").update(decoded.bytes).digest("hex");
    if (digest !== reference.descriptor.sha256) throw new Error("REFERENCE_DIGEST_MISMATCH");
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunkCandidate of request) {
    const chunk: unknown = chunkCandidate;
    const bytes = typeof chunk === "string"
      ? Buffer.from(chunk)
      : chunk instanceof Uint8Array
      ? Buffer.from(chunk)
      : null;
    if (bytes === null) throw new Error("GENERATION_BODY_CHUNK_INVALID");
    total += bytes.length;
    if (total > 42 * 1024 * 1024) throw new Error("GENERATION_BODY_TOO_LARGE");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(response: ServerResponse, status: number, candidate: unknown): void {
  const body = JSON.stringify(candidate);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function sendText(response: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  response.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function failure(mode: SidecarMode, stage: "input" | "transport" | "schema" | "model" | "mapping" | "compilation", code: string, retryable: boolean): GenerationOutcomeV1 {
  return GenerationOutcomeV1Schema.parse({
    schemaVersion: "1.0",
    kind: "failure",
    transportMode: mode,
    stage,
    code,
    retryable,
    attempt: null
  });
}

async function compileForSubmission(input: {
  submission: GenerationSubmissionV1;
  request: Parameters<typeof compileGeneratedProject>[0]["semanticRequest"];
  intent: Parameters<typeof compileGeneratedProject>[0]["intent"];
  mapping: Parameters<typeof compileGeneratedProject>[0]["mapping"];
  cacheResult: "miss" | "hit" | "singleflight-hit";
  runtimeApplicationApiCalls: 0 | 1;
}) {
  const fabrication = resolveGeneratedFabricationControls(input.submission.fabricationControls);
  return compileGeneratedProject({
    requestId: `generated-${crypto.randomUUID()}`,
    semanticRequest: input.request,
    intent: input.intent,
    mapping: input.mapping,
    profiles: fabrication.profiles,
    inputPolicyEvaluation: fabrication.inputPolicyEvaluation,
    pin: fabrication.pin,
    controls: input.submission.deterministicControls,
    cacheResult: input.cacheResult,
    runtimeApplicationApiCalls: input.runtimeApplicationApiCalls
  });
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function runOneShotLiveEvaluation(input: {
  modelId: string;
  evaluationAttempt: number;
  integrationCanaryAfter: string | null;
  retryRecordingIncidentId: string | null;
  liveRuntime: NonNullable<Awaited<ReturnType<typeof readLiveRuntime>>>;
  modelConfiguration: {
    modelId: string;
    reasoningEffort: "low";
    maxOutputTokens: number;
    serviceTier: "auto" | "default" | "priority";
    store: false;
  };
  cache: ExactSemanticCache;
  ledger: AppendOnlyM5LedgerStore;
}): Promise<boolean> {
  if (input.modelId !== "gpt-5.6-sol" && input.modelId !== "gpt-5.6-terra") {
    throw new Error("M5_LIVE_EVALUATION_MODEL_NOT_FROZEN");
  }
  const evaluationDirectory = path.join(repositoryRoot, "docs/evidence/m05/live");
  const reportPath = path.join(
    evaluationDirectory,
    `evaluation-${input.modelId}-attempt-${String(input.evaluationAttempt)}.json`,
  );
  if (await fileExists(reportPath)) {
    throw new Error(`M5_LIVE_EVALUATION_ATTEMPT_ALREADY_EXISTS: ${path.relative(repositoryRoot, reportPath)}`);
  }
  const incidentPath = path.join(
    evaluationDirectory,
    "incident-gpt-5.6-sol-attempt-2.json",
  );
  const isTerraIntegrationCanary = input.modelId === "gpt-5.6-terra" &&
    input.integrationCanaryAfter === SOL_REVISION_2_INCIDENT_ID;
  const isSolIncidentRetry = input.modelId === "gpt-5.6-sol" &&
    input.evaluationAttempt === 3 &&
    input.retryRecordingIncidentId === SOL_REVISION_2_INCIDENT_ID;
  if (input.integrationCanaryAfter !== null && !isTerraIntegrationCanary) {
    throw new Error("M5_INTEGRATION_CANARY_CONTEXT_INVALID");
  }
  if (input.retryRecordingIncidentId !== null && !isSolIncidentRetry) {
    throw new Error("M5_RECORDING_INCIDENT_RETRY_CONTEXT_INVALID");
  }
  if (isSolIncidentRetry) {
    const firstReportPath = path.join(
      evaluationDirectory,
      "evaluation-gpt-5.6-sol-attempt-1.json",
    );
    const missingSecondReportPath = path.join(
      evaluationDirectory,
      "evaluation-gpt-5.6-sol-attempt-2.json",
    );
    if (!(await fileExists(firstReportPath)) || await fileExists(missingSecondReportPath) ||
        !(await fileExists(incidentPath)) ||
        !(await input.ledger.hasRecordingIncident(SOL_REVISION_2_INCIDENT_ID))) {
      throw new Error("M5_SOL_REVISION_3_REQUIRES_RECORDED_REVISION_2_INCIDENT");
    }
    const firstReport = M5LiveEvaluationReportSchema.parse(
      JSON.parse(await readFile(firstReportPath, "utf8")) as unknown,
    );
    const incident = M5LiveRecordingIncidentSchema.parse(
      JSON.parse(await readFile(incidentPath, "utf8")) as unknown,
    );
    if (firstReport.modelId !== "gpt-5.6-sol" || firstReport.passed ||
        incident.incidentId !== SOL_REVISION_2_INCIDENT_ID) {
      throw new Error("M5_SOL_REVISION_3_PRIOR_EVIDENCE_INVALID");
    }
  } else if (input.evaluationAttempt > 1) {
    const priorReportPath = path.join(
      evaluationDirectory,
      `evaluation-${input.modelId}-attempt-${String(input.evaluationAttempt - 1)}.json`,
    );
    if (!(await fileExists(priorReportPath))) {
      throw new Error("M5_LIVE_EVALUATION_ATTEMPT_NOT_CONTIGUOUS");
    }
    const priorReport = M5LiveEvaluationReportSchema.parse(
      JSON.parse(await readFile(priorReportPath, "utf8")) as unknown,
    );
    if (priorReport.modelId !== input.modelId || priorReport.passed) {
      throw new Error("M5_LIVE_EVALUATION_RERUN_REQUIRES_PRIOR_FAILURE");
    }
  }

  const reference = createM5LiveEvaluationReference();
  const submission = GenerationSubmissionV1Schema.parse({
    schemaVersion: "1.0",
    brief: M5_LIVE_EVALUATION_BRIEF,
    references: [reference],
    roleConstraints: [{ referenceId: "reference-1", roles: ["structure", "motif"] }],
    deterministicControls: {
      dimensionsMm: { width: 120, depth: 90, height: 58 },
      scaleSource: "user-specified",
      motifPlacement: {
        scalePermille: 1_000,
        rotationQuarterTurns: 0,
        offsetXPermille: 0,
        offsetYPermille: 0,
        targetFace: "front"
      }
    },
    fabricationControls: {
      stockPresetId: "stock-3mm-basswood-laser-plywood",
      thickness: { basis: "nominal-preset" },
      fullCutWidthMm: 0.15,
      fitBiasMm: 0,
      stockFootprintMm: { width: 304.8, height: 304.8 }
    },
    retry: null
  });
  verifyReferencePayloads(submission);
  const semanticRequest = normalizeSemanticGenerationRequest({
    brief: submission.brief,
    references: submission.references.map((item) => item.descriptor),
    roleConstraints: submission.roleConstraints,
    promptVersion: input.liveRuntime.promptVersion,
    modelConfiguration: input.modelConfiguration
  });
  const frozenInputEvidence = {
    briefSha256: createHash("sha256").update(M5_LIVE_EVALUATION_BRIEF).digest("hex"),
    reference: { ...reference.descriptor, assignedRoles: ["structure", "motif"] as const },
    deterministicControlsSha256: await hashCanonical(submission.deterministicControls),
    fabricationControlsSha256: await hashCanonical(submission.fabricationControls)
  };
  const configurationEvidence = {
    promptSha256: createHash("sha256").update(input.liveRuntime.prompt).digest("hex"),
    intentSchemaSha256: await hashCanonical(INTENT_GRAPH_V1_JSON_SCHEMA),
    capabilityCatalogSha256: await capabilityCatalogHash(),
    modelConfigurationSha256: await hashCanonical(semanticRequest.modelConfiguration),
    reasoningEffort: input.modelConfiguration.reasoningEffort,
    maxOutputTokens: input.modelConfiguration.maxOutputTokens,
    serviceTier: input.modelConfiguration.serviceTier,
    store: false as const,
    expectedOutcomeKind: "supported" as const
  };
  if (input.modelId === "gpt-5.6-terra") {
    if (isTerraIntegrationCanary) {
      if (!(await fileExists(incidentPath)) ||
          !(await input.ledger.hasRecordingIncident(SOL_REVISION_2_INCIDENT_ID))) {
        throw new Error("M5_TERRA_CANARY_REQUIRES_RECORDED_SOL_INCIDENT");
      }
      const incident = M5LiveRecordingIncidentSchema.parse(
        JSON.parse(await readFile(incidentPath, "utf8")) as unknown,
      );
      if (incident.incidentId !== SOL_REVISION_2_INCIDENT_ID) {
        throw new Error("M5_TERRA_CANARY_INCIDENT_MISMATCH");
      }
    } else {
    const reportNames = await readdir(evaluationDirectory);
    const solReports = (await Promise.all(reportNames
      .filter((name) => /^evaluation-gpt-5\.6-sol-attempt-[1-9][0-9]*\.json$/.test(name))
      .map(async (name) => M5LiveEvaluationReportSchema.parse(
        JSON.parse(await readFile(path.join(evaluationDirectory, name), "utf8")) as unknown,
      ))))
      .filter((report) => report.modelId === "gpt-5.6-sol" && report.passed)
      .sort((left, right) => right.evaluationId.localeCompare(left.evaluationId));
    const solReport = solReports[0];
    if (solReport === undefined ||
        JSON.stringify(solReport.frozenInput) !== JSON.stringify(frozenInputEvidence) ||
        solReport.configuration.promptSha256 !== configurationEvidence.promptSha256 ||
        solReport.configuration.intentSchemaSha256 !== configurationEvidence.intentSchemaSha256 ||
        solReport.configuration.capabilityCatalogSha256 !==
          configurationEvidence.capabilityCatalogSha256) {
      throw new Error("M5_TERRA_REQUIRES_MATCHING_RECORDED_SOL_PASS");
    }
    }
  }
  if (isSolIncidentRetry) {
    const terraReportNames = await readdir(evaluationDirectory);
    const terraReports = (await Promise.all(terraReportNames
      .filter((name) => /^evaluation-gpt-5\.6-terra-attempt-[1-9][0-9]*\.json$/.test(name))
      .map(async (name) => M5LiveEvaluationReportSchema.parse(
        JSON.parse(await readFile(path.join(evaluationDirectory, name), "utf8")) as unknown,
      ))))
      .filter((report) => report.modelId === "gpt-5.6-terra" && report.passed)
      .sort((left, right) => right.evaluationId.localeCompare(left.evaluationId));
    const terraReport = terraReports[0];
    if (terraReport === undefined) {
      throw new Error("M5_SOL_REVISION_3_REQUIRES_MATCHING_TERRA_PASS");
    }
    if (terraReport.modelId !== "gpt-5.6-terra" || !terraReport.passed ||
        JSON.stringify(terraReport.frozenInput) !== JSON.stringify(frozenInputEvidence) ||
        terraReport.configuration.promptSha256 !== configurationEvidence.promptSha256 ||
        terraReport.configuration.intentSchemaSha256 !== configurationEvidence.intentSchemaSha256 ||
        terraReport.configuration.capabilityCatalogSha256 !==
          configurationEvidence.capabilityCatalogSha256) {
      throw new Error("M5_SOL_REVISION_3_REQUIRES_MATCHING_TERRA_PASS");
    }
  }
  const transport = new M5LiveOpenAITransport({
    apiKey: input.liveRuntime.apiKey,
    prompt: input.liveRuntime.prompt,
    references: submission.references.map((item) => ({
      referenceId: item.descriptor.referenceId,
      dataUrl: item.dataUrl
    })),
    price: input.liveRuntime.model.price
  });
  const orchestrator = new GeneratedProjectOrchestrator({
    cache: input.cache,
    transport,
    appendAttempt: (attempt) => input.ledger.append(attempt),
    promptHash: createHash("sha256").update(input.liveRuntime.prompt).digest("hex"),
    dispatchExposure: {
      requestBudgetUpperBoundUsd: input.liveRuntime.model.price.requestBudgetUpperBoundUsd,
      priceSnapshotId: input.liveRuntime.model.price.id
    },
    compile: ({ request, intent, mapping, cacheResult }) =>
      compileForSubmission({
        submission,
        request,
        intent,
        mapping,
        cacheResult,
        runtimeApplicationApiCalls: cacheResult === "miss" ? 1 : 0
      })
  });
  const outcome = await orchestrator.generate({
    request: semanticRequest,
    ...(isSolIncidentRetry ? {
      retry: {
        priorRecordingIncidentId: SOL_REVISION_2_INCIDENT_ID,
        retryChainId: "retry-chain-sol-revision-2-recording-incident",
        attemptOrdinal: 1
      }
    } : { initiatedBy: "live-eval" as const }),
    expectedOutcomeKind: "supported"
  });
  const successful = outcome.kind === "supported" ? outcome : null;
  const mustRequirementIds = successful?.intent.requirements
    .filter((requirement) => requirement.priority === "must")
    .map((requirement) => requirement.id) ?? [];
  const evidencedRequirementIds = new Set(
    successful?.mapping.requirementEvidence.map((item) => item.requirementId) ?? [],
  );
  const referenceIntent = successful?.intent.references.find(
    (item) => item.referenceId === "reference-1",
  );
  const motifPrimitives = successful?.mapping.acceptedMotifPrimitives ?? [];
  const motifReport = successful?.compiled.motifReport ?? null;
  const attempt = outcome.attempt;
  const interpreted = outcome.kind === "failure" ? null : outcome;
  const blockedRequirementIds = interpreted?.mapping.kind === "concept-only"
    ? new Set(interpreted.mapping.blockedRequirementIds)
    : new Set<string>();
  const semanticDiagnostics = interpreted === null ? null : {
    mappingKind: interpreted.mapping.kind,
    findingCodes: interpreted.mapping.findings.map((finding) => finding.code).sort(),
    blockedRequirementKinds: interpreted.intent.requirements
      .filter((requirement) => blockedRequirementIds.has(requirement.id))
      .map((requirement) => requirement.kind)
      .sort(),
    mustRequirementKinds: interpreted.intent.requirements
      .filter((requirement) => requirement.priority === "must")
      .map((requirement) => requirement.kind)
      .sort(),
    coreIntentRepresentable: interpreted.intent.capabilityAssessment.coreIntentRepresentable,
    unresolvedNeedCount: interpreted.intent.capabilityAssessment.unresolvedNeeds.length,
    bodyShapeClasses: interpreted.intent.topology.bodies.map((body) => body.shapeClass).sort(),
    interfaceBehaviors: interpreted.intent.topology.interfaces
      .map((item) => item.behavior)
      .sort(),
    requestedMotifPrimitives: [...(interpreted.intent.motif?.primitiveFamilies ?? [])].sort()
  };
  const runtimeCallCount = successful?.compiled.document.provenance.runtimeApplicationApiCalls ?? null;
  const rubric = [
    {
      id: "strict-intent-schema" as const,
      passed: attempt?.strictParse === "passed",
      evidence: `ledger strictParse=${attempt?.strictParse ?? "unavailable"}`
    },
    {
      id: "supported-outcome" as const,
      passed: outcome.kind === "supported" && attempt?.supportStateCorrect === true,
      evidence: `outcome=${outcome.kind}; supportStateCorrect=${String(attempt?.supportStateCorrect ?? null)}`
    },
    {
      id: "rigid-structure" as const,
      passed: successful?.mapping.operatorGraph.motionBehavior === "rigid" &&
        successful.intent.topology.interfaces.every((item) => item.behavior === "rigid"),
      evidence: `operatorGraph=${successful?.mapping.operatorGraph.graphId ?? "unavailable"}`
    },
    {
      id: "explicit-dual-reference-role" as const,
      passed: referenceIntent !== undefined &&
        referenceIntent.inferredRoles.includes("structure") &&
        referenceIntent.inferredRoles.includes("motif"),
      evidence: `reference roles=${referenceIntent?.inferredRoles.join(",") ?? "unavailable"}`
    },
    {
      id: "mandatory-requirement-evidence" as const,
      passed: mustRequirementIds.length > 0 &&
        mustRequirementIds.every((id) => evidencedRequirementIds.has(id)),
      evidence: `${String(evidencedRequirementIds.size)}/${String(mustRequirementIds.length)} must requirements mapped to evidence`
    },
    {
      id: "registered-filled-motif" as const,
      passed: motifPrimitives.includes("filled-dot-repeat"),
      evidence: `accepted primitives=${motifPrimitives.join(",") || "none"}`
    },
    {
      id: "deterministic-compilation" as const,
      passed: attempt?.deterministicCompile === "passed" && successful !== null,
      evidence: `ledger deterministicCompile=${attempt?.deterministicCompile ?? "unavailable"}`
    },
    {
      id: "canonical-validation" as const,
      passed: successful?.compiled.document.validation.status === "pass",
      evidence: `validation=${successful?.compiled.document.validation.status ?? "unavailable"}`
    },
    {
      id: "visible-filled-engraving" as const,
      passed: motifReport?.status === "applied" && motifReport.engraveFeatureCount > 0,
      evidence: `motif=${motifReport?.status ?? "unavailable"}; engrave features=${String(motifReport?.engraveFeatureCount ?? 0)}`
    },
    {
      id: "single-network-dispatch" as const,
      passed: attempt?.networkDispatchCount === 1,
      evidence: `networkDispatchCount=${String(attempt?.networkDispatchCount ?? 0)}`
    },
    {
      id: "model-partitioned-cache-miss" as const,
      passed: outcome.kind !== "failure" && outcome.cacheResult === "miss" && attempt?.cacheResult === "miss",
      evidence: `result cache=${outcome.kind === "failure" ? "unavailable" : outcome.cacheResult}; ledger cache=${attempt?.cacheResult ?? "unavailable"}`
    },
    {
      id: "single-runtime-model-call" as const,
      passed: runtimeCallCount === 1,
      evidence: `canonical runtimeApplicationApiCalls=${String(runtimeCallCount ?? 0)}`
    }
  ];
  const passed = rubric.every((item) => item.passed);
  const report = M5LiveEvaluationReportSchema.parse({
    schemaVersion: "1.0",
    evaluationId: `m5-live-${input.modelId}-attempt-${String(input.evaluationAttempt)}`,
    ...(input.evaluationAttempt > 1 && !isSolIncidentRetry ? {
      revisionOfEvaluationId:
        `m5-live-${input.modelId}-attempt-${String(input.evaluationAttempt - 1)}`
    } : {}),
    caseId: M5_LIVE_EVALUATION_CASE_ID,
    modelId: input.modelId,
    frozenInput: frozenInputEvidence,
    configuration: configurationEvidence,
    result: {
      kind: outcome.kind,
      cacheResult: outcome.kind === "failure" ? null : outcome.cacheResult,
      intentSha256: successful === null ? null : await hashCanonical(successful.intent),
      canonicalDocumentSha256: successful === null
        ? null
        : await canonicalDocumentHash(successful.compiled.document),
      geometrySha256: successful?.compiled.geometryHash ?? null,
      validationStatus: successful?.compiled.document.validation.status ?? null,
      acceptedMotifPrimitives: motifPrimitives,
      motifStatus: motifReport?.status ?? null,
      motifEngraveFeatureCount: motifReport?.engraveFeatureCount ?? null,
      failureStage: outcome.kind === "failure" ? outcome.stage : null,
      failureCode: outcome.kind === "failure" ? outcome.code : null,
      semanticDiagnostics
    },
    rubric,
    passed,
    attempt,
    privacy: {
      rawReferencePersisted: false,
      rawProviderResponsePersisted: false,
      fullPromptPersistedInReport: false,
      syntheticEvaluationInput: true
    },
    limitations: [
      "This is one synthetic interpretation evaluation, not a statistical model-quality claim.",
      "No physical fabrication, fit, strength, durability, or mechanism evidence is produced by this evaluation."
    ]
  });
  await mkdir(evaluationDirectory, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
  process.stdout.write(
    `Recorded ${input.modelId} M5 live evaluation: ${passed ? "PASS" : "FAIL"}.\n`,
  );
  return passed;
}

async function createBundle(outputDirectory: string): Promise<void> {
  await build({
    entryPoints: [path.join(repositoryRoot, "tools/m5-create-entry.tsx")],
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    outdir: outputDirectory,
    entryNames: "create",
    chunkNames: "chunk-[hash]",
    assetNames: "asset-[hash]",
    sourcemap: true,
    logLevel: "info"
  });
}

async function waitForNext(port: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    const ready = await new Promise<boolean>((resolve) => {
      const request = http.get({ host, port, path: "/", timeout: 500 }, (response) => {
        response.resume();
        response.on("end", () => resolve(true));
      });
      request.on("error", () => resolve(false));
      request.on("timeout", () => { request.destroy(); resolve(false); });
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("NEXT_DEVELOPMENT_SERVER_TIMEOUT");
}

function proxyToNext(request: IncomingMessage, response: ServerResponse, nextPort: number): void {
  const proxy = http.request({
    host,
    port: nextPort,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: `${host}:${String(nextPort)}` }
  }, (upstream) => {
    response.writeHead(upstream.statusCode ?? 502, upstream.headers);
    upstream.pipe(response);
  });
  proxy.on("error", () => sendText(response, 502, "Local development server unavailable."));
  request.pipe(proxy);
}

const mode = z.enum(["replay", "live"]).parse(argument("--mode", "replay"));
const publicPort = requiredIntegerArgument("--port", 3100);
const nextPort = requiredIntegerArgument("--next-port", publicPort + 1);
const modelId = argument("--model", mode === "replay" ? "m5-replay-fixture@1.0.0" : null);
if (modelId === null) throw new Error("Live mode requires --model.");
const liveRuntime = mode === "live" ? await readLiveRuntime(modelId) : null;
const modelConfiguration = liveRuntime === null ? {
  modelId,
  reasoningEffort: "low" as const,
  maxOutputTokens: 4_000,
  serviceTier: "default" as const,
  store: false as const
} : {
  modelId,
  reasoningEffort: liveRuntime.model.reasoningEffort,
  maxOutputTokens: liveRuntime.model.maxOutputTokens,
  serviceTier: liveRuntime.model.serviceTier,
  store: false as const
};

const cache = new ExactSemanticCache();
const ledger = new AppendOnlyM5LedgerStore(repositoryRoot);
const evaluationCase = argument("--evaluate-once");
if (evaluationCase !== null) {
  if (mode !== "live" || liveRuntime === null) {
    throw new Error("M5_ONE_SHOT_EVALUATION_REQUIRES_LIVE_MODE");
  }
  if (evaluationCase !== M5_LIVE_EVALUATION_CASE_ID) {
    throw new Error("M5_LIVE_EVALUATION_CASE_NOT_FROZEN");
  }
  const passed = await runOneShotLiveEvaluation({
    modelId,
    evaluationAttempt: requiredIntegerArgument("--evaluation-attempt", 1),
    integrationCanaryAfter: argument("--integration-canary-after"),
    retryRecordingIncidentId: argument("--retry-recording-incident"),
    liveRuntime,
    modelConfiguration,
    cache,
    ledger
  });
  process.exitCode = passed ? 0 : 1;
} else {
const outputDirectory = path.join(os.tmpdir(), `sketchycut-m5-sidecar-${String(process.pid)}`);
await createBundle(outputDirectory);
const nextProcess: ChildProcess = spawn(
  process.execPath,
  [path.join(repositoryRoot, "node_modules/next/dist/bin/next"), "dev", "--webpack", "-H", host, "-p", String(nextPort)],
  { cwd: repositoryRoot, stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } },
);
await waitForNext(nextPort);

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${host}:${String(publicPort)}`);
  if (request.method === "GET" && url.pathname === "/create") {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Create a fabrication candidate · SketchyCut</title><meta name="description" content="Turn a maker brief and references into a deterministically validated fabrication candidate."><link rel="stylesheet" href="/__m5/assets/create.css"></head><body><div id="m5-create-root"></div><script type="module" src="/__m5/assets/create.js"></script></body></html>`;
    sendText(response, 200, html, "text/html; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/__m5/assets/")) {
    const basename = path.basename(url.pathname);
    const candidate = path.join(outputDirectory, basename);
    if (path.dirname(candidate) !== outputDirectory) {
      sendText(response, 404, "Not found.");
      return;
    }
    try {
      const bytes = await readFile(candidate);
      const type = basename.endsWith(".css") ? "text/css" : basename.endsWith(".map")
        ? "application/json" : "text/javascript";
      response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      response.end(bytes);
    } catch {
      sendText(response, 404, "Not found.");
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/__sketchycut/generate") {
    try {
      const submission = GenerationSubmissionV1Schema.parse(await readBody(request));
      verifyReferencePayloads(submission);
      const semanticRequest = normalizeSemanticGenerationRequest({
        brief: submission.brief,
        references: submission.references.map((item) => item.descriptor),
        roleConstraints: submission.roleConstraints,
        ...(liveRuntime === null ? {} : { promptVersion: liveRuntime.promptVersion }),
        modelConfiguration
      });
      if (mode === "replay") {
        const orchestrator = new M5ReplayOrchestrator({
          cache,
          compile: ({ request: semantic, intent, mapping, cacheResult }) =>
            compileForSubmission({
              submission,
              request: semantic,
              intent,
              mapping,
              cacheResult,
              runtimeApplicationApiCalls: 0
            })
        });
        const result = await orchestrator.generate(semanticRequest);
        if (result.kind === "failure") {
          sendJson(response, 200, failure(mode, result.stage, result.code, result.retryable));
          return;
        }
        sendJson(response, 200, GenerationOutcomeV1Schema.parse({
          schemaVersion: "1.0",
          ...result,
          transportMode: "replay",
          attempt: null
        }));
        return;
      }
      if (liveRuntime === null) throw new Error("LIVE_RUNTIME_MISSING");
      const references = submission.references.map((item) => ({
        referenceId: item.descriptor.referenceId,
        dataUrl: item.dataUrl
      }));
      const transport = new M5LiveOpenAITransport({
        apiKey: liveRuntime.apiKey,
        prompt: liveRuntime.prompt,
        references,
        price: liveRuntime.model.price
      });
      const orchestrator = new GeneratedProjectOrchestrator({
        cache,
        transport,
        appendAttempt: (attempt) => ledger.append(attempt),
        promptHash: createHash("sha256").update(liveRuntime.prompt).digest("hex"),
        dispatchExposure: {
          requestBudgetUpperBoundUsd: liveRuntime.model.price.requestBudgetUpperBoundUsd,
          priceSnapshotId: liveRuntime.model.price.id
        },
        compile: ({ request: semantic, intent, mapping, cacheResult }) =>
          compileForSubmission({
            submission,
            request: semantic,
            intent,
            mapping,
            cacheResult,
            runtimeApplicationApiCalls: cacheResult === "miss" ? 1 : 0
          })
      });
      const result = await orchestrator.generate({
        request: semanticRequest,
        ...(submission.retry === null ? {} : { retry: submission.retry })
      });
      if (result.kind === "failure") {
        sendJson(response, 200, GenerationOutcomeV1Schema.parse({
          schemaVersion: "1.0",
          kind: "failure",
          transportMode: "live",
          stage: result.stage,
          code: result.code,
          retryable: result.retryable,
          attempt: result.attempt
        }));
        return;
      }
      sendJson(response, 200, GenerationOutcomeV1Schema.parse({
        schemaVersion: "1.0",
        ...result,
        semanticRequest,
        transportMode: "live"
      }));
    } catch {
      sendJson(response, 400, failure(mode, "input", "GENERATION_INPUT_INVALID", false));
    }
    return;
  }
  proxyToNext(request, response, nextPort);
}

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch(() => {
    if (!response.headersSent) sendJson(response, 500, failure(mode, "transport", "SIDECAR_INTERNAL_FAILURE", true));
    else response.destroy();
  });
});

server.listen(publicPort, host, () => {
  process.stdout.write(
    `SketchyCut M5 ${mode} sidecar listening at http://${host}:${String(publicPort)}/create\n`,
  );
});

async function shutdown(): Promise<void> {
  server.close();
  nextProcess.kill("SIGTERM");
  await rm(outputDirectory, { recursive: true, force: true });
}

process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
}
