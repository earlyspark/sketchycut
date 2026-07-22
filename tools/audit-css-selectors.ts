import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(candidate) : [candidate];
  }))).flat();
}

const css = await readFile(path.join(root, "src/app/globals.css"), "utf8");
const sourceFiles = (await filesUnder(path.join(root, "src")))
  .filter((file) => /\.(?:ts|tsx)$/.test(file));
const source = (await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")))).join("\n");
const selectors = [...new Set(
  [...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]!),
)].sort();
const dynamicSelectorAllowlist = [
  "operation-cut",
  "operation-engrave",
  "operation-score",
  "sketchycut-shell-authenticated"
];
const unused = selectors.filter((selector) =>
  !source.includes(selector) && !dynamicSelectorAllowlist.includes(selector)
);
process.stdout.write(`${JSON.stringify({
  schemaVersion: "1.0",
  cssBytes: Buffer.byteLength(css),
  selectorCount: selectors.length,
  sourceFileCount: sourceFiles.length,
  dynamicSelectorAllowlist,
  unused
}, null, 2)}\n`);
if (unused.length > 0) throw new Error("CSS_UNREACHABLE_SELECTOR_PRESENT");
