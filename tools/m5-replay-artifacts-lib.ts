import {
  DesignDocumentV1Schema,
  SheetPartSchema,
  XToolStudioHandoffSchema,
  buildXToolStudioHandoff,
  canonicalDocumentHash,
  canonicalPartHash,
  sha256
} from "../src/index.js";
import { IntentGraphV1Schema } from "../src/interpretation/intent-graph.js";
import {
  M5_REPLAY_SCENARIOS,
  buildM5ReplayIntent
} from "../src/interpretation/m5-replay-corpus.js";
import { mapIntentGraph } from "../src/interpretation/mapper.js";
import { normalizeSemanticGenerationRequest } from "../src/interpretation/semantic-request.js";
import { applyProceduralSurfaceTreatment } from "../src/operators/procedural-surface-treatment.js";
import {
  DEFAULT_GENERATED_CONTROLS,
  compileGeneratedProject
} from "../src/ui/content/generated-projects.js";
import {
  DEFAULT_GENERATED_FABRICATION_CONTROLS,
  resolveGeneratedFabricationControls
} from "../src/ui/content/generated-setup.js";
import { compileFixtureRequest } from "../src/workers/compile-service.js";
import type { ProjectionBundle } from "../src/domain/contracts.js";

export const M5_ARTIFACT_GENERATOR = Object.freeze({
  id: "m5-replay-artifact-generator",
  version: "1.0.0"
});

export const M5_COMPLEXITY_EVIDENCE = Object.freeze({
  status: "exact-hash-studio-import-verified" as const,
  studioDesktopVersion: "1.7.30",
  reportPath: "docs/evidence/m05/reports/studio-import-complexity.json",
  exactArtifactSource: "both-role/sheet-1",
  verifiedSvgSha256: "168e863072aa11f8080d2898312b21bf6b874c7012fd8e118e64b2e36808268d"
});

type ArtifactFileMap = Map<string, string>;
type Complexity = {
  pathCount: number;
  segmentCount: number;
  vertexCount: number;
  svgByteSize: number;
};

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function historicalM5ProjectionBundle(bundle: ProjectionBundle): ProjectionBundle {
  const scene = { ...bundle.scene };
  delete scene.surfaceTreatments;
  return { ...bundle, scene };
}

function treatmentGeometry(documentCandidate: unknown) {
  const document = DesignDocumentV1Schema.parse(documentCandidate);
  return document.parts.flatMap((part) => part.features
    .filter((feature) => feature.kind === "treatment")
    .map((feature) => ({
      partId: part.id,
      featureId: feature.id,
      operation: feature.operation,
      surfaceSide: feature.surfaceSide,
      path: feature.path,
      region: feature.region
    })))
    .sort((left, right) => left.featureId.localeCompare(right.featureId));
}

function maxComplexity(rows: readonly (Complexity & { scenarioId: string; sheetId: string })[]) {
  const fields = ["pathCount", "segmentCount", "vertexCount", "svgByteSize"] as const;
  return Object.fromEntries(fields.map((field) => {
    const maximum = Math.max(...rows.map((row) => row[field]));
    return [field, {
      maximum,
      exactArtifactSources: rows
        .filter((row) => row[field] === maximum)
        .map((row) => `${row.scenarioId}/${row.sheetId}`)
        .sort()
    }];
  }));
}

export type M5ReplayArtifactCorpus = {
  files: ArtifactFileMap;
  summary: {
    scenarioCount: number;
    compiledCount: number;
    conceptOnlyCount: number;
    failureCount: number;
    motifRecipeCount: number;
    runtimeApplicationApiCalls: 0;
  };
  geometryHashes: Record<string, string>;
  evaluatedDocumentHashes: Record<string, string>;
  svgHashes: Record<string, string>;
  complexityBudget: ReturnType<typeof maxComplexity>;
};

export async function buildM5ReplayArtifactCorpus(): Promise<M5ReplayArtifactCorpus> {
  const files: ArtifactFileMap = new Map();
  const fabrication = resolveGeneratedFabricationControls(
    DEFAULT_GENERATED_FABRICATION_CONTROLS,
  );
  const optionalFitTest = await compileFixtureRequest({
    kind: "fixture-compile",
    requestId: "m5-replay-optional-fit-test",
    stockPresetId: DEFAULT_GENERATED_FABRICATION_CONTROLS.stockPresetId
  });
  const geometryHashes: Record<string, string> = {};
  const evaluatedDocumentHashes: Record<string, string> = {};
  const svgHashes: Record<string, string> = {};
  const scenarioSummaries: unknown[] = [];
  const complexityRows: (Complexity & { scenarioId: string; sheetId: string })[] = [];
  const motifDeterminism: unknown[] = [];
  let compiledCount = 0;
  let conceptOnlyCount = 0;
  let failureCount = 0;

  for (const scenario of M5_REPLAY_SCENARIOS) {
    const referenceDigest = await sha256(`m5-replay-reference:${scenario.id}`);
    const semanticRequest = normalizeSemanticGenerationRequest({
      brief: scenario.brief,
      references: [{
        referenceId: "reference-1",
        sha256: referenceDigest,
        mediaType: "image/png",
        width: 640,
        height: 480
      }],
      roleConstraints: [],
      modelConfiguration: {
        modelId: "m5-replay-fixture@1.0.0",
        reasoningEffort: "low",
        maxOutputTokens: 4_000,
        serviceTier: "default",
        store: false
      }
    });
    const candidate = buildM5ReplayIntent(semanticRequest, scenario);
    const parsedIntent = IntentGraphV1Schema.safeParse(candidate);
    const prefix = `scenarios/${scenario.id}`;
    files.set(`${prefix}/semantic-request.json`, json(semanticRequest));

    if (!parsedIntent.success) {
      if (scenario.expectedOutcome !== "schema-failure") {
        throw new Error(`Unexpected strict-schema failure for ${scenario.id}.`);
      }
      failureCount += 1;
      const failure = {
        schemaVersion: "1.0",
        kind: "failure",
        stage: "schema",
        code: "STRICT_INTENT_SCHEMA_FAILURE",
        retryable: true,
        preservedSemanticRequestDigest: await sha256(JSON.stringify(semanticRequest)),
        runtimeApplicationApiCalls: 0
      };
      files.set(`${prefix}/outcome.json`, json(failure));
      scenarioSummaries.push({
        id: scenario.id,
        expectedOutcome: scenario.expectedOutcome,
        observedOutcome: "failure",
        artifactDirectory: prefix,
        runtimeApplicationApiCalls: 0
      });
      continue;
    }

    const intent = parsedIntent.data;
    const mapping = await mapIntentGraph(intent);
    files.set(`${prefix}/intent.json`, json(intent));
    files.set(`${prefix}/mapping.json`, json(mapping));
    if (mapping.kind === "concept-only") {
      if (scenario.expectedOutcome !== "concept-only") {
        throw new Error(`Unexpected concept-only mapping for ${scenario.id}.`);
      }
      conceptOnlyCount += 1;
      files.set(`${prefix}/outcome.json`, json({
        schemaVersion: "1.0",
        kind: "concept-only",
        exportAllowed: false,
        blockedRequirementIds: mapping.blockedRequirementIds,
        unresolvedNeeds: mapping.unresolvedNeeds,
        runtimeApplicationApiCalls: 0
      }));
      scenarioSummaries.push({
        id: scenario.id,
        expectedOutcome: scenario.expectedOutcome,
        observedOutcome: mapping.kind,
        artifactDirectory: prefix,
        runtimeApplicationApiCalls: 0
      });
      continue;
    }
    if (mapping.kind !== scenario.expectedOutcome) {
      throw new Error(
        `Scenario ${scenario.id} expected ${scenario.expectedOutcome} but mapped ${mapping.kind}.`,
      );
    }

    const controls = {
      ...DEFAULT_GENERATED_CONTROLS,
      scaleSource: scenario.missingScale ? "disclosed-preset" as const : "user-specified" as const
    };
    const compiled = await compileGeneratedProject({
      requestId: `m5-replay-${scenario.id}`,
      semanticRequest,
      intent,
      mapping,
      profiles: fabrication.profiles,
      inputPolicyEvaluation: fabrication.inputPolicyEvaluation,
      pin: fabrication.pin,
      controls,
      cacheResult: "miss",
      runtimeApplicationApiCalls: 0
    });
    const handoff = await buildXToolStudioHandoff(
      fabrication.profiles.machine,
      { fabrication: compiled.bundle.fabrication, svgs: compiled.svgs },
      { fabrication: optionalFitTest.bundle.fabrication, svgs: optionalFitTest.svgs },
      0,
    );
    XToolStudioHandoffSchema.parse(handoff);
    const documentHash = await canonicalDocumentHash(compiled.document);
    geometryHashes[scenario.id] = compiled.geometryHash;
    evaluatedDocumentHashes[scenario.id] = documentHash;
    files.set(`${prefix}/project.json`, json(compiled.document));
    files.set(
      `${prefix}/projection-bundle.json`,
      json(historicalM5ProjectionBundle(compiled.bundle)),
    );
    files.set(`${prefix}/fabrication-evidence.json`, json(compiled.evidence));
    files.set(`${prefix}/handoff.json`, json(handoff));
    files.set(`${prefix}/outcome.json`, json({
      schemaVersion: "1.0",
      kind: mapping.kind,
      geometryHash: compiled.geometryHash,
      evaluatedDocumentHash: documentHash,
      validationStatus: compiled.document.validation.status,
      exportAllowed: compiled.document.validation.status === "pass",
      scaleDisclosure: compiled.scaleDisclosure,
      motifRecipeHash: compiled.motifReport?.recipeHash ?? null,
      runtimeApplicationApiCalls: 0
    }));
    if (compiled.motifRecipe !== null && compiled.motifReport !== null) {
      files.set(`${prefix}/motif-recipe.json`, json(compiled.motifRecipe));
      files.set(`${prefix}/motif-report.json`, json(compiled.motifReport));
      const baseParts = compiled.document.parts.map((part) => SheetPartSchema.parse({
        ...part,
        features: part.features.filter((feature) => feature.kind !== "treatment")
      }));
      const [first, second, basePartHashes] = await Promise.all([
        applyProceduralSurfaceTreatment(baseParts, compiled.motifRecipe),
        applyProceduralSurfaceTreatment(baseParts, compiled.motifRecipe),
        Promise.all(baseParts.map((part) => canonicalPartHash(part)))
      ]);
      const [firstDigest, secondDigest] = await Promise.all([
        sha256(JSON.stringify(treatmentGeometry({
          ...compiled.document,
          parts: first.parts
        }))),
        sha256(JSON.stringify(treatmentGeometry({
          ...compiled.document,
          parts: second.parts
        })))
      ]);
      if (firstDigest !== secondDigest || firstDigest !== await sha256(
        JSON.stringify(treatmentGeometry(compiled.document)),
      )) {
        throw new Error(`Motif application is not byte-stable for ${scenario.id}.`);
      }
      motifDeterminism.push({
        scenarioId: scenario.id,
        composition: compiled.motifRecipe.composition,
        density: compiled.motifRecipe.density,
        symmetry: compiled.motifRecipe.symmetry,
        recipeHash: compiled.motifReport.recipeHash,
        targetBasePartHashes: basePartHashes,
        firstTreatmentGeometrySha256: firstDigest,
        repeatedTreatmentGeometrySha256: secondDigest,
        byteIdentical: true,
        materiallyVisible: compiled.motifReport.status === "applied" &&
          compiled.motifReport.featureIds.length > 0 &&
          compiled.motifReport.segmentCount > 0
      });
    }
    for (const svg of compiled.svgs) {
      const path = `${prefix}/${svg.sheetId}.svg`;
      files.set(path, svg.svg);
      svgHashes[`${scenario.id}/${svg.sheetId}`] = svg.sha256;
    }
    const productGroup = handoff.artifactGroups.find((group) => group.id === "product")!;
    for (const sheet of productGroup.sheets) {
      complexityRows.push({
        scenarioId: scenario.id,
        sheetId: sheet.sheetId,
        pathCount: sheet.complexity.pathCount,
        segmentCount: sheet.complexity.segmentCount,
        vertexCount: sheet.complexity.vertexCount,
        svgByteSize: sheet.complexity.svgByteSize
      });
    }
    compiledCount += 1;
    scenarioSummaries.push({
      id: scenario.id,
      expectedOutcome: scenario.expectedOutcome,
      observedOutcome: mapping.kind,
      artifactDirectory: prefix,
      geometryHash: compiled.geometryHash,
      evaluatedDocumentHash: documentHash,
      svgHashes: compiled.svgs.map((svg) => ({ sheetId: svg.sheetId, sha256: svg.sha256 })),
      productArtifactSetHash: productGroup.artifactSetHash,
      runtimeApplicationApiCalls: 0,
      physicalVerification: "required"
    });
  }

  const complexityBudget = maxComplexity(complexityRows);
  const distinctRecipes = new Set(motifDeterminism.map((candidate) => JSON.stringify({
    composition: (candidate as { composition: string }).composition,
    density: (candidate as { density: string }).density,
    symmetry: (candidate as { symmetry: string }).symmetry
  })));
  if (motifDeterminism.length < 3 || distinctRecipes.size < 3) {
    throw new Error("M5 replay corpus needs three materially distinct deterministic motif recipes.");
  }
  const summary = {
    scenarioCount: M5_REPLAY_SCENARIOS.length,
    compiledCount,
    conceptOnlyCount,
    failureCount,
    motifRecipeCount: motifDeterminism.length,
    runtimeApplicationApiCalls: 0 as const
  };
  files.set("replay-corpus.json", json({
    schemaVersion: "1.0",
    milestone: "M5",
    ...summary,
    scenarios: scenarioSummaries
  }));
  files.set("motif-determinism.json", json({
    schemaVersion: "1.0",
    milestone: "M5",
    requirement: "same recipe, seed, and base-part hash reproduce byte-identical treatment geometry",
    recipes: motifDeterminism
  }));
  files.set("complexity-budget.json", json({
    schemaVersion: "1.0",
    milestone: "M5",
    policy: "exact imported replay-corpus maxima; not a universal xTool Studio limit",
    evidence: M5_COMPLEXITY_EVIDENCE,
    maxima: complexityBudget,
    observedSheets: complexityRows
  }));
  files.set("optional-cut-width-fit-test/project.json", json(optionalFitTest.document));
  files.set(
    "optional-cut-width-fit-test/projection-bundle.json",
    json(optionalFitTest.bundle),
  );
  for (const svg of optionalFitTest.svgs) {
    files.set(`optional-cut-width-fit-test/${svg.sheetId}.svg`, svg.svg);
  }

  return {
    files,
    summary,
    geometryHashes,
    evaluatedDocumentHashes,
    svgHashes,
    complexityBudget
  };
}

export { json };
