import { generationFailureV2 } from "../../../../interpretation/generation-outcome-v2.js";
import { GenerationSubmissionV2Schema } from "../../../../interpretation/generation-submission-v2.js";
import { CurrentGenerationResponseSchema } from "../../../../server/generation/api-contracts-v2.js";
import { readRuntimeConfig } from "../../../../server/generation/config.js";
import {
  executeCurrentGeneration,
  currentProductionPromptHash
} from "../../../../server/generation/generation-service-v2.js";
import {
  authorizeRoute,
  genericApiFailure,
  noStoreJson
} from "../../../../server/generation/http-security.js";
import { verifyNormalizedReference } from "../../../../server/generation/image-decoder.js";
import {
  OpenAITransportV2
} from "../../../../server/generation/openai-transport-v2.js";
import { GENERATION_POLICY } from "../../../../server/generation/policy.js";
import { deriveRuntimeOrigin } from "../../../../server/generation/runtime-origin.js";
import { createGenerationStore } from "../../../../server/generation/store.js";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authorizeRoute(request, "generation");
  if (authenticated === null) return genericApiFailure();
  let mode: "fixture" | "live" = "live";
  try {
    const config = readRuntimeConfig();
    mode = config.generationMode;
    if (!config.generationEnabled) return genericApiFailure(503);
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isInteger(contentLength) || contentLength < 1 ||
        contentLength > GENERATION_POLICY.image.maximumGenerationRequestBytes) {
      return genericApiFailure(400);
    }
    const submission = GenerationSubmissionV2Schema.parse(await request.json() as unknown);
    await Promise.all(submission.references.map((reference) => verifyNormalizedReference(reference)));
    const store = createGenerationStore(config);
    const interpretationTransport = mode === "live" && config.liveTransport !== null
      ? new OpenAITransportV2({
          apiKey: config.liveTransport.apiKey,
          prompt: config.liveTransport.interpretationPrompt,
          references: submission.references.map((item) => ({
            referenceId: item.descriptor.referenceId,
            dataUrl: item.dataUrl
          }))
        })
      : undefined;
    return noStoreJson(await executeCurrentGeneration({
      config,
      authenticated,
      submission,
      store,
      runtimeOrigin: deriveRuntimeOrigin(),
      ...(interpretationTransport === undefined ? {} : {
        interpretationTransport,
        promptHash: await currentProductionPromptHash(config)
      })
    }));
  } catch {
    return noStoreJson(CurrentGenerationResponseSchema.parse({
      schemaVersion: "2.0",
      outcome: generationFailureV2({
        requestId: `invalid-${crypto.randomUUID()}`,
        transportMode: mode,
        semanticRequestDigest: "0".repeat(64),
        stage: "input",
        code: "GENERATION_INPUT_INVALID",
        retryable: false,
        attemptId: null
      }),
      project: null,
      compiled: null,
      retryContext: null
    }), 400);
  }
}
