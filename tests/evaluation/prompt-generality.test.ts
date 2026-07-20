import { describe, expect, it } from "vitest";

import {
  PROMPT_EXAMPLE_CATALOG_V1,
  PromptExampleCatalogV1Schema,
  evaluatePromptGenerality,
  promptExampleCatalogHash,
  promptGeneralityPolicyHash
} from "../../src/evaluation/prompt-generality.js";
import {
  FROZEN_PROMPT_EXAMPLE_CATALOG_HASH,
  FROZEN_PROMPT_GENERALITY_POLICY_HASH
} from "../fixtures/intent-conditioned-construction/manifest.js";

describe("PromptGeneralityPolicyV1", () => {
  it("accepts generic symmetric schema guidance and the frozen disjoint example catalog", async () => {
    const report = await evaluatePromptGenerality({
      prompt: [
        "Interpret semantic purpose and cite only supplied evidence IDs.",
        "Access may be open-top, open-front, or covered.",
        "Interfaces may be rigid, revolute, or prismatic.",
        "Use bounded non-project scale evidence and dimensionless proportions; never emit project or panel dimensions."
      ].join(" ")
    });
    expect(report.pass).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.policyHash).toBe(await promptGeneralityPolicyHash());
    expect(report.catalogHash).toBe(await promptExampleCatalogHash());
    expect(report.policyHash).toBe(FROZEN_PROMPT_GENERALITY_POLICY_HASH);
    expect(report.catalogHash).toBe(FROZEN_PROMPT_EXAMPLE_CATALOG_HASH);
    expect(PromptExampleCatalogV1Schema.parse(PROMPT_EXAMPLE_CATALOG_V1).examples).toHaveLength(3);
  });

  it("rejects public-corpus aliases and case-specific object-to-answer associations", async () => {
    const report = await evaluatePromptGenerality({
      prompt: "Whenever the object is pencils, emit a long width-over-depth proportion. Put four SD cards into four spaces."
    });
    expect(report.pass).toBe(false);
    expect(report.issues.some((item) => item.code === "PROHIBITED_CASE_ALIAS")).toBe(true);
    expect(report.issues.some((item) => item.code === "PROHIBITED_CASE_ASSOCIATION")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("pencils");
    expect(JSON.stringify(report)).not.toContain("sd cards");
  });

  it("rejects a catalog revision that overlaps a frozen public object alias", async () => {
    const changed = structuredClone(PROMPT_EXAMPLE_CATALOG_V1);
    changed.examples[0]!.objectAliases = ["camera"];
    const report = await evaluatePromptGenerality({ prompt: "Interpret the strict schema.", catalog: changed });
    expect(report.pass).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({ code: "CATALOG_ALIAS_OVERLAP", location: "catalog" }));
  });
});
