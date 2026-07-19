import { readdir, rm } from "node:fs/promises";

const generatedRoots = [
  ".next",
  ".next-fixtures",
  "dist",
  "playwright-report",
  "test-results"
];

for (const candidate of generatedRoots) {
  await rm(candidate, { force: true, recursive: true });
}
for (const entry of await readdir(".", { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".tsbuildinfo")) {
    await rm(entry.name, { force: true });
  }
}
