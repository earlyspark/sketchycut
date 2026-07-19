import { describe, expect, it } from "vitest";

import { LiveCallBillingSchema } from "../../src/interpretation/live-ledger.js";
import { GENERATION_TERRA_PRICE } from "../../src/server/generation/openai-transport.js";

describe("live price configuration", () => {
  it("accepts a price identifier that can be recorded by the completed-call ledger", () => {
    const price = GENERATION_TERRA_PRICE;
    expect(() => LiveCallBillingSchema.parse({
      state: "confirmed-billed",
      estimatedCostUsd: 0.001,
      requestBudgetUpperBoundUsd: price.requestBudgetUpperBoundUsd,
      priceSnapshotId: price.id
    })).not.toThrow();
  });

  it("rejects dotted identifiers before a network dispatch can start", () => {
    expect(() => LiveCallBillingSchema.parse({
      state: "confirmed-billed",
      estimatedCostUsd: 0.001,
      requestBudgetUpperBoundUsd: 0.25,
      priceSnapshotId: "openai-public-pricing-2026-07-17-gpt-5.6-terra"
    })).toThrow();
  });
});
