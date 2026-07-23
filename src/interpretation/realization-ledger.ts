import { z } from "zod";

import { DesignDocumentV1Schema, StableIdSchema, type DesignDocumentV1 } from "../domain/contracts.js";
import type { MotifApplicationReport } from "../operators/procedural-surface-treatment.js";
import { ConstructionPlanV1Schema, type ConstructionPlanV1 } from "./construction-contracts.js";
import {
  ClosedSemanticProjectionSchema,
  type ClosedSemanticProjection
} from "./semantic-interpretation.js";

export const REQUIREMENT_REALIZATION_POLICY_VERSION = "requirement-realization-v4" as const;

export const RealizationStateV1Schema = z.enum([
  "realized",
  "simplified",
  "unsupported",
  "conflict-resolved",
  "uncertain"
]);

export const RealizationEvidenceLinkV1Schema = z.object({
  kind: z.enum(["selected-plan", "registered-operator", "canonical-feature", "validated-output"]),
  sourceId: StableIdSchema,
  sourceVersion: z.string().regex(/^\d+\.\d+\.\d+$/).nullable()
}).strict();

const RequirementRealizationFindingCodeV1Schema = z.enum([
  "REQUIREMENT_REALIZED",
  "REQUIREMENT_SIMPLIFIED",
  "REQUIREMENT_UNSUPPORTED",
  "REQUIREMENT_CONFLICT_RESOLVED",
  "REQUIREMENT_UNCERTAIN"
]);

export const RequirementRealizationRecordV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  requirementId: StableIdSchema,
  priority: z.enum(["must", "prefer"]),
  requirementKind: z.enum([
    "containment",
    "support",
    "access",
    "organization",
    "closure",
    "rigid-interface",
    "revolute-interface",
    "prismatic-interface",
    "permitted-stock",
    "visual-treatment",
    "cut-through-treatment",
    "functional-aperture",
    "specific-profile",
    "compound-motion"
  ]),
  state: RealizationStateV1Schema,
  findingCode: RequirementRealizationFindingCodeV1Schema,
  evidenceLinks: z.array(RealizationEvidenceLinkV1Schema).max(128),
  disclosure: z.string().min(1).max(500).nullable(),
  policyVersion: z.literal(REQUIREMENT_REALIZATION_POLICY_VERSION)
}).strict().superRefine((value, context) => {
  if (value.state === "realized" && value.evidenceLinks.length === 0) {
    context.addIssue({ code: "custom", message: "Realized requirements require concrete deterministic evidence." });
  }
  if (value.state !== "realized" && value.disclosure === null) {
    context.addIssue({ code: "custom", message: "Non-realized requirements require a disclosure." });
  }
});

export const RequirementRealizationLedgerV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  policyVersion: z.literal(REQUIREMENT_REALIZATION_POLICY_VERSION),
  records: z.array(RequirementRealizationRecordV1Schema).max(32),
  unsupportedMustRequirementIds: z.array(StableIdSchema),
  unresolvedMustRequirementIds: z.array(StableIdSchema),
  simplifiedPreferRequirementIds: z.array(StableIdSchema)
}).strict().superRefine((value, context) => {
  const ids = value.records.map((record) => record.requirementId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Requirement realization records must be unique." });
  }
});

export type RealizationEvidenceLinkV1 = z.infer<typeof RealizationEvidenceLinkV1Schema>;
export type RequirementRealizationRecordV1 = z.infer<typeof RequirementRealizationRecordV1Schema>;
export type RequirementRealizationLedgerV1 = z.infer<typeof RequirementRealizationLedgerV1Schema>;

function uniqueLinks(links: readonly RealizationEvidenceLinkV1[]): RealizationEvidenceLinkV1[] {
  const output = new Map<string, RealizationEvidenceLinkV1>();
  for (const link of links) {
    const parsed = RealizationEvidenceLinkV1Schema.parse(link);
    output.set(`${parsed.kind}:${parsed.sourceId}:${parsed.sourceVersion ?? ""}`, parsed);
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

function validationLink(): RealizationEvidenceLinkV1 {
  return { kind: "validated-output", sourceId: "canonical-validation", sourceVersion: null };
}

function operatorLinks(plan: ConstructionPlanV1, ids: readonly string[]): RealizationEvidenceLinkV1[] {
  return plan.operatorProgram
    .filter((operator) => ids.includes(operator.operatorId))
    .map((operator) => ({
      kind: "registered-operator" as const,
      sourceId: operator.operatorId,
      sourceVersion: operator.operatorVersion
    }));
}

function canonicalLinks(document: DesignDocumentV1, ids: readonly string[]): RealizationEvidenceLinkV1[] {
  const permitted = new Set(ids);
  return [
    ...document.parts.filter((part) => permitted.has(part.id)).map((part) => ({
      kind: "canonical-feature" as const,
      sourceId: part.id,
      sourceVersion: null
    })),
    ...document.joints.filter((joint) => permitted.has(joint.id)).map((joint) => ({
      kind: "canonical-feature" as const,
      sourceId: joint.id,
      sourceVersion: null
    })),
    ...document.parts.flatMap((part) => part.features).filter((feature) => permitted.has(feature.id)).map((feature) => ({
      kind: "canonical-feature" as const,
      sourceId: feature.id,
      sourceVersion: null
    })),
    ...(document.cutThroughApplications ?? []).filter((application) => permitted.has(application.id)).map((application) => ({
      kind: "canonical-feature" as const,
      sourceId: application.id,
      sourceVersion: null
    }))
  ];
}

export function evaluateUnplannedRequirementRealization(input: {
  projection: unknown;
}): RequirementRealizationLedgerV1 {
  const projection = ClosedSemanticProjectionSchema.parse(input.projection);
  const records = projection.requirements.map((requirement): RequirementRealizationRecordV1 => {
    const accounting = projection.accounting.filter((item) => item.requirementIds.includes(requirement.id));
    const uncertain = accounting.some((item) => item.state === "uncertain");
    const state = uncertain ? "uncertain" as const
      : requirement.priority === "must" ? "unsupported" as const
      : "simplified" as const;
    return RequirementRealizationRecordV1Schema.parse({
      schemaVersion: "1.0",
      requirementId: requirement.id,
      priority: requirement.priority,
      requirementKind: requirement.kind,
      state,
      findingCode: uncertain ? "REQUIREMENT_UNCERTAIN"
        : requirement.priority === "must" ? "REQUIREMENT_UNSUPPORTED"
        : "REQUIREMENT_SIMPLIFIED",
      evidenceLinks: [],
      disclosure: uncertain
        ? `Requirement ${requirement.id} remains semantically unresolved and has no fabrication authority.`
        : requirement.priority === "must"
          ? `Mandatory requirement ${requirement.id} has no selected deterministic construction; fabrication export is withheld.`
          : `Preferred requirement ${requirement.id} has no selected deterministic construction and was omitted.`,
      policyVersion: REQUIREMENT_REALIZATION_POLICY_VERSION
    });
  });
  return RequirementRealizationLedgerV1Schema.parse({
    schemaVersion: "1.0",
    policyVersion: REQUIREMENT_REALIZATION_POLICY_VERSION,
    records,
    unsupportedMustRequirementIds: records.filter((record) =>
      record.priority === "must" && record.state === "unsupported"
    ).map((record) => record.requirementId).sort(),
    unresolvedMustRequirementIds: records.filter((record) =>
      record.priority === "must" && record.state === "uncertain"
    ).map((record) => record.requirementId).sort(),
    simplifiedPreferRequirementIds: records.filter((record) =>
      record.priority === "prefer" && record.state === "simplified"
    ).map((record) => record.requirementId).sort()
  });
}

function requirementPlanEvidence(input: {
  projection: ClosedSemanticProjection;
  plan: ConstructionPlanV1;
  document: DesignDocumentV1;
  motifReport: MotifApplicationReport | null;
  requirement: ClosedSemanticProjection["requirements"][number];
}): RealizationEvidenceLinkV1[] {
  const { projection, plan, document, motifReport, requirement } = input;
  const validation = document.validation.status === "pass" ? [validationLink()] : [];
  const structuralPartIds = plan.panels.map((panel) => panel.id);
  const structuralJointIds = plan.mates.map((mate) => mate.id);
  const structural = [
    planLink(plan),
    ...operatorLinks(plan, ["orthogonal-panel-layout", "panel-tab-slot-mate", "edge-finger-mate"]),
    ...canonicalLinks(document, [...structuralPartIds, ...structuralJointIds]),
    ...validation
  ];

  if (requirement.kind === "containment" || requirement.kind === "support") {
    return plan.topology.sourceRequirementIds.includes(requirement.id) ? structural : [];
  }
  if (requirement.kind === "access") {
    const access = projection.access.find((item) => item.requirementId === requirement.id);
    if (access?.kind !== plan.topology.access ||
        (access.kind === "covered" && access.direction !== "top")) return [];
    if (access.kind === "covered" && plan.topology.mechanism === "fixed-top-frame") {
      const aperture = projection.cutThrough.find((item) =>
        item.fixedTopAccess &&
        item.bodyId === access.bodyId &&
        item.requirementId === requirement.id
      );
      if (aperture === undefined) return [];
      const applications = (document.cutThroughApplications ?? []).filter((application) =>
        application.id === aperture.id &&
        application.purpose === "access" &&
        application.sourceRequirementIds.includes(requirement.id)
      );
      if (applications.length === 0) return [];
      return [
        planLink(plan),
        ...operatorLinks(plan, ["cut-through-treatment", "fixed-top-frame"]),
        ...canonicalLinks(document, applications.flatMap((application) => [
          application.id,
          ...application.targetPartIds,
          ...application.featureIds
        ])),
        ...validation
      ];
    }
    const relatedParts = plan.panels.filter((panel) =>
      access.kind === "covered" ? panel.role === "cover" : panel.role !== "cover"
    ).map((panel) => panel.id);
    return [planLink(plan), ...canonicalLinks(document, relatedParts), ...validation];
  }
  if (requirement.kind === "organization") {
    const organization = projection.organization.find((item) => item.requirementId === requirement.id);
    if (organization === undefined) return [];
    const expected = organization.desiredSpaceCount;
    if (expected !== plan.topology.canonicalSpaces.length) return [];
    const dividers = plan.panels.filter((panel) => panel.role === "divider").map((panel) => panel.id);
    return [planLink(plan), ...canonicalLinks(document, dividers), ...validation];
  }
  if (requirement.kind === "closure") {
    const cover = plan.panels.find((panel) => panel.role === "cover");
    return plan.topology.access === "covered" && cover !== undefined
      ? [planLink(plan), ...canonicalLinks(document, [cover.id]), ...validation]
      : [];
  }
  if (requirement.kind === "rigid-interface") {
    const mates = plan.mates.filter((mate) =>
      (mate.kind === "tab-slot" || mate.kind === "edge-finger") &&
      mate.sourceSemanticIds.includes(requirement.id)
    );
    return mates.length === 0 ? [] : [
      planLink(plan),
      ...operatorLinks(plan, ["panel-tab-slot-mate", "edge-finger-mate"]),
      ...canonicalLinks(document, mates.map((mate) => mate.id)),
      ...validation
    ];
  }
  if (requirement.kind === "revolute-interface" || requirement.kind === "prismatic-interface") {
    const expected = requirement.kind === "revolute-interface" ? "retained-pin" : "captured-slide";
    const operator = requirement.kind === "revolute-interface" ? "retained-pin-revolute" : "captured-panel-slide";
    const mate = plan.mates.find((item) => item.kind === expected);
    return plan.topology.mechanism !== expected || mate === undefined ? [] : [
      planLink(plan),
      ...operatorLinks(plan, [operator]),
      ...canonicalLinks(document, [mate.id]),
      ...validation
    ];
  }
  if (requirement.kind === "permitted-stock") {
    const stockIds = [document.resolvedInputs.material.id, ...(document.externalStock ?? []).map((item) => item.id)];
    return [planLink(plan), ...stockIds.map((sourceId) => ({
      kind: "canonical-feature" as const,
      sourceId,
      sourceVersion: null
    })), ...validation];
  }
  if (requirement.kind === "visual-treatment") {
    if (motifReport?.status !== "applied" || motifReport.featureIds.length === 0) return [];
    return [
      planLink(plan),
      ...operatorLinks(plan, ["procedural-surface-treatment"]),
      ...motifReport.featureIds.map((sourceId) => ({
        kind: "canonical-feature" as const,
        sourceId,
        sourceVersion: null
      })),
      ...validation
    ];
  }
  if (requirement.kind === "cut-through-treatment" || requirement.kind === "functional-aperture") {
    const applications = (document.cutThroughApplications ?? []).filter((application) =>
      application.sourceRequirementIds.includes(requirement.id) &&
      (requirement.kind !== "functional-aperture" || application.purpose !== "ornament")
    );
    if (applications.length === 0) return [];
    return [
      planLink(plan),
      ...operatorLinks(plan, ["cut-through-treatment", "fixed-top-frame"]),
      ...canonicalLinks(document, applications.flatMap((application) => [
        application.id,
        ...application.targetPartIds,
        ...application.featureIds
      ])),
      ...validation
    ];
  }
  return [];
}

export function evaluateRequirementRealization(input: {
  projection: unknown;
  plan: unknown;
  document: unknown;
  motifReport: MotifApplicationReport | null;
}): RequirementRealizationLedgerV1 {
  const projection = ClosedSemanticProjectionSchema.parse(input.projection);
  const plan = ConstructionPlanV1Schema.parse(input.plan);
  const document = DesignDocumentV1Schema.parse(input.document);
  const simplificationById = new Map(plan.simplifications.map((item) => [item.requirementId, item.disclosure]));
  const records = projection.requirements.map((requirement): RequirementRealizationRecordV1 => {
    const simplification = simplificationById.get(requirement.id);
    if (simplification !== undefined) {
      return RequirementRealizationRecordV1Schema.parse({
        schemaVersion: "1.0",
        requirementId: requirement.id,
        priority: requirement.priority,
        requirementKind: requirement.kind,
        state: "simplified",
        findingCode: "REQUIREMENT_SIMPLIFIED",
        evidenceLinks: [],
        disclosure: simplification,
        policyVersion: REQUIREMENT_REALIZATION_POLICY_VERSION
      });
    }
    const cutThroughSimplification = (document.cutThroughApplications ?? []).find((application) =>
      application.sourceRequirementIds.includes(requirement.id) && application.simplificationDisclosure !== null
    );
    if (cutThroughSimplification !== undefined && cutThroughSimplification.simplificationDisclosure !== null) {
      return RequirementRealizationRecordV1Schema.parse({
        schemaVersion: "1.0",
        requirementId: requirement.id,
        priority: requirement.priority,
        requirementKind: requirement.kind,
        state: "simplified",
        findingCode: "REQUIREMENT_SIMPLIFIED",
        evidenceLinks: uniqueLinks(requirementPlanEvidence({
          projection,
          plan,
          document,
          motifReport: input.motifReport,
          requirement
        })),
        disclosure: cutThroughSimplification.simplificationDisclosure,
        policyVersion: REQUIREMENT_REALIZATION_POLICY_VERSION
      });
    }
    const evidenceLinks = uniqueLinks(requirementPlanEvidence({
      projection,
      plan,
      document,
      motifReport: input.motifReport,
      requirement
    }));
    if (evidenceLinks.length > 0) {
      return RequirementRealizationRecordV1Schema.parse({
        schemaVersion: "1.0",
        requirementId: requirement.id,
        priority: requirement.priority,
        requirementKind: requirement.kind,
        state: "realized",
        findingCode: "REQUIREMENT_REALIZED",
        evidenceLinks,
        disclosure: null,
        policyVersion: REQUIREMENT_REALIZATION_POLICY_VERSION
      });
    }
    return RequirementRealizationRecordV1Schema.parse({
      schemaVersion: "1.0",
      requirementId: requirement.id,
      priority: requirement.priority,
      requirementKind: requirement.kind,
      state: requirement.priority === "prefer" ? "simplified" : "unsupported",
      findingCode: requirement.priority === "prefer" ? "REQUIREMENT_SIMPLIFIED" : "REQUIREMENT_UNSUPPORTED",
      evidenceLinks: [],
      disclosure: requirement.priority === "prefer"
        ? `Preferred requirement ${requirement.id} has no deterministic realization evidence and was omitted.`
        : `Mandatory requirement ${requirement.id} has no deterministic realization evidence; fabrication export is withheld.`,
      policyVersion: REQUIREMENT_REALIZATION_POLICY_VERSION
    });
  });
  return RequirementRealizationLedgerV1Schema.parse({
    schemaVersion: "1.0",
    policyVersion: REQUIREMENT_REALIZATION_POLICY_VERSION,
    records,
    unsupportedMustRequirementIds: records.filter((item) =>
      item.priority === "must" && item.state === "unsupported"
    ).map((item) => item.requirementId).sort(),
    unresolvedMustRequirementIds: records.filter((item) =>
      item.priority === "must" && item.state === "uncertain"
    ).map((item) => item.requirementId).sort(),
    simplifiedPreferRequirementIds: records.filter((item) =>
      item.priority === "prefer" && item.state === "simplified"
    ).map((item) => item.requirementId).sort()
  });
}
