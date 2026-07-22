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
import type { IntentGraphV2 } from "./intent-graph-v2.js";
import {
  RequirementRealizationLedgerV1Schema,
  type RequirementRealizationLedgerV1
} from "./realization-ledger.js";
import {
  ObservationRealizationLedgerV1Schema,
  type ObservationRealizationLedgerV1
} from "./observation-realization.js";

export type CanonicalSemanticProvenanceV2 = {
  modelId: string;
  promptIdentity: string;
  promptHash: string;
  semanticRequestDigest: string;
  runtimeApplicationApiCalls: 0 | 1;
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
  intent: IntentGraphV2;
  plan: ConstructionPlanV1;
  requirementRealization: RequirementRealizationLedgerV1;
  observationRealization: ObservationRealizationLedgerV1;
  profiles: OrthogonalCompileProfiles;
  semanticProvenance?: CanonicalSemanticProvenanceV2;
}): Promise<ProductCompileWorkerSuccess> {
  const sourceEvidenceByRequirement = new Map(
    input.intent.requirements.map((item) => [item.id, item.evidenceIds]),
  );
  const realization = RequirementRealizationLedgerV1Schema.parse(input.requirementRealization);
  const observationRealization = ObservationRealizationLedgerV1Schema.parse(input.observationRealization);
  const realizedRecords = realization.records.filter((record) => record.state === "realized");
  const conceptOnly = realization.unsupportedMustRequirementIds.length > 0 ||
    realization.unresolvedMustRequirementIds.length > 0 ||
    observationRealization.blockingObservationIds.length > 0;
  const simplified = realization.records.some((record) => record.state === "simplified") ||
    observationRealization.simplifiedObservationIds.length > 0;
  const document = DesignDocumentV1Schema.parse({
    ...input.compiled.document,
    intent: input.intent,
    provenance: {
      ...input.compiled.document.provenance,
      modelId: input.semanticProvenance?.modelId ?? null,
      promptVersion: input.semanticProvenance?.promptIdentity ?? null,
      promptHash: input.semanticProvenance?.promptHash ?? null,
      runtimeApplicationApiCalls: input.semanticProvenance?.runtimeApplicationApiCalls ?? 0,
      semanticRequestDigest: input.semanticProvenance?.semanticRequestDigest,
      capabilityCatalogVersion: CURRENT_CAPABILITY_CATALOG_VERSION,
      supportOutcome: conceptOnly ? "concept-only" : simplified ? "simplified" : "supported",
      requirementEvidence: realizedRecords.map((record) => ({
        requirementId: record.requirementId,
        capabilityIds: capabilityIds(input.plan),
        sourceEvidenceIds: sourceEvidenceByRequirement.get(record.requirementId) ?? [],
        deterministicCheckIds: [...new Set(record.evidenceLinks.map((link) => link.sourceId))].sort()
      })),
      requirementRealizationHash: await hashCanonical(realization),
      observationRealizationHash: await hashCanonical(observationRealization),
      simplificationDisclosures: realization.records.flatMap((record) =>
        record.disclosure === null ? [] : [record.disclosure]
      ).concat(observationRealization.records.flatMap((record) =>
        record.disclosure === null ? [] : [record.disclosure]
      )),
      inputDigest: await hashCanonical({
        priorInputDigest: input.compiled.document.provenance.inputDigest,
        intent: input.intent,
        plan: input.plan,
        semanticRequestDigest: input.semanticProvenance?.semanticRequestDigest ?? null
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
