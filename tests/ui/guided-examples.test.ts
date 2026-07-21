import { describe, expect, it } from "vitest";

import {
  buildXToolStudioHandoff,
  canonicalDocumentHash,
  createCompactFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup,
  sha256
} from "../../src/index.js";
import {
  AVAILABLE_GUIDED_EXAMPLES,
  DEFAULT_GUIDED_EXAMPLE,
  GUIDED_EXAMPLE_CATALOG,
  buildGuidedProductCompileRequest
} from "../../src/ui/content/guided-examples.js";
import {
  compileFixtureRequest,
  compileProductRequest
} from "../../src/workers/compile-service.js";

function starterInputs() {
  const applied = createCompactFabricationSetup();
  const resolved = resolveFabricationSetup(applied);
  const profiles = {
    material: resolved.material,
    machine: resolved.machine,
    processRecipe: resolved.processRecipe,
    fabricationContext: resolved.fabricationContext,
    fit: resolved.fit
  };
  return { applied, resolved, profiles };
}

describe("presentation-only guided example catalog", () => {
  it("is ordered, unique, and has one Basic default", () => {
    expect(GUIDED_EXAMPLE_CATALOG.map((entry) => entry.order)).toEqual([1, 2, 3]);
    expect(new Set(GUIDED_EXAMPLE_CATALOG.map((entry) => entry.id)).size).toBe(3);
    expect(DEFAULT_GUIDED_EXAMPLE).toMatchObject({
      order: 1,
      firstLoadDefault: true,
      programAdapter: { structuralKind: "orthogonal-panel" }
    });
    expect(AVAILABLE_GUIDED_EXAMPLES).toHaveLength(3);
    expect(GUIDED_EXAMPLE_CATALOG[2]).toMatchObject({
      label: "Sliding-lid box",
      programAdapter: { structuralKind: "captured-slide" }
    });
  });

  it("builds only the selected strict structural request and excludes dormant pin data from Basic", () => {
    const { resolved, profiles } = starterInputs();
    const retainedPin = createStarterPinSetup();
    const basic = buildGuidedProductCompileRequest(AVAILABLE_GUIDED_EXAMPLES[0]!, {
      requestId: "guided-basic",
      presetId: "medium",
      profiles,
      inputPolicyEvaluation: resolved.inputPolicyEvaluation,
      retainedPin
    });
    const hinged = buildGuidedProductCompileRequest(AVAILABLE_GUIDED_EXAMPLES[1]!, {
      requestId: "guided-hinged",
      presetId: "medium",
      profiles,
      inputPolicyEvaluation: resolved.inputPolicyEvaluation,
      retainedPin
    });
    expect(basic.structuralKind).toBe("orthogonal-panel");
    expect(JSON.stringify(basic)).not.toContain('"pin"');
    expect(hinged.structuralKind).toBe("retained-pin");
    expect(JSON.stringify(hinged)).toContain('"pin"');
  });

  it("preserves every protected Basic, Hinged, fit-test, and handoff identity", async () => {
    const { applied, resolved, profiles } = starterInputs();
    const retainedPin = createStarterPinSetup();
    const fixture = await compileFixtureRequest({
      kind: "fixture-compile",
      requestId: "guided-fit-test",
      stockPresetId: applied.stockPresetId
    });
    const compiled = await Promise.all(AVAILABLE_GUIDED_EXAMPLES.map(async (entry) => {
      const result = await compileProductRequest(buildGuidedProductCompileRequest(entry, {
        requestId: `guided-${String(entry.order)}`,
        presetId: "medium",
        profiles,
        inputPolicyEvaluation: resolved.inputPolicyEvaluation,
        retainedPin
      }));
      const handoff = await buildXToolStudioHandoff(
        profiles.machine,
        { fabrication: result.bundle.fabrication, svgs: result.svgs },
        { fabrication: fixture.bundle.fabrication, svgs: fixture.svgs },
      );
      return {
        result,
        handoff,
        handoffSha256: await sha256(`${JSON.stringify(handoff, null, 2)}\n`)
      };
    }));
    const [basic, hinged, sliding] = compiled;
    expect(basic!.result.geometryHash).toBe("bb208dff111a676247a9a75de409671af782ab10f1d5241d59546875e7cae1a2");
    expect(await canonicalDocumentHash(basic!.result.document)).toBe("4f6fc9af41c6fad15f4d1030a81d7663118ad0fe6ae35ee96f2f258a5ec6cd97");
    expect(basic!.result.svgs[0]!.sha256).toBe("42cdcb1dd7dbbc41b1c0cf0b043cc70e84489b83644452f83dbd6529c8226a8a");
    expect(basic!.handoff.artifactGroups[0]!.artifactSetHash).toBe("43d92bd8bea8a9b54feb14b345fd8113c872c27edfe2e2b9a677e1d52dc96dfa");
    expect(basic!.handoffSha256).toBe("111b3b03e7e452778df1524694391d681732575f0e2b3fb6751a187182a856c1");

    expect(hinged!.result.geometryHash).toBe("0ee46844154a57ad44c2c1e5efb5385a115afc1fb5c9fca7466dac2928b6be7e");
    expect(await canonicalDocumentHash(hinged!.result.document)).toBe("e96a303970d233c93a3020dbfd710f4da9efc3580c3cfd871d6d38c2fe46f1e9");
    expect(hinged!.result.svgs[0]!.sha256).toBe("02232b8321cd50853eba7b33569e4c82eb2a6d4d50218420b4d3f6717fa5d349");
    expect(hinged!.handoff.artifactGroups[0]!.artifactSetHash).toBe("50f929740153cbd307eade46ae3ebcd31eec37c1d88bc536b624efa9bda75856");
    expect(hinged!.handoffSha256).toBe("01cf69324d91fe081bf56764b4dcd073b55c5714504c064582ab3abea0e93ccd");

    expect(sliding!.result.geometryHash).toBe("78f8adcdd5b1b278e9cef9d70ca1d5a8e23822a1925a934ac3948acdd9973bf0");
    expect(await canonicalDocumentHash(sliding!.result.document)).toBe("2935255839a0cae24354eae7852f15b6254bebf6538625b846b63997bfcc9ad7");
    expect(sliding!.result.svgs[0]!.sha256).toBe("78111c6072a9e65c1ab7475109beb35d0890ea5260b5cc30ff69d744a83c848e");
    expect(sliding!.handoff.artifactGroups[0]!.artifactSetHash).toBe("d8d90f7faf7a1201a8f289cfe2b985946e4bf8c34fd3ff6c44673c2288211c14");
    expect(sliding!.handoffSha256).toBe("48cf7e3b0c02c5f3d894999f07fc7394c8c970ae3a302623cbfe96a0a5ea4245");

    for (const item of compiled) {
      expect(item.result.document.provenance.runtimeApplicationApiCalls).toBe(0);
      expect(item.handoff.artifactGroups[1]).toMatchObject({
        sourceDocumentHash: "67c5027f89f28db6596c8ca937a8d5f5e7d664ce466ed125a326e80c44f87b30",
        artifactSetHash: "770d918dfb4b1f193c04ee27e5c12601daeb6ed3c65eec01c4034c061d385a10"
      });
    }
    expect(fixture.svgs[0]!.sha256).toBe("2d4296889f9689cea687affd55dcb7bd7242e2340212b1d123d433aebd4b47fc");
  });

  it("replays Basic to Hinged to Basic byte-identically", async () => {
    const { resolved, profiles } = starterInputs();
    const retainedPin = createStarterPinSetup();
    const sequence = [
      AVAILABLE_GUIDED_EXAMPLES[0]!,
      AVAILABLE_GUIDED_EXAMPLES[1]!,
      AVAILABLE_GUIDED_EXAMPLES[0]!
    ];
    const results = [];
    for (const [index, entry] of sequence.entries()) {
      results.push(await compileProductRequest(buildGuidedProductCompileRequest(entry, {
        requestId: `switch-${String(index)}`,
        presetId: "medium",
        profiles,
        inputPolicyEvaluation: resolved.inputPolicyEvaluation,
        retainedPin
      })));
    }
    expect(results[2]!.geometryHash).toBe(results[0]!.geometryHash);
    expect(results[2]!.bundle.sourceDocumentHash).toBe(results[0]!.bundle.sourceDocumentHash);
    expect(results[2]!.svgs).toEqual(results[0]!.svgs);
    expect(results[1]!.bundle.sourceDocumentHash).not.toBe(results[0]!.bundle.sourceDocumentHash);
  });
});
