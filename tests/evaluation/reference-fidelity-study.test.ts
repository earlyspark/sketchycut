import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  REFERENCE_FIDELITY_STUDY_CASE_IDS,
  REFERENCE_FIDELITY_STUDY_CONFIGURATIONS,
  REFERENCE_FIDELITY_STUDY_MAX_DISPATCHES,
  validateReferenceFidelityStudyDefinition
} from "../../src/evaluation/reference-fidelity-study.js";

describe("frozen M7.1 Sol configuration study", () => {
  it("predeclares a fixed, non-adaptive five-by-five comparison matrix", async () => {
    expect(validateReferenceFidelityStudyDefinition()).toBeUndefined();
    expect(REFERENCE_FIDELITY_STUDY_CONFIGURATIONS).toHaveLength(5);
    expect(REFERENCE_FIDELITY_STUDY_CASE_IDS).toHaveLength(5);
    expect(REFERENCE_FIDELITY_STUDY_MAX_DISPATCHES).toBe(25);
    const manifest = JSON.parse(await readFile(
      new URL("../fixtures/reference-fidelity/manifest.json", import.meta.url), "utf8"
    )) as {
      schemaVersion: string;
      corpusId: string;
      cases: {
        id: string;
        partition: string;
        relationshipAcceptance: string[];
        outcomeAcceptance: string;
      }[];
    };
    expect(manifest.schemaVersion).toBe("2.0");
    expect(manifest.corpusId).toBe("m7-1-reference-fidelity-v2");
    const comparisonIds = new Set(manifest.cases.filter((item) => item.partition === "comparison").map((item) => item.id));
    expect(REFERENCE_FIDELITY_STUDY_CASE_IDS.every((id) => comparisonIds.has(id))).toBe(true);
    expect(new Set(manifest.cases.flatMap((item) => item.relationshipAcceptance))).toEqual(
      new Set(["exact", "non-context"]),
    );
    expect(new Set(manifest.cases.map((item) => item.outcomeAcceptance))).toEqual(
      new Set(["exact", "supported-or-disclosed-simplified"]),
    );
  });

  it("isolates the declared image-detail, reasoning, and prompt-layout comparisons", () => {
    const byId = new Map(REFERENCE_FIDELITY_STUDY_CONFIGURATIONS.map((item) => [item.id, item]));
    expect(byId.get("low-medium-request-local-control")).toMatchObject({
      reasoningEffort: "medium", imageDetailPolicy: "low", promptLayoutVersion: "request-local-control-v1"
    });
    expect(byId.get("low-medium-stable-prefix")).toMatchObject({
      reasoningEffort: "medium", imageDetailPolicy: "low", promptLayoutVersion: "stable-prefix-v2"
    });
    expect(byId.get("high-medium-stable-prefix")).toMatchObject({
      reasoningEffort: "medium", imageDetailPolicy: "high", promptLayoutVersion: "stable-prefix-v2"
    });
    expect(byId.get("high-high-stable-prefix")).toMatchObject({
      reasoningEffort: "high", imageDetailPolicy: "high", promptLayoutVersion: "stable-prefix-v2"
    });
    expect(byId.get("mixed-medium-stable-prefix")).toMatchObject({
      reasoningEffort: "medium", imageDetailPolicy: "mixed-first-high", promptLayoutVersion: "stable-prefix-v2"
    });
    expect(REFERENCE_FIDELITY_STUDY_CONFIGURATIONS.map((item) => item.store)).toEqual([
      false, false, false, false, false
    ]);
  });
});
