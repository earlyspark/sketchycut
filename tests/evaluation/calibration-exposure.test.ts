import { describe, expect, it } from "vitest";

import { parseReadOnlyExposureRecord } from "../../tools/run-live-diversity-evaluation.js";

describe("read-only calibration exposure state", () => {
  it("parses an exact durable state without filling missing values", () => {
    expect(parseReadOnlyExposureRecord({
      authorizedCeilingMicrousd: "45000000",
      reservedExposureMicrousd: 42500000,
      authorizationVersion: "8"
    })).toEqual({
      schemaVersion: "1.0",
      authorizedCeilingMicrousd: 45000000,
      reservedExposureMicrousd: 42500000,
      authorizationVersion: 8
    });
  });

  it.each([
    null,
    {},
    { authorizedCeilingMicrousd: "45000000", reservedExposureMicrousd: "42500000" }
  ])("rejects an absent or incomplete durable record: %o", (record) => {
    expect(() => parseReadOnlyExposureRecord(record)).toThrow(
      "CALIBRATION_READ_ONLY_EXPOSURE_STATE_MISSING",
    );
  });
});
