import { z } from "zod";

import { Sha256Schema } from "../domain/digests.js";
import { StableIdSchema } from "../domain/primitives.js";
import { hashCanonical } from "../domain/hash.js";

export const SIZING_FIXED_POINT_UM = 10 as const;

export const SizingAxisSchema = z.enum(["width", "depth", "height"]);
export const SizingTargetSchema = z.discriminatedUnion("subject", [
  z.object({ subject: z.literal("project"), envelope: z.enum(["external", "internal"]), axis: SizingAxisSchema }).strict(),
  z.object({ subject: z.literal("contained-object"), objectId: StableIdSchema, axis: SizingAxisSchema }).strict()
]);

const OptionalExactAxesSchema = z.object({
  widthMm: z.number().positive().max(1_000).optional(),
  depthMm: z.number().positive().max(1_000).optional(),
  heightMm: z.number().positive().max(1_000).optional()
}).strict().superRefine((value, context) => {
  if (value.widthMm === undefined && value.depthMm === undefined && value.heightMm === undefined) {
    context.addIssue({ code: "custom", message: "At least one exact sizing axis is required." });
  }
  for (const [axis, measurement] of Object.entries(value)) {
    if (measurement !== undefined && Math.round(measurement * 1_000) % SIZING_FIXED_POINT_UM !== 0) {
      context.addIssue({ code: "custom", path: [axis], message: "Exact sizing values must use the registered 0.01 mm increment." });
    }
  }
});

export const AdvancedSizingInputV1Schema = z.discriminatedUnion("basis", [
  z.object({ basis: z.literal("auto") }).strict(),
  z.object({ basis: z.literal("exact-external"), dimensions: OptionalExactAxesSchema }).strict(),
  z.object({ basis: z.literal("exact-internal"), dimensions: OptionalExactAxesSchema }).strict()
]);

export const ExplicitSizingConstraintV1Schema = z.object({
  constraintId: StableIdSchema,
  source: z.enum(["advanced", "brief"]),
  target: SizingTargetSchema,
  valueUm: z.number().int().positive(),
  sourceEvidenceId: StableIdSchema.nullable(),
  markerStart: z.number().int().nonnegative().nullable(),
  markerEnd: z.number().int().nonnegative().nullable(),
  status: z.enum(["active", "overridden", "unused"]),
  findingCode: z.enum([
    "PARSED_MEASUREMENT_OVERRIDDEN",
    "SIZING_OBJECT_TARGET_UNRESOLVED"
  ]).nullable()
}).strict().superRefine((value, context) => {
  if (value.valueUm % SIZING_FIXED_POINT_UM !== 0) {
    context.addIssue({ code: "custom", path: ["valueUm"], message: "Sizing constraints must be quantized to 0.01 mm." });
  }
  if (value.source === "advanced" && (value.sourceEvidenceId !== null || value.markerStart !== null || value.markerEnd !== null)) {
    context.addIssue({ code: "custom", message: "Advanced constraints do not cite brief markers." });
  }
  if (value.source === "brief" && (value.sourceEvidenceId === null || value.markerStart === null || value.markerEnd === null)) {
    context.addIssue({ code: "custom", message: "Brief constraints require evidence and marker offsets." });
  }
});

export const SizingParserFindingV1Schema = z.object({
  code: z.enum([
    "PARSED_MEASUREMENT_OVERRIDDEN",
    "SIZING_MEASUREMENT_IGNORED",
    "SIZING_MEASUREMENT_AMBIGUOUS"
  ]),
  blocking: z.boolean(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  target: SizingTargetSchema.nullable(),
  reason: z.enum(["approximate", "range", "ambiguous-target", "unsupported-form"])
}).strict();

export const ExplicitSizingConstraintsV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  constraints: z.array(ExplicitSizingConstraintV1Schema),
  findings: z.array(SizingParserFindingV1Schema),
  digest: Sha256Schema
}).strict();

export type AdvancedSizingInputV1 = z.infer<typeof AdvancedSizingInputV1Schema>;
export type SizingTarget = z.infer<typeof SizingTargetSchema>;
export type ExplicitSizingConstraintV1 = z.infer<typeof ExplicitSizingConstraintV1Schema>;
export type SizingParserFindingV1 = z.infer<typeof SizingParserFindingV1Schema>;
export type ExplicitSizingConstraintsV1 = z.infer<typeof ExplicitSizingConstraintsV1Schema>;

export function targetKey(target: SizingTarget): string {
  return target.subject === "project"
    ? `project.${target.envelope}.${target.axis}`
    : `contained.${target.objectId}.${target.axis}`;
}

function advancedConstraints(input: AdvancedSizingInputV1): ExplicitSizingConstraintV1[] {
  if (input.basis === "auto") return [];
  const envelope = input.basis === "exact-external" ? "external" : "internal";
  return (["width", "depth", "height"] as const).flatMap((axis) => {
    const valueMm = input.dimensions[`${axis}Mm`];
    if (valueMm === undefined) return [];
    return [ExplicitSizingConstraintV1Schema.parse({
      constraintId: `advanced-project-${envelope}-${axis}`,
      source: "advanced",
      target: { subject: "project", envelope, axis },
      valueUm: Math.round(valueMm * 1_000),
      sourceEvidenceId: null,
      markerStart: null,
      markerEnd: null,
      status: "active",
      findingCode: null
    })];
  });
}

export async function reconcileExplicitSizingConstraints(input: {
  advancedSizing: unknown;
  parsedConstraints: readonly ExplicitSizingConstraintV1[];
  parserFindings: readonly SizingParserFindingV1[];
}): Promise<ExplicitSizingConstraintsV1> {
  const advanced = advancedConstraints(AdvancedSizingInputV1Schema.parse(input.advancedSizing));
  const advancedTargets = new Set(advanced.map((constraint) => targetKey(constraint.target)));
  const parsed = input.parsedConstraints.map((constraint) => {
    if (!advancedTargets.has(targetKey(constraint.target))) return constraint;
    return ExplicitSizingConstraintV1Schema.parse({
      ...constraint,
      status: "overridden",
      findingCode: "PARSED_MEASUREMENT_OVERRIDDEN"
    });
  });
  const overrideFindings = parsed.flatMap((constraint) => constraint.status === "overridden"
    ? [SizingParserFindingV1Schema.parse({
        code: "PARSED_MEASUREMENT_OVERRIDDEN",
        blocking: false,
        start: constraint.markerStart,
        end: constraint.markerEnd,
        target: constraint.target,
        reason: "unsupported-form"
      })]
    : []);
  const constraints = [...advanced, ...parsed];
  const findings = [
    ...input.parserFindings.map((finding) => SizingParserFindingV1Schema.parse(finding)),
    ...overrideFindings
  ];
  return ExplicitSizingConstraintsV1Schema.parse({
    schemaVersion: "1.0",
    constraints,
    findings,
    digest: await hashCanonical({ schemaVersion: "1.0", constraints, findings })
  });
}
