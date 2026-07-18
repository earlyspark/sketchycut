import {
  ConstructionSelectionSchema,
  SheetPartSchema,
  type ConstructionSelection,
  type SheetPart,
  type ValidationReport
} from "../domain/contracts.js";
import {
  MotifApplicationReportSchema,
  MotifRecipeV1Schema,
  PROCEDURAL_SURFACE_TREATMENT_OPERATOR,
  applyProceduralSurfaceTreatment,
  type MotifApplicationReport,
  type MotifRecipeV1
} from "../operators/procedural-surface-treatment.js";
import { validateParts } from "../validation/geometry.js";

export const PROCEDURAL_MOTIF_SEARCH_POLICY = {
  id: "procedural-motif-construction-search",
  version: "1.0.0",
  preferredCandidateId: "requested-primitives"
} as const;

type SearchCandidate = {
  id: string;
  recipe: MotifRecipeV1;
  omittedPrimitive: MotifRecipeV1["primitiveFamilies"][number] | null;
};

export type PlannedProceduralMotif = {
  parts: SheetPart[];
  recipe: MotifRecipeV1;
  report: MotifApplicationReport;
  selection: ConstructionSelection;
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function targetParts(parts: readonly SheetPart[], recipe: MotifRecipeV1): SheetPart[] {
  const roles = new Set(recipe.preferredPartRoles);
  const movingRequested = roles.has("cover") || roles.has("moving-panel");
  const structuralRequested = roles.has("support") || roles.has("enclosure");
  const moving = movingRequested
    ? parts.filter((part) => part.role === "moving-panel")
    : [];
  const structural = structuralRequested
    ? parts.filter((part) => part.role === "structural-panel")
    : [];
  const fallbackCover = movingRequested && moving.length === 0 && !structuralRequested
    ? parts.filter((part) => part.role === "structural-panel")
    : [];
  const matched = [...moving, ...structural, ...fallbackCover]
    .sort((left, right) => {
      const leftRank = left.role === "moving-panel" ? 0 : 1;
      const rightRank = right.role === "moving-panel" ? 0 : 1;
      return leftRank - rightRank || left.id.localeCompare(right.id);
    });
  if (matched.length === 0) return parts.map((part) => SheetPartSchema.parse(part));
  const maximumTargets = recipe.density === "dense" ? 2 : 1;
  return matched.slice(0, maximumTargets).map((part) => SheetPartSchema.parse(part));
}

function candidates(recipe: MotifRecipeV1): SearchCandidate[] {
  const output: SearchCandidate[] = [{
    id: PROCEDURAL_MOTIF_SEARCH_POLICY.preferredCandidateId,
    recipe,
    omittedPrimitive: null
  }];
  const hasDiamond = recipe.primitiveFamilies.includes("filled-diamond-focal");
  const hasDots = recipe.primitiveFamilies.includes("filled-dot-repeat");
  if (!hasDiamond || !hasDots) return output;
  const omittedPrimitive = recipe.composition === "focal"
    ? "filled-dot-repeat" as const
    : "filled-diamond-focal" as const;
  output.push({
    id: recipe.composition === "focal" ? "focal-primary" : "repeat-primary",
    recipe: MotifRecipeV1Schema.parse({
      ...recipe,
      primitiveFamilies: recipe.primitiveFamilies.filter((primitive) =>
        primitive !== omittedPrimitive)
    }),
    omittedPrimitive
  });
  return output;
}

function mergeTargetParts(
  allParts: readonly SheetPart[],
  treatedParts: readonly SheetPart[],
): SheetPart[] {
  const treatedById = new Map(treatedParts.map((part) => [part.id, part]));
  return allParts.map((part) =>
    SheetPartSchema.parse(treatedById.get(part.id) ?? part));
}

function disclosure(input: {
  selected: SearchCandidate;
  rejectedCodes: readonly string[];
  targetPartIds: readonly string[];
}): string {
  const policy = `${PROCEDURAL_MOTIF_SEARCH_POLICY.id}@${PROCEDURAL_MOTIF_SEARCH_POLICY.version}`;
  if (input.selected.omittedPrimitive === null) {
    return `The requested registered motif construction passed under ${policy} on canonical part ${input.targetPartIds.join(", ")}; no motif primitive, measurement, fit, requested dimension, or placement was changed.`;
  }
  return `The requested motif construction was rejected for ${uniqueSorted(input.rejectedCodes).join(", ")}. ${policy} selected ${input.selected.id} and omitted ${input.selected.omittedPrimitive} while preserving the box, measurements, fit, requested dimensions, placement, and remaining Score/Engrave treatment.`;
}

export class ProceduralMotifConstructionError extends Error {
  readonly code = "PROCEDURAL_MOTIF_CONSTRUCTION_UNAVAILABLE";

  constructor(readonly attempts: ConstructionSelection["attempts"]) {
    super(
      `No candidate in ${PROCEDURAL_MOTIF_SEARCH_POLICY.id}@${PROCEDURAL_MOTIF_SEARCH_POLICY.version} produced valid registered treatment geometry; export is withheld.`,
    );
    this.name = "ProceduralMotifConstructionError";
  }
}

export async function applyPlannedProceduralMotif(input: {
  parts: readonly SheetPart[];
  recipe: MotifRecipeV1;
  validate?: (parts: readonly SheetPart[]) => ValidationReport;
}): Promise<PlannedProceduralMotif> {
  const parts = input.parts.map((part) => SheetPartSchema.parse(part));
  const requestedRecipe = MotifRecipeV1Schema.parse(input.recipe);
  const selectedTargets = targetParts(parts, requestedRecipe);
  const validate = input.validate ?? ((candidateParts) => validateParts(candidateParts));
  const attempts: ConstructionSelection["attempts"] = [];
  const rejectedCodes: string[] = [];

  for (const candidate of candidates(requestedRecipe)) {
    const applied = await applyProceduralSurfaceTreatment(selectedTargets, candidate.recipe);
    const mergedParts = mergeTargetParts(parts, applied.parts);
    const report = validate(mergedParts);
    const findingCodes = uniqueSorted([
      ...report.findings
        .filter((finding) => finding.severity === "error")
        .map((finding) => finding.code),
      ...(applied.report.status === "omitted" ? ["MOTIF_TREATMENT_OMITTED"] : [])
    ]);
    if (findingCodes.length > 0) {
      attempts.push({ candidateId: candidate.id, status: "rejected", findingCodes });
      rejectedCodes.push(...findingCodes);
      continue;
    }
    attempts.push({ candidateId: candidate.id, status: "selected", findingCodes: [] });
    const changedConstruction = candidate.id !==
      PROCEDURAL_MOTIF_SEARCH_POLICY.preferredCandidateId;
    const selectionDisclosure = disclosure({
      selected: candidate,
      rejectedCodes,
      targetPartIds: applied.report.targetPartIds
    });
    const selection = ConstructionSelectionSchema.parse({
      schemaVersion: "1.0",
      operatorId: PROCEDURAL_SURFACE_TREATMENT_OPERATOR.id,
      operatorVersion: PROCEDURAL_SURFACE_TREATMENT_OPERATOR.version,
      searchPolicyId: PROCEDURAL_MOTIF_SEARCH_POLICY.id,
      searchPolicyVersion: PROCEDURAL_MOTIF_SEARCH_POLICY.version,
      preferredCandidateId: PROCEDURAL_MOTIF_SEARCH_POLICY.preferredCandidateId,
      selectedCandidateId: candidate.id,
      changedConstruction,
      attempts,
      disclosure: selectionDisclosure
    });
    const motifReport = MotifApplicationReportSchema.parse({
      ...applied.report,
      disclosures: changedConstruction
        ? [...applied.report.disclosures, selectionDisclosure]
        : applied.report.disclosures
    });
    return {
      parts: mergedParts,
      recipe: candidate.recipe,
      report: motifReport,
      selection
    };
  }
  throw new ProceduralMotifConstructionError(attempts);
}
