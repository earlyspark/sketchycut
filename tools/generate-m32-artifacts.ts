import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  buildXToolStudioHandoff,
  canonicalDocumentHash,
  createStarterFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup,
  sha256
} from "../src/index.js";
import {
  AVAILABLE_GUIDED_EXAMPLES,
  DEFAULT_GUIDED_EXAMPLE,
  GUIDED_EXAMPLE_CATALOG,
  buildGuidedProductCompileRequest
} from "../src/ui/content/guided-examples.js";
import {
  compileFixtureRequest,
  compileProductRequest
} from "../src/workers/compile-service.js";

const outputDirectory = new URL("../artifacts/m3.2/", import.meta.url);

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const applied = createStarterFabricationSetup();
const resolved = resolveFabricationSetup(applied);
const profiles = {
  material: resolved.material,
  machine: resolved.machine,
  processRecipe: resolved.processRecipe,
  fabricationContext: resolved.fabricationContext,
  fit: resolved.fit
};
const retainedPin = createStarterPinSetup();
const fixture = await compileFixtureRequest({
  kind: "fixture-compile",
  requestId: "m3-2-fit-test",
  stockPresetId: applied.stockPresetId
});

async function compileEntry(index: number, requestId: string) {
  const entry = AVAILABLE_GUIDED_EXAMPLES[index]!;
  const result = await compileProductRequest(buildGuidedProductCompileRequest(entry, {
    requestId,
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
  const sheet = handoff.artifactGroups[0]!.sheets[0]!;
  return {
    entry,
    result,
    handoff,
    identity: {
      exampleId: entry.id,
      structuralKind: entry.programAdapter.structuralKind,
      geometryHash: result.geometryHash,
      sourceDocumentHash: await canonicalDocumentHash(result.document),
      svgSha256: result.svgs[0]!.sha256,
      artifactSetHash: handoff.artifactGroups[0]!.artifactSetHash,
      handoffSha256: await sha256(json(handoff)),
      rootDimensionsMm: sheet.rootDimensionsMm,
      occupiedDimensionsMm: {
        width: (sheet.occupiedCompensatedBoundsUm.maxXUm - sheet.occupiedCompensatedBoundsUm.minXUm) / 1_000,
        height: (sheet.occupiedCompensatedBoundsUm.maxYUm - sheet.occupiedCompensatedBoundsUm.minYUm) / 1_000
      },
      complexity: sheet.complexity,
      runtimeApplicationApiCalls: result.document.provenance.runtimeApplicationApiCalls
    }
  };
}

const [basic, hinged, basicReplay] = await Promise.all([
  compileEntry(0, "m3-2-basic-direct"),
  compileEntry(1, "m3-2-hinged-direct"),
  compileEntry(0, "m3-2-basic-replay")
]);
const fitGroup = basic.handoff.artifactGroups[1]!;
const goldenFiles = [
  ["m1", new URL("../tests/golden/m1-coupon-matrix.json", import.meta.url)],
  ["m2", new URL("../tests/golden/m2-panel-matrix.json", import.meta.url)],
  ["m3", new URL("../tests/golden/m3-revolute-matrix.json", import.meta.url)],
  ["m3.1-evaluated", new URL("../tests/golden/m3.1-evaluated-hash-matrix.json", import.meta.url)]
] as const;
const goldenSha256 = Object.fromEntries(await Promise.all(goldenFiles.map(async ([id, url]) => [
  id,
  await sha256(await readFile(url, "utf8"))
] as const)));

const catalogReport = {
  schemaVersion: "1.0",
  milestone: "M3.2",
  defaultExampleId: DEFAULT_GUIDED_EXAMPLE.id,
  entries: GUIDED_EXAMPLE_CATALOG.map((entry) => {
    const wasAvailableAtM32 = entry.evidenceMilestone !== "M4";
    return {
      id: entry.id,
      order: entry.order,
      label: entry.label,
      status: wasAvailableAtM32 ? "available" : "planned",
      statusText: wasAvailableAtM32
        ? "Explore now"
        : "Planned next · no preview or download yet",
      hasProgramAdapter: wasAvailableAtM32,
      structuralKind: wasAvailableAtM32
        ? entry.programAdapter.structuralKind
        : null,
      capabilityInputIds: wasAvailableAtM32
        ? entry.programAdapter.capabilityInputs.map((input) => input.id)
        : [],
      evidenceMilestone: entry.evidenceMilestone
    };
  }),
  plannedDispatchCount: 0,
  runtimeApplicationApiCalls: 0
};
const identityLedger = {
  schemaVersion: "1.0",
  milestone: "M3.2",
  examples: [basic.identity, hinged.identity],
  optionalFitTest: {
    sourceDocumentHash: fitGroup.sourceDocumentHash,
    svgSha256: fixture.svgs[0]!.sha256,
    artifactSetHash: fitGroup.artifactSetHash,
    complexity: fitGroup.sheets[0]!.complexity
  },
  goldenSha256,
  studioImportClaims: {
    basic: "xTool Studio-targeted fabrication candidate; no inherited import claim",
    hinged: {
      claim: "import-only verification retained for this exact artifact set",
      artifactSetHash: hinged.identity.artifactSetHash,
      studioDesktopVersion: "1.7.30"
    },
    optionalFitTest: {
      claim: "import-only verification retained for this exact artifact set",
      artifactSetHash: fitGroup.artifactSetHash,
      studioDesktopVersion: "1.7.30"
    }
  },
  runtimeApplicationApiCalls: 0,
  physicalVerification: "required"
};
const switchReplay = {
  schemaVersion: "1.0",
  milestone: "M3.2",
  sequence: [basic.entry.id, hinged.entry.id, basicReplay.entry.id],
  basicReplay: {
    geometryHashEqual: basicReplay.identity.geometryHash === basic.identity.geometryHash,
    sourceDocumentHashEqual:
      basicReplay.identity.sourceDocumentHash === basic.identity.sourceDocumentHash,
    svgSha256Equal: basicReplay.identity.svgSha256 === basic.identity.svgSha256,
    artifactSetHashEqual:
      basicReplay.identity.artifactSetHash === basic.identity.artifactSetHash
  },
  fitTestAcrossSwitches: {
    sourceDocumentHashEqual:
      hinged.handoff.artifactGroups[1]!.sourceDocumentHash === fitGroup.sourceDocumentHash,
    artifactSetHashEqual:
      hinged.handoff.artifactGroups[1]!.artifactSetHash === fitGroup.artifactSetHash
  },
  selectedProductCompilations: 3,
  plannedProductCompilations: 0,
  runtimeApplicationApiCalls: 0
};

const entries = [
  ["catalog-report.json", json(catalogReport)],
  ["identity-ledger.json", json(identityLedger)],
  ["switch-replay.json", json(switchReplay)]
] as const;
await mkdir(outputDirectory, { recursive: true });
const artifactEntries = [];
for (const [path, contents] of entries) {
  await writeFile(new URL(path, outputDirectory), contents);
  artifactEntries.push({
    path,
    bytes: new TextEncoder().encode(contents).length,
    sha256: await sha256(contents)
  });
}
await writeFile(new URL("artifact-manifest.json", outputDirectory), json({
  schemaVersion: "1.0",
  milestone: "M3.2",
  generator: { id: "m3-2-artifact-generator", version: "1.0.0" },
  runtimeApplicationApiCalls: 0,
  physicalVerification: "required",
  artifacts: artifactEntries
}));

process.stdout.write(
  `Generated M3.2 catalog, protected identity, and switch-replay evidence for ${String(AVAILABLE_GUIDED_EXAMPLES.length)} available examples.\n`,
);
