import { z } from "zod";

import { StableIdSchema } from "../src/domain/contracts.js";

export const LivePriceSchema = z.object({
  id: StableIdSchema,
  uncachedInputUsdPerMillion: z.number().nonnegative(),
  cachedInputUsdPerMillion: z.number().nonnegative(),
  outputUsdPerMillion: z.number().nonnegative(),
  requestBudgetUpperBoundUsd: z.number().positive()
}).strict();

export const LiveEvaluationConfigSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    promptPath: z.string().min(1),
    promptVersion: z.string().regex(/^m5-interpretation-prompt@\d+\.\d+\.\d+$/),
    models: z.record(z.string().min(1), z
      .object({
        reasoningEffort: z.literal("low"),
        maxOutputTokens: z.number().int().positive().max(4_000),
        serviceTier: z.enum(["auto", "default", "priority"]),
        price: LivePriceSchema
      })
      .strict())
  })
  .strict();

export type LiveEvaluationConfig = z.infer<typeof LiveEvaluationConfigSchema>;
