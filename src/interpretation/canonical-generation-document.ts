import { canonicalGeometryHash } from "../compiler/canonical.js";
import { DesignDocumentV1Schema } from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import type { OrthogonalCompileProfiles } from "../operators/orthogonal-compiler.js";
import { buildMultiSheetProjectionBundle } from "../projections/bundle.js";
import { buildFabricationEvidenceProjection } from "../projections/evidence.js";
import { nestPartsAcrossSheets } from "../projections/fabrication/nesting.js";
import type { ProductCompileWorkerSuccess } from "../workers/protocol.js";
import { CURRENT_CAPABILITY_CATALOG_VERSION } from "./capability-catalog.js";
import type { ConstructionPlanV1 } from "./construction-contracts.js";
import {
  MINIMUM_SEPARATED_ORGANIZATION_ASSUMPTION_ID,
  MINIMUM_SEPARATED_ORGANIZATION_DISCLOSURE,
  MINIMUM_SEPARATED_ORGANIZATION_FINDING_CODE,
  type ClosedSemanticProjection
} from "./semantic-interpretation.js";
import {
  RequirementRealizationLedgerV1Schema,
  type RequirementRealizationLedgerV1
} from "./realization-ledger.js";

export type CanonicalSemanticProvenance = {
  modelId: string;
  promptIdentity: string;
  promptHash: string;
  semanticRequestDigest: string;
  runtimeApplicationApiCalls: 0 | 1;
  deterministicScopeOutcome?: "simplified" | "modified" | null;
  deterministicScopeDisclosures?: readonly string[];
};

function capabilityIds(plan: ConstructionPlanV1): string[] {
  const ids = ["rigid-orthogonal-sheet-assembly"];
  if (plan.topology.mechanism === "retained-pin") ids.push("single-axis-retained-revolute");
  if (plan.topology.mechanism === "captured-slide") ids.push("single-axis-captured-prismatic");
  if (plan.topology.mechanism === "fixed-top-frame" || plan.cutThroughTreatments.length > 0) {
    ids.push("registered-cut-through-treatment");
  }
  if (plan.operatorProgram.some((item) => item.operatorId === "procedural-surface-treatment")) {
    ids.push("safe-procedural-surface-treatment");
  }
  return ids;
}

export async function bindCanonicalGenerationDocument(input: {
  compiled: ProductCompileWorkerSuccess;
  projection: ClosedSemanticProjection;
  plan: ConstructionPlanV1;
  requirementRealization: RequirementRealizationLedgerV1;
  profiles: OrthogonalCompileProfiles;
  semanticProvenance?: CanonicalSemanticProvenance;
}): Promise<ProductCompileWorkerSuccess> {
  const sourceEvidenceByRequirement = new Map(
    input.projection.requirements.map((item) => [item.id, item.evidenceIds]),
  );
  const realization = RequirementRealizationLedgerV1Schema.parse(input.requirementRealization);
  const realizedRecords = realization.records.filter((record) => record.state === "realized");
  const conceptOnly = realization.unsupportedMustRequirementIds.length > 0 ||
    realization.unresolvedMustRequirementIds.length > 0;
  const simplified = realization.records.some((record) => record.state === "simplified");
  const deterministicScopeOutcome =
    input.semanticProvenance?.deterministicScopeOutcome ?? null;
  const deterministicScopeDisclosures = [
    ...new Set(
      input.semanticProvenance?.deterministicScopeDisclosures ?? [],
    )
  ];
  const minimumSeparated = input.plan.assumptions.some(
    (assumption) => assumption.id === MINIMUM_SEPARATED_ORGANIZATION_ASSUMPTION_ID,
  );
  const document = DesignDocumentV1Schema.parse({
    ...input.compiled.document,
    applicationLimitations: [
      ...(input.compiled.document.applicationLimitations ?? []),
      ...(minimumSeparated
        ? [{
            code: MINIMUM_SEPARATED_ORGANIZATION_FINDING_CODE,
            message: MINIMUM_SEPARATED_ORGANIZATION_DISCLOSURE,
            relatedIds: input.plan.panels
              .filter((panel) => panel.role === "divider")
              .map((panel) => panel.id)
          }]
        : [])
    ],
    intent: input.projection,
    provenance: {
      ...input.compiled.document.provenance,
      modelId: input.semanticProvenance?.modelId ?? null,
      promptVersion: input.semanticProvenance?.promptIdentity ?? null,
      promptHash: input.semanticProvenance?.promptHash ?? null,
      runtimeApplicationApiCalls: input.semanticProvenance?.runtimeApplicationApiCalls ?? 0,
      semanticRequestDigest: input.semanticProvenance?.semanticRequestDigest,
      capabilityCatalogVersion: CURRENT_CAPABILITY_CATALOG_VERSION,
      supportOutcome: conceptOnly
        ? "concept-only"
        : deterministicScopeOutcome === "modified"
          ? "modified"
          : simplified || deterministicScopeOutcome === "simplified"
            ? "simplified"
            : "supported",
      requirementEvidence: realizedRecords.map((record) => ({
        requirementId: record.requirementId,
        capabilityIds: capabilityIds(input.plan),
        sourceEvidenceIds: sourceEvidenceByRequirement.get(record.requirementId) ?? [],
        deterministicCheckIds: [...new Set(record.evidenceLinks.map((link) => link.sourceId))].sort()
      })),
      requirementRealizationHash: await hashCanonical(realization),
      simplificationDisclosures: realization.records.flatMap((record) =>
        record.disclosure === null ? [] : [record.disclosure]
      ).concat(
        deterministicScopeOutcome === "simplified"
          ? deterministicScopeDisclosures
          : [],
      ),
      ...(deterministicScopeOutcome === "modified"
        ? {
            modificationDisclosures: deterministicScopeDisclosures
          }
        : {}),
      inputDigest: await hashCanonical({
        priorInputDigest: input.compiled.document.provenance.inputDigest,
        projection: input.projection,
        plan: input.plan,
        semanticRequestDigest:
          input.semanticProvenance?.semanticRequestDigest ?? null,
        deterministicScopeOutcome,
        deterministicScopeDisclosures
      })
    }
  });
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
    kind: "product-success",
    requestId: input.compiled.requestId,
    status: "success",
    document,
    geometryHash,
    bundle: artifacts.bundle,
    evidence,
    svgs: artifacts.svgs
  };
}
