import { describe, expect, it } from "vitest";

import {
  INTENT_GRAPH_V1_JSON_SCHEMA,
  IntentGraphV1Schema
} from "../../src/interpretation/intent-graph.js";

function asRecord(candidate: unknown): Record<string, unknown> {
  expect(candidate).not.toBeNull();
  expect(typeof candidate).toBe("object");
  expect(Array.isArray(candidate)).toBe(false);
  return candidate as Record<string, unknown>;
}

function verifyProviderSubset(candidate: unknown): void {
  if (Array.isArray(candidate)) {
    candidate.forEach((item) => verifyProviderSubset(item));
    return;
  }
  if (typeof candidate !== "object" || candidate === null) return;
  const node = candidate as Record<string, unknown>;
  expect(node).not.toHaveProperty("$schema");
  expect(node).not.toHaveProperty("allOf");
  expect(node).not.toHaveProperty("not");
  expect(Array.isArray(node.items)).toBe(false);
  if (node.type === "object") {
    expect(node.additionalProperties).toBe(false);
    const properties = Object.keys(asRecord(node.properties)).sort();
    const required = [...(node.required as string[])].sort();
    expect(required).toEqual(properties);
  }
  Object.values(node).forEach((value) => verifyProviderSubset(value));
}

describe("IntentGraphV1 provider output schema", () => {
  it("uses only closed required objects and homogeneous array items", () => {
    verifyProviderSubset(INTENT_GRAPH_V1_JSON_SCHEMA);
  });

  it("represents the two-body interface tuple with exact homogeneous bounds", () => {
    const root = asRecord(INTENT_GRAPH_V1_JSON_SCHEMA);
    const topology = asRecord(asRecord(root.properties).topology);
    const interfaces = asRecord(asRecord(topology.properties).interfaces);
    const interfaceItem = asRecord(interfaces.items);
    const between = asRecord(asRecord(interfaceItem.properties).between);
    expect(between).toMatchObject({
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "string" }
    });
    expect(IntentGraphV1Schema.shape.topology.shape.interfaces.element.shape.between.safeParse([
      "body-a",
      "body-b"
    ]).success).toBe(true);
    expect(IntentGraphV1Schema.shape.topology.shape.interfaces.element.shape.between.safeParse([
      "body-a"
    ]).success).toBe(false);
  });
});
