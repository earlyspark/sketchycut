import { z } from "zod";

import { Sha256Schema } from "../domain/digests.js";
import { StableIdSchema } from "../domain/primitives.js";
import { hashCanonical, sha256 } from "../domain/hash.js";
import {
  ExplicitSizingConstraintV1Schema,
  SIZING_FIXED_POINT_UM,
  SizingParserFindingV1Schema,
  SizingTargetSchema,
  targetKey,
  type ExplicitSizingConstraintV1,
  type SizingParserFindingV1,
  type SizingTarget
} from "./explicit-sizing.js";
import { normalizeBrief, SemanticReferenceDescriptorSchema } from "./semantic-input-contracts.js";

export const EXACT_MEASUREMENT_GRAMMAR_VERSION = "exact-measurement-grammar-v1" as const;

const EvidenceSpanV1Schema = z.object({
  evidenceId: StableIdSchema,
  kind: z.literal("brief-span"),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  semanticDigest: Sha256Schema,
  markerTargets: z.array(SizingTargetSchema)
}).strict();

const EvidenceReferenceV1Schema = z.object({
  evidenceId: StableIdSchema,
  kind: z.literal("reference"),
  referenceId: StableIdSchema,
  referenceIndex: z.number().int().nonnegative().max(2),
  contentDigest: Sha256Schema,
  declaredRoles: z.array(z.enum(["structure", "motif"])).max(2)
}).strict();

const MeasurementEvidenceLinkV1Schema = z.object({
  constraintId: StableIdSchema,
  evidenceId: StableIdSchema,
  target: SizingTargetSchema,
  markerStart: z.number().int().nonnegative(),
  markerEnd: z.number().int().positive()
}).strict();

export const SourceEvidenceIndexV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  semanticBriefDigest: Sha256Schema,
  spans: z.array(EvidenceSpanV1Schema).min(1),
  references: z.array(EvidenceReferenceV1Schema).max(3),
  measurementLinks: z.array(MeasurementEvidenceLinkV1Schema),
  digest: Sha256Schema
}).strict().superRefine((value, context) => {
  const ids = new Set([...value.spans.map((item) => item.evidenceId), ...value.references.map((item) => item.evidenceId)]);
  if (ids.size !== value.spans.length + value.references.length) {
    context.addIssue({ code: "custom", message: "Source evidence IDs must be unique." });
  }
  for (const link of value.measurementLinks) {
    if (!ids.has(link.evidenceId)) context.addIssue({ code: "custom", message: "Measurement link cites unknown evidence." });
  }
});

export type SourceEvidenceIndexV1 = z.infer<typeof SourceEvidenceIndexV1Schema>;

type ExtractedLiteral = {
  start: number;
  end: number;
  target: SizingTarget;
  valueUm: number;
};

const UNIT_TO_MM = { mm: 1, cm: 10, in: 25.4, inch: 25.4, inches: 25.4 } as const;
const tuplePattern = /project\s+(external|internal)\s+(?:dimensions?\s+)?width\s*[×x]\s*depth\s*[×x]\s*height\s*(?:is|of|=|:)?\s*(\d+(?:\.\d+)?)\s*(mm|cm|in|inch|inches)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(mm|cm|in|inch|inches)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(mm|cm|in|inch|inches)\b/giu;
const scalarPattern = /project\s+(external|internal)\s+(width|depth|height)\s*(?:is|of|=|:)??\s*(\d+(?:\.\d+)?)\s*(mm|cm|in|inch|inches)\b/giu;
const containedExplicitPattern = /(?:holds?|for)\s+([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*){0,2}?)\s+(?:with\s+)?contained-object\s+(width|depth|height)\s*(?:is|of|=|:)??\s*(\d+(?:\.\d+)?)\s*(mm|cm|in|inch|inches)\b/giu;
const containedAdjectivePattern = /(?:holds?|for)\s+(\d+(?:\.\d+)?)\s*(mm|cm|in|inch|inches)\s*[- ]?(wide|deep|tall|high|long|thick)\s+([a-z][a-z0-9-]*)/giu;
const approximatePattern = /(?:about|roughly|approximately|approx\.?|~|≈)\s*\d+(?:\.\d+)?\s*(?:mm|cm|in|inch|inches)\s*(?:wide|deep|tall|high|long|thick)?/giu;
const rangePattern = /\d+(?:\.\d+)?\s*(?:–|-|to)\s*\d+(?:\.\d+)?\s*(?:mm|cm|in|inch|inches)\s*(?:wide|deep|tall|high|long|thick)?/giu;
const ambiguousMeasurementPattern = /(?:\b(?:width|depth|height)\s*(?:is|of|=|:)?\s*\d+(?:\.\d+)?\s*(?:mm|cm|in|inch|inches)\b|\b\d+(?:\.\d+)?\s*(?:mm|cm|in|inch|inches)\s*[- ]?(?:wide|deep|tall|high|long|thick)\b)/giu;

function slug(value: string): string {
  const normalized = value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
  return normalized.length === 0 ? "object" : normalized;
}

function adjectiveAxis(value: string): "width" | "depth" | "height" {
  if (value === "wide" || value === "long") return "width";
  if (value === "deep") return "depth";
  return "height";
}

function toUm(value: string, unit: keyof typeof UNIT_TO_MM): number | null {
  const mm = Number(value) * UNIT_TO_MM[unit];
  const um = Math.round(mm * 1_000);
  return Number.isFinite(mm) && mm > 0 && um % SIZING_FIXED_POINT_UM === 0 ? um : null;
}

function overlaps(left: { start: number; end: number }, right: { start: number; end: number }): boolean {
  return left.start < right.end && right.start < left.end;
}

function exactLiterals(brief: string): ExtractedLiteral[] {
  const blocked = [
    ...brief.matchAll(approximatePattern),
    ...brief.matchAll(rangePattern)
  ].map((match) => ({ start: match.index, end: match.index + match[0].length }));
  const output: ExtractedLiteral[] = [];
  for (const match of brief.matchAll(tuplePattern)) {
    const components = [
      { axis: "width", value: match[2]!, unit: match[3]! },
      { axis: "depth", value: match[4]!, unit: match[5]! },
      { axis: "height", value: match[6]!, unit: match[7]! }
    ] as const;
    let searchFrom = 0;
    const tupleItems = components.flatMap(({ axis, value, unit }) => {
      const localStart = match[0].indexOf(value, searchFrom);
      const localUnitStart = match[0].indexOf(unit, localStart + value.length);
      searchFrom = localUnitStart + unit.length;
      const valueUm = toUm(value, unit.toLowerCase() as keyof typeof UNIT_TO_MM);
      if (valueUm === null) return [];
      return [{
        start: match.index + localStart,
        end: match.index + localUnitStart + unit.length,
        target: {
          subject: "project" as const,
          envelope: match[1]!.toLowerCase() as "external" | "internal",
          axis
        },
        valueUm
      }];
    });
    if (tupleItems.length === 3) output.push(...tupleItems);
  }
  for (const match of brief.matchAll(scalarPattern)) {
    const fullStart = match.index;
    if (blocked.some((item) => overlaps(item, { start: fullStart, end: fullStart + match[0].length }))) continue;
    const literal = `${match[3]!}${(/^\s*(mm|cm|in|inch|inches)/iu.exec(match[0].slice(match[0].indexOf(match[3]!) + match[3]!.length)))?.[0] ?? ` ${match[4]!}`}`;
    const start = fullStart + match[0].lastIndexOf(match[3]!);
    const end = start + literal.length;
    const valueUm = toUm(match[3]!, match[4]!.toLowerCase() as keyof typeof UNIT_TO_MM);
    if (valueUm === null) continue;
    output.push({
      start,
      end,
      target: { subject: "project", envelope: match[1]!.toLowerCase() as "external" | "internal", axis: match[2]!.toLowerCase() as "width" | "depth" | "height" },
      valueUm
    });
  }
  for (const match of brief.matchAll(containedExplicitPattern)) {
    const start = match.index + match[0].lastIndexOf(match[3]!);
    const unitStart = match[0].lastIndexOf(match[4]!);
    const end = match.index + unitStart + match[4]!.length;
    const valueUm = toUm(match[3]!, match[4]!.toLowerCase() as keyof typeof UNIT_TO_MM);
    if (valueUm === null) continue;
    output.push({
      start,
      end,
      target: { subject: "contained-object", objectId: slug(match[1]!), axis: match[2]!.toLowerCase() as "width" | "depth" | "height" },
      valueUm
    });
  }
  for (const match of brief.matchAll(containedAdjectivePattern)) {
    const start = match.index + match[0].indexOf(match[1]!);
    const unitStart = match[0].indexOf(match[2]!, match[0].indexOf(match[1]!) + match[1]!.length);
    const end = match.index + unitStart + match[2]!.length;
    const valueUm = toUm(match[1]!, match[2]!.toLowerCase() as keyof typeof UNIT_TO_MM);
    if (valueUm === null) continue;
    output.push({
      start,
      end,
      target: { subject: "contained-object", objectId: slug(match[4]!), axis: adjectiveAxis(match[3]!.toLowerCase()) },
      valueUm
    });
  }
  return output
    .sort((left, right) => left.start - right.start)
    .filter((item, index, items) => !items.slice(0, index).some((prior) => overlaps(prior, item)));
}

function ignoredFindings(brief: string, extracted: readonly ExtractedLiteral[]): SizingParserFindingV1[] {
  const finding = (match: RegExpMatchArray, reason: "approximate" | "range") => {
    const start = match.index ?? 0;
    return SizingParserFindingV1Schema.parse({
      code: "SIZING_MEASUREMENT_IGNORED",
      blocking: false,
      start,
      end: start + match[0].length,
      target: null,
      reason
    });
  };
  const approximate = [...brief.matchAll(approximatePattern)];
  const ranges = [...brief.matchAll(rangePattern)];
  const blocked = [...approximate, ...ranges].map((match) => ({
    start: match.index,
    end: match.index + match[0].length
  }));
  const ambiguous = [...brief.matchAll(ambiguousMeasurementPattern)].flatMap((match) => {
    const start = match.index;
    const span = { start, end: start + match[0].length };
    if (extracted.some((item) => overlaps(item, span)) || blocked.some((item) => overlaps(item, span))) {
      return [];
    }
    return [SizingParserFindingV1Schema.parse({
      code: "SIZING_MEASUREMENT_AMBIGUOUS",
      blocking: true,
      start,
      end: span.end,
      target: null,
      reason: "ambiguous-target"
    })];
  });
  return [
    ...approximate.map((match) => finding(match, "approximate")),
    ...ranges.map((match) => finding(match, "range")),
    ...ambiguous
  ].sort((left, right) => left.start - right.start);
}

function semanticBriefFrom(brief: string, extracted: readonly ExtractedLiteral[]): {
  semanticBrief: string;
  markerRanges: { start: number; end: number; target: SizingTarget; valueUm: number }[];
} {
  let cursor = 0;
  let semanticBrief = "";
  const markerRanges: { start: number; end: number; target: SizingTarget; valueUm: number }[] = [];
  for (const literal of extracted) {
    semanticBrief += brief.slice(cursor, literal.start);
    const marker = `<EXACT:${targetKey(literal.target)}>`;
    const start = semanticBrief.length;
    semanticBrief += marker;
    markerRanges.push({ start, end: semanticBrief.length, target: literal.target, valueUm: literal.valueUm });
    cursor = literal.end;
  }
  semanticBrief += brief.slice(cursor);
  return { semanticBrief, markerRanges };
}

function spanRanges(semanticBrief: string): { start: number; end: number }[] {
  const output: { start: number; end: number }[] = [];
  const pattern = /[^.!?;]+[.!?;]?/gu;
  for (const match of semanticBrief.matchAll(pattern)) {
    const leading = (/^\s*/u.exec(match[0]))?.[0].length ?? 0;
    const trailing = (/\s*$/u.exec(match[0]))?.[0].length ?? 0;
    const start = match.index + leading;
    const end = match.index + match[0].length - trailing;
    if (end > start) output.push({ start, end });
  }
  return output.length > 0 ? output : [{ start: 0, end: semanticBrief.length }];
}

export async function buildSourceEvidenceIndex(input: {
  brief: string;
  references: readonly z.input<typeof SemanticReferenceDescriptorSchema>[];
  roleConstraints: readonly { referenceId: string; roles: readonly ("structure" | "motif")[] }[];
}): Promise<{
  semanticBrief: string;
  sourceEvidenceIndex: SourceEvidenceIndexV1;
  parsedConstraints: ExplicitSizingConstraintV1[];
  parserFindings: SizingParserFindingV1[];
}> {
  const brief = normalizeBrief(input.brief);
  const extracted = exactLiterals(brief);
  const { semanticBrief, markerRanges } = semanticBriefFrom(brief, extracted);
  const spanInputs = spanRanges(semanticBrief);
  const spans = await Promise.all(spanInputs.map(async (span, index) => {
    const markerTargets = markerRanges
      .filter((marker) => overlaps(marker, span))
      .map((marker) => marker.target);
    const semanticDigest = await sha256(semanticBrief.slice(span.start, span.end));
    return EvidenceSpanV1Schema.parse({
      evidenceId: `brief-${String(index + 1)}-${semanticDigest.slice(0, 16)}`,
      kind: "brief-span",
      start: span.start,
      end: span.end,
      semanticDigest,
      markerTargets
    });
  }));
  const references = input.references.map((candidate, index) => {
    const reference = SemanticReferenceDescriptorSchema.parse(candidate);
    const roles = input.roleConstraints.find((item) => item.referenceId === reference.referenceId)?.roles ?? [];
    return EvidenceReferenceV1Schema.parse({
      evidenceId: `reference-${String(index + 1)}-${reference.sha256.slice(0, 16)}`,
      kind: "reference",
      referenceId: reference.referenceId,
      referenceIndex: index,
      contentDigest: reference.sha256,
      declaredRoles: (["structure", "motif"] as const).filter((role) => roles.includes(role))
    });
  });
  const parsedConstraints = markerRanges.map((marker, index) => {
    const span = spans.find((candidate) => overlaps(candidate, marker));
    if (span === undefined) throw new Error("SOURCE_EVIDENCE_MARKER_SPAN_MISSING");
    return ExplicitSizingConstraintV1Schema.parse({
      constraintId: `brief-${targetKey(marker.target).replaceAll(".", "-")}-${String(index + 1)}`,
      source: "brief",
      target: marker.target,
      valueUm: marker.valueUm,
      sourceEvidenceId: span.evidenceId,
      markerStart: marker.start,
      markerEnd: marker.end,
      status: "active",
      findingCode: null
    });
  });
  const measurementLinks = parsedConstraints.map((constraint) => MeasurementEvidenceLinkV1Schema.parse({
    constraintId: constraint.constraintId,
    evidenceId: constraint.sourceEvidenceId,
    target: constraint.target,
    markerStart: constraint.markerStart,
    markerEnd: constraint.markerEnd
  }));
  const semanticBriefDigest = await sha256(semanticBrief);
  const indexWithoutDigest = {
    schemaVersion: "1.0" as const,
    semanticBriefDigest,
    spans,
    references,
    measurementLinks
  };
  return {
    semanticBrief,
    sourceEvidenceIndex: SourceEvidenceIndexV1Schema.parse({
      ...indexWithoutDigest,
      digest: await hashCanonical(indexWithoutDigest)
    }),
    parsedConstraints,
    parserFindings: ignoredFindings(brief, extracted)
  };
}

export function authorizedEvidenceIds(index: SourceEvidenceIndexV1): Set<string> {
  const parsed = SourceEvidenceIndexV1Schema.parse(index);
  return new Set([
    ...parsed.spans.map((item) => item.evidenceId),
    ...parsed.references.map((item) => item.evidenceId)
  ]);
}
