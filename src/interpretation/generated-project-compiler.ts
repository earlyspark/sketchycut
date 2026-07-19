import { canonicalGeometryHash } from "../compiler/canonical.js";
import {
  DesignDocumentV1Schema,
  type DesignDocumentV1,
  type InputPolicyEvaluation,
  type ValidationReport
} from "../domain/contracts.js";
import { resolvePinSetup, type AppliedPinSetup } from "../domain/fabrication-setup.js";
import { hashCanonical } from "../domain/hash.js";
import {
  MotifRecipeV1Schema,
  PROCEDURAL_SURFACE_TREATMENT_OPERATOR,
  type MotifRecipeV1
} from "../operators/procedural-surface-treatment.js";
import {
  createCapturedSlideProgram,
  createPanelProgram,
  createRetainedProgram,
  type ProgramContent
} from "../operators/orthogonal-program-builders.js";
import type { OrthogonalCompileProfiles } from "../operators/orthogonal-compiler.js";
import { buildMultiSheetProjectionBundle } from "../projections/bundle.js";
import { buildFabricationEvidenceProjection } from "../projections/evidence.js";
import { nestPartsAcrossSheets } from "../projections/fabrication/nesting.js";
import { validateOrthogonalAssembly } from "../validation/assembly.js";
import { validateParts } from "../validation/geometry.js";
import { validateCapturedPanelSlide } from "../validation/prismatic.js";
import { validateRetainedPinMechanism } from "../validation/revolute.js";
import { compileProductRequest } from "../workers/compile-service.js";
import type { ProductCompileWorkerRequest } from "../workers/protocol.js";

import {
  GeneratedDeterministicControlsSchema,
  GeneratedSemanticProvenanceSchema,
  type GeneratedCompiledProject,
  type GeneratedDeterministicControls,
  type GeneratedSemanticProvenance
} from "./generated-project-contracts.js";
import type { IntentGraphV1 } from "./intent-graph.js";
import type { CapabilityMappingOutcome } from "./mapper.js";
import { DeterministicCompilationError } from "./compilation-error.js";
import { applyPlannedProceduralMotif } from "./procedural-motif-planner.js";
import type { SemanticGenerationRequestV1 } from "./semantic-request.js";

type FabricationMapping = Exclude<CapabilityMappingOutcome, { kind: "concept-only" }>;
type GeneratedControls = GeneratedDeterministicControls;

const REFERENCE_MOTIF_APPROXIMATION_DISCLOSURE =
  "Reference imagery informed only semantic vocabulary, composition, density, symmetry, and registered primitive selection. The surface treatment is a deterministic approximation; no reference region was traced or vectorized.";

function generatedProjectId(prefix: string, controls: GeneratedControls): string {
  const { width, depth, height } = controls.dimensionsMm;
  return `${prefix}-${String(width)}-${String(depth)}-${String(height)}`;
}

function supportContent(
  intent: IntentGraphV1,
  controls: GeneratedControls,
  hasMotif: boolean,
): ProgramContent {
  return {
    programId: "generated-orthogonal-support",
    projectId: generatedProjectId("generated-support", controls),
    title: intent.title,
    description: intent.coreIntent,
    dimensions: {
      widthMm: controls.dimensionsMm.width,
      depthMm: controls.dimensionsMm.depth,
      heightMm: controls.dimensionsMm.height
    },
    includeFront: true,
    dividerCount: 0,
    treatmentPrimitive: hasMotif ? null : "parallel-lines"
  };
}

function buildCompileRequest(input: {
  requestId: string;
  intent: IntentGraphV1;
  mapping: FabricationMapping;
  profiles: OrthogonalCompileProfiles;
  inputPolicyEvaluation: InputPolicyEvaluation;
  pin: AppliedPinSetup;
  controls: GeneratedControls;
}): ProductCompileWorkerRequest {
  const { mapping, controls, profiles, intent } = input;
  const hasMotif = intent.motif !== null && mapping.acceptedMotifPrimitives.length > 0;
  const support = supportContent(intent, controls, hasMotif);
  const common = {
    kind: "product-compile" as const,
    requestId: input.requestId,
    profiles,
    inputPolicyEvaluation: input.inputPolicyEvaluation
  };
  if (mapping.operatorGraph.graphId === "rigid-panel-composition") {
    return {
      ...common,
      structuralKind: "orthogonal-panel",
      program: createPanelProgram(support, profiles)
    };
  }
  if (mapping.operatorGraph.graphId === "single-revolute-panel") {
    const pin = resolvePinSetup(input.pin);
    return {
      ...common,
      structuralKind: "retained-pin",
      program: createRetainedProgram({
        programId: "generated-revolute-panel",
        projectId: generatedProjectId("generated-revolute", controls),
        title: intent.title,
        description: intent.coreIntent,
        support,
        movingPanelId: "cover-panel",
        movingPanelName: "Rigid moving panel",
        movingPanelMarkingCode: "p6",
        stationaryAnchorPartId: "rear-panel",
        panelWidthMm: controls.dimensionsMm.width,
        panelDepthMm: controls.dimensionsMm.depth,
        axisXmm: 0,
        stationSpanMm: { start: 20, end: controls.dimensionsMm.width - 20 },
        openAngleDegrees: 105,
        axialEndplayMm: 0.6,
        installationClearanceMm: 12,
        pin: {
          kind: "wooden-dowel",
          stockProfileId: pin.basis === "nominal-preset"
            ? `wooden-pin-starter-${String(Math.round(pin.effectiveDiameterMm * 1_000))}`
            : `wooden-pin-measured-${String(Math.round(pin.effectiveDiameterMm * 1_000))}`,
          sourceLabel: pin.basis === "nominal-preset"
            ? "Sold as a nominal 3 mm straight wooden dowel or bamboo skewer; actual diameter unmeasured"
            : "User-measured straight wooden dowel or bamboo skewer",
          nominalDiameterMm: 3,
          measuredDiameterMm: pin.effectiveDiameterMm,
          measuredMinimumDiameterMm: pin.effectiveDiameterMm,
          measuredMaximumDiameterMm: pin.effectiveDiameterMm,
          straightnessEvidence: "unverified",
          evidenceState: pin.basis === "nominal-preset" ? "provisional-preset" : "user-reported",
          diameterBasis: pin.basis
        }
      }, profiles)
    };
  }
  return {
    ...common,
    structuralKind: "captured-slide",
    program: createCapturedSlideProgram({
      programId: "generated-prismatic-panel",
      projectId: generatedProjectId("generated-prismatic", controls),
      title: intent.title,
      description: intent.coreIntent,
      support,
      movingPanelId: "sliding-cover-panel",
      movingPanelName: "Captured sliding cover",
      movingPanelMarkingCode: "p6",
      minimumGuideEngagementMm: 18,
      verticalRunningClearanceMm: 0.6,
      lateralRunningClearanceMm: 0.6,
      thumbAccessWidthMm: 24,
      thumbAccessDepthMm: 10
    }, profiles)
  };
}

function mergeReports(...reports: readonly ValidationReport[]): ValidationReport {
  const unique = new Map<string, ValidationReport["findings"][number]>();
  for (const finding of reports.flatMap((report) => report.findings)) {
    const key = `${finding.code}|${[...finding.relatedIds].sort().join(",")}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  const findings = [...unique.values()];
  return {
    schemaVersion: "1.0",
    status: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    findings
  };
}

function motifValidation(document: DesignDocumentV1): ValidationReport {
  const reports: ValidationReport[] = [
    validateParts(document.parts),
    validateOrthogonalAssembly(document)
  ];
  if (document.motionConstraints.some((constraint) => constraint.kind === "revolute")) {
    reports.push(validateRetainedPinMechanism(document).validation);
  }
  if (document.motionConstraints.some((constraint) => constraint.kind === "prismatic")) {
    reports.push(validateCapturedPanelSlide(document).validation);
  }
  return mergeReports(...reports);
}

function motifRecipe(
  intent: IntentGraphV1,
  mapping: FabricationMapping,
  controls: GeneratedControls,
): MotifRecipeV1 | null {
  if (intent.motif === null || mapping.acceptedMotifPrimitives.length === 0) return null;
  return MotifRecipeV1Schema.parse({
    schemaVersion: "1.0",
    recipeId: "reference-motif",
    deterministicSeed: mapping.intentDigest,
    vocabulary: intent.motif.vocabulary,
    composition: intent.motif.composition,
    density: intent.motif.density,
    symmetry: intent.motif.symmetry,
    primitiveFamilies: mapping.acceptedMotifPrimitives,
    preferredOperations: intent.motif.preferredOperations,
    preferredPartRoles: intent.motif.preferredPartRoles,
    placement: controls.motifPlacement
  });
}

export async function compileGeneratedProjectFromSemantic(input: {
  requestId: string;
  semanticRequest?: SemanticGenerationRequestV1;
  semanticProvenance?: GeneratedSemanticProvenance;
  intent: IntentGraphV1;
  mapping: FabricationMapping;
  profiles: OrthogonalCompileProfiles;
  inputPolicyEvaluation: InputPolicyEvaluation;
  pin: AppliedPinSetup;
  controls: unknown;
  cacheResult: "miss" | "hit" | "singleflight-hit";
  runtimeApplicationApiCalls?: 0 | 1;
}): Promise<GeneratedCompiledProject> {
  if ((input.semanticRequest === undefined) === (input.semanticProvenance === undefined)) {
    throw new Error("Exactly one semantic request or sanitized semantic provenance is required.");
  }
  const semanticProvenance = input.semanticRequest === undefined
    ? GeneratedSemanticProvenanceSchema.parse(input.semanticProvenance)
    : GeneratedSemanticProvenanceSchema.parse({
        modelId: input.semanticRequest.modelConfiguration.modelId,
        promptVersion: input.semanticRequest.promptVersion,
        promptHash: input.semanticRequest.promptHash,
        semanticRequestDigest: await hashCanonical(input.semanticRequest),
        capabilityCatalogVersion: input.semanticRequest.capabilityCatalogVersion
      });
  const controls = GeneratedDeterministicControlsSchema.parse(input.controls);
  const base = await compileProductRequest(buildCompileRequest({ ...input, controls }));
  const requestedRecipe = motifRecipe(input.intent, input.mapping, controls);
  const motif = requestedRecipe === null
    ? null
    : await applyPlannedProceduralMotif({
        parts: base.document.parts,
        recipe: requestedRecipe,
        validate: (parts) => motifValidation({ ...base.document, parts: [...parts] })
      });
  const recipe = motif?.recipe ?? null;
  const referenceMotifApproximation = recipe !== null && input.intent.references.length > 0
    ? [REFERENCE_MOTIF_APPROXIMATION_DISCLOSURE]
    : [];
  const request = {
    ...base.document.request,
    title: input.intent.title,
    description: input.intent.coreIntent,
    referenceIds: input.intent.references.map((reference) => reference.referenceId)
  };
  const operatorProgram = recipe === null || motif === null
    ? base.document.operatorProgram
    : [
        ...base.document.operatorProgram,
        {
          operatorId: PROCEDURAL_SURFACE_TREATMENT_OPERATOR.id,
          operatorVersion: PROCEDURAL_SURFACE_TREATMENT_OPERATOR.version,
          parameterHash: await hashCanonical({ recipe, report: motif.report })
        }
      ];
  const provisional = DesignDocumentV1Schema.parse({
    ...base.document,
    request,
    intent: input.intent,
    operatorProgram,
    parts: motif?.parts ?? base.document.parts,
    constructionSelections: motif === null
      ? base.document.constructionSelections
      : [...(base.document.constructionSelections ?? []), motif.selection],
    provenance: {
      ...base.document.provenance,
      modelId: semanticProvenance.modelId,
      promptVersion: semanticProvenance.promptVersion,
      promptHash: semanticProvenance.promptHash,
      runtimeApplicationApiCalls: input.runtimeApplicationApiCalls ??
        (input.cacheResult === "miss" ? 1 : 0),
      semanticRequestDigest: semanticProvenance.semanticRequestDigest,
      capabilityCatalogVersion: semanticProvenance.capabilityCatalogVersion,
      supportOutcome: input.mapping.kind,
      requirementEvidence: input.mapping.requirementEvidence,
      simplificationDisclosures: [
        ...input.mapping.disclosures,
        ...referenceMotifApproximation,
        ...(motif?.selection.changedConstruction === true
          ? [motif.selection.disclosure]
          : [])
      ],
      ...(motif === null ? {} : { motifRecipeHash: motif.report.recipeHash }),
      operatorVersions: {
        ...base.document.provenance.operatorVersions,
        ...(motif === null
          ? {}
          : {
              [PROCEDURAL_SURFACE_TREATMENT_OPERATOR.id]:
                PROCEDURAL_SURFACE_TREATMENT_OPERATOR.version
            })
      }
    }
  });
  const validation = mergeReports(base.document.validation, motifValidation(provisional));
  const document = DesignDocumentV1Schema.parse({ ...provisional, validation });
  if (document.validation.status !== "pass") {
    const blocker = document.validation.findings.find((finding) => finding.severity === "error");
    throw new DeterministicCompilationError(
      blocker?.code ?? "GENERATED_PROJECT_VALIDATION_FAILED",
      blocker?.message ?? "Generated project validation failed.",
    );
  }
  const nests = nestPartsAcrossSheets(
    document.parts,
    input.profiles.machine,
    input.profiles.material,
    input.profiles.processRecipe,
    input.profiles.fabricationContext,
  );
  const [artifacts, geometryHash, evidence] = await Promise.all([
    buildMultiSheetProjectionBundle(document, nests),
    canonicalGeometryHash(document),
    buildFabricationEvidenceProjection(document)
  ]);
  return {
    document,
    geometryHash,
    bundle: artifacts.bundle,
    evidence,
    svgs: artifacts.svgs,
    motifRecipe: recipe,
    motifReport: motif?.report ?? null,
    scaleDisclosure: controls.scaleSource === "disclosed-preset"
      ? "No reliable scale was supplied; the registered 120 × 90 × 58 mm working preset was applied."
      : null
  };
}
