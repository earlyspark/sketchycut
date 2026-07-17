import { describe, expect, it } from "vitest";

import {
  buildXToolStudioHandoff,
  canonicalDocumentHash,
  createStarterFabricationSetup,
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
  const applied = createStarterFabricationSetup();
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
  it("is ordered, unique, and has one available Basic default", () => {
    expect(GUIDED_EXAMPLE_CATALOG.map((entry) => entry.order)).toEqual([1, 2, 3]);
    expect(new Set(GUIDED_EXAMPLE_CATALOG.map((entry) => entry.id)).size).toBe(3);
    expect(DEFAULT_GUIDED_EXAMPLE).toMatchObject({
      order: 1,
      status: "available",
      firstLoadDefault: true,
      programAdapter: { structuralKind: "orthogonal-panel" }
    });
    expect(AVAILABLE_GUIDED_EXAMPLES).toHaveLength(2);
    const planned = GUIDED_EXAMPLE_CATALOG.find((entry) => entry.status === "planned")!;
    expect(planned.statusText).toBe("Planned next · no preview or download yet");
    expect("programAdapter" in planned).toBe(false);
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
    const [basic, hinged] = compiled;
    expect(basic!.result.geometryHash).toBe("b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5");
    expect(await canonicalDocumentHash(basic!.result.document)).toBe("17a51ce72c0edd58e6d7f7d4627ab887f9194c7ca2f0e2954cf0049bffa58dad");
    expect(basic!.result.svgs[0]!.sha256).toBe("0c00350bb3ce195c2f0ed479acdb7c2fa8b54e594d6b161ad7b0c4365f0aae64");
    expect(basic!.handoff.artifactGroups[0]!.artifactSetHash).toBe("67e26c7d280473f9a567747f192d50555d4f8c9895710839a328cad751a7b89c");
    expect(basic!.handoffSha256).toBe("073c2a684df29b32fd698140fab72cfe6d98dd3a3bef407069d21643b7eeb4dc");

    expect(hinged!.result.geometryHash).toBe("cf612788f8ec8ae169bb3f029b614b5ebe4ad9f8b0f17732f4d5f08d1be2b664");
    expect(await canonicalDocumentHash(hinged!.result.document)).toBe("0cbffb0cf8e2051ce01558c66ba9424d1842e5ce395487f5766a65531c45d381");
    expect(hinged!.result.svgs[0]!.sha256).toBe("622314744940326893a8509d648b907bec2a26b9d639ae2c31ea5648338ffadc");
    expect(hinged!.handoff.artifactGroups[0]!.artifactSetHash).toBe("d2d84a1e03bb8da5d55048ec3d0efd7c3c2c08396f0766f515dc0d8435bde7e5");
    expect(hinged!.handoffSha256).toBe("3515f141e58cab2f661dc7af368fef4db5db016717533cc382ae6b908af0b56e");

    for (const item of compiled) {
      expect(item.result.document.provenance.runtimeApplicationApiCalls).toBe(0);
      expect(item.handoff.artifactGroups[1]).toMatchObject({
        sourceDocumentHash: "0f80a5523903ce9a206a13560848dcbe1b428514493ac5c7b24c7326815bb7dc",
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
