import { readFile } from "node:fs/promises";

import {
  BomProjectionSchema,
  DesignDocumentV1Schema,
  ProjectionBundleSchema,
  SceneProjectionSchema,
  SheetProjectionSchema,
  ValidationReportSchema
} from "../src/domain/contracts.js";

const outputDirectoryUrl = new URL("../artifacts/m1/", import.meta.url);

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, outputDirectoryUrl), "utf8")) as unknown;
}

const document = DesignDocumentV1Schema.parse(await readJson("project.json"));
const bundle = ProjectionBundleSchema.parse(await readJson("projection-bundle.json"));
const sheet = SheetProjectionSchema.parse(await readJson("sheet.json"));
const scene = SceneProjectionSchema.parse(await readJson("scene.json"));
const bom = BomProjectionSchema.parse(await readJson("bom.json"));
const validation = (await readJson("validation.json")) as {
  canonical?: unknown;
  sheet?: unknown;
};
ValidationReportSchema.parse(validation.canonical);
ValidationReportSchema.parse(validation.sheet);

const golden = (await readJson("golden-matrix.json")) as {
  schemaVersion?: unknown;
  cases?: unknown[];
};
if (golden.schemaVersion !== "1.0" || golden.cases?.length !== 9) {
  throw new Error("M1 golden matrix must contain exactly nine schema-version 1.0 cases.");
}
if (
  document.projectId !== "m1-coupon-t3000-k150" ||
  bundle.fabrication.sheets[0]?.id !== sheet.id ||
  scene.sourceDocumentHash !== bundle.sourceDocumentHash ||
  bom.sourceDocumentHash !== bundle.sourceDocumentHash
) {
  throw new Error("M1 JSON projections do not resolve to the representative canonical project.");
}

process.stdout.write("Validated canonical M1 project, projection, report, and golden JSON.\n");
