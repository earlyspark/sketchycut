import { z } from "zod";

import type { GenerationOutcomeV2 } from "../interpretation/generation-outcome-v2.js";
import {
  ReferenceFidelityPredicateCodeSchema,
  type ReferenceFidelityCaseContract
} from "./reference-fidelity-study.js";

export const ReferenceFidelityPredicateResultSchema = z.object({
  code: ReferenceFidelityPredicateCodeSchema,
  pass: z.boolean()
}).strict();

export type ReferenceFidelityPredicateResult = z.infer<
  typeof ReferenceFidelityPredicateResultSchema
>;

type Intent = Exclude<GenerationOutcomeV2, { kind: "failure" }> extends infer Outcome
  ? Outcome extends { intent: infer Candidate } ? Candidate
    : Outcome extends { source: { intent: infer Candidate } } ? Candidate
      : never
  : never;

function intentFrom(outcome: GenerationOutcomeV2): Intent | null {
  if (outcome.kind === "failure") return null;
  return outcome.kind === "concept-only" ? outcome.intent : outcome.source.intent;
}

function observationLedger(outcome: GenerationOutcomeV2) {
  if (outcome.kind === "failure") return null;
  return outcome.kind === "concept-only"
    ? outcome.observationRealization
    : outcome.source.observationRealization;
}

function requirementLedger(outcome: GenerationOutcomeV2) {
  if (outcome.kind === "failure") return null;
  return outcome.kind === "concept-only"
    ? outcome.requirementRealization
    : outcome.source.requirementRealization;
}

function truthfullyDisclosedSimplification(outcome: GenerationOutcomeV2): boolean {
  if (outcome.kind !== "simplified") return false;
  const requirementLimitations = requirementLedger(outcome)?.records.filter((record) =>
    record.state === "simplified"
  ) ?? [];
  const observationLimitations = observationLedger(outcome)?.records.filter((record) =>
    record.coverage === "prefer" && !["realized", "conflict-resolved"].includes(record.state)
  ) ?? [];
  const limitationIds = new Set([
    ...requirementLimitations.map((record) => record.requirementId),
    ...observationLimitations.map((record) => record.observationId)
  ]);
  return limitationIds.size > 0 &&
    outcome.changedSemanticIds.length === limitationIds.size &&
    outcome.changedSemanticIds.every((id) => limitationIds.has(id)) &&
    [...requirementLimitations, ...observationLimitations].every((record) =>
      record.disclosure !== null
    ) &&
    outcome.simplificationDisclosures.length > 0;
}

function observationEntries(outcome: GenerationOutcomeV2) {
  return intentFrom(outcome)?.referenceBrief ?? [];
}

function observations(outcome: GenerationOutcomeV2) {
  return observationEntries(outcome).flatMap((entry) => entry.observations);
}

function hasObservation(
  outcome: GenerationOutcomeV2,
  kind: string,
  value?: string,
): boolean {
  return observations(outcome).some((item) =>
    item.kind === kind && (value === undefined || item.value === value));
}

function realizedObservation(
  outcome: GenerationOutcomeV2,
  kind: string,
  value: string,
): boolean {
  return observationLedger(outcome)?.records.some((record) =>
    record.observationKind === kind && record.observationValue === value &&
    record.state === "realized" && record.evidenceLinks.length > 0) ?? false;
}

function privacySafeText(outcome: GenerationOutcomeV2): string {
  const intent = intentFrom(outcome);
  if (intent === null) return "";
  return JSON.stringify({
    requirements: intent.requirements.map((item) => item.semanticSummary),
    assumptions: intent.assumptions.map((item) => item.semanticSummary),
    unresolvedNeeds: intent.unresolvedNeeds.map((item) => item.semanticSummary),
    objects: intent.objects
  }).toLowerCase();
}

function outcomeDisclosures(outcome: GenerationOutcomeV2): string {
  if (outcome.kind === "simplified") return outcome.simplificationDisclosures.join(" ");
  if (outcome.kind === "concept-only") return outcome.unresolvedNeeds.join(" ");
  return "";
}

function predicatePass(input: {
  code: z.infer<typeof ReferenceFidelityPredicateCodeSchema>;
  contract: ReferenceFidelityCaseContract;
  outcome: GenerationOutcomeV2;
}): boolean {
  const { code, contract, outcome } = input;
  const intent = intentFrom(outcome);
  const entries = observationEntries(outcome);
  const ledger = observationLedger(outcome);
  const source = outcome.kind === "supported" || outcome.kind === "simplified"
    ? outcome.source
    : null;
  switch (code) {
    case "NO_SILENT_PLAIN_SHELL":
      return outcome.kind === "concept-only" &&
        hasObservation(outcome, "opening", "arched-aperture") &&
        hasObservation(outcome, "ornament", "lattice") &&
        hasObservation(outcome, "operation-character", "cut-through-visible");
    case "NO_UNRELATED_DOT_REPLACEMENT":
      return intent !== null && !intent.motif?.vocabulary.some((item) => /\b(?:dot|circle)\b/iu.test(item));
    case "UNSUPPORTED_DOMINANT_FEATURE_DISCLOSED": {
      const required = new Set(["opening:arched-aperture", "ornament:lattice", "operation-character:cut-through-visible"]);
      const matching = ledger?.records.filter((record) =>
        required.has(`${record.observationKind}:${record.observationValue}`)) ?? [];
      const structuralOpening = matching.find((record) =>
        record.observationKind === "opening" && record.observationValue === "arched-aperture"
      );
      const omittedDecoration = matching.filter((record) =>
        record.observationKind === "ornament" || record.observationKind === "operation-character"
      );
      return matching.length === required.size &&
        structuralOpening?.coverage === "must" && structuralOpening.state === "unsupported" &&
        structuralOpening.disclosure !== null &&
        (ledger?.blockingObservationIds.includes(structuralOpening.observationId) ?? false) &&
        omittedDecoration.length === 2 && omittedDecoration.every((record) =>
          record.coverage === "prefer" && record.state === "simplified" &&
          record.disclosure !== null && ledger?.simplifiedObservationIds.includes(record.observationId));
    }
    case "PREFERRED_UNSUPPORTED_DISCLOSED":
      return outcome.kind === "simplified" && (ledger?.records.some((record) =>
        record.coverage === "prefer" && record.state !== "realized" &&
        record.disclosure !== null && ledger.simplifiedObservationIds.includes(record.observationId)) ?? false);
    case "NO_FIDELITY_CLAIM":
      return !/\b(?:faithful|identical|exact replica|visually matches?|pixel[- ]?match)\b/iu.test(outcomeDisclosures(outcome));
    case "CONTEXT_DOES_NOT_CREATE_REQUIREMENT":
      return entries.length > 0 && entries.every((entry) => entry.relationship === "context") &&
        (ledger?.records.every((record) => record.coverage === "context") ?? false) &&
        (ledger?.blockingObservationIds.length ?? 0) === 0 &&
        (ledger?.simplifiedObservationIds.length ?? 0) === 0;
    case "ZERO_REFERENCE_SUPPORTED":
      return outcome.kind === "supported" && entries.length === 0;
    case "REFERENCE_SELECTS_UNSTATED_OPEN_ACCESS":
      return source?.selectedPlan.topology.access === "open-top" &&
        realizedObservation(outcome, "opening", "open-top");
    case "REFERENCE_SELECTS_UNSTATED_COVERED_ACCESS":
      return source?.selectedPlan.topology.access === "covered" &&
        realizedObservation(outcome, "opening", "covered");
    case "NO_BACKGROUND_PROP_REQUIREMENT":
      return intent !== null && intent.objects.length === 0 &&
        !/\b(?:background|prop|green circle|plant|tree)\b/iu.test(privacySafeText(outcome));
    case "NO_OVERLAY_TEXT_REQUIREMENT":
      return !/\b(?:sale|discount|overlay|50\s*%)\b/iu.test(privacySafeText(outcome));
    case "STRUCTURE_ROLE_PRESERVED":
      return contract.roleConstraints.length === 1 &&
        contract.roleConstraints[0]?.join(",") === "structure" &&
        !observations(outcome).some((item) =>
          item.kind === "ornament" || item.kind === "operation-character");
    case "MOTIF_ROLE_PRESERVED":
      return contract.roleConstraints.length === 1 &&
        contract.roleConstraints[0]?.join(",") === "motif" &&
        observations(outcome).some((item) =>
          item.kind === "ornament" || item.kind === "operation-character") &&
        !observations(outcome).some((item) =>
          ["opening", "proportion", "visible-joint"].includes(item.kind));
    case "REGISTERED_BORDER_REALIZED":
      return realizedObservation(outcome, "ornament", "border") &&
        realizedObservation(outcome, "operation-character", "score");
    case "BOTH_ROLES_PRESERVED":
      return contract.roleConstraints.length === 1 &&
        contract.roleConstraints[0]?.join(",") === "structure,motif" &&
        observations(outcome).some((item) =>
          ["primary-subject", "target-role", "opening", "silhouette", "visible-joint"].includes(item.kind)) &&
        observations(outcome).some((item) =>
          item.kind === "ornament" || item.kind === "operation-character");
    case "AUTO_ROLE_IS_UNCONSTRAINED":
      return contract.roleConstraints.length === 1 && contract.roleConstraints[0]?.length === 0 &&
        entries.length === 1 && entries[0]!.observations.length > 0;
    case "DIRECT_TEXT_ACCESS_WINS":
      return source?.selectedPlan.topology.access === "open-top" &&
        (intent?.conflicts.some((conflict) =>
          conflict.attribute === "access" && conflict.resolution === "explicit-text-wins") ?? false);
    case "CONFLICT_RESOLVED_DISCLOSED":
      return ledger?.records.some((record) =>
        record.state === "conflict-resolved" && record.disclosure !== null) ?? false;
    case "MULTI_REFERENCE_CONFLICT_NOT_SILENT":
      return outcome.kind === "concept-only" && entries.length === 2 &&
        (intent?.conflicts.some((conflict) => conflict.resolution === "unresolved") ?? false) &&
        outcome.blockedObservationIds.length > 0;
    case "NOVEL_ROLE_COMPOSITION":
      return source?.selectedPlan.topology.mechanism === "captured-slide" &&
        contract.roleConstraints.some((roles) => roles.includes("structure")) &&
        contract.roleConstraints.some((roles) => roles.includes("motif"));
    case "ORDER_PRESERVED":
      return entries.length === contract.expectedRelationships.length && entries.every((entry, index) =>
        contract.relationshipAcceptance[index] === "non-context"
          ? entry.relationship !== "context"
          : entry.relationship === contract.expectedRelationships[index]);
    case "PRISMATIC_AND_MOTIF_REALIZED":
      return source?.selectedPlan.topology.mechanism === "captured-slide" &&
        realizedObservation(outcome, "ornament", "border");
  }
}

export function evaluateReferenceFidelityPredicates(input: {
  contract: ReferenceFidelityCaseContract;
  outcome: GenerationOutcomeV2;
}): ReferenceFidelityPredicateResult[] {
  return input.contract.predicateCodes.map((code) =>
    ReferenceFidelityPredicateResultSchema.parse({
      code,
      pass: predicatePass({ code, ...input })
    }));
}

export const ReferenceFidelityCaseScoreSchema = z.object({
  caseId: z.string().min(1),
  strictParsePass: z.boolean(),
  outcomeAcceptancePass: z.boolean(),
  orderedReferenceCoveragePass: z.boolean(),
  relationshipAcceptancePass: z.boolean(),
  predicateResults: z.array(ReferenceFidelityPredicateResultSchema).min(1),
  pass: z.boolean()
}).strict();

export function scoreReferenceFidelityCase(input: {
  contract: ReferenceFidelityCaseContract;
  outcome: GenerationOutcomeV2;
}) {
  const strictParsePass = input.outcome.kind !== "failure";
  const entries = observationEntries(input.outcome);
  const outcomeAcceptancePass = input.outcome.kind === input.contract.expectedOutcome ||
    (input.contract.outcomeAcceptance === "supported-or-disclosed-simplified" &&
      input.contract.expectedOutcome === "supported" &&
      truthfullyDisclosedSimplification(input.outcome));
  const orderedReferenceCoveragePass = entries.length === input.contract.referenceIds.length;
  const relationshipAcceptancePass = orderedReferenceCoveragePass && entries.every((entry, index) =>
    input.contract.relationshipAcceptance[index] === "non-context"
      ? entry.relationship !== "context"
      : entry.relationship === input.contract.expectedRelationships[index]);
  const predicateResults = evaluateReferenceFidelityPredicates(input);
  const pass = strictParsePass && outcomeAcceptancePass && orderedReferenceCoveragePass &&
    relationshipAcceptancePass && predicateResults.every((item) => item.pass);
  return ReferenceFidelityCaseScoreSchema.parse({
    caseId: input.contract.id,
    strictParsePass,
    outcomeAcceptancePass,
    orderedReferenceCoveragePass,
    relationshipAcceptancePass,
    predicateResults,
    pass
  });
}
