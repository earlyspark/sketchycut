import { z } from "zod";

import { GENERATION_OPENAI_MODEL } from "../server/generation/cost-envelope.js";
import { CalibrationStudyConfigurationIdSchema } from "./calibration-campaign.js";

export const REFERENCE_FIDELITY_STUDY_VERSION = "reference-fidelity-study-v2" as const;

export const ReferenceFidelityStudyConfigurationSchema = z.object({
  id: CalibrationStudyConfigurationIdSchema,
  modelId: z.literal(GENERATION_OPENAI_MODEL),
  reasoningEffort: z.enum(["medium", "high"]),
  imageDetailPolicy: z.enum(["low", "high", "mixed-first-high"]),
  promptLayoutVersion: z.enum(["stable-prefix-v2", "request-local-control-v1"]),
  maxOutputTokens: z.literal(6_000),
  serviceTier: z.literal("default"),
  store: z.literal(false)
}).strict();

export const REFERENCE_FIDELITY_STUDY_CONFIGURATIONS = Object.freeze([
  { id: "low-medium-request-local-control", modelId: GENERATION_OPENAI_MODEL, reasoningEffort: "medium", imageDetailPolicy: "low", promptLayoutVersion: "request-local-control-v1", maxOutputTokens: 6_000, serviceTier: "default", store: false },
  { id: "low-medium-stable-prefix", modelId: GENERATION_OPENAI_MODEL, reasoningEffort: "medium", imageDetailPolicy: "low", promptLayoutVersion: "stable-prefix-v2", maxOutputTokens: 6_000, serviceTier: "default", store: false },
  { id: "high-medium-stable-prefix", modelId: GENERATION_OPENAI_MODEL, reasoningEffort: "medium", imageDetailPolicy: "high", promptLayoutVersion: "stable-prefix-v2", maxOutputTokens: 6_000, serviceTier: "default", store: false },
  { id: "high-high-stable-prefix", modelId: GENERATION_OPENAI_MODEL, reasoningEffort: "high", imageDetailPolicy: "high", promptLayoutVersion: "stable-prefix-v2", maxOutputTokens: 6_000, serviceTier: "default", store: false },
  { id: "mixed-medium-stable-prefix", modelId: GENERATION_OPENAI_MODEL, reasoningEffort: "medium", imageDetailPolicy: "mixed-first-high", promptLayoutVersion: "stable-prefix-v2", maxOutputTokens: 6_000, serviceTier: "default", store: false }
] as const satisfies readonly z.input<typeof ReferenceFidelityStudyConfigurationSchema>[]);

export const REFERENCE_FIDELITY_STUDY_CASE_IDS = Object.freeze([
  "ornate-reproduce-mismatch",
  "same-text-covered-counterfactual",
  "subject-background-ocr-isolation",
  "auto-role",
  "multi-reference-unresolved-conflict"
] as const);

const ReferenceRoleSchema = z.enum(["structure", "motif"]);
export const ReferenceFidelityPredicateCodeSchema = z.enum([
  "NO_SILENT_PLAIN_SHELL",
  "NO_UNRELATED_DOT_REPLACEMENT",
  "UNSUPPORTED_DOMINANT_FEATURE_DISCLOSED",
  "PREFERRED_UNSUPPORTED_DISCLOSED",
  "NO_FIDELITY_CLAIM",
  "CONTEXT_DOES_NOT_CREATE_REQUIREMENT",
  "ZERO_REFERENCE_SUPPORTED",
  "REFERENCE_SELECTS_UNSTATED_OPEN_ACCESS",
  "REFERENCE_SELECTS_UNSTATED_COVERED_ACCESS",
  "NO_BACKGROUND_PROP_REQUIREMENT",
  "NO_OVERLAY_TEXT_REQUIREMENT",
  "STRUCTURE_ROLE_PRESERVED",
  "MOTIF_ROLE_PRESERVED",
  "REGISTERED_BORDER_REALIZED",
  "BOTH_ROLES_PRESERVED",
  "AUTO_ROLE_IS_UNCONSTRAINED",
  "DIRECT_TEXT_ACCESS_WINS",
  "CONFLICT_RESOLVED_DISCLOSED",
  "MULTI_REFERENCE_CONFLICT_NOT_SILENT",
  "NOVEL_ROLE_COMPOSITION",
  "ORDER_PRESERVED",
  "PRISMATIC_AND_MOTIF_REALIZED"
]);

export const ReferenceFidelityManifestSchema = z.object({
  schemaVersion: z.literal("2.0"),
  corpusId: z.literal("m7-1-reference-fidelity-v2"),
  provenance: z.object({
    kind: z.literal("project-authored-procedural-synthetic"),
    externalAssets: z.literal(false),
    containsPrivateUserContent: z.literal(false)
  }).strict(),
  references: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]+$/),
    path: z.string().regex(/^tests\/fixtures\/reference-fidelity\/references\/[a-z0-9-]+\.png$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.literal(512),
    height: z.literal(512),
    assertionCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/)).min(2)
  }).strict()).min(6),
  cases: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]+$/),
    partition: z.enum(["comparison", "heldout"]),
    brief: z.string().min(1),
    referenceIds: z.array(z.string()).max(3),
    roleConstraints: z.array(z.array(ReferenceRoleSchema).max(2)).max(3),
    expectedRelationships: z.array(z.enum(["reproduce", "inspire", "context"])).max(3),
    relationshipAcceptance: z.array(z.enum(["exact", "non-context"])).max(3),
    expectedOutcome: z.enum(["supported", "simplified", "concept-only"]),
    outcomeAcceptance: z.enum(["exact", "supported-or-disclosed-simplified"]),
    predicateCodes: z.array(ReferenceFidelityPredicateCodeSchema).min(1)
  }).strict()).min(12)
}).strict().superRefine((value, context) => {
  const references = new Set(value.references.map((item) => item.id));
  const caseIds = new Set(value.cases.map((item) => item.id));
  if (caseIds.size !== value.cases.length) {
    context.addIssue({ code: "custom", message: "Reference-fidelity case IDs must be unique." });
  }
  for (const candidate of value.cases) {
    if (candidate.referenceIds.length !== candidate.roleConstraints.length ||
        candidate.referenceIds.length !== candidate.expectedRelationships.length ||
        candidate.referenceIds.length !== candidate.relationshipAcceptance.length) {
      context.addIssue({ code: "custom", message: `Case ${candidate.id} reference arrays must align.` });
    }
    if (candidate.outcomeAcceptance === "supported-or-disclosed-simplified" &&
        candidate.expectedOutcome !== "supported") {
      context.addIssue({
        code: "custom",
        message: `Case ${candidate.id} may broaden only an expected supported outcome.`
      });
    }
    for (const id of candidate.referenceIds) {
      if (!references.has(id)) context.addIssue({ code: "custom", message: `Case ${candidate.id} cites unknown reference ${id}.` });
    }
  }
  for (const caseId of REFERENCE_FIDELITY_STUDY_CASE_IDS) {
    if (!caseIds.has(caseId)) context.addIssue({ code: "custom", message: `Study case ${caseId} is missing.` });
  }
});

export type ReferenceFidelityManifest = z.infer<typeof ReferenceFidelityManifestSchema>;
export type ReferenceFidelityCaseContract = ReferenceFidelityManifest["cases"][number];

export function referenceFidelityStudyConfiguration(
  id: z.infer<typeof CalibrationStudyConfigurationIdSchema>,
) {
  const configuration = REFERENCE_FIDELITY_STUDY_CONFIGURATIONS.find((item) => item.id === id);
  if (configuration === undefined) throw new Error(`REFERENCE_FIDELITY_CONFIGURATION_UNKNOWN:${id}`);
  return ReferenceFidelityStudyConfigurationSchema.parse(configuration);
}

export const REFERENCE_FIDELITY_STUDY_MAX_DISPATCHES =
  REFERENCE_FIDELITY_STUDY_CONFIGURATIONS.length * REFERENCE_FIDELITY_STUDY_CASE_IDS.length;

export function validateReferenceFidelityStudyDefinition(): void {
  const configurations = REFERENCE_FIDELITY_STUDY_CONFIGURATIONS.map((item) =>
    ReferenceFidelityStudyConfigurationSchema.parse(item));
  if (new Set(configurations.map((item) => item.id)).size !== configurations.length) {
    throw new Error("REFERENCE_FIDELITY_STUDY_CONFIGURATION_ID_DUPLICATE");
  }
  if (new Set(REFERENCE_FIDELITY_STUDY_CASE_IDS).size !== REFERENCE_FIDELITY_STUDY_CASE_IDS.length) {
    throw new Error("REFERENCE_FIDELITY_STUDY_CASE_ID_DUPLICATE");
  }
}
