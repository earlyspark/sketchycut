import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const nextRoot = path.join(repositoryRoot, ".next");

const TeaserManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    generator: z.object({ id: z.literal("m5-root-teaser"), version: z.literal("1.0.0") }).strict(),
    fixture: z
      .object({
        sourceId: z.string().min(1),
        presetId: z.string().min(1),
        canonicalGeometryHash: z.string().regex(/^[0-9a-f]{64}$/),
        sourceDocumentHash: z.string().regex(/^[0-9a-f]{64}$/),
        sheetId: z.string().min(1),
        sheetSvgSha256: z.string().regex(/^[0-9a-f]{64}$/)
      })
      .strict(),
    asset: z
      .object({
        path: z.literal("/m5/root-teaser.svg"),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        width: z.literal(1600),
        height: z.literal(900)
      })
      .strict(),
    runtimeApplicationApiCalls: z.literal(0),
    physicalVerification: z.literal("required")
  })
  .strict();

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
  const groups = await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(candidate) : [candidate];
  }));
  return groups.flat().sort();
}

function digest(contents: string | Uint8Array): string {
  return createHash("sha256").update(contents).digest("hex");
}

const manifest = TeaserManifestSchema.parse(JSON.parse(await readFile(
  path.join(repositoryRoot, "public/m5/root-teaser-manifest.json"),
  "utf8",
)) as unknown);
const teaserBytes = await readFile(
  path.join(repositoryRoot, "public", manifest.asset.path.slice(1)),
);
if (digest(teaserBytes) !== manifest.asset.sha256) {
  throw new Error("M5PROD001_ROOT_TEASER_HASH_MISMATCH");
}
const rootTeaserSource = await readFile(path.join(repositoryRoot, "src/app/root-teaser.ts"), "utf8");
if (
  !rootTeaserSource.includes(manifest.asset.sha256) ||
  !rootTeaserSource.includes(manifest.fixture.sourceDocumentHash)
) {
  throw new Error("M5PROD002_ROOT_TEASER_PIN_MISMATCH");
}

const routeManifest = JSON.parse(await readFile(
  path.join(nextRoot, "app-path-routes-manifest.json"),
  "utf8",
)) as Record<string, string>;
if (routeManifest["/page"] !== "/" || routeManifest["/examples/page"] !== "/examples") {
  throw new Error("M5PROD003_REQUIRED_ROUTE_MISSING");
}
for (const route of Object.values(routeManifest)) {
  if (route === "/create" || /generate|interpret/i.test(route)) {
    throw new Error(`M5PROD004_PRODUCTION_GENERATION_ROUTE_PRESENT: ${route}`);
  }
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
const reachableRepositoryClientModules = Object.entries(rootClientManifest.clientModules)
  .filter(([modulePath]) => modulePath.startsWith(repositoryRoot) && !modulePath.endsWith("globals.css"))
  .filter(([, value]) => value.chunks.length > 0);
if (reachableRepositoryClientModules.length > 0) {
  throw new Error(
    `M5PROD006_ROOT_CLIENT_CHUNKS_PRESENT: ${reachableRepositoryClientModules.map(([modulePath]) => modulePath).join(", ")}`,
  );
}

const rootBundleFiles = [
  path.join(nextRoot, "server/app/page.js"),
  ...(await collectFiles(path.join(nextRoot, "static/chunks/app"))).filter((candidate) =>
    path.dirname(candidate) === path.join(nextRoot, "static/chunks/app") &&
    /^page-[^/]+\.js$/.test(path.basename(candidate)),
  )
];
const rootForbiddenTokens = [
  "guided-examples-controller",
  "canonical-project-workspace",
  "compile.worker",
  "@react-three",
  "three.module",
  "OPENAI_API_KEY",
  "__sketchycut/generate"
];
for (const file of rootBundleFiles) {
  const source = await readFile(file, "utf8");
  for (const token of rootForbiddenTokens) {
    if (source.includes(token)) {
      throw new Error(`M5PROD007_ROOT_BUNDLE_FORBIDDEN_TOKEN: ${path.relative(repositoryRoot, file)} contains ${token}`);
    }
  }
}

const productionFiles = [
  ...(await collectFiles(path.join(nextRoot, "server"))),
  ...(await collectFiles(path.join(nextRoot, "static")))
].filter((candidate) => /\.(?:js|json|html|rsc)$/.test(candidate));
const productionForbiddenTokens = [
  "OPENAI_API_KEY",
  "sketchycut-live-openai-adapter",
  "__sketchycut/generate",
  "node_modules/openai/",
  "openai/resources/"
];
for (const file of productionFiles) {
  const source = await readFile(file, "utf8");
  for (const token of productionForbiddenTokens) {
    if (source.includes(token)) {
      throw new Error(`M5PROD008_PRODUCTION_FORBIDDEN_TOKEN: ${path.relative(repositoryRoot, file)} contains ${token}`);
    }
  }
}

const sourceFiles = await collectFiles(path.join(repositoryRoot, "src"));
for (const file of sourceFiles.filter((candidate) => /\.(?:ts|tsx|js|jsx)$/.test(candidate))) {
  const source = await readFile(file, "utf8");
  for (const token of [
    "OPENAI_API_KEY",
    ".env.local",
    "sketchycut-live-openai-adapter",
    'from "openai"',
    "from 'openai'"
  ]) {
    if (source.includes(token)) {
      throw new Error(
        `M5PROD009_PRODUCTION_SOURCE_LIVE_TOKEN: ${path.relative(repositoryRoot, file)} contains ${token}`,
      );
    }
  }
}
for (const forbiddenPath of [
  path.join(repositoryRoot, "src/app/create"),
  path.join(repositoryRoot, "src/app/api")
]) {
  if (await pathExists(forbiddenPath)) {
    throw new Error(
      `M5PROD010_PRODUCTION_GENERATION_SOURCE_PRESENT: ${path.relative(repositoryRoot, forbiddenPath)}`,
    );
  }
}

const packageDocument = JSON.parse(await readFile(
  path.join(repositoryRoot, "package.json"),
  "utf8",
)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
if (
  packageDocument.dependencies?.openai !== undefined ||
  packageDocument.devDependencies?.openai === undefined
) {
  throw new Error("M5PROD011_OPENAI_SDK_MUST_BE_TOOLS_ONLY_DEV_DEPENDENCY");
}

process.stdout.write(
  `Verified M5 production closure, tools-only SDK placement, static root client isolation, and teaser ${manifest.asset.sha256} pinned to ${manifest.fixture.sourceDocumentHash}.\n`,
);
