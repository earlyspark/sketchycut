import { z } from "zod";

import { StableIdSchema } from "../domain/primitives.js";
import {
  SemanticInterpretationSchema,
  type SemanticInterpretation
} from "./semantic-interpretation.js";
import {
  RequirementRealizationLedgerV1Schema,
  type RequirementRealizationLedgerV1
} from "./realization-ledger.js";
import {
  SubstitutionSearchTraceSchema,
  type SubstitutionSearchTrace
} from "./substitution-graph.js";
import {
  RetainedScopeDecisionSchema,
  type RetainedScopeDecision
} from "./retained-scope.js";

export const INVENTORY_REALIZATION_POLICY_VERSION = "inventory-realization-v4" as const;

export const InventoryRealizationRecordSchema = z.object({
  itemId: StableIdSchema,
  importance: z.enum(["essential", "preference"]),
  accountingState: z.enum(["bound", "deferred", "unbound", "uncertain"]),
  realizationState: z.enum([
    "realized",
    "substituted",
    "simplified",
    "deferred",
    "unsupported",
    "uncertain"
  ]),
  reason: z.enum([
    "REFERENCE_ROLE_DEFERRED",
    "CAPABILITY_NOT_REGISTERED",
    "EVIDENCE_INSUFFICIENT",
    "EVIDENCE_CONFLICT",
    "PROJECTION_COVERAGE_MISMATCH",
    "DETERMINISTIC_RETAINED_SCOPE_OMISSION"
  ]).nullable(),
  requirementIds: z.array(StableIdSchema),
  capabilityIds: z.array(StableIdSchema),
  substitutionEdgeIds: z.array(StableIdSchema),
  disclosure: z.string().min(1).max(900).nullable()
}).strict().superRefine((record, context) => {
  if (record.realizationState === "realized" && record.disclosure !== null) {
    context.addIssue({ code: "custom", message: "Realized inventory items do not carry limitation disclosures." });
  }
  if (record.realizationState !== "realized" && record.disclosure === null) {
    context.addIssue({ code: "custom", message: "Non-realized inventory items require a disclosure." });
  }
  if (
    (record.realizationState === "substituted") !==
      (record.substitutionEdgeIds.length > 0)
  ) {
    context.addIssue({
      code: "custom",
      message: "Only substituted inventory items may carry substitution edges."
    });
  }
  if (
    record.realizationState === "substituted" &&
    record.accountingState !== "bound"
  ) {
    context.addIssue({
      code: "custom",
      message: "A substituted inventory item requires effective bound accounting."
    });
  }
});

export const InventoryRealizationLedgerSchema = z.object({
  schemaVersion: z.literal("1.0"),
  policyVersion: z.literal(INVENTORY_REALIZATION_POLICY_VERSION),
  records: z.array(InventoryRealizationRecordSchema).max(48),
  blockingItemIds: z.array(StableIdSchema),
  substitutedItemIds: z.array(StableIdSchema),
  simplifiedItemIds: z.array(StableIdSchema),
  deferredItemIds: z.array(StableIdSchema)
}).strict().superRefine((ledger, context) => {
  const ids = ledger.records.map((record) => record.itemId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Inventory realization records must be unique by item." });
  }
  const exactIds = [
    {
      actual: ledger.blockingItemIds,
      expected: ledger.records.filter((record) =>
        record.importance === "essential" &&
        (
          record.realizationState === "unsupported" ||
          record.realizationState === "uncertain"
        )
      ).map((record) => record.itemId).sort(),
      label: "Blocking"
    },
    {
      actual: ledger.substitutedItemIds,
      expected: ledger.records.filter((record) =>
        record.realizationState === "substituted"
      ).map((record) => record.itemId).sort(),
      label: "Substituted"
    },
    {
      actual: ledger.simplifiedItemIds,
      expected: ledger.records.filter((record) =>
        record.realizationState === "simplified"
      ).map((record) => record.itemId).sort(),
      label: "Simplified"
    },
    {
      actual: ledger.deferredItemIds,
      expected: ledger.records.filter((record) =>
        record.realizationState === "deferred"
      ).map((record) => record.itemId).sort(),
      label: "Deferred"
    }
  ];
  for (const item of exactIds) {
    if (JSON.stringify(item.actual) !== JSON.stringify(item.expected)) {
      context.addIssue({
        code: "custom",
        message: `${item.label} item IDs must derive exactly from realization records.`
      });
    }
  }
});

export type InventoryRealizationLedger = z.infer<typeof InventoryRealizationLedgerSchema>;

function itemDisclosure(input: {
  itemId: string;
  state: "substituted" | "simplified" | "deferred" | "unsupported" | "uncertain";
  reason: "REFERENCE_ROLE_DEFERRED" | "CAPABILITY_NOT_REGISTERED" |
    "EVIDENCE_INSUFFICIENT" | "EVIDENCE_CONFLICT" |
    "PROJECTION_COVERAGE_MISMATCH" |
    "DETERMINISTIC_RETAINED_SCOPE_OMISSION" | null;
}): string {
  if (input.state === "deferred") {
    return `Inventory item ${input.itemId} is deferred by the maker-selected reference role and is not fabrication authority.`;
  }
  if (input.state === "unsupported") {
    return `Inventory item ${input.itemId} is unsupported by the registered capability catalog (${input.reason ?? "CAPABILITY_NOT_REGISTERED"}).`;
  }
  if (input.state === "uncertain") {
    return `Inventory item ${input.itemId} is uncertain and cannot authorize fabrication (${input.reason ?? "EVIDENCE_INSUFFICIENT"}).`;
  }
  if (input.state === "substituted") {
    return `Inventory item ${input.itemId} uses a registered deterministic substitution disclosed in the canonical substitution provenance.`;
  }
  return `Preferred inventory item ${input.itemId} was not fully realized and is disclosed as a deterministic simplification.`;
}

export function evaluateInventoryRealization(input: {
  interpretation: SemanticInterpretation;
  requirementRealization?: RequirementRealizationLedgerV1 | null;
  substitutionTrace?: SubstitutionSearchTrace;
  retainedScopeDecision?: RetainedScopeDecision;
}): InventoryRealizationLedger {
  const interpretation = SemanticInterpretationSchema.parse(input.interpretation);
  const requirements = input.requirementRealization === undefined || input.requirementRealization === null
    ? null
    : RequirementRealizationLedgerV1Schema.parse(input.requirementRealization);
  const requirementById = new Map(requirements?.records.map((record) => [record.requirementId, record]) ?? []);
  const substitutionTrace = input.substitutionTrace === undefined
    ? null
    : SubstitutionSearchTraceSchema.parse(input.substitutionTrace);
  const retainedScopeDecision = input.retainedScopeDecision === undefined
    ? null
    : RetainedScopeDecisionSchema.parse(input.retainedScopeDecision);
  const retainedOmissionIds = new Set(
    retainedScopeDecision?.omittedInventoryItemIds ?? [],
  );
  const retainedDisclosureById = new Map(
    retainedScopeDecision?.disclosures.map((item) => [
      item.semanticId,
      item.message
    ]) ?? [],
  );
  const substitutionByItemId = new Map(
    substitutionTrace?.appliedSubstitutions.flatMap((application) =>
      application.affectedSemanticIds.map((itemId) => [itemId, application] as const)
    ) ?? [],
  );
  const itemById = new Map(interpretation.inventory.items.map((item) => [item.id, item]));
  const records = interpretation.projection.accounting.map((accounting) => {
    const item = itemById.get(accounting.itemId)!;
    const requirementStates = accounting.requirementIds.flatMap((id) => {
      const record = requirementById.get(id);
      return record === undefined ? [] : [record.state];
    });
    const substitution = substitutionByItemId.get(item.id);
    if (substitution !== undefined && retainedOmissionIds.has(item.id)) {
      throw new Error("RETAINED_SCOPE_CANNOT_OMIT_SUBSTITUTED_ITEM");
    }
    const retainedOmission = retainedOmissionIds.has(item.id);
    const realizationState = retainedOmission
      ? (item.importance === "essential"
          ? "unsupported" as const
          : "simplified" as const)
      : substitution !== undefined ? "substituted" as const
      : accounting.state === "deferred" ? "deferred" as const
      : accounting.state === "unbound" ? (item.importance === "essential" ? "unsupported" as const : "simplified" as const)
      : accounting.state === "uncertain" ? (item.importance === "essential" ? "uncertain" as const : "simplified" as const)
      : requirements === null ? (item.importance === "essential" ? "unsupported" as const : "simplified" as const)
      : requirementStates.some((state) => state === "unsupported" || state === "uncertain")
        ? (item.importance === "essential" ? "unsupported" as const : "simplified" as const)
        : requirementStates.some((state) => state === "simplified")
          ? "simplified" as const
          : "realized" as const;
    return InventoryRealizationRecordSchema.parse({
      itemId: item.id,
      importance: item.importance,
      accountingState: accounting.state,
      realizationState,
      reason: retainedOmission
        ? "DETERMINISTIC_RETAINED_SCOPE_OMISSION"
        : accounting.reason,
      requirementIds: accounting.requirementIds,
      capabilityIds: accounting.capabilityIds,
      substitutionEdgeIds: substitution === undefined
        ? []
        : [substitution.edgeId],
      disclosure: realizationState === "realized"
        ? null
        : retainedDisclosureById.get(item.id) ??
          substitution?.disclosure ?? itemDisclosure({
            itemId: item.id,
            state: realizationState,
            reason: retainedOmission
              ? "DETERMINISTIC_RETAINED_SCOPE_OMISSION"
              : accounting.reason
          })
    });
  });
  return InventoryRealizationLedgerSchema.parse({
    schemaVersion: "1.0",
    policyVersion: INVENTORY_REALIZATION_POLICY_VERSION,
    records,
    blockingItemIds: records.filter((record) =>
      record.importance === "essential" && ["unsupported", "uncertain"].includes(record.realizationState)
    ).map((record) => record.itemId).sort(),
    substitutedItemIds: records.filter((record) =>
      record.realizationState === "substituted"
    ).map((record) => record.itemId).sort(),
    simplifiedItemIds: records.filter((record) => record.realizationState === "simplified")
      .map((record) => record.itemId).sort(),
    deferredItemIds: records.filter((record) => record.realizationState === "deferred")
      .map((record) => record.itemId).sort()
  });
}
