import { canonicalGeometryHash } from "../../compiler/canonical";
import {
  DesignDocumentV1Schema,
  type DesignDocumentV1,
  type InputPolicyEvaluation,
  type ValidationReport
} from "../../domain/contracts";
import { hashCanonical } from "../../domain/hash";
import { resolvePinSetup, type AppliedPinSetup } from "../../domain/fabrication-setup";
import {
  GeneratedDeterministicControlsSchema,
  GeneratedSemanticProvenanceSchema,
  type GeneratedCompiledProject,
  type GeneratedDeterministicControls,
  type GeneratedSemanticProvenance
} from "../../interpretation/generated-project-contracts";
import type { CapabilityMappingOutcome } from "../../interpretation/mapper";
import type { IntentGraphV1 } from "../../interpretation/intent-graph";
import type { SemanticGenerationRequestV1 } from "../../interpretation/semantic-request";
import {
  MotifRecipeV1Schema,
  PROCEDURAL_SURFACE_TREATMENT_OPERATOR,
  applyProceduralSurfaceTreatment,
  type MotifRecipeV1
} from "../../operators/procedural-surface-treatment";
import type { OrthogonalCompileProfiles } from "../../operators/orthogonal-compiler";
import { validateOrthogonalAssembly } from "../../validation/assembly";
import { validateParts } from "../../validation/geometry";
import { validateCapturedPanelSlide } from "../../validation/prismatic";
import { validateRetainedPinMechanism } from "../../validation/revolute";
import { buildMultiSheetProjectionBundle } from "../../projections/bundle";
import { buildFabricationEvidenceProjection } from "../../projections/evidence";
import { nestPartsAcrossSheets } from "../../projections/fabrication/nesting";
import { compileProductRequest } from "../../workers/compile-service";
import type { ProductCompileWorkerRequest } from "../../workers/protocol";
import {
  PRIMARY_CAPTURED_SLIDE_PROGRAM_CONTENT,
  PRIMARY_PROGRAM_CONTENT,
  PRIMARY_RETAINED_PROGRAM_CONTENT,
  createCapturedSlidePreset,
  createCapturedSlideProgram,
  createPanelProgram,
  createPrimaryPreset,
  createRetainedPreset,
  createRetainedProgram
} from "./presets";

export const DEFAULT_GENERATED_CONTROLS = GeneratedDeterministicControlsSchema.parse({
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

type GeneratedControls = GeneratedDeterministicControls;
type FabricationMapping = Exclude<CapabilityMappingOutcome, { kind: "concept-only" }>;

export {
  GeneratedCompiledProjectSchema,
  GeneratedDeterministicControlsSchema
} from "../../interpretation/generated-project-contracts";
export type {
  GeneratedCompiledProject,
  GeneratedDeterministicControls,
  GeneratedSemanticProvenance
} from "../../interpretation/generated-project-contracts";

function exactPublicDefault(controls: GeneratedControls): boolean {
  return controls.dimensionsMm.width === 120 &&
    controls.dimensionsMm.depth === 90 &&
    controls.dimensionsMm.height === 58;
}

function generatedProjectId(prefix: string, controls: GeneratedControls): string {
  const { width, depth, height } = controls.dimensionsMm;
  return `${prefix}-${String(width)}-${String(depth)}-${String(height)}`;
}

function supportContent(
  intent: IntentGraphV1,
  controls: GeneratedControls,
  hasMotif: boolean,
) {
  return {
    ...PRIMARY_PROGRAM_CONTENT,
    programId: "generated-orthogonal-support",
    projectId: generatedProjectId("generated-support", controls),
    title: intent.title,
    description: intent.coreIntent,
    dimensions: {
      widthMm: controls.dimensionsMm.width,
      depthMm: controls.dimensionsMm.depth,
      heightMm: controls.dimensionsMm.height
    },
    treatmentPrimitive: hasMotif ? null : PRIMARY_PROGRAM_CONTENT.treatmentPrimitive
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
  const useProtectedDefault = exactPublicDefault(controls) && !hasMotif;
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
      program: useProtectedDefault
        ? createPrimaryPreset("medium", profiles)
        : createPanelProgram(supportContent(intent, controls, hasMotif), profiles)
    };
  }
  if (mapping.operatorGraph.graphId === "single-revolute-panel") {
    const pin = resolvePinSetup(input.pin);
    const program = useProtectedDefault
      ? createRetainedPreset("medium", profiles, pin)
      : createRetainedProgram({
          ...PRIMARY_RETAINED_PROGRAM_CONTENT,
          programId: "generated-revolute-panel",
          projectId: generatedProjectId("generated-revolute", controls),
          title: intent.title,
          description: intent.coreIntent,
          support: supportContent(intent, controls, hasMotif),
          panelWidthMm: controls.dimensionsMm.width,
          panelDepthMm: controls.dimensionsMm.depth,
          stationSpanMm: {
            start: 20,
            end: controls.dimensionsMm.width - 20
          },
          pin: {
            ...PRIMARY_RETAINED_PROGRAM_CONTENT.pin,
            stockProfileId: pin.basis === "nominal-preset"
              ? `wooden-pin-starter-${String(Math.round(pin.effectiveDiameterMm * 1_000))}`
              : `wooden-pin-measured-${String(Math.round(pin.effectiveDiameterMm * 1_000))}`,
            sourceLabel: pin.basis === "nominal-preset"
              ? "Sold as a nominal 3 mm straight wooden dowel or bamboo skewer; actual diameter unmeasured"
              : "User-measured straight wooden dowel or bamboo skewer",
            measuredDiameterMm: pin.effectiveDiameterMm,
            measuredMinimumDiameterMm: pin.effectiveDiameterMm,
            measuredMaximumDiameterMm: pin.effectiveDiameterMm,
            evidenceState: pin.basis === "nominal-preset" ? "provisional-preset" : "user-reported",
            diameterBasis: pin.basis
          }
        }, profiles);
    return { ...common, structuralKind: "retained-pin", program };
  }
  const program = useProtectedDefault
    ? createCapturedSlidePreset("medium", profiles)
    : createCapturedSlideProgram({
        ...PRIMARY_CAPTURED_SLIDE_PROGRAM_CONTENT,
        programId: "generated-prismatic-panel",
        projectId: generatedProjectId("generated-prismatic", controls),
        title: intent.title,
        description: intent.coreIntent,
        support: supportContent(intent, controls, hasMotif)
      }, profiles);
  return { ...common, structuralKind: "captured-slide", program };
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
    recipeId: "m5-reference-motif",
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

export async function compileGeneratedProject(input: {
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
        semanticRequestDigest: await hashCanonical(input.semanticRequest),
        capabilityCatalogVersion: input.semanticRequest.capabilityCatalogVersion
      });
  const controls = GeneratedDeterministicControlsSchema.parse(input.controls);
  const compileRequest = buildCompileRequest({ ...input, controls });
  const base = await compileProductRequest(compileRequest);
  const recipe = motifRecipe(input.intent, input.mapping, controls);
  const motif = recipe === null
    ? null
    : await applyProceduralSurfaceTreatment(base.document.parts, recipe);
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
    provenance: {
      ...base.document.provenance,
      modelId: semanticProvenance.modelId,
      promptVersion: semanticProvenance.promptVersion,
      runtimeApplicationApiCalls: input.runtimeApplicationApiCalls ?? (
        input.cacheResult === "miss" ? 1 : 0
      ),
      semanticRequestDigest: semanticProvenance.semanticRequestDigest,
      capabilityCatalogVersion: semanticProvenance.capabilityCatalogVersion,
      supportOutcome: input.mapping.kind,
      requirementEvidence: input.mapping.requirementEvidence,
      simplificationDisclosures: input.mapping.disclosures,
      ...(motif === null ? {} : { motifRecipeHash: motif.report.recipeHash }),
      operatorVersions: {
        ...base.document.provenance.operatorVersions,
        ...(motif === null
          ? {}
          : { [PROCEDURAL_SURFACE_TREATMENT_OPERATOR.id]: PROCEDURAL_SURFACE_TREATMENT_OPERATOR.version })
      }
    }
  });
  const validation = mergeReports(base.document.validation, motifValidation(provisional));
  const document = DesignDocumentV1Schema.parse({ ...provisional, validation });
  if (document.validation.status !== "pass") {
    const blocker = document.validation.findings.find((finding) => finding.severity === "error");
    throw new Error(blocker?.code ?? "GENERATED_PROJECT_VALIDATION_FAILED");
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
