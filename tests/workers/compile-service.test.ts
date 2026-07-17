import { describe, expect, it } from "vitest";

import {
  canonicalDocumentHash,
  createStarterFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/index.js";
import { createPrimaryPreset, createRetainedPreset } from "../../src/ui/content/presets.js";
import {
  compileFixtureRequest,
  compileProductRequest
} from "../../src/workers/compile-service.js";
import type { ProductCompileWorkerRequest } from "../../src/workers/protocol.js";

function productInputs() {
  const resolved = resolveFabricationSetup(createStarterFabricationSetup());
  const profiles = {
    material: resolved.material,
    machine: resolved.machine,
    processRecipe: resolved.processRecipe,
    fabricationContext: resolved.fabricationContext,
    fit: resolved.fit
  };
  return { resolved, profiles };
}

describe("independent calibration fixture worker service", () => {
  it("compiles without product, pin, thickness draft, or cut-width draft state", async () => {
    const result = await compileFixtureRequest({
      kind: "fixture-compile",
      requestId: "fixture-independent",
      stockPresetId: "stock-3mm-basswood-laser-plywood"
    });
    expect(result.kind).toBe("fixture-success");
    expect(result.document.parts).toHaveLength(10);
    expect(result.document.externalStock).toBeUndefined();
    expect(result.svgs).toHaveLength(1);
    expect(result.svgs[0]?.sha256).toBe(
      "2d4296889f9689cea687affd55dcb7bd7242e2340212b1d123d433aebd4b47fc",
    );
  });

  it("replays the registered-stock fixture byte-identically", async () => {
    const [first, second] = await Promise.all([
      compileFixtureRequest({
        kind: "fixture-compile", requestId: "fixture-first",
        stockPresetId: "stock-3mm-basswood-laser-plywood"
      }),
      compileFixtureRequest({
        kind: "fixture-compile", requestId: "fixture-second",
        stockPresetId: "stock-3mm-basswood-laser-plywood"
      })
    ]);
    expect(second.svgs).toEqual(first.svgs);
  });
});

describe("strict structural product worker dispatch", () => {
  it("compiles an orthogonal-panel request with no pin input or hash contribution", async () => {
    const { resolved, profiles } = productInputs();
    const request = {
      kind: "product-compile" as const,
      structuralKind: "orthogonal-panel" as const,
      requestId: "orthogonal-no-pin",
      program: createPrimaryPreset("medium", profiles),
      profiles,
      inputPolicyEvaluation: resolved.inputPolicyEvaluation
    };
    expect(JSON.stringify(request)).not.toContain('"pin"');
    const first = await compileProductRequest(request);
    const second = await compileProductRequest({ ...request, requestId: "orthogonal-replay" });
    expect(first.document.externalStock).toBeUndefined();
    expect(second.geometryHash).toBe(first.geometryHash);
    expect(await canonicalDocumentHash(second.document)).toBe(
      await canonicalDocumentHash(first.document),
    );
    expect(second.svgs).toEqual(first.svgs);
  });

  it("requires a valid retained-pin program and rejects discriminator/schema mismatches", async () => {
    const { resolved, profiles } = productInputs();
    const orthogonal = createPrimaryPreset("medium", profiles);
    const retained = createRetainedPreset("medium", profiles, createStarterPinSetup());
    const base = {
      kind: "product-compile" as const,
      requestId: "structural-mismatch",
      profiles,
      inputPolicyEvaluation: resolved.inputPolicyEvaluation
    };
    await expect(compileProductRequest({
      ...base,
      structuralKind: "retained-pin",
      program: orthogonal
    } as unknown as ProductCompileWorkerRequest)).rejects.toMatchObject({
      code: "STRUCTURAL_PROGRAM_MISMATCH"
    });
    const missingPin = structuredClone(retained) as unknown as {
      mechanism: { pin?: unknown };
    };
    delete missingPin.mechanism.pin;
    await expect(compileProductRequest({
      ...base,
      structuralKind: "retained-pin",
      program: missingPin
    } as unknown as ProductCompileWorkerRequest)).rejects.toMatchObject({
      code: "STRUCTURAL_PROGRAM_MISMATCH"
    });
  });

  it("rejects undeclared capability data at the worker boundary", async () => {
    const { resolved, profiles } = productInputs();
    const request = {
      kind: "product-compile" as const,
      structuralKind: "orthogonal-panel" as const,
      requestId: "orthogonal-extra-pin",
      program: createPrimaryPreset("medium", profiles),
      profiles,
      inputPolicyEvaluation: resolved.inputPolicyEvaluation,
      pin: { effectiveDiameterMm: 99 }
    } as unknown as ProductCompileWorkerRequest;
    await expect(compileProductRequest(request)).rejects.toMatchObject({
      code: "PRODUCT_COMPILE_REQUEST_INVALID"
    });
  });
});
