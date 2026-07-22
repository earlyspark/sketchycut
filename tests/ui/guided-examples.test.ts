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
    expect(await canonicalDocumentHash(basic!.result.document)).toBe("a7a492dcb67a5529c0b50203041c5a837e038d61b1ea05c42af80d6993430109");
    expect(basic!.result.svgs[0]!.sha256).toBe("22aef2dea6e9f5b1043a3da5addffe3bdc8e843d8c4abb7da896a843f92b858c");
    expect(basic!.handoff.artifactGroups[0]!.artifactSetHash).toBe("affea3e3862122b73f15550b7e730028b3b4450651fd2953c28c6a2eb11252dd");
    expect(basic!.handoffSha256).toBe("4e94140cd22e40e859a346c44a14b3fdb42d97fe379d5a165f7e0b2aa3de59d8");

    expect(hinged!.result.geometryHash).toBe("0ee46844154a57ad44c2c1e5efb5385a115afc1fb5c9fca7466dac2928b6be7e");
    expect(await canonicalDocumentHash(hinged!.result.document)).toBe("386f3d2d6be74f2720c7ff7da0dfb8a8446571a1ba24078b40c269cde0ad2cb7");
    expect(hinged!.result.svgs[0]!.sha256).toBe("7d5efba5d95f51a2a006c3cdc6aa9d2aadda807d689725ca1178e9264aa40d0b");
    expect(hinged!.handoff.artifactGroups[0]!.artifactSetHash).toBe("a2ac3dea2ad95b52135ff9840e87ea760b2257e609bd1899860cfcf1cda40210");
    expect(hinged!.handoffSha256).toBe("1162344e74a2035d84c30332f60eaa74b18f339310a66976d478576da7e150b4");

    expect(sliding!.result.geometryHash).toBe("78f8adcdd5b1b278e9cef9d70ca1d5a8e23822a1925a934ac3948acdd9973bf0");
    expect(await canonicalDocumentHash(sliding!.result.document)).toBe("63573761b1feb0562e62f761ecb9dce9ccdf809fa330d65b70bdae3743b32124");
    expect(sliding!.result.svgs[0]!.sha256).toBe("d35e856fc0964e30e5b90796f0695c0f9b7343c67b688b15a896814148f58bdd");
    expect(sliding!.handoff.artifactGroups[0]!.artifactSetHash).toBe("2d1f965f85e50e150b990a7479f89dcfe95f7d081bb2821389b48ac2caa23b2a");
    expect(sliding!.handoffSha256).toBe("cb881b0be7c6dc5837903ad2de344e48e98cd25f9e460342d83afb76646f64a8");

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
