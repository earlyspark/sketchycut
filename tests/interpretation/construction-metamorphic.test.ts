import { describe, expect, it } from "vitest";

import { createPublicFabricationSetup, createStarterPinSetup, resolveFabricationSetup } from "../../src/domain/fabrication-setup.js";
import { planIntentConditionedConstruction } from "../../src/interpretation/construction-planner.js";
import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import type { IntentGraphV2 } from "../../src/interpretation/intent-graph-v2.js";
import { buildSourceEvidenceIndex } from "../../src/interpretation/source-evidence.js";
import { frozenSemanticFixture } from "../fixtures/intent-conditioned-construction/semantic-fixtures.js";

async function run(input: {
  brief: string;
  caseId: Parameters<typeof frozenSemanticFixture>[0]["caseId"];
  mutateIntent?: (intent: IntentGraphV2) => void;
}) {
  const parsed = await buildSourceEvidenceIndex({ brief: input.brief, references: [], roleConstraints: [] });
  const intent = frozenSemanticFixture({ caseId: input.caseId, sourceEvidenceIndex: parsed.sourceEvidenceIndex });
  input.mutateIntent?.(intent);
  const explicitSizing = await reconcileExplicitSizingConstraints({
    advancedSizing: { basis: "auto" },
    parsedConstraints: parsed.parsedConstraints,
    parserFindings: parsed.parserFindings
  });
  const setup = resolveFabricationSetup(createPublicFabricationSetup());
  const planning = await planIntentConditionedConstruction({
    intent,
    explicitConstraints: explicitSizing,
    profiles: {
      material: setup.material,
      machine: setup.machine,
      processRecipe: setup.processRecipe,
      fabricationContext: setup.fabricationContext,
      fit: setup.fit
    },
    inputPolicyEvaluation: setup.inputPolicyEvaluation,
    pin: createStarterPinSetup()
  });
  if (planning.kind !== "planned") throw new Error(`expected planned: ${planning.kind}`);
  if (planning.selected.sizing.kind !== "solved") throw new Error("selected sizing must be solved");
  return { parsed, intent, explicitSizing, planning, selectedSizing: planning.selected.sizing };
}

describe("intent-conditioned construction metamorphic behavior", () => {
  it("keeps equivalent paraphrases on the same deterministic sizing, plan, and geometry", async () => {
    const first = await run({
      caseId: "divided-organizer",
      brief: "Make an open-top divided organizer with two equal spaces."
    });
    const second = await run({
      caseId: "divided-organizer",
      brief: "Please create an organizer split into two equal compartments and open at the top."
    });
    expect(first.planning.selected.sizing).toEqual(second.planning.selected.sizing);
    expect(first.planning.selected.plan).toEqual(second.planning.selected.plan);
    expect(first.planning.selected.compiled?.compiled.geometryHash).toBe(second.planning.selected.compiled?.compiled.geometryHash);
  });

  it("changes construction when supported access, compartment, proportion, or motion meaning changes", async () => {
    const openTop = await run({ caseId: "open-top-catchall", brief: "Make an open-top catchall." });
    const openFront = await run({ caseId: "open-front-cubby", brief: "Make an open-front cubby." });
    expect(openTop.planning.selected.topology.access).not.toBe(openFront.planning.selected.topology.access);
    expect(openTop.planning.selected.compiled?.compiled.geometryHash).not.toBe(openFront.planning.selected.compiled?.compiled.geometryHash);

    const one = await run({ caseId: "one-compartment-control", brief: "Make one compartment for SD cards." });
    const four = await run({ caseId: "four-sd-card-compartments", brief: "Make four compartments for SD cards." });
    expect(one.planning.selected.topology.canonicalSpaces).toHaveLength(1);
    expect(four.planning.selected.topology.canonicalSpaces).toHaveLength(4);
    expect(one.planning.selected.compiled?.compiled.geometryHash).not.toBe(four.planning.selected.compiled?.compiled.geometryHash);

    const retained = await run({ caseId: "retained-pin-keepsake-enclosure", brief: "Use a retained-pin hinged cover." });
    const captured = await run({ caseId: "captured-sliding-card-enclosure", brief: "Use a captured sliding cover." });
    expect(retained.planning.selected.topology.mechanism).toBe("retained-pin");
    expect(captured.planning.selected.topology.mechanism).toBe("captured-slide");

    const base = await run({ caseId: "flat-wide-tray", brief: "Make a flat wide tray." });
    const altered = await run({
      caseId: "flat-wide-tray",
      brief: "Make a flat wide tray.",
      mutateIntent: (intent) => {
        intent.proportions[0]!.strength = "moderate";
      }
    });
    expect(base.selectedSizing.decisionHash).not.toBe(altered.selectedSizing.decisionHash);
    expect(base.planning.selected.compiled?.compiled.geometryHash).not.toBe(altered.planning.selected.compiled?.compiled.geometryHash);
  });

  it("keeps value-only exact edits out of semantics while deterministically changing geometry", async () => {
    const first = await run({
      caseId: "feasible-exact-external",
      brief: "Make an open-top box with project external width 150 mm, project external depth 100 mm, and project external height 60 mm."
    });
    const second = await run({
      caseId: "feasible-exact-external",
      brief: "Make an open-top box with project external width 155 mm, project external depth 100 mm, and project external height 60 mm."
    });
    expect(first.parsed.semanticBrief).toBe(second.parsed.semanticBrief);
    expect(first.parsed.sourceEvidenceIndex.digest).toBe(second.parsed.sourceEvidenceIndex.digest);
    expect(first.explicitSizing.digest).not.toBe(second.explicitSizing.digest);
    expect(first.selectedSizing.external.widthUm).toBe(150_000);
    expect(second.selectedSizing.external.widthUm).toBe(155_000);
    expect(first.planning.selected.compiled?.compiled.geometryHash).not.toBe(second.planning.selected.compiled?.compiled.geometryHash);
  });
});
