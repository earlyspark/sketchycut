import { z } from "zod";

import { DesignDocumentV1Schema, StableIdSchema, type DesignDocumentV1 } from "../domain/contracts.js";
import type { MotifApplicationReport } from "../operators/procedural-surface-treatment.js";
import { ConstructionPlanV1Schema, type ConstructionPlanV1 } from "./construction-contracts.js";
import { SizingDecisionV1Schema, type SizingDecisionV1 } from "./constraint-sizing-solver.js";
import {
  IntentGraphV2Schema,
  ReferenceObservationV1Schema,
  type IntentGraphV2,
} from "./intent-graph-v2.js";
import {
  RealizationEvidenceLinkV1Schema,
  RealizationStateV1Schema,
  type RealizationEvidenceLinkV1
} from "./realization-ledger.js";
import {
  isMvpOmittableObservation,
  mvpObservationOmissionDisclosure
} from "./mvp-safe-omission-policy.js";

export const OBSERVATION_REALIZATION_POLICY_VERSION = "observation-realization-v4" as const;

const ObservationFindingCodeV1Schema = z.enum([
  "REFERENCE_OBSERVATION_REALIZED",
  "REFERENCE_OBSERVATION_SIMPLIFIED",
  "REFERENCE_OBSERVATION_UNSUPPORTED",
  "REFERENCE_OBSERVATION_CONFLICT_RESOLVED",
  "REFERENCE_OBSERVATION_UNCERTAIN"
]);

export const ObservationRealizationRecordV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  observationId: StableIdSchema,
  referenceEvidenceId: StableIdSchema,
  relationship: z.enum(["reproduce", "inspire", "context"]),
  observationKind: z.enum([
    "primary-subject",
    "silhouette",
    "proportion",
    "opening",
    "ornament",
    "operation-character",
    "target-role",
    "visible-joint"
  ]),
  observationValue: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  coverage: z.enum(["must", "prefer", "context"]),
  state: RealizationStateV1Schema,
  findingCode: ObservationFindingCodeV1Schema,
  evidenceLinks: z.array(RealizationEvidenceLinkV1Schema).max(128),
  disclosure: z.string().min(1).max(500).nullable(),
  policyVersion: z.literal(OBSERVATION_REALIZATION_POLICY_VERSION)
}).strict().superRefine((value, context) => {
  if (value.state === "realized" && value.evidenceLinks.length === 0) {
    context.addIssue({ code: "custom", message: "Realized observations require deterministic evidence." });
  }
  if (value.state !== "realized" && value.disclosure === null) {
    context.addIssue({ code: "custom", message: "Non-realized observations require a disclosure." });
  }
});

export const ObservationRealizationLedgerV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  policyVersion: z.literal(OBSERVATION_REALIZATION_POLICY_VERSION),
  records: z.array(ObservationRealizationRecordV1Schema).max(48),
  blockingObservationIds: z.array(StableIdSchema),
  simplifiedObservationIds: z.array(StableIdSchema)
}).strict().superRefine((value, context) => {
  const ids = value.records.map((record) => record.observationId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Observation realization records must be unique." });
  }
});

export type ObservationRealizationLedgerV1 = z.infer<typeof ObservationRealizationLedgerV1Schema>;
type Observation = z.infer<typeof ReferenceObservationV1Schema>;

function uniqueLinks(links: readonly RealizationEvidenceLinkV1[]): RealizationEvidenceLinkV1[] {
  const output = new Map<string, RealizationEvidenceLinkV1>();
  for (const candidate of links) {
    const link = RealizationEvidenceLinkV1Schema.parse(candidate);
    output.set(`${link.kind}:${link.sourceId}:${link.sourceVersion ?? ""}`, link);
  }
  return [...output.values()].sort((left, right) =>
    `${left.kind}:${left.sourceId}:${left.sourceVersion ?? ""}`.localeCompare(
      `${right.kind}:${right.sourceId}:${right.sourceVersion ?? ""}`,
    ),
  );
}

function planLink(plan: ConstructionPlanV1): RealizationEvidenceLinkV1 {
  return { kind: "selected-plan", sourceId: plan.planId, sourceVersion: null };
}

function validated(): RealizationEvidenceLinkV1 {
  return { kind: "validated-output", sourceId: "canonical-validation", sourceVersion: null };
}

function operator(plan: ConstructionPlanV1, operatorId: string): RealizationEvidenceLinkV1[] {
  const match = plan.operatorProgram.find((item) => item.operatorId === operatorId);
  return match === undefined ? [] : [{
    kind: "registered-operator",
    sourceId: match.operatorId,
    sourceVersion: match.operatorVersion
  }];
}

function canonical(sourceId: string): RealizationEvidenceLinkV1 {
  return { kind: "canonical-feature", sourceId, sourceVersion: null };
}

function cutThroughLinks(input: {
  observation: Observation;
  plan: ConstructionPlanV1;
  document: DesignDocumentV1;
  predicate?: (application: NonNullable<DesignDocumentV1["cutThroughApplications"]>[number]) => boolean;
}): RealizationEvidenceLinkV1[] {
  const roleByPartId = new Map(input.plan.panels.map((panel) => [panel.id, panel.role]));
  const applications = (input.document.cutThroughApplications ?? []).filter((application) => {
    if (input.predicate !== undefined && !input.predicate(application)) return false;
    if (input.observation.targetFaceRole === "all" || input.observation.targetFaceRole === "unspecified") return true;
    return application.targetPartIds.some((partId) => roleByPartId.get(partId) === input.observation.targetFaceRole);
  });
  if (applications.length === 0) return [];
  return uniqueLinks([
    planLink(input.plan),
    ...operator(input.plan, "cut-through-treatment"),
    ...applications.flatMap((application) => [
      canonical(application.id),
      ...application.featureIds.map(canonical)
    ]),
    validated()
  ]);
}

function coverage(input: {
  relationship: "reproduce" | "inspire" | "context";
  observation: Observation;
  siblingObservations: readonly Observation[];
}): "must" | "prefer" | "context" {
  const { relationship, observation, siblingObservations } = input;
  if (relationship === "context") return "context";
  if (isMvpOmittableObservation({ observation, siblingObservations })) return "prefer";
  if (relationship === "reproduce" && observation.salience !== "secondary") return "must";
  return "prefer";
}

export function evaluateUnplannedObservationRealization(input: {
  intent: unknown;
}): ObservationRealizationLedgerV1 {
  const intent = IntentGraphV2Schema.parse(input.intent);
  const conflictResolution = new Map(intent.conflicts.flatMap((conflict) =>
    conflict.observationIds.map((observationId) => [observationId, conflict.resolution] as const)
  ));
  const records = intent.referenceBrief.flatMap((entry) => entry.observations.map((observation) => {
    const impact = coverage({
      relationship: entry.relationship,
      observation,
      siblingObservations: entry.observations
    });
    const resolution = conflictResolution.get(observation.id);
    const omittedByMvpPolicy = isMvpOmittableObservation({
      observation,
      siblingObservations: entry.observations
    });
    const state = resolution === "explicit-text-wins" ? "conflict-resolved" as const
      : omittedByMvpPolicy ? "simplified" as const
      : resolution === "unresolved" ? "uncertain" as const
      : "unsupported" as const;
    return ObservationRealizationRecordV1Schema.parse({
      schemaVersion: "1.0",
      observationId: observation.id,
      referenceEvidenceId: entry.referenceEvidenceId,
      relationship: entry.relationship,
      observationKind: observation.kind,
      observationValue: observation.value,
      coverage: impact,
      state,
      findingCode: state === "conflict-resolved" ? "REFERENCE_OBSERVATION_CONFLICT_RESOLVED"
        : state === "simplified" ? "REFERENCE_OBSERVATION_SIMPLIFIED"
        : state === "uncertain" ? "REFERENCE_OBSERVATION_UNCERTAIN"
        : "REFERENCE_OBSERVATION_UNSUPPORTED",
      evidenceLinks: [],
      disclosure: state === "conflict-resolved"
        ? `Observation ${observation.id} was not applied because explicit maker text directly stated the conflicting attribute.`
        : omittedByMvpPolicy
          ? mvpObservationOmissionDisclosure(observation)
          : state === "uncertain"
            ? `Observation ${observation.id} remains unresolved and has no fabrication authority.`
            : `Reference observation ${observation.id} (${observation.kind}: ${observation.value}) has no selected deterministic construction and is unsupported.`,
      policyVersion: OBSERVATION_REALIZATION_POLICY_VERSION
    });
  }));
  return ObservationRealizationLedgerV1Schema.parse({
    schemaVersion: "1.0",
    policyVersion: OBSERVATION_REALIZATION_POLICY_VERSION,
    records,
    blockingObservationIds: records.filter((record) =>
      record.coverage === "must" && ["unsupported", "uncertain"].includes(record.state)
    ).map((record) => record.observationId).sort(),
    simplifiedObservationIds: records.filter((record) =>
      record.state === "simplified" ||
      (record.coverage === "prefer" && !["realized", "conflict-resolved"].includes(record.state))
    ).map((record) => record.observationId).sort()
  });
}

function aspectState(input: {
  observation: Observation;
  intent: IntentGraphV2;
  plan: ConstructionPlanV1;
  sizing: SizingDecisionV1;
  document: DesignDocumentV1;
  motifReport: MotifApplicationReport | null;
}): { state: "realized" | "simplified" | "unsupported" | "uncertain"; links: RealizationEvidenceLinkV1[] } {
  const { observation, intent, plan, sizing, document, motifReport } = input;
  if (observation.value === "unknown" || observation.value === "uncertain" ||
      observation.visibility === "uncertain" || observation.visibility === "occluded") {
    return { state: "uncertain", links: [] };
  }
  const structural = [planLink(plan), validated()];
  if (observation.kind === "primary-subject") {
    if (["enclosure", "container", "lantern"].includes(observation.value)) {
      const foundation = plan.panels.find((panel) => panel.role === "foundation");
      return foundation === undefined ? { state: "unsupported", links: [] } : {
        state: "realized",
        links: [...structural, canonical(foundation.id)]
      };
    }
    if (observation.value === "support" || observation.value === "stand") {
      const supported = intent.constructionBodies.some((body) => body.role === "support") ||
        intent.requirements.some((requirement) => requirement.kind === "support");
      return supported ? { state: "realized", links: structural } : { state: "simplified", links: [] };
    }
    if (observation.value === "cover") {
      const cover = plan.panels.find((panel) => panel.role === "cover");
      return cover === undefined ? { state: "unsupported", links: [] } : {
        state: "realized",
        links: [...structural, canonical(cover.id)]
      };
    }
  }
  if (observation.kind === "silhouette") {
    return observation.value === "orthogonal"
      ? { state: "realized", links: [...structural, ...operator(plan, "orthogonal-panel-layout")] }
      : { state: "unsupported", links: [] };
  }
  if (observation.kind === "proportion") {
    const dimensions = {
      wide: sizing.external.widthUm,
      deep: sizing.external.depthUm,
      tall: sizing.external.heightUm
    } as const;
    const values = Object.values(dimensions);
    const largest = Math.max(...values);
    const smallest = Math.min(...values);
    const matches = observation.value === "balanced" ? largest <= smallest * 1.8
      : observation.value === "slender" ? largest >= smallest * 2.5
      : observation.value in dimensions
        ? dimensions[observation.value as keyof typeof dimensions] === largest && largest >= smallest * 1.8
        : false;
    return matches ? { state: "realized", links: structural } : { state: "simplified", links: [] };
  }
  if (observation.kind === "opening") {
    if (observation.value === "none") {
      return { state: "uncertain", links: [] };
    }
    if (["open-top", "open-front", "covered"].includes(observation.value)) {
      return observation.value === plan.topology.access
        ? { state: "realized", links: structural }
        : { state: "simplified", links: [] };
    }
    if (["geometric-aperture", "repeated-apertures"].includes(observation.value)) {
      const links = cutThroughLinks({
        observation,
        plan,
        document,
        predicate: (application) => observation.value === "repeated-apertures"
          ? application.featureIds.length > 1 || application.targetPartIds.length > 1
          : application.purpose !== "ornament"
      });
      return links.length > 0 ? { state: "realized", links } : { state: "unsupported", links: [] };
    }
    return { state: "unsupported", links: [] };
  }
  if (observation.kind === "ornament") {
    if (observation.value === "none") {
      return motifReport?.status === "applied" ? { state: "simplified", links: [] } : { state: "realized", links: structural };
    }
    if (observation.value === "botanical") {
      return { state: "unsupported", links: [] };
    }
    if (observation.value === "lattice" || observation.value === "geometric") {
      const links = cutThroughLinks({
        observation,
        plan,
        document,
        predicate: (application) => observation.value === "lattice"
          ? application.patternFamily === "lattice-grid"
          : true
      });
      return links.length > 0 ? { state: "realized", links } : { state: "unsupported", links: [] };
    }
    if (motifReport?.status !== "applied") return { state: "unsupported", links: [] };
    const compositionMatch = ["border", "field", "focal", "repeated"].includes(observation.value)
      ? intent.motif?.composition === observation.value
      : true;
    return compositionMatch ? {
      state: "realized",
      links: [...structural, ...operator(plan, "procedural-surface-treatment"), ...motifReport.featureIds.map(canonical)]
    } : { state: "simplified", links: [] };
  }
  if (observation.kind === "operation-character") {
    const score = motifReport?.scoreFeatureCount ?? 0;
    const engrave = motifReport?.engraveFeatureCount ?? 0;
    if (observation.value === "cut-through-visible") {
      const links = cutThroughLinks({ observation, plan, document });
      return links.length > 0 ? { state: "realized", links } : { state: "unsupported", links: [] };
    }
    const matches = observation.value === "score" ? score > 0 && engrave === 0
      : observation.value === "engrave" ? engrave > 0 && score === 0
      : observation.value === "mixed" ? score > 0 && engrave > 0
      : false;
    return matches && motifReport !== null ? {
      state: "realized",
      links: [...structural, ...operator(plan, "procedural-surface-treatment"), ...motifReport.featureIds.map(canonical)]
    } : { state: "unsupported", links: [] };
  }
  if (observation.kind === "target-role") {
    const target = observation.value === "primary-enclosure"
      ? intent.constructionBodies.some((body) => body.role === "primary-enclosure")
      : observation.value === "support"
        ? intent.constructionBodies.some((body) => body.role === "support")
        : observation.value === "cover"
          ? plan.panels.some((panel) => panel.role === "cover")
          : false;
    return target ? { state: "realized", links: structural } : { state: "unsupported", links: [] };
  }
  if (observation.kind === "visible-joint") {
    const matchingMates = plan.mates.filter((mate) =>
      observation.value === "finger" ? mate.kind === "edge-finger"
        : observation.value === "tab-slot" ? mate.kind === "tab-slot"
        : observation.value === "pin-hinge" ? mate.kind === "retained-pin"
        : observation.value === "slide-guide" ? mate.kind === "captured-slide"
        : false
    );
    if (observation.value === "none-visible") return { state: "uncertain", links: [] };
    return matchingMates.length === 0 ? { state: "unsupported", links: [] } : {
      state: "realized",
      links: [...structural, ...matchingMates.map((mate) => canonical(mate.id))]
    };
  }
  return { state: "unsupported", links: [] };
}

export function evaluateObservationRealization(input: {
  intent: unknown;
  plan: unknown;
  sizing: unknown;
  document: unknown;
  motifReport: MotifApplicationReport | null;
}): ObservationRealizationLedgerV1 {
  const intent = IntentGraphV2Schema.parse(input.intent);
  const plan = ConstructionPlanV1Schema.parse(input.plan);
  const sizing = SizingDecisionV1Schema.parse(input.sizing);
  const document = DesignDocumentV1Schema.parse(input.document);
  const conflictResolution = new Map(intent.conflicts.flatMap((conflict) =>
    conflict.observationIds.map((observationId) => [observationId, conflict.resolution] as const)
  ));
  const records = intent.referenceBrief.flatMap((entry) => entry.observations.map((observation) => {
    const impact = coverage({
      relationship: entry.relationship,
      observation,
      siblingObservations: entry.observations
    });
    const resolution = conflictResolution.get(observation.id);
    if (resolution === "explicit-text-wins") {
      return ObservationRealizationRecordV1Schema.parse({
        schemaVersion: "1.0",
        observationId: observation.id,
        referenceEvidenceId: entry.referenceEvidenceId,
        relationship: entry.relationship,
        observationKind: observation.kind,
        observationValue: observation.value,
        coverage: impact,
        state: "conflict-resolved",
        findingCode: "REFERENCE_OBSERVATION_CONFLICT_RESOLVED",
        evidenceLinks: [],
        disclosure: `Observation ${observation.id} was not applied because explicit maker text directly stated the conflicting attribute.`,
        policyVersion: OBSERVATION_REALIZATION_POLICY_VERSION
      });
    }
    const omittedByMvpPolicy = isMvpOmittableObservation({
      observation,
      siblingObservations: entry.observations
    });
    if (resolution === "unresolved" && !omittedByMvpPolicy) {
      return ObservationRealizationRecordV1Schema.parse({
        schemaVersion: "1.0",
        observationId: observation.id,
        referenceEvidenceId: entry.referenceEvidenceId,
        relationship: entry.relationship,
        observationKind: observation.kind,
        observationValue: observation.value,
        coverage: impact,
        state: "uncertain",
        findingCode: "REFERENCE_OBSERVATION_UNCERTAIN",
        evidenceLinks: [],
        disclosure: `Observation ${observation.id} remains unresolved against the maker brief.`,
        policyVersion: OBSERVATION_REALIZATION_POLICY_VERSION
      });
    }
    const result = aspectState({ observation, intent, plan, sizing, document, motifReport: input.motifReport });
    const state = omittedByMvpPolicy && result.state !== "realized" ? "simplified" as const : result.state;
    const code = state === "realized" ? "REFERENCE_OBSERVATION_REALIZED"
      : state === "simplified" ? "REFERENCE_OBSERVATION_SIMPLIFIED"
      : state === "unsupported" ? "REFERENCE_OBSERVATION_UNSUPPORTED"
      : "REFERENCE_OBSERVATION_UNCERTAIN";
    return ObservationRealizationRecordV1Schema.parse({
      schemaVersion: "1.0",
      observationId: observation.id,
      referenceEvidenceId: entry.referenceEvidenceId,
      relationship: entry.relationship,
      observationKind: observation.kind,
      observationValue: observation.value,
      coverage: impact,
      state,
      findingCode: code,
      evidenceLinks: uniqueLinks(result.links),
      disclosure: state === "realized" ? null
        : omittedByMvpPolicy
          ? mvpObservationOmissionDisclosure(observation)
          : `Reference observation ${observation.id} (${observation.kind}: ${observation.value}) was ${state}.`,
      policyVersion: OBSERVATION_REALIZATION_POLICY_VERSION
    });
  }));
  return ObservationRealizationLedgerV1Schema.parse({
    schemaVersion: "1.0",
    policyVersion: OBSERVATION_REALIZATION_POLICY_VERSION,
    records,
    blockingObservationIds: records.filter((record) =>
      record.coverage === "must" && ["unsupported", "uncertain"].includes(record.state)
    ).map((record) => record.observationId).sort(),
    simplifiedObservationIds: records.filter((record) =>
      record.state === "simplified" ||
      (record.coverage === "prefer" && !["realized", "conflict-resolved"].includes(record.state))
    ).map((record) => record.observationId).sort()
  });
}
