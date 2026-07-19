import type {
  SemanticInterpretationTransport,
  SemanticTransportOutcome
} from "../../interpretation/orchestrator.js";
import type { SemanticGenerationRequestV1 } from "../../interpretation/semantic-request.js";

import type { GenerationStore } from "./contracts.js";
import { generationKeys } from "./keys.js";
import { GENERATION_POLICY } from "./policy.js";

export class QuotaTransport implements SemanticInterpretationTransport {
  constructor(private readonly input: {
    transport: SemanticInterpretationTransport;
    store: GenerationStore;
    sessionId: string;
    clientIdentifier: string;
  }) {}

  async dispatch(input: {
    request: SemanticGenerationRequestV1;
    clientRequestId: string;
  }): Promise<SemanticTransportOutcome> {
    try {
      const policy = GENERATION_POLICY.generation;
      const reservation = await this.input.store.reserveGeneration({
        sessionId: this.input.sessionId,
        clientKey: generationKeys.generationClient(this.input.clientIdentifier),
        nowMs: Date.now(),
        minimumIntervalMs: policy.minimumIntervalMs,
        maximumSessionDispatches: policy.maximumDispatchesPerSession,
        requestExposureMicrousd: policy.requestBudgetUpperBoundMicrousd,
        maximumSessionExposureMicrousd: policy.maximumSessionExposureMicrousd,
        clientWindowMs: policy.clientWindowMs,
        maximumClientDispatches: policy.maximumDispatchesPerClientPerHour
      });
      if (!reservation.allowed) {
        return {
          kind: "pre-dispatch-failure",
          errorCode: `GENERATION_${reservation.reason.replaceAll("-", "_").toUpperCase()}`
        };
      }
      return await this.input.transport.dispatch(input);
    } catch {
      return { kind: "pre-dispatch-failure", errorCode: "GENERATION_RESERVATION_UNAVAILABLE" };
    }
  }
}
