import {
  CachedSemanticValueSchema,
  type SemanticCache,
  type SemanticCacheResolution
} from "../interpretation/semantic-cache.js";
import {
  SemanticGenerationRequestSchema,
  semanticRequestDigest,
  type SemanticGenerationRequest
} from "../interpretation/semantic-request.js";

/**
 * An explicitly authorized live semantic evaluation must observe a fresh response for every
 * pre-registered case. This evaluation-only cache adapter deliberately has no
 * read, write, or singleflight state; it cannot be selected by a public route.
 */
export class DispatchOnlySemanticCache implements SemanticCache {
  async resolve(
    requestCandidate: unknown,
    dispatch: (request: SemanticGenerationRequest) => Promise<unknown>,
  ): Promise<SemanticCacheResolution> {
    const request = SemanticGenerationRequestSchema.parse(requestCandidate);
    return {
      requestDigest: await semanticRequestDigest(request),
      cacheResult: "miss",
      value: CachedSemanticValueSchema.parse(await dispatch(request))
    };
  }
}
