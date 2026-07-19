import { describe, expect, it } from "vitest";

import {
  buildFabricationEvidenceProjection,
  compileOrthogonalPanelProgram,
  compileRetainedPinProgram,
  createCompactFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/index.js";
import { createRetainedPreset } from "../../src/ui/content/presets.js";
import { createPrimaryPreset } from "../../src/ui/content/presets.js";

describe("source-aware fabrication evidence projection", () => {
  it("projects a pinless orthogonal document with an explicit null pin basis", async () => {
    const resolved = resolveFabricationSetup(createCompactFabricationSetup());
    const profiles = {
      material: resolved.material,
      machine: resolved.machine,
      processRecipe: resolved.processRecipe,
      fabricationContext: resolved.fabricationContext,
      fit: resolved.fit
    };
    const document = await compileOrthogonalPanelProgram(
      createPrimaryPreset("medium", profiles),
      profiles,
      resolved.inputPolicyEvaluation,
    );
    const projection = await buildFabricationEvidenceProjection(document);
    expect(document.externalStock).toBeUndefined();
    expect(projection.pinDiameterBasis).toBeNull();
    expect(projection.runtimeApplicationApiCalls).toBe(0);
  });

  it("projects starter claims from canonical/evaluated state and survives replay", async () => {
    const applied = createCompactFabricationSetup();
    const appliedPin = createStarterPinSetup();
    const resolved = resolveFabricationSetup(applied);
    const profiles = {
      material: resolved.material,
      machine: resolved.machine,
      processRecipe: resolved.processRecipe,
      fabricationContext: resolved.fabricationContext,
      fit: resolved.fit
    };
    const program = createRetainedPreset("medium", profiles, {
      effectiveDiameterMm: appliedPin.effectiveDiameterMm,
      basis: appliedPin.basis
    });
    const document = (await compileRetainedPinProgram(
      program,
      profiles,
      resolved.inputPolicyEvaluation,
    )).document;
    const projection = await buildFabricationEvidenceProjection(document);
    const replayed = await buildFabricationEvidenceProjection(structuredClone(document));
    expect(projection).toEqual(replayed);
    expect(projection.claim).toContain("starter estimates");
    expect(projection).toMatchObject({
      outcome: "fabrication-candidate",
      thickness: {
        basis: "nominal-preset",
        effectiveThicknessMm: 3,
        readingCount: 0
      },
      cutWidth: { source: "provisional-preset", xMm: 0.15, yMm: 0.15 },
      pinDiameterBasis: "nominal-preset",
      physicalVerification: "required",
      runtimeApplicationApiCalls: 0
    });
    expect(projection.inputFindingCodes).toContain("STOCK_THICKNESS_UNMEASURED");
  });
});
