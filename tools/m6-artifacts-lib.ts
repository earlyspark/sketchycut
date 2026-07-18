import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";

import { stableJson, sha256 } from "../src/domain/hash.js";
import type { ProjectionBundle, SceneProjection } from "../src/domain/contracts.js";
import { GeneratedFabricationControlsSchema, GeneratedDeterministicControlsSchema } from "../src/interpretation/generated-project-contracts.js";
import { resolveGeneratedFabricationControls } from "../src/interpretation/generated-fabrication.js";
import { compileGeneratedProjectFromSemantic } from "../src/interpretation/generated-project-compiler.js";
import { IntentGraphV1Schema } from "../src/interpretation/intent-graph.js";
import { buildM5ReplayIntent, M5_REPLAY_SCENARIOS } from "../src/interpretation/m5-replay-corpus.js";
import { mapIntentGraph } from "../src/interpretation/mapper.js";
import { normalizeSemanticGenerationRequest } from "../src/interpretation/semantic-request.js";
import { buildM6Package, M6PackageManifestSchema } from "../src/server/m6/package-builder.js";
import type { M6Package } from "../src/server/m6/package-builder.js";
import { renderSceneSvg } from "../src/projections/mesh/render-svg.js";
import {
  M6PersistedProjectSchema,
  semanticProvenanceFromRequest
} from "../src/server/m6/project-persistence.js";

export type M6ArtifactOutput = {
  path: string;
  bytes: Uint8Array;
};

function json(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${stableJson(value)}\n`);
}

function historicalScene(sceneCandidate: SceneProjection): SceneProjection {
  const scene = { ...sceneCandidate };
  delete scene.surfaceTreatments;
  return scene;
}

async function historicalM6Package(
  project: Parameters<typeof buildM6Package>[0],
  bundle: ProjectionBundle,
): Promise<M6Package> {
  const current = await buildM6Package(project);
  const archive = unzipSync(current.bytes);
  const scene = historicalScene(bundle.scene);
  archive["projection-bundle.json"] = json({ ...bundle, scene });
  archive["previews/assembled.svg"] = strToU8(renderSceneSvg(scene, "assembled"));
  archive["previews/exploded.svg"] = strToU8(renderSceneSvg(scene, "exploded"));
  const currentManifest = M6PackageManifestSchema.parse(
    JSON.parse(strFromU8(archive["manifest.json"]!)) as unknown,
  );
  const files = await Promise.all(currentManifest.files.map(async (entry) => {
    const bytes = archive[entry.path];
    if (bytes === undefined) throw new Error(`M6_HISTORICAL_PACKAGE_FILE_MISSING:${entry.path}`);
    return { path: entry.path, bytes: bytes.byteLength, sha256: await sha256(bytes) };
  }));
  const manifest = M6PackageManifestSchema.parse({ ...currentManifest, files });
  archive["manifest.json"] = json(manifest);
  const zippable: Zippable = {};
  for (const [entryPath, bytes] of Object.entries(archive)
    .sort(([left], [right]) => left.localeCompare(right))) {
    zippable[entryPath] = [bytes, {
      mtime: new Date("1980-01-02T00:00:00.000Z"),
      level: 6
    }];
  }
  const bytes = zipSync(zippable, {
    mtime: new Date("1980-01-02T00:00:00.000Z"),
    level: 6
  });
  return {
    filename: current.filename,
    bytes,
    sha256: await sha256(bytes),
    manifest
  };
}

export async function buildM6EvidenceArtifacts(): Promise<{
  outputs: M6ArtifactOutput[];
  artifactManifest: unknown;
}> {
  const scenario = M5_REPLAY_SCENARIOS.find((candidate) => candidate.id === "rigid-structure");
  if (scenario === undefined) throw new Error("M6_EVIDENCE_SCENARIO_MISSING");
  const semanticRequest = normalizeSemanticGenerationRequest({
    brief: scenario.brief,
    references: [{
      referenceId: "reference-one",
      sha256: "6".repeat(64),
      mediaType: "image/jpeg",
      width: 1_024,
      height: 768
    }],
    roleConstraints: [],
    modelConfiguration: {
      modelId: "gpt-5.6-terra",
      reasoningEffort: "low",
      maxOutputTokens: 4_000,
      serviceTier: "default",
      store: false
    }
  });
  const intent = IntentGraphV1Schema.parse(buildM5ReplayIntent(semanticRequest, scenario));
  const mapping = await mapIntentGraph(intent);
  if (mapping.kind === "concept-only") throw new Error("M6_EVIDENCE_MAPPING_UNSUPPORTED");
  const deterministicControls = GeneratedDeterministicControlsSchema.parse({
    dimensionsMm: { width: 120, depth: 90, height: 58 },
    scaleSource: "disclosed-preset",
    motifPlacement: {
      scalePermille: 1_000,
      rotationQuarterTurns: 0,
      offsetXPermille: 0,
      offsetYPermille: 0,
      targetFace: "front"
    }
  });
  const fabricationControls = GeneratedFabricationControlsSchema.parse({
    stockPresetId: "stock-3mm-basswood-laser-plywood",
    thickness: { basis: "nominal-preset" },
    fullCutWidthMm: 0.15,
    fitBiasMm: 0,
    stockFootprintMm: { width: 200, height: 180 }
  });
  const fabrication = resolveGeneratedFabricationControls(fabricationControls);
  const compiled = await compileGeneratedProjectFromSemantic({
    requestId: "m6-evidence-compile",
    semanticRequest,
    intent,
    mapping,
    profiles: fabrication.profiles,
    inputPolicyEvaluation: fabrication.inputPolicyEvaluation,
    pin: fabrication.pin,
    controls: deterministicControls,
    cacheResult: "hit",
    runtimeApplicationApiCalls: 0
  });
  const project = M6PersistedProjectSchema.parse({
    schemaVersion: "1.0",
    projectId: "m6-evidence-project",
    ownerSessionId: "m6-evidence-session",
    revision: 1,
    createdAtMs: 1_784_332_800_000,
    updatedAtMs: 1_784_332_800_000,
    intent,
    mapping,
    semanticProvenance: await semanticProvenanceFromRequest(semanticRequest),
    deterministicControls,
    fabricationControls,
    runtimeApplicationApiCalls: 0,
    lastDocumentHash: compiled.bundle.sourceDocumentHash,
    lastGeometryHash: compiled.geometryHash
  });
  const firstPackage = await historicalM6Package(project, compiled.bundle);
  const repeatedPackage = await historicalM6Package(project, compiled.bundle);
  if (firstPackage.sha256 !== repeatedPackage.sha256 ||
      !Buffer.from(firstPackage.bytes).equals(Buffer.from(repeatedPackage.bytes))) {
    throw new Error("M6_EVIDENCE_PACKAGE_NONDETERMINISTIC");
  }
  const archive = unzipSync(firstPackage.bytes);
  const packageManifest = M6PackageManifestSchema.parse(
    JSON.parse(strFromU8(archive["manifest.json"]!)) as unknown,
  );
  const generationReport = {
    schemaVersion: "1.0",
    milestone: "M6",
    status: "software-validated-fabrication-candidate",
    transportMode: "replay",
    runtimeApplicationApiCalls: 0,
    modelConfiguration: semanticRequest.modelConfiguration,
    persistedProjectId: project.projectId,
    canonicalProjectId: compiled.document.projectId,
    projectRevision: project.revision,
    sourceDocumentHash: compiled.bundle.sourceDocumentHash,
    geometryHash: compiled.geometryHash,
    packageSha256: firstPackage.sha256,
    packageBytes: firstPackage.bytes.byteLength,
    artifactGroups: packageManifest.artifactGroups.map((group) => ({
      id: group.id,
      sourceDocumentHash: group.sourceDocumentHash,
      sheetCount: group.sheetCount,
      svgHashes: group.sheets.map((sheet) => ({
        sheetId: sheet.sheetId,
        sha256: sheet.svgSha256
      }))
    })),
    deterministicPackageRepeatMatch: true,
    physicalVerification: "required",
    limitations: packageManifest.limitations
  };
  const firstProductSheet = packageManifest.artifactGroups[0]!.sheets[0]!;
  const baseOutputs: M6ArtifactOutput[] = [
    { path: "fabrication-package.zip", bytes: firstPackage.bytes },
    { path: "package-manifest.json", bytes: json(packageManifest) },
    { path: "generation-report.json", bytes: json(generationReport) },
    { path: "previews/assembled.svg", bytes: archive["previews/assembled.svg"]! },
    { path: "previews/exploded.svg", bytes: archive["previews/exploded.svg"]! },
    { path: "previews/product-sheet-1.svg", bytes: archive[firstProductSheet.path]! }
  ];
  const entries = await Promise.all(baseOutputs.map(async (output) => ({
    path: output.path,
    bytes: output.bytes.byteLength,
    sha256: await sha256(output.bytes)
  })));
  const artifactManifest = {
    schemaVersion: "1.0",
    milestone: "M6",
    generator: { id: "m6-evidence-artifacts", version: "1.0.0" },
    sourceDocumentHash: compiled.bundle.sourceDocumentHash,
    geometryHash: compiled.geometryHash,
    packageSha256: firstPackage.sha256,
    runtimeApplicationApiCalls: 0,
    physicalVerification: "required",
    files: entries
  };
  return {
    outputs: [...baseOutputs, { path: "artifact-manifest.json", bytes: json(artifactManifest) }],
    artifactManifest
  };
}
