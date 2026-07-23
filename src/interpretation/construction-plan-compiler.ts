import type {
  CutThroughTreatmentRequest,
  InputPolicyEvaluation,
  OrthogonalPanelProgramV1
} from "../domain/contracts.js";
import { resolvePinSetup, type AppliedPinSetup } from "../domain/fabrication-setup.js";
import {
  createCapturedSlideProgram,
  createPanelProgram,
  createRetainedProgram,
  type ProgramContent
} from "../operators/orthogonal-program-builders.js";
import type { OrthogonalCompileProfiles } from "../operators/orthogonal-compiler.js";
import {
  importComplexityWithinCurrentLimit,
  measureSheetImportComplexity,
  type SheetImportComplexity
} from "../projections/import-complexity.js";
import type { MotifRecipeV1 } from "../operators/procedural-surface-treatment.js";
import type { MotifApplicationReport } from "../operators/procedural-surface-treatment.js";
import { compileProductRequest } from "../workers/compile-service.js";
import type { ProductCompileWorkerRequest, ProductCompileWorkerSuccess } from "../workers/protocol.js";
import { ConstructionPlanV1Schema, type ConstructionPlanV1 } from "./construction-contracts.js";
import { applyClosedSemanticProjectionMotif } from "./construction-motif.js";
import { bindCanonicalGenerationDocument, type CanonicalSemanticProvenance } from "./canonical-generation-document.js";
import { SizingDecisionV1Schema, type SizingDecisionV1 } from "./constraint-sizing-solver.js";
import { ClosedSemanticProjectionSchema } from "./semantic-interpretation.js";
import {
  evaluateRequirementRealization,
  type RequirementRealizationLedgerV1
} from "./realization-ledger.js";

export type CompiledConstructionCandidateV1 = {
  compiled: ProductCompileWorkerSuccess;
  motifRecipe: MotifRecipeV1 | null;
  motifReport: MotifApplicationReport | null;
  motifRecipeHash: string | null;
  motifStatus: "applied" | "omitted" | null;
  requirementRealization: RequirementRealizationLedgerV1;
  importComplexity: readonly {
    sheetId: string;
    complexity: SheetImportComplexity;
    withinCurrentLimit: boolean;
  }[];
};

function supportContent(input: {
  plan: ConstructionPlanV1;
  sizing: SizingDecisionV1;
}): ProgramContent {
  return {
    programId: `program-${input.plan.planId}`,
    projectId: input.plan.planId,
    title: "Generated construction",
    description: "Deterministically compiled from the closed semantic projection.",
    dimensions: {
      widthMm: input.sizing.external.widthUm / 1_000,
      depthMm: input.sizing.external.depthUm / 1_000,
      heightMm: input.sizing.internal.heightUm / 1_000
    },
    includeFront: input.plan.topology.access !== "open-front",
    dividerCount: input.plan.topology.canonicalSpaces.length - 1,
    dividerAxis: input.plan.topology.partitionAxis ?? "width",
    treatmentPrimitive: null,
    fixedTop: input.plan.topology.mechanism === "fixed-top-frame"
  };
}

function cutThroughRequests(input: {
  plan: ConstructionPlanV1;
  profiles: OrthogonalCompileProfiles;
  densityCeiling?: CutThroughTreatmentRequest["density"];
}): CutThroughTreatmentRequest[] {
  const fullCutWidthUm = Math.round(Math.max(
    input.profiles.processRecipe.cutWidth.xMm,
    input.profiles.processRecipe.cutWidth.yMm,
  ) * 1_000);
  const bridgeWidthUm = Math.max(
    Math.round(input.profiles.material.measuredThicknessMm * 1_000),
    fullCutWidthUm * 4,
    Math.round(input.profiles.machine.minimumFeatureMm * 1_000),
  );
  const edgeMarginUm = Math.max(9_000, bridgeWidthUm * 3);
  const symmetryOrder = {
    none: 1,
    bilateral: 2,
    translational: 2,
    radial: 8
  } as const;
  const densityRank = { sparse: 0, balanced: 1, dense: 2 } as const;
  return input.plan.cutThroughTreatments.map((treatment) => ({
    applicationId: treatment.applicationId,
    patternFamily: treatment.patternFamily,
    purpose: treatment.purpose,
    density: input.densityCeiling === undefined || densityRank[treatment.density] <= densityRank[input.densityCeiling]
      ? treatment.density
      : input.densityCeiling,
    requestedDensity: treatment.density,
    symmetryOrder: symmetryOrder[treatment.symmetry],
    edgeMarginUm,
    bridgeWidthUm,
    targetPartIds: treatment.targetPanelIds,
    repeatedGroupId: treatment.repeatedGroupId,
    sourceRequirementIds: [treatment.requirementId]
  }));
}

function buildOrthogonalProgram(input: {
  support: ProgramContent;
  plan: ConstructionPlanV1;
  profiles: OrthogonalCompileProfiles;
  densityCeiling?: CutThroughTreatmentRequest["density"];
}): OrthogonalPanelProgramV1 {
  const base = createPanelProgram(input.support, input.profiles);
  return {
    ...base,
    cutThroughTreatments: cutThroughRequests(input),
    applicationLimitations: []
  };
}

function compileRequest(input: {
  requestId: string;
  plan: ConstructionPlanV1;
  sizing: SizingDecisionV1;
  profiles: OrthogonalCompileProfiles;
  inputPolicyEvaluation: InputPolicyEvaluation;
  pin: AppliedPinSetup;
  densityCeiling?: CutThroughTreatmentRequest["density"];
}): ProductCompileWorkerRequest {
  const support = supportContent(input);
  const common = {
    kind: "product-compile" as const,
    requestId: input.requestId,
    profiles: input.profiles,
    inputPolicyEvaluation: input.inputPolicyEvaluation
  };
  if (input.plan.topology.mechanism === "rigid") {
    return {
      ...common,
      structuralKind: "orthogonal-panel",
      program: buildOrthogonalProgram({
        support,
        plan: input.plan,
        profiles: input.profiles,
        ...(input.densityCeiling === undefined ? {} : { densityCeiling: input.densityCeiling })
      })
    };
  }
  if (input.plan.topology.mechanism === "fixed-top-frame") {
    return {
      ...common,
      structuralKind: "orthogonal-panel",
      program: buildOrthogonalProgram({
        support,
        plan: input.plan,
        profiles: input.profiles,
        ...(input.densityCeiling === undefined ? {} : { densityCeiling: input.densityCeiling })
      })
    };
  }
  const cover = input.plan.panels.find((item) => item.role === "cover");
  if (cover === undefined) throw new Error("CONSTRUCTION_PLAN_COVER_MISSING");
  if (input.plan.topology.mechanism === "retained-pin") {
    const pin = resolvePinSetup(input.pin);
    const widthMm = input.sizing.external.widthUm / 1_000;
    const depthMm = input.sizing.external.depthUm / 1_000;
    const endInsetMm = Math.max(15, Math.min(20, widthMm / 5));
    return {
      ...common,
      structuralKind: "retained-pin",
      program: createRetainedProgram({
        programId: `retained-${input.plan.planId}`,
        projectId: input.plan.planId,
        title: "Generated construction",
        description: "Deterministically compiled from the closed semantic projection.",
        support,
        movingPanelId: cover.id,
        movingPanelName: "Retained moving cover",
        movingPanelMarkingCode: cover.markingCode,
        stationaryAnchorPartId: "rear-panel",
        panelWidthMm: widthMm,
        panelDepthMm: depthMm,
        axisXmm: 0,
        stationSpanMm: { start: endInsetMm, end: widthMm - endInsetMm },
        openAngleDegrees: 105,
        axialEndplayMm: 0.6,
        installationClearanceMm: 12,
        pin: {
          kind: pin.basis === "user-reported-reference-gauge"
            ? "wooden-toothpick"
            : "wooden-dowel",
          stockProfileId: pin.basis === "nominal-preset"
            ? `wooden-pin-starter-${String(Math.round(pin.effectiveDiameterMm * 1_000))}`
            : pin.basis === "user-reported-reference-gauge"
              ? `wooden-toothpick-awg-${String(pin.referenceGauge.largerDiameterGaugeNumber)}-` +
                `${String(pin.referenceGauge.smallerDiameterGaugeNumber)}-` +
                String(Math.round(pin.effectiveDiameterMm * 1_000))
            : `wooden-pin-measured-${String(Math.round(pin.effectiveDiameterMm * 1_000))}`,
          sourceLabel: pin.basis === "nominal-preset"
            ? "Sold as a nominal 3 mm straight wooden dowel or bamboo skewer; actual diameter unmeasured"
            : pin.basis === "user-reported-reference-gauge"
              ? `Wooden toothpick section reported between AWG ` +
                `${String(pin.referenceGauge.largerDiameterGaugeNumber)} and ` +
                `${String(pin.referenceGauge.smallerDiameterGaugeNumber)} reference holes`
              : "User-measured straight wooden dowel or bamboo skewer",
          nominalDiameterMm: 3,
          measuredDiameterMm: pin.effectiveDiameterMm,
          measuredMinimumDiameterMm: pin.basis === "user-reported-reference-gauge"
            ? pin.minimumDiameterMm
            : pin.effectiveDiameterMm,
          measuredMaximumDiameterMm: pin.basis === "user-reported-reference-gauge"
            ? pin.maximumDiameterMm
            : pin.effectiveDiameterMm,
          straightnessEvidence: pin.basis === "user-reported-reference-gauge"
            ? pin.straightnessEvidence
            : "unverified",
          evidenceState: pin.basis === "nominal-preset" ? "provisional-preset" : "user-reported",
          diameterBasis: pin.basis,
          ...(pin.basis === "user-reported-reference-gauge"
            ? { referenceGauge: pin.referenceGauge }
            : {})
        }
      }, input.profiles)
    };
  }
  return {
    ...common,
    structuralKind: "captured-slide",
    program: createCapturedSlideProgram({
      programId: `captured-${input.plan.planId}`,
      projectId: input.plan.planId,
      title: "Generated construction",
      description: "Deterministically compiled from the closed semantic projection.",
      support,
      movingPanelId: cover.id,
      movingPanelName: "Captured sliding cover",
      movingPanelMarkingCode: cover.markingCode,
      minimumGuideEngagementMm: 18,
      verticalRunningClearanceMm: 0.6,
      lateralRunningClearanceMm: 0.6,
      thumbAccessWidthMm: 24,
      thumbAccessDepthMm: 10
    }, input.profiles)
  };
}

function verifyPlanCorrespondence(plan: ConstructionPlanV1, compiled: ProductCompileWorkerSuccess): void {
  const partById = new Map(compiled.document.parts.map((part) => [part.id, part]));
  for (const panel of plan.panels) {
    const part = partById.get(panel.id);
    if (part === undefined) throw new Error(`CONSTRUCTION_PLAN_PANEL_MISSING:${panel.id}`);
    if (part.markingCode !== panel.markingCode) throw new Error(`CONSTRUCTION_PLAN_MARKING_MISMATCH:${panel.id}`);
  }
  const jointIds = new Set(compiled.document.joints.map((joint) => joint.id));
  for (const mate of plan.mates.filter((item) =>
    item.kind === "tab-slot" || item.kind === "edge-finger" || item.kind === "fixed-top-frame"
  )) {
    if (!jointIds.has(mate.id)) throw new Error(`CONSTRUCTION_PLAN_MATE_MISSING:${mate.id}`);
  }
}

export async function compileConstructionPlan(input: {
  requestId: string;
  projection: unknown;
  plan: unknown;
  sizing: unknown;
  profiles: OrthogonalCompileProfiles;
  inputPolicyEvaluation: InputPolicyEvaluation;
  pin: AppliedPinSetup;
  motifPlacement?: MotifRecipeV1["placement"];
  semanticProvenance?: CanonicalSemanticProvenance;
}): Promise<CompiledConstructionCandidateV1> {
  const projection = ClosedSemanticProjectionSchema.parse(input.projection);
  const plan = ConstructionPlanV1Schema.parse(input.plan);
  const sizing = SizingDecisionV1Schema.parse(input.sizing);
  const highestRequestedRank = Math.max(-1, ...plan.cutThroughTreatments.map((item) =>
    item.density === "dense" ? 2 : item.density === "balanced" ? 1 : 0
  ));
  const densityAttempts = highestRequestedRank < 0
    ? [undefined]
    : (["sparse", "balanced", "dense"] as const).slice(0, highestRequestedRank + 1).reverse();
  let lastCandidate: CompiledConstructionCandidateV1 | null = null;
  for (const [attemptIndex, densityCeiling] of densityAttempts.entries()) {
    try {
      const base = await compileProductRequest(compileRequest({
      requestId: input.requestId,
      plan,
      sizing,
      profiles: input.profiles,
      inputPolicyEvaluation: input.inputPolicyEvaluation,
      pin: input.pin,
      ...(densityCeiling === undefined ? {} : { densityCeiling })
    }));
      const motif = await applyClosedSemanticProjectionMotif({
      base, projection, plan, profiles: input.profiles,
      ...(input.motifPlacement === undefined ? {} : { placement: input.motifPlacement })
    });
      const requirementRealization = evaluateRequirementRealization({
      projection,
      plan,
      document: motif.compiled.document,
      motifReport: motif.motifReport
    });
      const compiled = await bindCanonicalGenerationDocument({
      compiled: motif.compiled,
      projection: projection,
      plan,
      requirementRealization,
      profiles: input.profiles,
      ...(input.semanticProvenance === undefined ? {} : { semanticProvenance: input.semanticProvenance })
    });
      if (compiled.document.validation.status !== "pass") {
        throw new Error("CONSTRUCTION_PLAN_VALIDATION_FAILED");
      }
      verifyPlanCorrespondence(plan, compiled);
      const svgBySheet = new Map(compiled.svgs.map((item) => [item.sheetId, item.svg]));
      const importComplexity = compiled.bundle.fabrication.sheets.map((sheet) => {
        const svg = svgBySheet.get(sheet.id);
        if (svg === undefined) throw new Error(`CONSTRUCTION_PLAN_SVG_MISSING:${sheet.id}`);
        const complexity = measureSheetImportComplexity(sheet, svg);
        return { sheetId: sheet.id, complexity, withinCurrentLimit: importComplexityWithinCurrentLimit(complexity) };
      });
      const candidate = {
        compiled,
        motifRecipe: motif.motifRecipe,
        motifReport: motif.motifReport,
        motifRecipeHash: motif.motifReport?.recipeHash ?? null,
        motifStatus: motif.motifReport?.status ?? null,
        requirementRealization,
        importComplexity
      } satisfies CompiledConstructionCandidateV1;
      lastCandidate = candidate;
      if (importComplexity.every((item) => item.withinCurrentLimit)) return candidate;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const densityDependent = message.startsWith("CUT_THROUGH_SAFE_REGION_UNAVAILABLE") ||
        message.startsWith("CUT_THROUGH_KEEPOUT_INTRUSION");
      if (!densityDependent || attemptIndex === densityAttempts.length - 1) throw error;
    }
  }
  if (lastCandidate === null) throw new Error("CONSTRUCTION_DENSITY_SEARCH_EMPTY");
  return lastCandidate;
}
