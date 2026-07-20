import {
  CachedSemanticValueV2Schema,
  type SemanticCacheV2,
  type SemanticCacheResolutionV2
} from "../interpretation/semantic-cache-v2.js";
import {
  SemanticGenerationRequestV2Schema,
  semanticRequestDigestV2,
  type SemanticGenerationRequestV2
} from "../interpretation/semantic-request-v2.js";

/**
 * Paid diversity evaluation must observe a fresh model response for every
 * pre-registered case. This evaluation-only cache adapter deliberately has no
 * read, write, or singleflight state; it cannot be selected by a public route.
 */
export class DispatchOnlySemanticCacheV2 implements SemanticCacheV2 {
  async resolve(
    requestCandidate: unknown,
    dispatch: (request: SemanticGenerationRequestV2) => Promise<unknown>,
  ): Promise<SemanticCacheResolutionV2> {
    const request = SemanticGenerationRequestV2Schema.parse(requestCandidate);
    return {
      requestDigest: await semanticRequestDigestV2(request),
      cacheResult: "miss",
      value: CachedSemanticValueV2Schema.parse(await dispatch(request))
    };
  }
}
