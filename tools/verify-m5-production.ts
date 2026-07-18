import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const nextRoot = path.join(repositoryRoot, ".next");

const TeaserManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  generator: z.object({ id: z.literal("m5-root-teaser"), version: z.literal("1.0.0") }).strict(),
  fixture: z.object({
    sourceId: z.string().min(1),
    presetId: z.string().min(1),
    canonicalGeometryHash: z.string().regex(/^[0-9a-f]{64}$/),
    sourceDocumentHash: z.string().regex(/^[0-9a-f]{64}$/),
    sheetId: z.string().min(1),
    sheetSvgSha256: z.string().regex(/^[0-9a-f]{64}$/)
  }).strict(),
  asset: z.object({
    path: z.literal("/m5/root-teaser.svg"),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.literal(1600),
    height: z.literal(900)
  }).strict(),
  runtimeApplicationApiCalls: z.literal(0),
  physicalVerification: z.literal("required")
}).strict();

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function collectFiles(directory: string): Promise<string[]> {
  if (!(await pathExists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(candidate) : [candidate];
  }))).flat().sort();
}

const manifest = TeaserManifestSchema.parse(JSON.parse(await readFile(
  path.join(repositoryRoot, "public/m5/root-teaser-manifest.json"),
  "utf8",
)) as unknown);
const teaserBytes = await readFile(path.join(repositoryRoot, "public", manifest.asset.path.slice(1)));
if (createHash("sha256").update(teaserBytes).digest("hex") !== manifest.asset.sha256) {
  throw new Error("M5PROD001_ROOT_TEASER_HASH_MISMATCH");
}
const rootTeaserSource = await readFile(path.join(repositoryRoot, "src/app/root-teaser.ts"), "utf8");
if (!rootTeaserSource.includes(manifest.asset.sha256) ||
    !rootTeaserSource.includes(manifest.fixture.sourceDocumentHash)) {
  throw new Error("M5PROD002_ROOT_TEASER_PIN_MISMATCH");
}

const routeManifest = JSON.parse(await readFile(
  path.join(nextRoot, "app-path-routes-manifest.json"),
  "utf8",
)) as Record<string, string>;
const routes = new Set(Object.values(routeManifest));
for (const route of [
  "/",
  "/examples",
  "/create",
  "/api/session",
  "/api/create/upload",
  "/api/create/generate",
  "/api/create/project",
  "/api/create/export"
]) {
  if (!routes.has(route)) throw new Error(`M5PROD003_REQUIRED_ROUTE_MISSING: ${route}`);
}
if ([...routes].some((route) => route === "/__sketchycut/generate")) {
  throw new Error("M5PROD004_DEVELOPMENT_SIDECAR_ROUTE_IN_PRODUCTION");
}

const rootClientManifestSource = await readFile(
  path.join(nextRoot, "server/app/page_client-reference-manifest.js"),
  "utf8",
);
const assignment = 'globalThis.__RSC_MANIFEST["/page"]=';
const assignmentIndex = rootClientManifestSource.indexOf(assignment);
if (assignmentIndex < 0) throw new Error("M5PROD005_ROOT_CLIENT_MANIFEST_MISSING");
const rootClientManifest = JSON.parse(
  rootClientManifestSource.slice(assignmentIndex + assignment.length).replace(/;\s*$/, ""),
) as { clientModules: Record<string, { chunks: string[] }> };
const rootClientModules = Object.entries(rootClientManifest.clientModules)
  .filter(([modulePath]) => modulePath.startsWith(repositoryRoot) && !modulePath.endsWith("globals.css"))
  .filter(([, value]) => value.chunks.length > 0);
if (rootClientModules.length > 0) {
  throw new Error(`M5PROD006_ROOT_CLIENT_CHUNKS_PRESENT: ${rootClientModules.map(([item]) => item).join(", ")}`);
}

const rootBundleFiles = [
  path.join(nextRoot, "server/app/page.js"),
  ...(await collectFiles(path.join(nextRoot, "static/chunks/app"))).filter((candidate) =>
    path.dirname(candidate) === path.join(nextRoot, "static/chunks/app") &&
    /^page-[^/]+\.js$/.test(path.basename(candidate)),
  )
];
for (const file of rootBundleFiles) {
  const source = await readFile(file, "utf8");
  for (const token of [
    "guided-examples-controller",
    "canonical-project-workspace",
    "compile.worker",
    "@react-three",
    "three.module",
    "OPENAI_API_KEY",
    "__sketchycut/generate"
  ]) {
    if (source.includes(token)) {
      throw new Error(`M5PROD007_ROOT_BUNDLE_FORBIDDEN_TOKEN: ${path.relative(repositoryRoot, file)} contains ${token}`);
    }
  }
}

const publicClientFiles = (await collectFiles(path.join(nextRoot, "static")))
  .filter((candidate) => /\.(?:js|json|html|map)$/.test(candidate));
for (const file of publicClientFiles) {
  const source = await readFile(file, "utf8");
  for (const token of [
    "OPENAI_API_KEY",
    "SKETCHYCUT_ACCESS_CODE_SHA256",
    "SKETCHYCUT_SESSION_SIGNING_SECRET",
    "UPSTASH_REDIS_REST_TOKEN",
    "sketchycut_KV_REST_API_TOKEN",
    "SKETCHYCUT_INTERPRETATION_PROMPT",
    "node_modules/openai/",
    "openai/resources/"
  ]) {
    if (source.includes(token)) {
      throw new Error(`M5PROD008_CLIENT_SECRET_OR_ADAPTER_TOKEN: ${path.relative(repositoryRoot, file)} contains ${token}`);
    }
  }
}

const sourceFiles = (await collectFiles(path.join(repositoryRoot, "src")))
  .filter((candidate) => /\.(?:ts|tsx|js|jsx)$/.test(candidate));
const apiKeyReaders: string[] = [];
const sdkImporters: string[] = [];
for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  const relative = path.relative(repositoryRoot, file);
  if (source.includes(".env.local")) {
    throw new Error(`M5PROD009_PRODUCTION_SOURCE_ENV_FILE_READER: ${relative}`);
  }
  if (source.includes("OPENAI_API_KEY")) apiKeyReaders.push(relative);
  if (/from ["']openai["']/.test(source)) sdkImporters.push(relative);
}
if (JSON.stringify(apiKeyReaders) !== JSON.stringify(["src/server/m6/config.ts"])) {
  throw new Error(`M5PROD010_API_KEY_READER_SCOPE_CHANGED: ${apiKeyReaders.join(",")}`);
}
if (JSON.stringify(sdkImporters) !== JSON.stringify(["src/server/m6/openai-transport.ts"])) {
  throw new Error(`M5PROD011_SDK_IMPORT_SCOPE_CHANGED: ${sdkImporters.join(",")}`);
}

const packageDocument = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
if (packageDocument.dependencies?.openai !== "6.48.0" ||
    packageDocument.devDependencies?.openai !== undefined) {
  throw new Error("M5PROD012_M6_SERVER_SDK_PIN_INVALID");
}

process.stdout.write(
  `Verified preserved M5 static-root and teaser invariants after the intentional M6 production-route migration; client output contains no server secret or live-adapter tokens.\n`,
);
