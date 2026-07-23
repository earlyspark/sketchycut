import { describe, expect, it } from "vitest";

import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import {
  parseExposureCommandArguments,
  runExposureAuthorizationCommand
} from "../../tools/generation-exposure-command.js";

const digest = "a".repeat(64);

describe("reviewed exposure command", () => {
  it("defaults to a read-only dry run and reports the required durable summary", async () => {
    const store = new MemoryGenerationStore();
    const args = parseExposureCommandArguments([
      "--increase-usd", "5",
      "--evidence-sha256", digest,
      "--note", "Dry-run review"
    ]);
    const result = await runExposureAuthorizationCommand({
      store,
      arguments: args,
      authorizationId: "exposure-command-dry-run"
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

  it("applies the exact reviewed decimal increase once with an immutable evidence-bound record", async () => {
    const store = new MemoryGenerationStore();
    const result = await runExposureAuthorizationCommand({
      store,
      arguments: parseExposureCommandArguments([
        "--increase-usd", "11.05",
        "--evidence-sha256", digest,
        "--note", "Apply reviewed increase",
        "--apply"
      ]),
      now: new Date("2026-07-17T23:00:00.000Z"),
      authorizationId: "exposure-command-apply"
    });
    expect(result.applied).toBe(true);
    expect(result.output).toContain("ceiling is now $16.050000");
    expect(await store.readExposureAuthorizations()).toEqual([
      expect.objectContaining({
        authorizationId: "exposure-command-apply",
        evidenceSha256: digest,
        increaseMicrousd: 11_050_000,
        resultingAuthorizedCeilingMicrousd: 16_050_000,
        reviewNote: "Apply reviewed increase"
      })
    ]);
  });

  it("rejects invalid increments, missing review data, and unknown flags", () => {
    expect(() => parseExposureCommandArguments([
      "--increase-usd", "0", "--evidence-sha256", digest, "--note", "No"
    ])).toThrow("GENERATION_AUTHORIZATION_INCREMENT_INVALID");
    expect(() => parseExposureCommandArguments([
      "--increase-usd", "1.0000001", "--evidence-sha256", digest, "--note", "No"
    ])).toThrow("GENERATION_AUTHORIZATION_INCREMENT_INVALID");
    expect(() => parseExposureCommandArguments([
      "--increase-usd", "100.000001", "--evidence-sha256", digest, "--note", "No"
    ])).toThrow("GENERATION_AUTHORIZATION_INCREMENT_INVALID");
    expect(() => parseExposureCommandArguments([
      "--increase-usd", "5", "--evidence-sha256", digest
    ])).toThrow("GENERATION_AUTHORIZATION_EVIDENCE_AND_NOTE_REQUIRED");
    expect(() => parseExposureCommandArguments([
      "--increase-usd", "5", "--evidence-sha256", digest, "--note", "No", "--force"
    ])).toThrow("GENERATION_AUTHORIZATION_ARGUMENT_UNKNOWN_force");
  });

  it("never includes source environment secrets in output", async () => {
    const store = new MemoryGenerationStore();
    const secret = "upstash-secret-never-render";
    const result = await runExposureAuthorizationCommand({
      store,
      arguments: parseExposureCommandArguments([
        "--increase-usd", "5", "--evidence-sha256", digest, "--note", "Secret-free output"
      ]),
      authorizationId: "exposure-command-secret-free"
    });
    expect(result.output).not.toContain(secret);
    expect(result.output).not.toMatch(/token|redis_rest/i);
  });
});
