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
import { M5ReplayOrchestrator } from "../../interpretation/replay-orchestrator.js";
import { normalizeSemanticGenerationRequest } from "../../interpretation/semantic-request.js";
import type { LiveCallRuntimeOrigin } from "../../interpretation/live-ledger.js";

import { M6GenerationResponseSchema, type M6GenerationResponse } from "./api-contracts.js";
import type { M6AuthenticatedRequest } from "./http-security.js";
import type { M6RuntimeConfig } from "./config.js";
import { DurableSemanticCache } from "./durable-semantic-cache.js";
import {
  M6_OPENAI_MODEL,
  M6_PROMPT_VERSION,
  M6_TERRA_PRICE
} from "./openai-transport.js";
import { createPersistedProject } from "./project-persistence.js";
import { M6QuotaTransport } from "./quota-transport.js";
import type { M6Store } from "./contracts.js";

export function m6GenerationFailure(
  transportMode: "replay" | "live",
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

function semanticRequest(submission: GenerationSubmissionV1) {
  return normalizeSemanticGenerationRequest({
    brief: submission.brief,
    references: submission.references.map((item) => item.descriptor),
    roleConstraints: submission.roleConstraints,
    promptVersion: M6_PROMPT_VERSION,
    modelConfiguration: {
      modelId: M6_OPENAI_MODEL,
      reasoningEffort: "low",
      maxOutputTokens: 4_000,
      serviceTier: "default",
      store: false
    }
  });
}

export async function executeM61Generation(input: {
  config: M6RuntimeConfig;
  authenticated: M6AuthenticatedRequest;
  submission: GenerationSubmissionV1;
  store: M6Store;
  runtimeOrigin: LiveCallRuntimeOrigin;
  interpretationTransport?: SemanticInterpretationTransport;
  promptHash?: string;
}): Promise<M6GenerationResponse> {
  const mode = input.config.generationMode;
  const semantic = semanticRequest(input.submission);
  const cache = new DurableSemanticCache({ store: input.store });
  const compile = ({
    request: compileRequest,
    intent,
    mapping,
    cacheResult
  }: Parameters<ConstructorParameters<typeof GeneratedProjectOrchestrator>[0]["compile"]>[0]) => {
    const fabrication = resolveGeneratedFabricationControls(input.submission.fabricationControls);
    return compileGeneratedProjectFromSemantic({
      requestId: `m6-generated-${crypto.randomUUID()}`,
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
  if (mode === "replay") {
    const replay = await new M5ReplayOrchestrator({ cache, compile }).generate(semantic);
    outcome = replay.kind === "failure"
      ? m6GenerationFailure("replay", replay.stage, replay.code, replay.retryable)
      : GenerationOutcomeV1Schema.parse({
          schemaVersion: "1.0",
          ...replay,
          transportMode: "replay",
          attempt: null
        });
  } else {
    if (input.interpretationTransport === undefined || input.promptHash === undefined) {
      throw new Error("M61_LIVE_TRANSPORT_SEAM_MISSING");
    }
    const live = new GeneratedProjectOrchestrator({
      cache,
      transport: new M6QuotaTransport({
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
        requestBudgetUpperBoundUsd: M6_TERRA_PRICE.requestBudgetUpperBoundUsd,
        priceSnapshotId: M6_TERRA_PRICE.id
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
  return M6GenerationResponseSchema.parse({
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

export async function productionPromptHash(config: M6RuntimeConfig): Promise<string> {
  if (config.liveTransport === null) throw new Error("M6_LIVE_TRANSPORT_UNAVAILABLE");
  return sha256(config.liveTransport.interpretationPrompt);
}
