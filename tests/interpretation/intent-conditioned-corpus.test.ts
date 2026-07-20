import { describe, expect, it } from "vitest";

import {
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/domain/fabrication-setup.js";
import { hashCanonical } from "../../src/domain/hash.js";
import { planIntentConditionedConstruction } from "../../src/interpretation/construction-planner.js";
import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import { generationOutcomeV2FromPlanner } from "../../src/interpretation/generation-outcome-v2.js";
import { authorizeIntentGraphV2Evidence } from "../../src/interpretation/intent-graph-v2.js";
import { buildSourceEvidenceIndex } from "../../src/interpretation/source-evidence.js";
import { FROZEN_CONSTRUCTION_CORPUS } from "../fixtures/intent-conditioned-construction/corpus.js";
import { frozenSemanticFixture } from "../fixtures/intent-conditioned-construction/semantic-fixtures.js";

function references(count: 0 | 1 | 3) {
  return Array.from({ length: count }, (_, index) => ({
    referenceId: `fixture-reference-${String(index + 1)}`,
    sha256: (index + 1).toString(16).padStart(64, "0"),
    mediaType: "image/png" as const,
    width: 640,
    height: 480
  }));
}

function advancedSizing(candidate: typeof FROZEN_CONSTRUCTION_CORPUS[number]) {
  if (candidate.advancedSizing === null) return { basis: "auto" as const };
  const { basis, widthMm, depthMm, heightMm } = candidate.advancedSizing as {
    basis: "exact-external" | "exact-internal";
    widthMm?: number;
    depthMm?: number;
    heightMm?: number;
  };
  return {
    basis,
    dimensions: {
      ...(widthMm === undefined ? {} : { widthMm }),
      ...(depthMm === undefined ? {} : { depthMm }),
      ...(heightMm === undefined ? {} : { heightMm })
    }
  };
}

function sourceCategoryAlternatives(expected: string): readonly string[] {
  if (expected === "parsed-exact") return ["exact-external", "exact-internal", "exact-contained-object"];
  if (expected === "advanced-exact") return ["exact-external", "exact-internal"];
  if (expected === "contained-object-exact") return ["exact-contained-object"];
  if (expected === "model-prior-object-scale") return ["model-prior-scale"];
  return [expected];
}

describe("frozen 28-case intent-conditioned construction corpus", () => {
  for (const candidate of FROZEN_CONSTRUCTION_CORPUS) {
    it(candidate.id, async () => {
      const descriptors = references(candidate.referenceCount);
      const parsed = await buildSourceEvidenceIndex({
        brief: candidate.brief,
        references: descriptors,
        roleConstraints: descriptors.map((item) => ({ referenceId: item.referenceId, roles: ["structure" as const] }))
      });
      const explicitSizing = await reconcileExplicitSizingConstraints({
        advancedSizing: advancedSizing(candidate),
        parsedConstraints: parsed.parsedConstraints,
        parserFindings: parsed.parserFindings
      });
      const intent = frozenSemanticFixture({ caseId: candidate.id, sourceEvidenceIndex: parsed.sourceEvidenceIndex });
      expect(authorizeIntentGraphV2Evidence({ intent, sourceEvidenceIndex: parsed.sourceEvidenceIndex })).toMatchObject({ success: true });
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
        pin: createStarterPinSetup(),
        ...(candidate.id === "deliberate-search-budget-exhaustion" ? { candidateBudget: 0 } : {})
      });
      const semanticRequestDigest = await hashCanonical({
        semanticBrief: parsed.semanticBrief,
        sourceEvidenceIndexDigest: parsed.sourceEvidenceIndex.digest,
        referenceDigests: descriptors.map((item) => item.sha256)
      });
      const outcome = await generationOutcomeV2FromPlanner({
        requestId: `corpus-${candidate.id}`,
        transportMode: "fixture",
        semanticRequestDigest,
        sourceEvidenceIndexDigest: parsed.sourceEvidenceIndex.digest,
        promptIdentity: "frozen-fixture-transport",
        promptHash: await hashCanonical("frozen-fixture-transport"),
        modelId: "strict-fixture-intent-v2",
        cacheResult: "miss",
        attemptId: null,
        providerRequestId: null,
        intent,
        explicitSizing,
        planning
      });

      expect(outcome.kind).toBe(candidate.expected.outcome);
      expect(outcome.kind === "failure" ? [outcome.code] : outcome.findingCodes).toEqual([...candidate.expected.findingCodes].sort());
      expect(outcome.fabricationCandidate).toBe(candidate.expected.fabricationCandidate);
      expect(outcome.exportAllowed).toBe(candidate.expected.exportAllowed);

      const expectedExact = candidate.parser.filter((item) => item.marker === "exact");
      expect(parsed.parsedConstraints).toHaveLength(expectedExact.length);
      for (const expected of expectedExact) {
        const matching = explicitSizing.constraints.find((item) => {
          if (item.target.subject === "project") {
            return expected.targetId === `project.${item.target.envelope}.${item.target.axis}` &&
              (expected.findingCode === null ? item.status === "active" : item.source === "brief");
          }
          return expected.targetId === `contained.${item.target.objectId}.${item.target.axis}` &&
            (expected.findingCode === null ? item.status === "active" : item.source === "brief");
        });
        expect(matching, expected.targetId).toBeDefined();
        expect(matching?.status === "active").toBe(expected.active);
        expect(matching?.findingCode).toBe(expected.findingCode);
      }
      for (const expected of candidate.parser.filter((item) => item.marker === "approximate" || item.marker === "range")) {
        expect(parsed.parserFindings).toContainEqual(expect.objectContaining({
          code: expected.findingCode,
          reason: expected.marker
        }));
      }

      if (planning.kind === "planned") {
        expect(outcome.kind === "supported" || outcome.kind === "simplified").toBe(true);
        const selected = planning.selected;
        expect(selected.topology.canonicalSpaces).toHaveLength(candidate.expected.canonicalSpaces);
        if (candidate.expected.mechanism === "revolute") expect(selected.topology.mechanism).toBe("retained-pin");
        else if (candidate.expected.mechanism === "prismatic") expect(selected.topology.mechanism).toBe("captured-slide");
        else if (intent.access.some((item) => item.kind === "covered")) {
          // Frozen "rigid" means no moving interface was requested. Construction still
          // needs an access realization, so the planner must select and disclose one.
          expect(intent.interfaces.filter((item) => item.behavior !== "rigid")).toHaveLength(0);
          expect(selected.topology.mechanism).not.toBe("rigid");
          expect(selected.plan?.assumptions).toContainEqual(expect.objectContaining({
            id: "moving-cover-realization-assumption"
          }));
        } else expect(selected.topology.mechanism).toBe("rigid");
        for (const expectedSource of candidate.expected.sizingSources) {
          expect(sourceCategoryAlternatives(expectedSource).some((item) =>
            selected.sizing.kind === "solved" && (selected.sizing.sourceCategories as readonly string[]).includes(item)
          ), expectedSource).toBe(true);
        }
        expect(selected.compiled?.compiled.document.validation.status).toBe("pass");
        expect(selected.compiled?.importComplexity.every((item) => item.withinCurrentLimit)).toBe(true);
        const bundle = selected.compiled!.compiled.bundle;
        expect(new Set([
          bundle.sourceDocumentHash,
          bundle.fabrication.sourceDocumentHash,
          bundle.scene.sourceDocumentHash,
          bundle.bom.sourceDocumentHash,
          bundle.legend?.sourceDocumentHash,
          bundle.instructions?.sourceDocumentHash
        ])).toHaveLength(1);
        expect(bundle.bom.entries.length).toBeGreaterThanOrEqual(selected.plan!.panels.length);
        expect(bundle.instructions?.steps.length).toBeGreaterThan(0);
        expect(selected.compiled!.compiled.svgs.every((item) => item.sha256.length === 64)).toBe(true);
        if (candidate.expected.canonicalSpaces > 1) {
          expect(selected.compiled!.compiled.document.parts.filter((item) => item.id.startsWith("divider-"))).toHaveLength(
            candidate.expected.canonicalSpaces - 1,
          );
          expect(bundle.instructions?.steps.some((step) => step.partIds.some((id) => id.startsWith("divider-")))).toBe(true);
        }
      } else {
        expect(outcome.fabricationCandidate).toBe(false);
        expect(outcome.exportAllowed).toBe(false);
        expect(outcome.canonicalResult).toBeNull();
      }
    }, 30_000);
  }
});
