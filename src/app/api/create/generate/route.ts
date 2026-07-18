import { GenerationSubmissionV1Schema } from "../../../../interpretation/generation-protocol.js";
import { M6GenerationResponseSchema } from "../../../../server/m6/api-contracts.js";
import { readM6RuntimeConfig } from "../../../../server/m6/config.js";
import {
  executeM61Generation,
  m6GenerationFailure,
  productionPromptHash
} from "../../../../server/m6/generation-service.js";
import {
  authorizeM6Route,
  genericApiFailure,
  noStoreJson
} from "../../../../server/m6/http-security.js";
import { verifyNormalizedReference } from "../../../../server/m6/image-decoder.js";
import {
  M6OpenAITransport
} from "../../../../server/m6/openai-transport.js";
import { M6_POLICY } from "../../../../server/m6/policy.js";
import { deriveM61RuntimeOrigin } from "../../../../server/m6/runtime-origin.js";
import { createM6Store } from "../../../../server/m6/store.js";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authorizeM6Route(request, "generation");
  if (authenticated === null) return genericApiFailure();
  let mode: "replay" | "live" = "live";
  try {
    const config = readM6RuntimeConfig();
    mode = config.generationMode;
    if (!config.generationEnabled) return genericApiFailure(503);
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isInteger(contentLength) || contentLength < 1 ||
        contentLength > M6_POLICY.image.maximumGenerationRequestBytes) {
      return genericApiFailure(400);
    }
    const submission = GenerationSubmissionV1Schema.parse(await request.json() as unknown);
    await Promise.all(submission.references.map((reference) => verifyNormalizedReference(reference)));
    const store = createM6Store(config);
    const interpretationTransport = mode === "live" && config.liveTransport !== null
      ? new M6OpenAITransport({
          apiKey: config.liveTransport.apiKey,
          prompt: config.liveTransport.interpretationPrompt,
          references: submission.references.map((item) => ({
            referenceId: item.descriptor.referenceId,
            dataUrl: item.dataUrl
          }))
        })
      : undefined;
    return noStoreJson(await executeM61Generation({
      config,
      authenticated,
      submission,
      store,
      runtimeOrigin: deriveM61RuntimeOrigin(),
      ...(interpretationTransport === undefined ? {} : {
        interpretationTransport,
        promptHash: await productionPromptHash(config)
      })
    }));
  } catch {
    return noStoreJson(M6GenerationResponseSchema.parse({
      schemaVersion: "1.0",
      outcome: m6GenerationFailure(mode, "input", "GENERATION_INPUT_INVALID", false),
      project: null
    }), 400);
  }
}
