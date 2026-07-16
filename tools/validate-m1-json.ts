import { readFile } from "node:fs/promises";

import {
  BomProjectionSchema,
  DesignDocumentV1Schema,
  InputPolicyEvaluationSchema,
  OrthogonalPanelProgramV1Schema,
  ProjectionBundleSchema,
  SceneProjectionSchema,
  SheetProjectionSchema,
  ValidationReportSchema
} from "../src/domain/contracts.js";

const outputDirectoryUrl = new URL("../artifacts/m1/", import.meta.url);
const m2OutputDirectoryUrl = new URL("../artifacts/m2/", import.meta.url);
const m21OutputDirectoryUrl = new URL("../artifacts/m2.1/", import.meta.url);

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, outputDirectoryUrl), "utf8")) as unknown;
}

async function readM2Json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, m2OutputDirectoryUrl), "utf8")) as unknown;
}

async function readM21Json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, m21OutputDirectoryUrl), "utf8")) as unknown;
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

OrthogonalPanelProgramV1Schema.parse(await readM2Json("primary/program.json"));
const m2Primary = DesignDocumentV1Schema.parse(await readM2Json("primary/project.json"));
const m2PrimaryBundle = ProjectionBundleSchema.parse(await readM2Json("primary/projection-bundle.json"));
OrthogonalPanelProgramV1Schema.parse(await readM2Json("forced-multi-sheet/program.json"));
const m2Forced = DesignDocumentV1Schema.parse(await readM2Json("forced-multi-sheet/project.json"));
const m2ForcedBundle = ProjectionBundleSchema.parse(
  await readM2Json("forced-multi-sheet/projection-bundle.json"),
);
const m2Validation = (await readM2Json("validation.json")) as {
  primary?: { canonical?: unknown; fabrication?: unknown };
  forcedMultiSheet?: { canonical?: unknown; fabrication?: unknown };
};
ValidationReportSchema.parse(m2Validation.primary?.canonical);
ValidationReportSchema.parse(m2Validation.primary?.fabrication);
ValidationReportSchema.parse(m2Validation.forcedMultiSheet?.canonical);
ValidationReportSchema.parse(m2Validation.forcedMultiSheet?.fabrication);
const m2Golden = (await readM2Json("golden-matrix.json")) as {
  schemaVersion?: unknown;
  milestone?: unknown;
  cases?: unknown[];
};
if (
  m2Golden.schemaVersion !== "1.0" ||
  m2Golden.milestone !== "M2" ||
  m2Golden.cases?.length !== 9
) {
  throw new Error("Historical M2 golden matrix must contain exactly nine schema-version 1.0 cases.");
}
if (
  m2Primary.validation.status !== "pass" ||
  m2PrimaryBundle.sourceDocumentHash !== m2PrimaryBundle.scene.sourceDocumentHash ||
  m2Forced.validation.status !== "pass" ||
  m2ForcedBundle.fabrication.sheets.length < 2
) {
  throw new Error("M2 JSON projections do not satisfy the canonical and forced-sheet proof gates.");
}

const m21Product = DesignDocumentV1Schema.parse(await readM21Json("product/project.json"));
const m21ProductBundle = ProjectionBundleSchema.parse(
  await readM21Json("product/projection-bundle.json"),
);
const m21Gauge = DesignDocumentV1Schema.parse(await readM21Json("gauge/project.json"));
const m21GaugeBundle = ProjectionBundleSchema.parse(
  await readM21Json("gauge/projection-bundle.json"),
);
const m21Golden = (await readM21Json("golden-matrix.json")) as {
  schemaVersion?: unknown;
  milestone?: unknown;
  cases?: unknown[];
};
const m21Boundaries = (await readM21Json("input-policy-boundaries.json")) as {
  exactLowBoundary?: unknown;
  exactHighBoundary?: unknown;
  justOutside?: unknown;
  highVariation?: unknown;
};
for (const evaluation of [
  m21Boundaries.exactLowBoundary,
  m21Boundaries.exactHighBoundary,
  m21Boundaries.justOutside,
  m21Boundaries.highVariation
]) {
  InputPolicyEvaluationSchema.parse(evaluation);
}
if (
  m21Golden.schemaVersion !== "1.0" ||
  m21Golden.milestone !== "M2.1" ||
  m21Golden.cases?.length !== 15 ||
  m21Product.provenance.inputPolicyEvaluation?.status !== "pass" ||
  m21Gauge.calibrationMeasurements?.[0]?.pieceCount !== 10 ||
  m21GaugeBundle.scene.meshes.length !== 10 ||
  m21ProductBundle.sourceDocumentHash !== m21ProductBundle.scene.sourceDocumentHash
) {
  throw new Error("M2.1 JSON does not satisfy measured-input, gauge, and linked-projection gates.");
}

process.stdout.write(
  "Validated canonical M1, M2, and M2.1 projects, projections, reports, and golden JSON.\n",
);
