import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { M6PackageManifestSchema } from "../src/server/m6/package-builder.js";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const RelativePathSchema = z.string().min(1).refine((value) =>
  !path.isAbsolute(value) && !value.split("/").includes(".."),
);

const GateSchema = z.object({
  id: z.string().regex(/^M6-[A-Z0-9-]+$/),
  expected: z.string().min(1),
  observed: z.string().min(1),
  status: z.enum(["pass", "fail", "not-applicable"]),
  evidence: z.array(RelativePathSchema)
}).strict();

const AcceptanceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6"),
  status: z.enum(["pending-deployment", "pass"]),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reviewer: z.string().min(1),
  summary: z.string().min(1),
  hosting: z.object({
    provider: z.literal("Vercel"),
    localProjectLinked: z.boolean(),
    deploymentPreview: z.enum(["not-performed", "pass"]),
    durableStore: z.object({
      provider: z.literal("Upstash Redis via Vercel Marketplace"),
      resourceConnection: z.enum(["builder-reported-connected", "verified-connected"]),
      environmentContract: z.string().min(1),
      namespace: z.literal("sketchycut:m6:v1"),
      liveConformance: z.enum(["pending-deployed-flow", "pass"])
    }).strict()
  }).strict(),
  gates: z.array(GateSchema).length(19),
  commands: z.array(z.object({
    command: z.string().min(1),
    result: z.enum(["pass", "fail"]),
    detail: z.string().min(1).optional()
  }).strict()).min(15),
  hashes: z.object({
    sourceDocument: HashSchema,
    geometry: HashSchema,
    package: HashSchema,
    artifactManifest: HashSchema
  }).strict(),
  apiUsage: z.object({
    runtimeApplicationApiCalls: z.number().int().min(0).max(1),
    networkDispatches: z.number().int().min(0).max(1),
    reportedTokens: z.number().int().nonnegative().nullable(),
    confirmedEstimatedCostUsd: z.number().nonnegative(),
    unresolvedPotentialExposureUsd: z.number().nonnegative(),
    liveLedgerEntriesAdded: z.number().int().min(0)
  }).strict(),
  physicalVerification: z.object({
    requiredForM6: z.literal(false),
    performed: z.literal(false),
    state: z.literal("fabrication-candidate-physical-verification-required-before-physical-claims")
  }).strict(),
  limitations: z.array(z.string().min(1)).min(3)
}).strict();

const ManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6"),
  status: z.enum(["pending-deployment", "pass"]),
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/),
  dirtyWorktreeFingerprint: HashSchema.nullable(),
  sourceDocumentHash: HashSchema,
  geometryHash: HashSchema,
  packageSha256: HashSchema,
  runtimeApplicationApiCalls: z.number().int().min(0).max(1),
  estimatedCostUsd: z.number().nonnegative(),
  unresolvedPotentialExposureUsd: z.number().nonnegative(),
  deploymentStatus: z.enum(["not-performed", "pass"]),
  physicalVerification: z.literal("required-not-performed"),
  entries: z.array(z.object({ path: RelativePathSchema, sha256: HashSchema }).strict()).min(20),
  pendingEntries: z.array(RelativePathSchema)
}).strict();

const VisualSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6"),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  captureCommand: z.literal("npm run capture:m6"),
  runtime: z.string().min(1),
  viewports: z.array(z.object({
    name: z.enum(["desktop", "mobile"]),
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive()
  }).strict()).length(2),
  directInspection: z.object({
    result: z.literal("pass"),
    observations: z.array(z.string().min(1)).min(6),
    limitations: z.array(z.string().min(1)).min(2)
  }).strict(),
  files: z.array(z.object({
    path: RelativePathSchema,
    sha256: HashSchema,
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive()
  }).strict()).length(11)
}).strict();

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(relative: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(repositoryRoot, relative), "utf8")) as unknown;
}

async function verifyEntries(entries: readonly { path: string; sha256: string }[]): Promise<void> {
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw new Error("M6EVIDENCE001_DUPLICATE_MANIFEST_PATH");
  }
  for (const entry of entries) {
    const absolute = path.resolve(repositoryRoot, entry.path);
    if (!absolute.startsWith(repositoryRoot + path.sep)) {
      throw new Error(`M6EVIDENCE002_PATH_ESCAPE: ${entry.path}`);
    }
    if (sha256(await readFile(absolute)) !== entry.sha256) {
      throw new Error(`M6EVIDENCE003_HASH_MISMATCH: ${entry.path}`);
    }
  }
}

const [acceptance, manifest, visual, artifactManifest, packageManifest, milestone, buildLog] =
  await Promise.all([
    readJson("docs/evidence/m06/acceptance-report.json").then((value) => AcceptanceSchema.parse(value)),
    readJson("docs/evidence/m06/manifest.json").then((value) => ManifestSchema.parse(value)),
    readJson("docs/evidence/m06/reports/visual-review.json").then((value) => VisualSchema.parse(value)),
    readJson("artifacts/m6/artifact-manifest.json") as Promise<{
      sourceDocumentHash: string;
      geometryHash: string;
      packageSha256: string;
      runtimeApplicationApiCalls: number;
    }>,
    readJson("artifacts/m6/package-manifest.json").then((value) => M6PackageManifestSchema.parse(value)),
    readFile(path.join(repositoryRoot, "docs/MILESTONE_PLAN.md"), "utf8"),
    readFile(path.join(repositoryRoot, "docs/HACKATHON_BUILD_LOG.md"), "utf8")
  ]);

await verifyEntries(manifest.entries);
await verifyEntries(visual.files.map((file) => ({
  path: `docs/evidence/m06/${file.path}`,
  sha256: file.sha256
})));

const expectedGateIds = [
  "M6-PUBLIC-ZERO-CALL",
  "M6-SESSION-BOUNDARY",
  "M6-INDEPENDENT-ROUTE-AUTH",
  "M6-RATE-QUOTA-KILL",
  "M6-BOUNDED-IMAGE-INPUT",
  "M6-ONE-SHOT-TERRA",
  "M6-DURABLE-MINIMALITY",
  "M6-CACHE-RECOMPILE",
  "M6-PROJECT-CAS-ZERO-CALL-EDIT",
  "M6-FAILURE-RETRY-PRESERVATION",
  "M6-EXPORT-WITHHOLDING",
  "M6-MULTI-SHEET-COMPLETE-PACKAGE",
  "M6-PACKAGE-INTEGRITY",
  "M6-PLAIN-SVG-COMPLEXITY",
  "M6-ACCESSIBILITY-RESPONSIVE-VISUAL",
  "M6-PRODUCTION-BUILD-PRIVACY-DEPS",
  "M6-DEPLOYMENT-PREVIEW",
  "M6-LIVE-VALID-ACCESS",
  "M6-PHYSICAL-PROOF"
];
if (acceptance.gates.map((gate) => gate.id).join("\n") !== expectedGateIds.join("\n")) {
  throw new Error("M6EVIDENCE004_GATE_SET_CHANGED");
}
if (acceptance.status !== manifest.status ||
    acceptance.hashes.sourceDocument !== manifest.sourceDocumentHash ||
    acceptance.hashes.geometry !== manifest.geometryHash ||
    acceptance.hashes.package !== manifest.packageSha256 ||
    acceptance.apiUsage.runtimeApplicationApiCalls !== manifest.runtimeApplicationApiCalls ||
    acceptance.apiUsage.confirmedEstimatedCostUsd !== manifest.estimatedCostUsd ||
    acceptance.apiUsage.unresolvedPotentialExposureUsd !== manifest.unresolvedPotentialExposureUsd) {
  throw new Error("M6EVIDENCE005_REPORT_MANIFEST_MISMATCH");
}
if (artifactManifest.sourceDocumentHash !== manifest.sourceDocumentHash ||
    artifactManifest.geometryHash !== manifest.geometryHash ||
    artifactManifest.packageSha256 !== manifest.packageSha256 ||
    artifactManifest.runtimeApplicationApiCalls !== 0 ||
    packageManifest.sourceDocumentHash !== manifest.sourceDocumentHash ||
    packageManifest.geometryHash !== manifest.geometryHash ||
    packageManifest.artifactGroups.map((group) => group.id).join(",") !==
      "product,material-fit-coupon,optional-cut-width-fit-test" ||
    packageManifest.artifactGroups[0]!.sheets.length < 2 ||
    packageManifest.files.length !== 22) {
  throw new Error("M6EVIDENCE006_PACKAGE_IDENTITY_OR_COMPLETENESS_CHANGED");
}

const failedGates = acceptance.gates.filter((gate) => gate.status === "fail").map((gate) => gate.id);
if (acceptance.status === "pending-deployment") {
  if (failedGates.join(",") !== "M6-DEPLOYMENT-PREVIEW,M6-LIVE-VALID-ACCESS" ||
      acceptance.hosting.localProjectLinked ||
      acceptance.hosting.deploymentPreview !== "not-performed" ||
      acceptance.hosting.durableStore.liveConformance !== "pending-deployed-flow" ||
      acceptance.apiUsage.runtimeApplicationApiCalls !== 0 ||
      acceptance.apiUsage.networkDispatches !== 0 ||
      acceptance.apiUsage.reportedTokens !== 0 ||
      manifest.dirtyWorktreeFingerprint !== null ||
      manifest.deploymentStatus !== "not-performed" ||
      manifest.pendingEntries.length !== 3 ||
      !milestone.includes("No completion claim is made yet.")) {
    throw new Error("M6EVIDENCE008_PENDING_STATE_INCONSISTENT");
  }
} else {
  if (failedGates.length !== 0 ||
      !acceptance.hosting.localProjectLinked ||
      acceptance.hosting.deploymentPreview !== "pass" ||
      acceptance.hosting.durableStore.resourceConnection !== "verified-connected" ||
      acceptance.hosting.durableStore.liveConformance !== "pass" ||
      acceptance.apiUsage.runtimeApplicationApiCalls !== 1 ||
      acceptance.apiUsage.networkDispatches !== 1 ||
      acceptance.apiUsage.reportedTokens === null ||
      acceptance.apiUsage.liveLedgerEntriesAdded < 1 ||
      manifest.dirtyWorktreeFingerprint === null ||
      manifest.deploymentStatus !== "pass" ||
      manifest.pendingEntries.length !== 0 ||
      !milestone.includes("Status: complete") ||
      !buildLog.includes("## M6 completion")) {
    throw new Error("M6EVIDENCE009_COMPLETION_STATE_INCONSISTENT");
  }
}

for (const evidencePath of acceptance.gates.flatMap((gate) => gate.evidence)) {
  const absolute = path.resolve(repositoryRoot, evidencePath);
  if (!absolute.startsWith(repositoryRoot + path.sep)) {
    throw new Error(`M6EVIDENCE010_GATE_PATH_ESCAPE: ${evidencePath}`);
  }
  await stat(absolute);
}
if (!buildLog.includes("## M6 local production gate") && !buildLog.includes("## M6 completion")) {
  throw new Error("M6EVIDENCE011_BUILD_LOG_ENTRY_MISSING");
}

process.stdout.write(
  `Verified M6 ${acceptance.status} evidence: 19 acceptance gates, ${String(manifest.entries.length)} hashed entries, 11 visual captures, complete three-group package identity, API/cost state, and documentation consistency.\n`,
);
