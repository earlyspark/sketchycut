import { describe, expect, it } from "vitest";

import { LiveCallBillingSchema } from "../../src/interpretation/live-ledger.js";
import { LivePriceSchema } from "../../tools/m5-live-config.js";

describe("M5 live price configuration", () => {
  it("accepts a price identifier that can be recorded by the completed-call ledger", () => {
    const price = LivePriceSchema.parse({
      id: "openai-public-pricing-2026-07-17-gpt-5-6-terra",
      uncachedInputUsdPerMillion: 2.5,
      cachedInputUsdPerMillion: 0.25,
      outputUsdPerMillion: 15,
      requestBudgetUpperBoundUsd: 0.25
    });
    expect(() => LiveCallBillingSchema.parse({
      state: "confirmed-billed",
      estimatedCostUsd: 0.001,
      requestBudgetUpperBoundUsd: price.requestBudgetUpperBoundUsd,
      priceSnapshotId: price.id
    })).not.toThrow();
  });

  it("rejects dotted identifiers before a network dispatch can start", () => {
    expect(() => LivePriceSchema.parse({
      id: "openai-public-pricing-2026-07-17-gpt-5.6-terra",
      uncachedInputUsdPerMillion: 2.5,
      cachedInputUsdPerMillion: 0.25,
      outputUsdPerMillion: 15,
      requestBudgetUpperBoundUsd: 0.25
    })).toThrow();
  });
});
