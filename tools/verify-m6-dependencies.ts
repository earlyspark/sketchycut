import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const DependencyReviewSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M6"),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dependencies: z.array(z.object({
    package: z.enum(["@upstash/redis", "sharp", "fflate", "openai"]),
    version: z.string().min(1),
    dependencyClass: z.literal("dependency"),
    license: z.enum(["Apache-2.0", "MIT"]),
    role: z.string().min(1),
    licenseEvaluation: z.string().min(1),
    numericalCorrectnessEvaluation: z.string().min(1),
    browserServerEvaluation: z.string().min(1),
    determinismEvaluation: z.string().min(1),
    maintainabilityEvaluation: z.string().min(1),
    productionBoundary: z.string().min(1)
  }).strict()).length(4),
  decision: z.literal("accepted-for-m6-server-boundary-with-live-upstash-preview-pending")
}).strict();

const [packageDocument, lockDocument, review] = await Promise.all([
  readFile(path.join(repositoryRoot, "package.json"), "utf8").then((source) => JSON.parse(source) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }),
  readFile(path.join(repositoryRoot, "package-lock.json"), "utf8").then((source) => JSON.parse(source) as {
    packages: Record<string, { version?: string; license?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
  }),
  readFile(
    path.join(repositoryRoot, "docs/evidence/m06/reports/dependency-review.json"),
    "utf8",
  ).then((source) => DependencyReviewSchema.parse(JSON.parse(source) as unknown))
]);

const seen = new Set<string>();
const rootLock = lockDocument.packages[""];
if (rootLock === undefined) throw new Error("M6DEP000_LOCK_ROOT_MISSING");
for (const item of review.dependencies) {
  if (seen.has(item.package)) throw new Error(`M6DEP001_DUPLICATE_REVIEW: ${item.package}`);
  seen.add(item.package);
  if (packageDocument.dependencies?.[item.package] !== item.version ||
      packageDocument.devDependencies?.[item.package] !== undefined ||
      rootLock.dependencies?.[item.package] !== item.version ||
      rootLock.devDependencies?.[item.package] !== undefined) {
    throw new Error(`M6DEP002_EXACT_PRODUCTION_PIN_CHANGED: ${item.package}`);
  }
  const installed = lockDocument.packages[`node_modules/${item.package}`];
  if (installed?.version !== item.version || installed.license !== item.license) {
    throw new Error(`M6DEP003_LOCK_LICENSE_OR_VERSION_CHANGED: ${item.package}`);
  }
}

process.stdout.write(
  "Verified exact M6 server dependency pins, installed licenses, runtime placement, deterministic roles, and recorded maintenance evaluation.\n",
);
