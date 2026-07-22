import { z } from "zod";

import { Sha256Schema } from "../domain/contracts.js";
import { hashCanonical, sha256 } from "../domain/hash.js";

export const PROMPT_EXAMPLE_CATALOG_VERSION = "prompt-example-catalog-v1" as const;
export const PROMPT_GENERALITY_POLICY_VERSION = "prompt-generality-policy-v1" as const;

const AccessSchema = z.enum(["open-top", "open-front", "covered"]);
const MechanismSchema = z.enum(["none", "fixed-top-frame", "retained-pin", "captured-slide"]);
const RelationTupleSchema = z.object({
  objectRoles: z.array(z.enum(["contained", "supported"])).min(1).max(4),
  access: AccessSchema,
  organizationCount: z.number().int().min(1).max(4).nullable(),
  scaleEvidenceTarget: z.string().trim().min(1).max(80).nullable(),
  proportionDirection: z.enum([
    "width-over-depth",
    "width-over-height",
    "height-over-width",
    "depth-over-width",
    "none"
  ]),
  mechanism: MechanismSchema
}).strict();
export const NoveltyRelationTupleV1Schema = RelationTupleSchema;

const PromptExampleV1Schema = z.object({
  exampleId: z.string().regex(/^[a-z][a-z0-9-]+$/),
  syntheticBrief: z.string().trim().min(1).max(500),
  objectAliases: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  relationTuple: RelationTupleSchema,
  intentFragment: z.object({
    purpose: z.string().trim().min(1).max(240),
    access: AccessSchema,
    organizationCount: z.number().int().min(1).max(4).nullable(),
    scaleEvidenceBasis: z.literal("model-prior").nullable(),
    proportionDirection: RelationTupleSchema.shape.proportionDirection,
    mechanism: MechanismSchema
  }).strict()
}).strict();

export const PromptExampleCatalogV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  catalogVersion: z.literal(PROMPT_EXAMPLE_CATALOG_VERSION),
  examples: z.array(PromptExampleV1Schema).min(1).max(8)
}).strict().superRefine((value, context) => {
  const ids = value.examples.map((item) => item.exampleId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Prompt example IDs must be unique." });
});

export const PROMPT_EXAMPLE_CATALOG_V1 = PromptExampleCatalogV1Schema.parse({
  schemaVersion: "1.0",
  catalogVersion: PROMPT_EXAMPLE_CATALOG_VERSION,
  examples: [
    {
      exampleId: "embroidery-hoop-sorter",
      syntheticBrief: "Create a low open-top sorter with three spaces for embroidery hoops.",
      objectAliases: ["embroidery hoops", "hoops"],
      relationTuple: {
        objectRoles: ["contained"],
        access: "open-top",
        organizationCount: 3,
        scaleEvidenceTarget: "embroidery hoops",
        proportionDirection: "width-over-height",
        mechanism: "none"
      },
      intentFragment: {
        purpose: "Sort embroidery hoops in three accessible spaces.",
        access: "open-top",
        organizationCount: 3,
        scaleEvidenceBasis: "model-prior",
        proportionDirection: "width-over-height",
        mechanism: "none"
      }
    },
    {
      exampleId: "rolled-map-sleeve",
      syntheticBrief: "Create a tall open-front sleeve that supports two rolled maps.",
      objectAliases: ["rolled maps", "maps"],
      relationTuple: {
        objectRoles: ["supported"],
        access: "open-front",
        organizationCount: null,
        scaleEvidenceTarget: "rolled maps",
        proportionDirection: "height-over-width",
        mechanism: "none"
      },
      intentFragment: {
        purpose: "Support rolled maps in a tall front-access sleeve.",
        access: "open-front",
        organizationCount: null,
        scaleEvidenceBasis: "model-prior",
        proportionDirection: "height-over-width",
        mechanism: "none"
      }
    },
    {
      exampleId: "seed-packet-keeper",
      syntheticBrief: "Make a two-space keeper for seed packets with a captured sliding cover.",
      objectAliases: ["seed packets", "packets"],
      relationTuple: {
        objectRoles: ["contained"],
        access: "covered",
        organizationCount: 2,
        scaleEvidenceTarget: "seed packets",
        proportionDirection: "none",
        mechanism: "captured-slide"
      },
      intentFragment: {
        purpose: "Contain seed packets in two spaces under a captured sliding cover.",
        access: "covered",
        organizationCount: 2,
        scaleEvidenceBasis: "model-prior",
        proportionDirection: "none",
        mechanism: "captured-slide"
      }
    }
  ]
});

const SCHEMA_VOCABULARY = [
  "access", "assumptions", "axis", "body", "canonical", "captured-slide", "clearance", "closed", "confidence",
  "contained", "covered", "depth", "evidence", "freeform", "height", "intent", "interface", "mechanism", "model-prior",
  "must", "none", "object", "open-front", "open-top", "organization", "planar", "prefer", "prismatic", "proportion",
  "purpose", "retained-pin", "revolute", "rigid", "scale", "space", "supported", "width"
] as const;
const STOP_WORDS = [
  "a", "an", "and", "at", "be", "by", "create", "for", "from", "in", "into", "is", "it", "make", "my", "of", "on",
  "or", "please", "that", "the", "this", "to", "use", "with"
] as const;
const PROHIBITED_PUBLIC_ALIASES = [
  "automaton", "camera", "catchall", "keepsake", "notebook", "paint brush", "paint brushes", "pencil", "pencils",
  "phone stand", "sd card", "sd cards", "tea bag", "tea bags"
] as const;
const PROHIBITED_ASSOCIATIONS = [
  ["six", "pencils"],
  ["four", "sd cards"],
  ["one", "sd cards"],
  ["retained pin", "keepsake"],
  ["captured sliding", "cards"]
] as const;

const POLICY = {
  version: PROMPT_GENERALITY_POLICY_VERSION,
  normalizer: "nfkc-lowercase-alphanumeric-token-v1",
  schemaVocabulary: SCHEMA_VOCABULARY,
  stopWords: STOP_WORDS,
  prohibitedPublicAliases: PROHIBITED_PUBLIC_ALIASES,
  prohibitedAssociations: PROHIBITED_ASSOCIATIONS,
  minimumAliasTokens: 1,
  catalogVersion: PROMPT_EXAMPLE_CATALOG_VERSION
} as const;

const PromptGeneralityIssueV1Schema = z.object({
  code: z.enum([
    "PROHIBITED_CASE_ALIAS",
    "PROHIBITED_CASE_ASSOCIATION",
    "CATALOG_ALIAS_OVERLAP",
    "CATALOG_DUPLICATE_RELATION_TUPLE"
  ]),
  location: z.enum(["prompt", "catalog"]),
  matchHash: Sha256Schema
}).strict();

export const PromptGeneralityReportV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  policyVersion: z.literal(PROMPT_GENERALITY_POLICY_VERSION),
  policyHash: Sha256Schema,
  promptHash: Sha256Schema,
  catalogHash: Sha256Schema,
  issues: z.array(PromptGeneralityIssueV1Schema),
  pass: z.boolean()
}).strict();

export type PromptExampleCatalogV1 = z.infer<typeof PromptExampleCatalogV1Schema>;
export type PromptGeneralityReportV1 = z.infer<typeof PromptGeneralityReportV1Schema>;
export type NoveltyRelationTupleV1 = z.infer<typeof RelationTupleSchema>;

export function normalizeGeneralityText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim().replaceAll(/\s+/g, " ");
}

export function relationTupleKey(tuple: NoveltyRelationTupleV1): string {
  return JSON.stringify(RelationTupleSchema.parse({
    ...tuple,
    objectRoles: [...tuple.objectRoles].sort()
  }));
}

async function issue(code: z.infer<typeof PromptGeneralityIssueV1Schema>["code"], location: "prompt" | "catalog", match: string) {
  return PromptGeneralityIssueV1Schema.parse({ code, location, matchHash: await sha256(normalizeGeneralityText(match)) });
}

export async function evaluatePromptGenerality(input: {
  prompt: string;
  catalog?: unknown;
}): Promise<PromptGeneralityReportV1> {
  const catalog = PromptExampleCatalogV1Schema.parse(input.catalog ?? PROMPT_EXAMPLE_CATALOG_V1);
  const normalizedPrompt = ` ${normalizeGeneralityText(input.prompt)} `;
  const issues: z.infer<typeof PromptGeneralityIssueV1Schema>[] = [];
  for (const alias of POLICY.prohibitedPublicAliases) {
    const normalized = normalizeGeneralityText(alias);
    if (normalizedPrompt.includes(` ${normalized} `)) issues.push(await issue("PROHIBITED_CASE_ALIAS", "prompt", alias));
  }
  for (const association of POLICY.prohibitedAssociations) {
    const normalized = association.map(normalizeGeneralityText);
    if (normalized.every((item) => normalizedPrompt.includes(` ${item} `))) {
      issues.push(await issue("PROHIBITED_CASE_ASSOCIATION", "prompt", association.join("|")));
    }
  }
  const aliases = catalog.examples.flatMap((item) => item.objectAliases.map(normalizeGeneralityText));
  for (const alias of aliases) {
    if (POLICY.prohibitedPublicAliases.some((item) => normalizeGeneralityText(item) === alias)) {
      issues.push(await issue("CATALOG_ALIAS_OVERLAP", "catalog", alias));
    }
  }
  const tupleKeys = catalog.examples.map((item) => relationTupleKey(item.relationTuple));
  for (const key of tupleKeys.filter((item, index) => tupleKeys.indexOf(item) !== index)) {
    issues.push(await issue("CATALOG_DUPLICATE_RELATION_TUPLE", "catalog", key));
  }
  const uniqueIssues = [...new Map(issues.map((item) => [`${item.code}|${item.location}|${item.matchHash}`, item])).values()];
  return PromptGeneralityReportV1Schema.parse({
    schemaVersion: "1.0",
    policyVersion: PROMPT_GENERALITY_POLICY_VERSION,
    policyHash: await hashCanonical(POLICY),
    promptHash: await sha256(input.prompt),
    catalogHash: await hashCanonical(catalog),
    issues: uniqueIssues,
    pass: uniqueIssues.length === 0
  });
}

export async function promptGeneralityPolicyHash(): Promise<string> {
  return hashCanonical(POLICY);
}

export async function promptExampleCatalogHash(): Promise<string> {
  return hashCanonical(PROMPT_EXAMPLE_CATALOG_V1);
}
