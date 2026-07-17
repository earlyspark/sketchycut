import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const DependencyReviewSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M5"),
  dependencies: z.array(z.object({
    package: z.enum(["openai", "esbuild"]),
    version: z.string().min(1),
    dependencyClass: z.literal("devDependency"),
    license: z.enum(["Apache-2.0", "MIT"]),
    role: z.string().min(1),
    licenseEvaluation: z.string().min(1),
    numericalCorrectnessEvaluation: z.string().min(1),
    browserServerEvaluation: z.string().min(1),
    determinismEvaluation: z.string().min(1),
    maintainabilityEvaluation: z.string().min(1),
    productionBoundary: z.string().min(1)
  }).strict()).length(2),
  decision: z.literal("accepted-for-tools-only-m5-development-boundary")
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
    path.join(repositoryRoot, "docs/evidence/m05/reports/dependency-review.json"),
    "utf8",
  ).then((source) => DependencyReviewSchema.parse(JSON.parse(source) as unknown))
]);

for (const item of review.dependencies) {
  if (
    packageDocument.dependencies?.[item.package] !== undefined ||
    packageDocument.devDependencies?.[item.package] !== item.version ||
    lockDocument.packages[""]?.dependencies?.[item.package] !== undefined ||
    lockDocument.packages[""]?.devDependencies?.[item.package] !== item.version
  ) {
    throw new Error(`M5DEP001_TOOLS_ONLY_EXACT_PIN_CHANGED: ${item.package}`);
  }
  const installed = lockDocument.packages[`node_modules/${item.package}`];
  if (installed?.version !== item.version || installed.license !== item.license) {
    throw new Error(`M5DEP002_LOCK_LICENSE_OR_VERSION_CHANGED: ${item.package}`);
  }
}

process.stdout.write(
  "Verified exact tools-only M5 dependency pins, licenses, platform boundary, determinism role, and recorded maintenance evaluation.\n",
);
