import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { M6_POLICY } from "../src/server/m6/policy.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const nextRoot = path.join(repositoryRoot, ".next");

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function filesUnder(directory: string): Promise<string[]> {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(candidate) : [candidate];
  }))).flat().sort();
}

const routeManifest = JSON.parse(await readFile(
  path.join(nextRoot, "app-path-routes-manifest.json"),
  "utf8",
)) as Record<string, string>;
const routes = new Set(Object.values(routeManifest));
for (const required of [
  "/",
  "/examples",
  "/create",
  "/api/session",
  "/api/create/upload",
  "/api/create/generate",
  "/api/create/project",
  "/api/create/export"
]) {
  if (!routes.has(required)) throw new Error(`M6PROD001_ROUTE_MISSING: ${required}`);
}
if (routes.has("/__sketchycut/generate")) {
  throw new Error("M6PROD002_DEVELOPMENT_GENERATION_ROUTE_PRESENT");
}

const nextConfig = await readFile(path.join(repositoryRoot, "next.config.ts"), "utf8");
for (const header of [
  "Content-Security-Policy",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "connect-src 'self'"
]) {
  if (!nextConfig.includes(header)) throw new Error(`M6PROD003_SECURITY_HEADER_MISSING: ${header}`);
}

const routeAuthorizers: Record<string, readonly string[]> = {
  "src/app/api/create/upload/route.ts": ["authorizeM6Route(request, \"upload\")"],
  "src/app/api/create/generate/route.ts": ["authorizeM6Route(request, \"generation\")"],
  "src/app/api/create/project/route.ts": [
    "authorizeM6Route(request, \"project\")"
  ],
  "src/app/api/create/export/route.ts": ["authorizeM6Route(request, \"export\")"]
};
for (const [relative, tokens] of Object.entries(routeAuthorizers)) {
  const source = await readFile(path.join(repositoryRoot, relative), "utf8");
  if (!source.includes('export const runtime = "nodejs"')) {
    throw new Error(`M6PROD004_NODE_RUNTIME_MISSING: ${relative}`);
  }
  for (const token of tokens) {
    if (!source.includes(token)) throw new Error(`M6PROD005_ROUTE_AUTHORIZATION_MISSING: ${relative}`);
  }
}

const configSource = await readFile(path.join(repositoryRoot, "src/server/m6/config.ts"), "utf8");
for (const token of [
  "M6_CONFIG_MEMORY_STORE_FORBIDDEN_IN_PRODUCTION",
  "SKETCHYCUT_GENERATION_ENABLED",
  "SKETCHYCUT_GENERATION_MODE",
  "OPENAI_API_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "sketchycut_KV_REST_API_URL",
  "sketchycut_KV_REST_API_TOKEN"
]) {
  if (!configSource.includes(token)) throw new Error(`M6PROD006_CLOSED_CONFIG_CONTRACT_MISSING: ${token}`);
}

function verifyPayloadEnvelope(image: {
  maximumUploadRequestBytes: number;
  maximumGenerationRequestBytes: number;
  maximumNormalizedBytes: number;
  maximumReferences: number;
}): void {
  const maximumBase64Bytes = image.maximumReferences *
    4 * Math.ceil(image.maximumNormalizedBytes / 3);
  if (image.maximumUploadRequestBytes >= 4_500_000 ||
      image.maximumGenerationRequestBytes >= 4_500_000 ||
      maximumBase64Bytes + 100_000 >= image.maximumGenerationRequestBytes) {
    throw new Error("M6PROD014_VERCEL_PAYLOAD_ENVELOPE_EXCEEDED");
  }
}
verifyPayloadEnvelope(M6_POLICY.image);
const controllerSource = await readFile(
  path.join(repositoryRoot, "src/ui/components/generated-project-controller.tsx"),
  "utf8",
);
if (!controllerSource.includes("const normalized = await normalizeReferenceFiles") ||
    !controllerSource.includes("body: item.normalizedBlob")) {
  throw new Error("M6PROD015_CLIENT_UPLOAD_NORMALIZATION_MISSING");
}

const transportSource = await readFile(
  path.join(repositoryRoot, "src/server/m6/openai-transport.ts"),
  "utf8",
);
for (const token of [
  'M6_OPENAI_MODEL = "gpt-5.6-terra"',
  "M6_OPENAI_MAX_RETRIES = 0",
  "maxRetries: M6_OPENAI_MAX_RETRIES",
  'reasoning: { effort: "low" }',
  'service_tier: "default"',
  "store: false",
  "strict: true"
]) {
  if (!transportSource.includes(token)) throw new Error(`M6PROD007_MODEL_CONFIGURATION_DRIFT: ${token}`);
}
if ((transportSource.match(/\.responses\.create\(/g) ?? []).length !== 1) {
  throw new Error("M6PROD008_TRANSPORT_DISPATCH_SITE_COUNT_CHANGED");
}

const projectPersistence = await readFile(
  path.join(repositoryRoot, "src/server/m6/project-persistence.ts"),
  "utf8",
);
if (!projectPersistence.includes("compileGeneratedProjectFromSemantic") ||
    !projectPersistence.includes("compareAndSetValue")) {
  throw new Error("M6PROD009_RECOMPILE_OR_CAS_BOUNDARY_MISSING");
}
const packageBuilder = await readFile(
  path.join(repositoryRoot, "src/server/m6/package-builder.ts"),
  "utf8",
);
for (const token of [
  "recompilePersistedProject",
  "M6_PACKAGE_PROJECT_REVALIDATION_MISMATCH",
  "M6_PACKAGE_FABRICATION_VALIDATION_FAILED",
  "M6_PACKAGE_IMPORT_COMPLEXITY_BUDGET_EXCEEDED",
  "off / 0.00 mm"
]) {
  if (!packageBuilder.includes(token)) throw new Error(`M6PROD010_EXPORT_GATE_MISSING: ${token}`);
}

const rootSource = await readFile(path.join(repositoryRoot, "src/app/page.tsx"), "utf8");
if ((rootSource.match(/Judge workspace/g) ?? []).length !== 1 ||
    !rootSource.includes('action="/api/session"')) {
  throw new Error("M6PROD011_DISCREET_ENTRY_CONTRACT_CHANGED");
}
const publicMetadataSources = await Promise.all([
  readFile(path.join(repositoryRoot, "src/app/page.tsx"), "utf8"),
  readFile(path.join(repositoryRoot, "src/app/examples/page.tsx"), "utf8"),
  readFile(path.join(repositoryRoot, "src/app/create/page.tsx"), "utf8")
]);
for (const source of publicMetadataSources) {
  const metadataBlock = /export const metadata:[\s\S]*?\n};/.exec(source)?.[0] ?? "";
  if (/password|protected|unlock|access required/i.test(metadataBlock)) {
    throw new Error("M6PROD012_ACCESS_ADVERTISING_IN_METADATA");
  }
}

const sourceMaps = (await filesUnder(path.join(nextRoot, "static")))
  .filter((candidate) => candidate.endsWith(".map"));
if (sourceMaps.length > 0) throw new Error("M6PROD013_PUBLIC_SOURCE_MAP_PRESENT");

process.stdout.write(
  "Verified M6 production routes, independent authorization, closed runtime configuration, one-shot Terra adapter, export revalidation, security headers, discreet metadata, and source-map closure.\n",
);
