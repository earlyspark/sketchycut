import { canonicalGeometryHash } from "../compiler/canonical.js";
import { DesignDocumentV1Schema, type DesignDocumentV1, type ValidationReport } from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import {
  MotifRecipeV1Schema,
  PROCEDURAL_SURFACE_TREATMENT_OPERATOR,
  type MotifApplicationReport,
  type MotifRecipeV1
} from "../operators/procedural-surface-treatment.js";
import type { OrthogonalCompileProfiles } from "../operators/orthogonal-compiler.js";
import { buildMultiSheetProjectionBundle } from "../projections/bundle.js";
import { buildFabricationEvidenceProjection } from "../projections/evidence.js";
import { nestPartsAcrossSheets } from "../projections/fabrication/nesting.js";
import { validateOrthogonalAssembly } from "../validation/assembly.js";
import { validateParts } from "../validation/geometry.js";
import { validateCapturedPanelSlide } from "../validation/prismatic.js";
import { validateRetainedPinMechanism } from "../validation/revolute.js";
import type { ProductCompileWorkerSuccess } from "../workers/protocol.js";
import type { ConstructionPlanV1 } from "./construction-contracts.js";
import type { ClosedSemanticProjection } from "./semantic-interpretation.js";
import { applyPlannedProceduralMotif } from "./procedural-motif-planner.js";

function mergeReports(...reports: readonly ValidationReport[]): ValidationReport {
  const unique = new Map<string, ValidationReport["findings"][number]>();
  for (const finding of reports.flatMap((report) => report.findings)) {
    const key = `${finding.code}|${[...finding.relatedIds].sort().join(",")}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  const findings = [...unique.values()];
  return {
    schemaVersion: "2.0",
    status: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    findings
  };
}

function validateMotifDocument(document: DesignDocumentV1): ValidationReport {
  const reports: ValidationReport[] = [validateParts(document.parts), validateOrthogonalAssembly(document)];
  if (document.motionConstraints.some((item) => item.kind === "revolute")) {
    reports.push(validateRetainedPinMechanism(document).validation);
  }
  if (document.motionConstraints.some((item) => item.kind === "prismatic")) {
    reports.push(validateCapturedPanelSlide(document).validation);
  }
  return mergeReports(...reports);
}

function preferredPartRoles(projection: ClosedSemanticProjection): ("support" | "enclosure" | "cover" | "moving-panel" | "connector")[] {
  const roles = new Set<"support" | "enclosure" | "cover" | "moving-panel" | "connector">();
  for (const role of projection.motif?.preferredBodyRoles ?? []) {
    if (role === "primary-enclosure") roles.add("enclosure");
    if (role === "support") roles.add("support");
    if (role === "cover") {
      roles.add("cover");
      roles.add("moving-panel");
    }
  }
  if (roles.size === 0) roles.add("enclosure");
  return [...roles];
}

export async function applyClosedSemanticProjectionMotif(input: {
  base: ProductCompileWorkerSuccess;
  projection: ClosedSemanticProjection;
  plan: ConstructionPlanV1;
  profiles: OrthogonalCompileProfiles;
  placement?: MotifRecipeV1["placement"];
}): Promise<{
  compiled: ProductCompileWorkerSuccess;
  motifRecipe: MotifRecipeV1 | null;
  motifReport: MotifApplicationReport | null;
}> {
  if (input.projection.motif === null) return { compiled: input.base, motifRecipe: null, motifReport: null };
  const recipe = MotifRecipeV1Schema.parse({
    schemaVersion: "1.0",
    recipeId: "projection-surface-treatment",
    deterministicSeed: await hashCanonical({ motif: input.projection.motif, planId: input.plan.planId }),
    vocabulary: input.projection.motif.primitiveFamilies,
    composition: input.projection.motif.composition,
    density: input.projection.motif.density,
    symmetry: input.projection.motif.symmetry,
    primitiveFamilies: input.projection.motif.primitiveFamilies,
    preferredOperations: input.projection.motif.preferredOperations,
    preferredPartRoles: preferredPartRoles(input.projection),
    placement: input.placement ?? {
      scalePermille: 1_000,
      rotationQuarterTurns: 0,
      offsetXPermille: 0,
      offsetYPermille: 0,
      targetFace: "front"
    }
  });
  const motif = await applyPlannedProceduralMotif({
    parts: input.base.document.parts,
    recipe,
    validate: (parts) => validateMotifDocument({ ...input.base.document, parts: [...parts] })
  });
  const provisional = DesignDocumentV1Schema.parse({
    ...input.base.document,
    operatorProgram: [
      ...input.base.document.operatorProgram,
      {
        operatorId: PROCEDURAL_SURFACE_TREATMENT_OPERATOR.id,
        operatorVersion: PROCEDURAL_SURFACE_TREATMENT_OPERATOR.version,
        parameterHash: await hashCanonical({ recipe: motif.recipe, report: motif.report })
      }
    ],
    parts: motif.parts,
    constructionSelections: [...(input.base.document.constructionSelections ?? []), motif.selection],
    provenance: {
      ...input.base.document.provenance,
      motifRecipeHash: motif.report.recipeHash,
      simplificationDisclosures: [
        ...(input.base.document.provenance.simplificationDisclosures ?? []),
        ...(motif.selection.changedConstruction ? [motif.selection.disclosure] : [])
      ],
      operatorVersions: {
        ...input.base.document.provenance.operatorVersions,
        [PROCEDURAL_SURFACE_TREATMENT_OPERATOR.id]: PROCEDURAL_SURFACE_TREATMENT_OPERATOR.version
      }
    }
  });
  const document = DesignDocumentV1Schema.parse({
    ...provisional,
    validation: mergeReports(input.base.document.validation, validateMotifDocument(provisional))
  });
  if (document.validation.status !== "pass") throw new Error("CONSTRUCTION_MOTIF_VALIDATION_FAILED");
  const nests = nestPartsAcrossSheets(
    document.parts,
    input.profiles.machine,
    input.profiles.material,
    input.profiles.processRecipe,
    input.profiles.fabricationContext
  );
  const [artifacts, geometryHash, evidence] = await Promise.all([
    buildMultiSheetProjectionBundle(document, nests),
    canonicalGeometryHash(document),
    buildFabricationEvidenceProjection(document)
  ]);
  return {
    compiled: {
      kind: "product-success",
      requestId: input.base.requestId,
      status: "success",
      document,
      geometryHash,
      bundle: artifacts.bundle,
      evidence,
      svgs: artifacts.svgs
    },
    motifRecipe: motif.recipe,
    motifReport: motif.report
  };
}
