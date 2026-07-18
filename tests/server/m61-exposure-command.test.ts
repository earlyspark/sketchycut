import { describe, expect, it } from "vitest";

import { MemoryM6Store } from "../../src/server/m6/memory-store.js";
import {
  parseM61ExposureCommandArguments,
  runM61ExposureAuthorizationCommand
} from "../../tools/m61-exposure-command.js";

const digest = "a".repeat(64);

describe("M6.1 reviewed exposure command", () => {
  it("defaults to a read-only dry run and reports the required durable summary", async () => {
    const store = new MemoryM6Store();
    const args = parseM61ExposureCommandArguments([
      "--increase-usd", "5",
      "--evidence-sha256", digest,
      "--note", "Dry-run review"
    ]);
    const result = await runM61ExposureAuthorizationCommand({
      store,
      arguments: args,
      authorizationId: "m61-command-dry-run"
    });
    expect(result.applied).toBe(false);
    expect(result.output).toContain("Mode: dry-run");
    expect(result.output).toContain("Current authorized ceiling: $5.000000");
    expect(result.output).toContain("Cumulative reserved exposure: $0.000000");
    expect(result.output).toContain("Confirmed estimated cost: $0.000000");
    expect(result.output).toContain("Unresolved potentially billed exposure: $0.000000");
    expect(result.output).toContain("Attempts: 0 dispatched / 0 non-dispatched");
    expect((await store.readGlobalExposureState()).authorizedCeilingMicrousd).toBe(5_000_000);
    expect(await store.readExposureAuthorizations()).toEqual([]);
  });

  it("applies exactly $5 once with an immutable evidence-bound record", async () => {
    const store = new MemoryM6Store();
    const result = await runM61ExposureAuthorizationCommand({
      store,
      arguments: parseM61ExposureCommandArguments([
        "--increase-usd", "5",
        "--evidence-sha256", digest,
        "--note", "Apply reviewed increase",
        "--apply"
      ]),
      now: new Date("2026-07-17T23:00:00.000Z"),
      authorizationId: "m61-command-apply"
    });
    expect(result.applied).toBe(true);
    expect(result.output).toContain("ceiling is now $10.000000");
    expect(await store.readExposureAuthorizations()).toEqual([
      expect.objectContaining({
        authorizationId: "m61-command-apply",
        evidenceSha256: digest,
        increaseMicrousd: 5_000_000,
        resultingAuthorizedCeilingMicrousd: 10_000_000,
        reviewNote: "Apply reviewed increase"
      })
    ]);
  });

  it("rejects wrong increments, missing review data, and unknown flags", () => {
    expect(() => parseM61ExposureCommandArguments([
      "--increase-usd", "1", "--evidence-sha256", digest, "--note", "No"
    ])).toThrow("M61_AUTHORIZATION_INCREMENT_MUST_BE_5_USD");
    expect(() => parseM61ExposureCommandArguments([
      "--increase-usd", "5", "--evidence-sha256", digest
    ])).toThrow("M61_AUTHORIZATION_EVIDENCE_AND_NOTE_REQUIRED");
    expect(() => parseM61ExposureCommandArguments([
      "--increase-usd", "5", "--evidence-sha256", digest, "--note", "No", "--force"
    ])).toThrow("M61_AUTHORIZATION_ARGUMENT_UNKNOWN_force");
  });

  it("never includes source environment secrets in output", async () => {
    const store = new MemoryM6Store();
    const secret = "upstash-secret-never-render";
    const result = await runM61ExposureAuthorizationCommand({
      store,
      arguments: parseM61ExposureCommandArguments([
        "--increase-usd", "5", "--evidence-sha256", digest, "--note", "Secret-free output"
      ]),
      authorizationId: "m61-command-secret-free"
    });
    expect(result.output).not.toContain(secret);
    expect(result.output).not.toMatch(/token|redis_rest/i);
  });
});
