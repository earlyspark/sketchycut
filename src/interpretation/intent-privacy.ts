import { IntentGraphV1Schema, type IntentGraphV1 } from "./intent-graph.js";

const SEMANTIC_TEXT_PROPERTIES = new Set([
  "title",
  "coreIntent",
  "statement",
  "function",
  "vocabulary",
  "unresolvedNeeds"
]);

function replacementFor(rawBrief: string): string {
  const primary = "The maker request was interpreted into this semantic structure.";
  return rawBrief === primary ? "Semantic maker intent." : primary;
}

function transformSemanticText(
  value: unknown,
  property: string | null,
  rawBrief: string,
): unknown {
  if (typeof value === "string") {
    if (property === null || !SEMANTIC_TEXT_PROPERTIES.has(property)) return value;
    return value.includes(rawBrief)
      ? value.replaceAll(rawBrief, replacementFor(rawBrief))
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => transformSemanticText(item, property, rawBrief));
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      transformSemanticText(item, key, rawBrief)
    ]),
  );
}

function stringValues(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) stringValues(item, output);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const item of Object.values(value)) stringValues(item, output);
}

export function intentContainsRawBrief(intent: IntentGraphV1, rawBrief: string): boolean {
  const values: string[] = [];
  stringValues(intent, values);
  return values.some((value) => value.includes(rawBrief));
}

export function removeRawBriefCopiesFromIntent(
  intentCandidate: unknown,
  rawBrief: string,
): IntentGraphV1 {
  const intent = IntentGraphV1Schema.parse(intentCandidate);
  const sanitized = IntentGraphV1Schema.parse(
    transformSemanticText(intent, null, rawBrief),
  );
  if (intentContainsRawBrief(sanitized, rawBrief)) {
    throw new Error("SEMANTIC_INTENT_RAW_BRIEF_PRESENT");
  }
  return sanitized;
}

export function assertIntentExcludesRawBrief(
  intentCandidate: unknown,
  rawBrief: string,
): asserts intentCandidate is IntentGraphV1 {
  const intent = IntentGraphV1Schema.parse(intentCandidate);
  if (intentContainsRawBrief(intent, rawBrief)) {
    throw new Error("SEMANTIC_INTENT_RAW_BRIEF_PRESENT");
  }
}
