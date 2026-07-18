import type {
  SemanticInterpretationTransport,
  SemanticTransportOutcome
} from "../../interpretation/orchestrator.js";
import type { SemanticGenerationRequestV1 } from "../../interpretation/semantic-request.js";

import type { M6Store } from "./contracts.js";
import { m6Keys } from "./keys.js";
import { M6_POLICY } from "./policy.js";

export class M6QuotaTransport implements SemanticInterpretationTransport {
  constructor(private readonly input: {
    transport: SemanticInterpretationTransport;
    store: M6Store;
    sessionId: string;
    clientIdentifier: string;
  }) {}

  async dispatch(input: {
    request: SemanticGenerationRequestV1;
    clientRequestId: string;
  }): Promise<SemanticTransportOutcome> {
    try {
      const policy = M6_POLICY.generation;
      const reservation = await this.input.store.reserveGeneration({
        sessionId: this.input.sessionId,
        clientKey: m6Keys.generationClient(this.input.clientIdentifier),
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
