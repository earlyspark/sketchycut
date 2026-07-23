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
    expect(basic!.result.geometryHash).toBe("da7cb5d0efd1c1db084cd46a91a42fd1484f068314a2fe8ed1171544b17fb482");
    expect(await canonicalDocumentHash(basic!.result.document)).toBe("3f6177f72545d7d32a8cd6d428992d43d4cb2aca8970eecb88aaf3cc6684b08d");
    expect(basic!.result.svgs[0]!.sha256).toBe("ae7b4a2e94766722980c1f4d28d813fac34a14bf7dbc94561eff14f50ef23d66");
    expect(basic!.handoff.artifactGroups[0]!.artifactSetHash).toBe("f968780e9f3d0727baded6f2a2e05ba906e77221beb98c22ab91ca9c9ce558df");
    expect(basic!.handoffSha256).toBe("7fdfdd9f7ba671ab62039e7d5b80b948b54571db8a87bd70b8073d1c7bf76f96");

    expect(hinged!.result.geometryHash).toBe("43c7cbab4c90108b6c0de60b414734761d327aaccc9240987182aabf80e1ca0f");
    expect(await canonicalDocumentHash(hinged!.result.document)).toBe("62049e845aba5c2bcca14cd294c18665bfc47055219785a957b1b087e977fb32");
    expect(hinged!.result.svgs[0]!.sha256).toBe("6cb77e069635c7216377cd5ca92eb3a4b9c98d71a616682f1dc08ae08ef5d173");
    expect(hinged!.handoff.artifactGroups[0]!.artifactSetHash).toBe("7a3c56e31c69d148569d348f501d3d19f3dececa8a5bf87e9df416fb8c07728c");
    expect(hinged!.handoffSha256).toBe("ea987d196ef854f82761db49a9f8810abec97357c431b77c4654ab69a6c47942");

    expect(sliding!.result.geometryHash).toBe("a56bd8fa977a1e462495aaa80957f3ada7624fddfabec1e2e05791cd0cd033fe");
    expect(await canonicalDocumentHash(sliding!.result.document)).toBe("0da11970f2de2a64b022722d792d98e507abc00385c5e51d1df697d2fcaa5773");
    expect(sliding!.result.svgs[0]!.sha256).toBe("fd951c042e4576fc3c04adc8e30d89797f6de291b169ad700263b6784f389b25");
    expect(sliding!.handoff.artifactGroups[0]!.artifactSetHash).toBe("7271e7e0181b3649ee16058a5aef7fcec7d8dec399b81a60993f733fd377b0f4");
    expect(sliding!.handoffSha256).toBe("2cf626abcdf32e7e30ad7e59d2b6f6e9f3ae5ca51b438c5904fcc345d110d25b");

    for (const item of compiled) {
      expect(item.result.document.provenance.runtimeApplicationApiCalls).toBe(0);
      expect(item.handoff.artifactGroups[1]).toMatchObject({
        sourceDocumentHash: "7e77284b5bd0ca4b37b33f1f106d1f7bea71b4a746da4cce43d817ce85449b47",
        artifactSetHash: "24bb4b493aa73f8ecf340348ba6f0cd4774bef778ea58cf435a4392230e66488"
      });
    }
    expect(fixture.svgs[0]!.sha256).toBe("8c8eb309ed2091cbd26f6f22bd6a1e8dd34f4c06bf006c8c58cd522c82f76121");
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
