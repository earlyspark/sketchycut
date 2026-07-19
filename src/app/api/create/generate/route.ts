import { GenerationSubmissionV1Schema } from "../../../../interpretation/generation-protocol.js";
import { GenerationResponseSchema } from "../../../../server/generation/api-contracts.js";
import { readRuntimeConfig } from "../../../../server/generation/config.js";
import {
  executeGeneration,
  generationFailure,
  productionPromptHash
} from "../../../../server/generation/generation-service.js";
import {
  authorizeRoute,
  genericApiFailure,
  noStoreJson
} from "../../../../server/generation/http-security.js";
import { verifyNormalizedReference } from "../../../../server/generation/image-decoder.js";
import {
  OpenAITransport
} from "../../../../server/generation/openai-transport.js";
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
    const submission = GenerationSubmissionV1Schema.parse(await request.json() as unknown);
    await Promise.all(submission.references.map((reference) => verifyNormalizedReference(reference)));
    const store = createGenerationStore(config);
    const interpretationTransport = mode === "live" && config.liveTransport !== null
      ? new OpenAITransport({
          apiKey: config.liveTransport.apiKey,
          prompt: config.liveTransport.interpretationPrompt,
          references: submission.references.map((item) => ({
            referenceId: item.descriptor.referenceId,
            dataUrl: item.dataUrl
          }))
        })
      : undefined;
    return noStoreJson(await executeGeneration({
      config,
      authenticated,
      submission,
      store,
      runtimeOrigin: deriveRuntimeOrigin(),
      ...(interpretationTransport === undefined ? {} : {
        interpretationTransport,
        promptHash: await productionPromptHash(config)
      })
    }));
  } catch {
    return noStoreJson(GenerationResponseSchema.parse({
      schemaVersion: "1.0",
      outcome: generationFailure(mode, "input", "GENERATION_INPUT_INVALID", false),
      project: null
    }), 400);
  }
}
