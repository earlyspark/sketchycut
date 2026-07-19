import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageDocument = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8")) as {
  lockfileVersion: number;
  packages: Record<string, { version?: string; license?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
};
if (lock.lockfileVersion !== 3) throw new Error("DEPENDENCY001_LOCKFILE_VERSION");
const rootLock = lock.packages[""];
if (rootLock === undefined) throw new Error("DEPENDENCY002_LOCK_ROOT_MISSING");
const expectedRuntime = [
  "@react-three/drei", "@react-three/fiber", "@upstash/redis", "clipper2-ts",
  "earcut", "fflate", "next", "openai", "react", "react-dom", "sharp", "three", "zod"
].sort();
const expectedDevelopment = [
  "@eslint/js", "@playwright/test", "@types/node", "@types/react", "@types/react-dom",
  "@types/three", "@xmldom/xmldom", "eslint", "tsx", "typescript", "typescript-eslint", "vitest"
].sort();
if (JSON.stringify(Object.keys(packageDocument.dependencies).sort()) !== JSON.stringify(expectedRuntime) ||
    JSON.stringify(Object.keys(packageDocument.devDependencies).sort()) !== JSON.stringify(expectedDevelopment)) {
  throw new Error("DEPENDENCY003_UNREVIEWED_DIRECT_DEPENDENCY_SET");
}
const allowedLicenses = new Set(["Apache-2.0", "BSL-1.0", "ISC", "MIT"]);
for (const [dependencyClass, dependencies] of [
  ["dependencies", packageDocument.dependencies],
  ["devDependencies", packageDocument.devDependencies]
] as const) {
  const lockedRootDependencies = rootLock[dependencyClass] ?? {};
  for (const [name, pin] of Object.entries(dependencies)) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pin)) {
      throw new Error(`DEPENDENCY004_NON_EXACT_PIN:${name}`);
    }
    if (lockedRootDependencies[name] !== pin) throw new Error(`DEPENDENCY005_ROOT_LOCK_DRIFT:${name}`);
    const installed = lock.packages[`node_modules/${name}`];
    if (installed?.version !== pin) throw new Error(`DEPENDENCY006_PACKAGE_LOCK_DRIFT:${name}`);
    if (installed.license === undefined || !allowedLicenses.has(installed.license)) {
      throw new Error(`DEPENDENCY007_UNREVIEWED_DIRECT_LICENSE:${name}`);
    }
  }
}
if (packageDocument.devDependencies.esbuild !== undefined || rootLock.devDependencies?.esbuild !== undefined) {
  throw new Error("DEPENDENCY008_DEAD_DIRECT_ESBUILD_PRESENT");
}
const reviewedTransitiveLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 AND LGPL-3.0-or-later",
  "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "MPL-2.0"
]);
let reviewedPackageCount = 0;
for (const [packagePath, installed] of Object.entries(lock.packages)) {
  if (packagePath.length === 0 || installed.version === undefined) continue;
  reviewedPackageCount += 1;
  if (installed.license !== undefined && reviewedTransitiveLicenses.has(installed.license)) continue;
  if (packagePath === "node_modules/webgl-constants" && installed.version === "1.1.1") {
    const license = await readFile(path.join(root, packagePath, "LICENSE"));
    const digest = createHash("sha256").update(license).digest("hex");
    if (digest === "0969fa65680b694452c2c65981df14af5c192da24f2b1f87bdd51d8ed24efcfa") continue;
  }
  throw new Error(`DEPENDENCY009_UNREVIEWED_TRANSITIVE_LICENSE:${packagePath}`);
}
process.stdout.write(`Verified ${String(Object.keys(packageDocument.dependencies).length)} runtime and ${String(Object.keys(packageDocument.devDependencies).length)} development exact pins, ${String(reviewedPackageCount)} installed lock entries, the reviewed direct set, and direct/transitive licenses.\n`);
