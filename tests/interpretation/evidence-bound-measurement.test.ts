import { describe, expect, it } from "vitest";

import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import { bindEvidenceMeasurements } from "../../src/interpretation/measurement-binding.js";
import {
  authorizeSemanticInterpretation,
  expandSemanticInterpretationCandidate
} from "../../src/interpretation/semantic-model-contract.js";
import { buildSourceEvidenceIndex } from "../../src/interpretation/source-evidence.js";
import { basicSemanticCandidate } from "../helpers/semantic-interpretation.js";

async function measurementFixture(input: {
  brief: string;
  literal: string;
  interpretation: "exact" | "approximate" | "range" | "ambiguous";
}) {
  const source = await buildSourceEvidenceIndex({ brief: input.brief, references: [], roleConstraints: [] });
  const candidate = basicSemanticCandidate({ sourceEvidenceIndex: source.sourceEvidenceIndex });
  const start = source.semanticBrief.indexOf(input.literal);
  if (start < 0) throw new Error("TEST_LITERAL_MISSING");
  candidate.items[0]!.measurements = [{
    target: { subject: "project", envelope: "external", axis: "width" },
    interpretation: input.interpretation,
    literal: {
      evidenceId: source.sourceEvidenceIndex.spans[0]!.evidenceId,
      start,
      end: start + input.literal.length
    }
  }];
  return {
    source,
    candidate,
    semantic: expandSemanticInterpretationCandidate(candidate, source.sourceEvidenceIndex)
  };
}

describe("evidence-bound semantic measurement targeting", () => {
  it("verifies the unchanged literal and deterministically converts a supported unit", async () => {
    const { source, candidate, semantic } = await measurementFixture({
      brief: "Please make it 12.5 cm wide on the outside.",
      literal: "12.5 cm",
      interpretation: "exact"
    });
    expect(source.semanticBrief).toBe("Please make it 12.5 cm wide on the outside.");
    expect(Object.keys(source)).toEqual(["semanticBrief", "sourceEvidenceIndex"]);
    expect(authorizeSemanticInterpretation({
      interpretation: candidate,
      sourceEvidenceIndex: source.sourceEvidenceIndex
    }).success).toBe(true);
    const bound = bindEvidenceMeasurements({
      semanticBrief: source.semanticBrief,
      sourceEvidenceIndex: source.sourceEvidenceIndex,
      interpretation: semantic
    });
    expect(bound.parsedConstraints).toEqual([
      expect.objectContaining({
        source: "brief",
        target: { subject: "project", envelope: "external", axis: "width" },
        valueUm: 125_000,
        status: "active"
      })
    ]);
    expect(bound.parserFindings).toEqual([]);
    expect(bound.blockingInventoryItemIds).toEqual([]);
  });

  it("does not promote approximate, ambiguous, unsupported-unit, or tampered spans", async () => {
    const cases = [
      { brief: "Around 80 mm wide.", literal: "80 mm", interpretation: "approximate" as const, code: "SIZING_MEASUREMENT_IGNORED" },
      { brief: "It should be 80 mm somewhere.", literal: "80 mm", interpretation: "ambiguous" as const, code: "SIZING_MEASUREMENT_AMBIGUOUS" },
      { brief: "La anchura debe ser 4 pulgadas.", literal: "4 pulgadas", interpretation: "exact" as const, code: "SIZING_MEASUREMENT_UNVERIFIABLE" }
    ];
    for (const candidate of cases) {
      const { source, semantic } = await measurementFixture(candidate);
      const bound = bindEvidenceMeasurements({
        semanticBrief: source.semanticBrief,
        sourceEvidenceIndex: source.sourceEvidenceIndex,
        interpretation: semantic
      });
      expect(bound.parsedConstraints, candidate.brief).toEqual([]);
      expect(bound.parserFindings[0]?.code, candidate.brief).toBe(candidate.code);
      expect(bound.blockingInventoryItemIds, candidate.brief).toEqual(
        candidate.interpretation === "approximate" ? [] : ["inventory-item-1"]
      );
    }

    const tampered = await measurementFixture({ brief: "Exactly 90 mm wide.", literal: "90 mm", interpretation: "exact" });
    tampered.candidate.items[0]!.measurements[0]!.literal.end += 100;
    const authorization = authorizeSemanticInterpretation({
      interpretation: tampered.candidate,
      sourceEvidenceIndex: tampered.source.sourceEvidenceIndex
    });
    expect(authorization).toMatchObject({
      success: true,
      findings: [expect.objectContaining({ code: "MEASUREMENT_SPAN_UNVERIFIED" })]
    });
    const tamperedBinding = bindEvidenceMeasurements({
      semanticBrief: tampered.source.semanticBrief,
      sourceEvidenceIndex: tampered.source.sourceEvidenceIndex,
      interpretation: expandSemanticInterpretationCandidate(
        tampered.candidate,
        tampered.source.sourceEvidenceIndex,
      )
    });
    expect(tamperedBinding.parsedConstraints).toEqual([]);
    expect(tamperedBinding.blockingInventoryItemIds).toEqual(["inventory-item-1"]);
  });

  it("gives explicit advanced sizing precedence over a verified brief target", async () => {
    const { source, semantic } = await measurementFixture({
      brief: "Make the outside width 90 mm.",
      literal: "90 mm",
      interpretation: "exact"
    });
    const measured = bindEvidenceMeasurements({
      semanticBrief: source.semanticBrief,
      sourceEvidenceIndex: source.sourceEvidenceIndex,
      interpretation: semantic
    });
    const reconciled = await reconcileExplicitSizingConstraints({
      advancedSizing: { basis: "exact-external", dimensions: { widthMm: 100 } },
      parsedConstraints: measured.parsedConstraints,
      parserFindings: measured.parserFindings
    });
    expect(reconciled.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "advanced", valueUm: 100_000, status: "active" }),
      expect.objectContaining({ source: "brief", valueUm: 90_000, status: "overridden" })
    ]));
  });
});
