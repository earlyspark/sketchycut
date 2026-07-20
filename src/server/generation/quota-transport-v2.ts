import type {
  SemanticInterpretationTransportV2,
  SemanticTransportOutcome
} from "../../interpretation/semantic-transport.js";
import type { SemanticGenerationRequestV2 } from "../../interpretation/semantic-request-v2.js";
import type { GenerationStore } from "./contracts.js";
import { generationKeys } from "./keys.js";
import { GENERATION_POLICY } from "./policy.js";

export class QuotaTransportV2 implements SemanticInterpretationTransportV2 {
  constructor(private readonly input: {
    transport: SemanticInterpretationTransportV2;
    store: GenerationStore;
    sessionId: string;
    clientIdentifier: string;
    now?: () => number;
  }) {}

  async dispatch(input: {
    request: SemanticGenerationRequestV2;
    clientRequestId: string;
  }): Promise<SemanticTransportOutcome> {
    try {
      const policy = GENERATION_POLICY.generation;
      const reservation = await this.input.store.reserveGeneration({
        sessionId: this.input.sessionId,
        clientKey: generationKeys.generationClient(this.input.clientIdentifier),
        nowMs: this.input.now?.() ?? Date.now(),
        minimumIntervalMs: policy.minimumIntervalMs,
        maximumSessionDispatches: policy.maximumDispatchesPerSession,
        requestExposureMicrousd: policy.requestBudgetUpperBoundMicrousd,
        maximumSessionExposureMicrousd: policy.maximumSessionExposureMicrousd,
        clientWindowMs: policy.clientWindowMs,
        maximumClientDispatches: policy.maximumDispatchesPerClientPerHour
      });
      if (!reservation.allowed) {
        return { kind: "pre-dispatch-failure", errorCode: `GENERATION_${reservation.reason.replaceAll("-", "_").toUpperCase()}` };
      }
      return await this.input.transport.dispatch(input);
    } catch {
      return { kind: "pre-dispatch-failure", errorCode: "GENERATION_RESERVATION_UNAVAILABLE" };
    }
  }
}
