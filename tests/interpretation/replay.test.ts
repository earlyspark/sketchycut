import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { FixtureReplayTransport } from "../../src/interpretation/replay.js";

const fixtureUrl = new URL("../fixtures/replay/offline-coupon.json", import.meta.url);

describe("offline fixture replay", () => {
  it("returns strict semantic intent with network disabled and zero runtime API calls", async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as unknown;
    const transport = await FixtureReplayTransport.create([fixture]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network disabled for ordinary tests."));

    const request = (fixture as { request: unknown }).request;
    const response = await transport.interpret(request);

    expect(response.fixtureId).toBe("offline-coupon-intent");
    expect(transport.networkAllowed).toBe(false);
    expect(transport.runtimeApplicationApiCalls).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("fails closed when a request has no exact pinned digest", async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as unknown;
    const transport = await FixtureReplayTransport.create([fixture]);
    const request = {
      ...(fixture as { request: Record<string, unknown> }).request,
      title: "Changed request"
    };
    await expect(transport.interpret(request)).rejects.toThrow(
      "No offline replay fixture matches",
    );
  });
});
