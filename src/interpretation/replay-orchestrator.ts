import { hashCanonical } from "../domain/hash.js";
import { deterministicCompilationFailureCode } from "./compilation-error.js";
import { buildM5ReplayIntent, findM5ReplayScenario } from "./m5-replay-corpus.js";
import { IntentGraphV1Schema, type IntentGraphV1 } from "./intent-graph.js";
import { mapIntentGraph, type CapabilityMappingOutcome } from "./mapper.js";
import type { SemanticCache } from "./semantic-cache.js";
import {
  SemanticGenerationRequestV1Schema,
  type SemanticGenerationRequestV1
} from "./semantic-request.js";

type FabricationMapping = Exclude<CapabilityMappingOutcome, { kind: "concept-only" }>;
type ReplayCompileCallback<TCompiled> = (input: {
  request: SemanticGenerationRequestV1;
  intent: IntentGraphV1;
  mapping: FabricationMapping;
  cacheResult: "miss" | "hit" | "singleflight-hit";
}) => Promise<TCompiled>;

export type M5ReplayResult<TCompiled> =
  | {
      kind: "supported" | "simplified";
      semanticRequest: SemanticGenerationRequestV1;
      intent: IntentGraphV1;
      mapping: FabricationMapping;
      compiled: TCompiled;
      cacheResult: "miss" | "hit" | "singleflight-hit";
    }
  | {
      kind: "concept-only";
      semanticRequest: SemanticGenerationRequestV1;
      intent: IntentGraphV1;
      mapping: Extract<CapabilityMappingOutcome, { kind: "concept-only" }>;
      exportAllowed: false;
      cacheResult: "miss" | "hit" | "singleflight-hit";
    }
  | {
      kind: "failure";
      stage: "input" | "schema" | "mapping" | "compilation";
      code: string;
      retryable: boolean;
    };

export class M5ReplayOrchestrator<TCompiled> {
  readonly #cache: SemanticCache;
  readonly #compile: ReplayCompileCallback<TCompiled>;

  constructor(input: {
    cache: SemanticCache;
    compile: ReplayCompileCallback<TCompiled>;
  }) {
    this.#cache = input.cache;
    this.#compile = input.compile;
  }

  async generate(requestCandidate: unknown): Promise<M5ReplayResult<TCompiled>> {
    const parsedRequest = SemanticGenerationRequestV1Schema.safeParse(requestCandidate);
    if (!parsedRequest.success) {
      return { kind: "failure", stage: "input", code: "GENERATION_INPUT_INVALID", retryable: false };
    }
    const request = parsedRequest.data;
    const scenario = findM5ReplayScenario(request.normalizedBrief);
    if (scenario === null) {
      return { kind: "failure", stage: "input", code: "REPLAY_FIXTURE_NOT_FOUND", retryable: false };
    }
    let resolution;
    try {
      resolution = await this.#cache.resolve(request, async (cacheRequest) => {
        const candidate = buildM5ReplayIntent(cacheRequest, scenario);
        const intent = IntentGraphV1Schema.parse(candidate);
        return {
          schemaVersion: "1.0" as const,
          intent,
          provenance: {
            modelId: request.modelConfiguration.modelId,
            responseId: null,
            outputDigest: await hashCanonical(intent),
            promptVersion: request.promptVersion,
            intentSchemaVersion: request.intentSchemaVersion,
            capabilityCatalogVersion: request.capabilityCatalogVersion
          }
        };
      });
    } catch {
      return { kind: "failure", stage: "schema", code: "STRICT_INTENT_SCHEMA_FAILURE", retryable: true };
    }
    const intent = IntentGraphV1Schema.parse(resolution.value.intent);
    const mapping = await mapIntentGraph(intent);
    if (mapping.kind === "concept-only") {
      return {
        kind: "concept-only",
        semanticRequest: request,
        intent,
        mapping,
        exportAllowed: false,
        cacheResult: resolution.cacheResult
      };
    }
    try {
      const compiled = await this.#compile({
        request,
        intent,
        mapping,
        cacheResult: resolution.cacheResult
      });
      return {
        kind: mapping.kind,
        semanticRequest: request,
        intent,
        mapping,
        compiled,
        cacheResult: resolution.cacheResult
      };
    } catch (error) {
      return {
        kind: "failure",
        stage: "compilation",
        code: deterministicCompilationFailureCode(error),
        retryable: false
      };
    }
  }
}
