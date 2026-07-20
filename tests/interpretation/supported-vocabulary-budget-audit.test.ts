import { describe, expect, it } from "vitest";

import {
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/domain/fabrication-setup.js";
import { DEFAULT_CONSTRUCTION_CANDIDATE_BUDGET } from "../../src/interpretation/construction-planner.js";
import { runSupportedVocabularyBudgetAudit } from "../helpers/supported-vocabulary-budget-audit.js";

describe("SupportedVocabularyBudgetAuditV1", () => {
  it("exhaustively compiles every mutually compatible registered topology combination within budget", async () => {
    const setup = resolveFabricationSetup(createPublicFabricationSetup());
    const audit = await runSupportedVocabularyBudgetAudit({
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
    expect(audit.complete).toBe(true);
    expect(audit.records).toHaveLength(80);
    expect(audit.maximumCandidatesAfterHardPruning).toBeLessThan(DEFAULT_CONSTRUCTION_CANDIDATE_BUDGET);
    expect(audit.maximumCandidatesSolved).toBe(audit.maximumCandidatesAfterHardPruning);
    expect(audit.records.every((item) => item.candidatesCompiled > 0)).toBe(true);
    expect(audit.records.filter((item) => item.outcomeKind === "planned").every((item) =>
      item.selectedCandidateId !== null && item.selectedSheetsWithinImportBudget === true
    )).toBe(true);
    expect(audit.records.filter((item) => item.outcomeKind === "concept-only").every((item) =>
      item.unsupportedFindingCodes.includes("STUDIO_IMPORT_COMPLEXITY_EXCEEDED")
    )).toBe(true);
    expect(audit.records.some((item) => item.pruningProofs.length > 0)).toBe(true);
  }, 120_000);
});
