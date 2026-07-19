import { sha256 } from "../../domain/hash.js";
import {
  GenerationOutcomeV1Schema,
  type GenerationOutcomeV1,
  type GenerationSubmissionV1
} from "../../interpretation/generation-protocol.js";
import { resolveGeneratedFabricationControls } from "../../interpretation/generated-fabrication.js";
import { compileGeneratedProjectFromSemantic } from "../../interpretation/generated-project-compiler.js";
import { GeneratedProjectOrchestrator } from "../../interpretation/orchestrator.js";
import type { SemanticInterpretationTransport } from "../../interpretation/orchestrator.js";
import { FixtureOrchestrator } from "../../interpretation/fixture-orchestrator.js";
import {
  CURRENT_INTERPRETATION_PROMPT_VERSION,
  normalizeSemanticGenerationRequest
} from "../../interpretation/semantic-request.js";
import type { LiveCallRuntimeOrigin } from "../../interpretation/live-ledger.js";

import { GenerationResponseSchema, type GenerationResponse } from "./api-contracts.js";
import type { AuthenticatedRequest } from "./http-security.js";
import type { RuntimeConfig } from "./config.js";
import { DurableSemanticCache } from "./durable-semantic-cache.js";
import {
  GENERATION_OPENAI_MODEL,
  GENERATION_TERRA_PRICE
} from "./openai-transport.js";
import { createPersistedProject } from "./project-persistence.js";
import { QuotaTransport } from "./quota-transport.js";
import type { GenerationStore } from "./contracts.js";

export function generationFailure(
  transportMode: "fixture" | "live",
  stage: "input" | "transport" | "schema" | "model" | "mapping" | "compilation",
  code: string,
  retryable: boolean,
): GenerationOutcomeV1 {
  return GenerationOutcomeV1Schema.parse({
    schemaVersion: "1.0",
    kind: "failure",
    transportMode,
    stage,
    code,
    retryable,
    attempt: null
  });
}

function semanticRequest(
  submission: GenerationSubmissionV1,
  promptHash: string | null,
) {
  return normalizeSemanticGenerationRequest({
    brief: submission.brief,
    references: submission.references.map((item) => item.descriptor),
    roleConstraints: submission.roleConstraints,
    promptVersion: CURRENT_INTERPRETATION_PROMPT_VERSION,
    promptHash,
    modelConfiguration: {
      modelId: GENERATION_OPENAI_MODEL,
      reasoningEffort: "low",
      maxOutputTokens: 4_000,
      serviceTier: "default",
      store: false
    }
  });
}

export async function executeGeneration(input: {
  config: RuntimeConfig;
  authenticated: AuthenticatedRequest;
  submission: GenerationSubmissionV1;
  store: GenerationStore;
  runtimeOrigin: LiveCallRuntimeOrigin;
  interpretationTransport?: SemanticInterpretationTransport;
  promptHash?: string;
}): Promise<GenerationResponse> {
  const mode = input.config.generationMode;
  if (mode === "live" && input.promptHash === undefined) {
    throw new Error("GENERATION_LIVE_PROMPT_HASH_MISSING");
  }
  const semantic = semanticRequest(
    input.submission,
    mode === "live" ? input.promptHash! : null,
  );
  const cache = new DurableSemanticCache({ store: input.store });
  const compile = ({
    request: compileRequest,
    intent,
    mapping,
    cacheResult
  }: Parameters<ConstructorParameters<typeof GeneratedProjectOrchestrator>[0]["compile"]>[0]) => {
    const fabrication = resolveGeneratedFabricationControls(input.submission.fabricationControls);
    return compileGeneratedProjectFromSemantic({
      requestId: `generated-${crypto.randomUUID()}`,
      semanticRequest: compileRequest,
      intent,
      mapping,
      profiles: fabrication.profiles,
      inputPolicyEvaluation: fabrication.inputPolicyEvaluation,
      pin: fabrication.pin,
      controls: input.submission.deterministicControls,
      cacheResult,
      runtimeApplicationApiCalls: cacheResult === "miss" && mode === "live" ? 1 : 0
    });
  };
  let outcome: GenerationOutcomeV1;
  if (mode === "fixture") {
    const fixtureResult = await new FixtureOrchestrator({ cache, compile }).generate(semantic);
    outcome = fixtureResult.kind === "failure"
      ? generationFailure("fixture", fixtureResult.stage, fixtureResult.code, fixtureResult.retryable)
      : GenerationOutcomeV1Schema.parse({
          schemaVersion: "1.0",
          ...fixtureResult,
          transportMode: "fixture",
          attempt: null
        });
  } else {
    if (input.interpretationTransport === undefined || input.promptHash === undefined) {
      throw new Error("GENERATION_LIVE_TRANSPORT_SEAM_MISSING");
    }
    const live = new GeneratedProjectOrchestrator({
      cache,
      transport: new QuotaTransport({
        store: input.store,
        sessionId: input.authenticated.session.sessionId,
        clientIdentifier: input.authenticated.clientIdentifier,
        transport: input.interpretationTransport
      }),
      compile,
      appendAttempt: (attempt) => input.store.appendLedgerAttempt(attempt),
      promptHash: input.promptHash,
      runtimeOrigin: input.runtimeOrigin,
      dispatchExposure: {
        requestBudgetUpperBoundUsd: GENERATION_TERRA_PRICE.requestBudgetUpperBoundUsd,
        priceSnapshotId: GENERATION_TERRA_PRICE.id
      }
    });
    const result = await live.generate({
      request: semantic,
      ...(input.submission.retry === null ? {} : { retry: input.submission.retry })
    });
    outcome = result.kind === "failure"
      ? GenerationOutcomeV1Schema.parse({
          schemaVersion: "1.0",
          kind: "failure",
          transportMode: "live",
          stage: result.stage,
          code: result.code,
          retryable: result.retryable,
          attempt: result.attempt
        })
      : GenerationOutcomeV1Schema.parse({
          schemaVersion: "1.0",
          ...result,
          semanticRequest: semantic,
          transportMode: "live"
        });
  }
  const project = outcome.kind === "supported" || outcome.kind === "simplified"
    ? await createPersistedProject({
        store: input.store,
        ownerSessionId: input.authenticated.session.sessionId,
        semanticRequest: outcome.semanticRequest,
        intent: outcome.intent,
        mapping: outcome.mapping,
        deterministicControls: input.submission.deterministicControls,
        fabricationControls: input.submission.fabricationControls,
        compiled: outcome.compiled
      })
    : null;
  return GenerationResponseSchema.parse({
    schemaVersion: "1.0",
    outcome,
    project: project === null ? null : {
      projectId: project.projectId,
      revision: project.revision,
      updatedAtMs: project.updatedAtMs,
      lastDocumentHash: project.lastDocumentHash,
      lastGeometryHash: project.lastGeometryHash
    }
  });
}

export async function productionPromptHash(config: RuntimeConfig): Promise<string> {
  if (config.liveTransport === null) throw new Error("GENERATION_LIVE_TRANSPORT_UNAVAILABLE");
  return sha256(config.liveTransport.interpretationPrompt);
}
