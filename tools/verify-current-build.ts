import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const nextRoot = path.join(root, ".next");

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(candidate) : [candidate];
  }))).flat().sort();
}
const routeManifest = JSON.parse(await readFile(path.join(nextRoot, "app-path-routes-manifest.json"), "utf8")) as Record<string, string>;
const routes = new Set(Object.values(routeManifest));
for (const required of ["/", "/examples", "/about", "/create", "/api/session", "/api/create/upload", "/api/create/generate", "/api/create/project", "/api/create/export"]) {
  if (!routes.has(required)) throw new Error(`BUILD001_ROUTE_MISSING:${required}`);
}
if ([...routes].some((route) => route.includes("__sketchycut"))) throw new Error("BUILD002_COMPATIBILITY_ROUTE_PRESENT");

// `next dev` keeps its isolated incremental output under `.next/dev`. Those
// bytes are neither production build output nor deployable client/server
// artifacts, and a concurrently running local preview may legitimately keep
// them present after `next build`. Production guards still inspect every
// other emitted path, including all `.next/server` and `.next/static` bytes.
const allNextFiles = (await filesUnder(nextRoot)).filter((file) =>
  path.relative(nextRoot, file).split(path.sep)[0] !== "dev"
);
for (const file of allNextFiles) {
  const outputPath = path.relative(nextRoot, file);
  const segments = outputPath.split(path.sep);
  if (segments.some((segment) => ["docs", "tools", "tests", "artifacts"].includes(segment))
    || segments.some((segment) => segment === ".env" || segment.startsWith(".env."))) {
    throw new Error(`BUILD003_PRIVATE_PATH_PRESENT:${outputPath}`);
  }
}
const sourceMapFile = allNextFiles.find((file) => file.endsWith(".map"));
if (sourceMapFile !== undefined) {
  throw new Error(`BUILD004_SOURCE_MAP_PRESENT:${path.relative(root, sourceMapFile)}`);
}
const emittedCodeFiles = allNextFiles.filter((file) => /\.(?:[cm]?js|css)$/.test(file));
for (const file of emittedCodeFiles) {
  const contents = await readFile(file, "utf8");
  if (/sourceMappingURL\s*=|["']sourcesContent["']\s*:/.test(contents)) {
    throw new Error(`BUILD004_INLINE_SOURCE_MAP_PRESENT:${path.relative(root, file)}`);
  }
}

const staticFiles = await filesUnder(path.join(nextRoot, "static"));
const clientFiles = staticFiles.filter((file) => /\.(?:js|css)$/.test(file));
const forbiddenClientSignatures = [
  { id: "OPENAI_API_KEY_ENV", pattern: /\bOPENAI_API_KEY\b/ },
  { id: "OPENAI_PROMPT_ENV", pattern: /\bSKETCHYCUT_INTERPRETATION_PROMPT\b/ },
  { id: "ACCESS_CODE_DIGEST_ENV", pattern: /\bSKETCHYCUT_ACCESS_CODE_SHA256\b/ },
  { id: "SESSION_SIGNING_SECRET_ENV", pattern: /\bSKETCHYCUT_SESSION_SIGNING_SECRET\b/ },
  { id: "UPSTASH_REST_URL_ENV", pattern: /\bUPSTASH_REDIS_REST_URL\b/ },
  { id: "UPSTASH_REST_TOKEN_ENV", pattern: /\bUPSTASH_REDIS_REST_TOKEN\b/ },
  { id: "VERCEL_KV_REST_TOKEN_ENV", pattern: /\b(?:sketchycut_)?KV_REST_API_TOKEN\b/ },
  { id: "PRIVATE_PROMPT_PATH", pattern: /docs\/runtime\/semantic-interpretation-prompt/ },
  { id: "FIXTURE_ACCESS_CODE", pattern: /sketchycut-fixture-access/ },
  { id: "OPENAI_API_HOST", pattern: /api\.openai\.com/ },
  { id: "OPENAI_RESPONSES_ENDPOINT", pattern: /(?:\/v1)?\/responses\b/ },
  { id: "OPENAI_AUTH_HEADER", pattern: /OpenAI-(?:Organization|Project|Beta)/ },
  { id: "OPENAI_SDK_HEADER", pattern: /x-stainless-(?:retry-count|timeout|package-version|arch|lang|os|runtime)/i },
  { id: "OPENAI_SDK_ERROR", pattern: /(?:OpenAIError|APIPromise)/ },
  { id: "OPENAI_BROWSER_ESCAPE_HATCH", pattern: /dangerouslyAllowBrowser/ },
  { id: "OPENAI_TRANSPORT_ADAPTER", pattern: /GenerationOpenAITransport/ },
  { id: "OPENAI_RETRY_POLICY", pattern: /GENERATION_OPENAI_MAX_RETRIES/ },
  { id: "OPENAI_PRICE_POLICY", pattern: /GENERATION_OPENAI_PRICE/ },
  { id: "SERVER_CONFIG_READER", pattern: /readRuntimeConfig/ },
  { id: "SERVER_UPSTASH_CONFIG_READER", pattern: /readUpstashConfig/ },
  { id: "SERVER_STORE_FACTORY", pattern: /createGenerationStore/ },
  { id: "SERVER_UPSTASH_ADAPTER", pattern: /UpstashGenerationStore/ },
  { id: "UPSTASH_CLIENT_LIBRARY", pattern: /(?:UpstashJSONParseError|\[Upstash Redis\])/ },
  { id: "SERVER_SESSION_HANDLER", pattern: /handleSessionRequest/ },
  { id: "SERVER_ACCESS_VERIFIER", pattern: /verifyAccessCodeConstantTime/ }
] as const;
for (const file of clientFiles) {
  const contents = await readFile(file, "utf8");
  for (const signature of forbiddenClientSignatures) {
    if (signature.pattern.test(contents)) {
      throw new Error(
        `BUILD005_CLIENT_SERVER_SIGNATURE:${path.relative(root, file)}:${signature.id}`,
      );
    }
  }
}

const rootHtml = await readFile(path.join(nextRoot, "server/app/index.html"), "utf8");
const initialScripts = [...rootHtml.matchAll(/<script[^>]+src="\/_next\/(static\/[^"?]+\.js)/g)]
  .map((match) => path.join(nextRoot, match[1]!));
if (initialScripts.length === 0) throw new Error("BUILD006_ROOT_INITIAL_SCRIPT_SET_EMPTY");
const initialClientBytes = (await Promise.all(initialScripts.map((file) => stat(file)))).reduce((sum, item) => sum + item.size, 0);
if (initialClientBytes > 592_345) throw new Error(`BUILD007_ROOT_INITIAL_BUDGET:${String(initialClientBytes)}`);
const initialSources = await Promise.all(initialScripts.map((file) => readFile(file, "utf8")));
for (const [index, contents] of initialSources.entries()) {
  if (/WebGLRenderer|@react-three|three\.module|REVISION:\s*["']185/.test(contents)) {
    throw new Error(`BUILD008_THREE_IN_INITIAL_ROOT:${path.relative(root, initialScripts[index]!)}`);
  }
}
if (initialSources.some((source) => source.includes("foundation-panel-mesh"))) {
  throw new Error("BUILD009_CANONICAL_PAYLOAD_IN_INITIAL_ROOT");
}
const javascriptChunks = staticFiles.filter((file) => file.endsWith(".js"));
const lazyThreeChunks: { file: string; bytes: number }[] = [];
for (const file of javascriptChunks) {
  if (initialScripts.includes(file)) continue;
  const contents = await readFile(file, "utf8");
  if (/WebGLRenderer|REVISION:\s*["']185|three\.module/.test(contents)) {
    lazyThreeChunks.push({ file, bytes: (await stat(file)).size });
  }
}
if (lazyThreeChunks.length === 0) throw new Error("BUILD010_LAZY_THREE_CHUNK_MISSING");

const rootServerEntry = path.join(nextRoot, "server/app/page.js");
const rootServerSource = await readFile(rootServerEntry, "utf8");
const rootServerChunkIds = /\.X\(0,\[([\d,]+)\]/.exec(rootServerSource)?.[1]
  ?.split(",").filter(Boolean) ?? [];
const rootServerFiles = [
  rootServerEntry,
  ...rootServerChunkIds.map((id) => path.join(nextRoot, "server/chunks", `${id}.js`))
];
const rootServerBytes = (await Promise.all(rootServerFiles.map((file) => stat(file))))
  .reduce((sum, item) => sum + item.size, 0);
if (rootServerBytes > 601_384) throw new Error(`BUILD011_ROOT_SERVER_BUDGET:${String(rootServerBytes)}`);
const rootServerSources = await Promise.all(rootServerFiles.map((file) => readFile(file, "utf8")));
for (const token of ["OPENAI_API_KEY", "@react-three/fiber", "compileGeneratedProjectFromSemantic", "CanonicalProjectWorkspace", "api/create/generate"]) {
  if (rootServerSources.some((source) => source.includes(token))) {
    throw new Error(`BUILD012_ROOT_SERVER_BOUNDARY:${token}`);
  }
}
const cssFiles = staticFiles.filter((file) => file.endsWith(".css"));
const cssBytes = (await Promise.all(cssFiles.map((file) => stat(file)))).reduce((sum, item) => sum + item.size, 0);
const rootSsrBytes = (await stat(path.join(nextRoot, "server/app/index.html"))).size;
const rootRscBytes = (await stat(path.join(nextRoot, "server/app/index.rsc"))).size;
process.stdout.write(`${JSON.stringify({
  routes: routes.size,
  initialClientBytes,
  rootSsrBytes,
  rootRscBytes,
  rootServerBundleBytes: rootServerBytes,
  rootServerFiles: rootServerFiles.map((file) => path.relative(root, file)),
  lazyThreeChunks: lazyThreeChunks.map((item) => ({ path: path.relative(root, item.file), bytes: item.bytes })),
  cssBytes
})}\n`);
