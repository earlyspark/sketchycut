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
    expect(basic!.result.geometryHash).toBe("b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5");
    expect(await canonicalDocumentHash(basic!.result.document)).toBe("8b7cbd59f71174111e5a16c51356f7ad7836454478167e0a9ede8cfe8868be46");
    expect(basic!.result.svgs[0]!.sha256).toBe("0c00350bb3ce195c2f0ed479acdb7c2fa8b54e594d6b161ad7b0c4365f0aae64");
    expect(basic!.handoff.artifactGroups[0]!.artifactSetHash).toBe("67e26c7d280473f9a567747f192d50555d4f8c9895710839a328cad751a7b89c");
    expect(basic!.handoffSha256).toBe("031b32f0203d811f7d493fc46e1edc4c39ce917609a2cc902b2379e93d492d36");

    expect(hinged!.result.geometryHash).toBe("cf612788f8ec8ae169bb3f029b614b5ebe4ad9f8b0f17732f4d5f08d1be2b664");
    expect(await canonicalDocumentHash(hinged!.result.document)).toBe("1f88931c48363f6e128f34c398269ca8b7fda6428539fe170eec2bd89d055fee");
    expect(hinged!.result.svgs[0]!.sha256).toBe("622314744940326893a8509d648b907bec2a26b9d639ae2c31ea5648338ffadc");
    expect(hinged!.handoff.artifactGroups[0]!.artifactSetHash).toBe("d2d84a1e03bb8da5d55048ec3d0efd7c3c2c08396f0766f515dc0d8435bde7e5");
    expect(hinged!.handoffSha256).toBe("6944ab4840b8cd6aba7f66a17d37ece041616373d58047c2952d9010c087d1b6");

    expect(sliding!.result.geometryHash).toBe("3d689633d37df8aeff952b1ef9411242f015accc70005b782df27a5313863085");
    expect(await canonicalDocumentHash(sliding!.result.document)).toBe("4e9c2682c16fe669fad097db9f82f544f1f24b8b516b4d15529279050047094c");
    expect(sliding!.result.svgs[0]!.sha256).toBe("27dfc70deb4edde531563f4e90e335e9d7a044a2a4ea4407ce798a083fc99431");
    expect(sliding!.handoff.artifactGroups[0]!.artifactSetHash).toBe("93ea7f6d6d7ef6e7d1e135d315525ce08993b01a59559ebdcacff8856d969050");
    expect(sliding!.handoffSha256).toBe("f22d4a6516df0526517513194424a8d9597860417b7ada3de8dc693b71fbeaff");

    for (const item of compiled) {
      expect(item.result.document.provenance.runtimeApplicationApiCalls).toBe(0);
      expect(item.handoff.artifactGroups[1]).toMatchObject({
        sourceDocumentHash: "9eb6e1d8272a9b820c925a83d03bae2965df78805bc8f3d65c42cadf4f38db55",
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
