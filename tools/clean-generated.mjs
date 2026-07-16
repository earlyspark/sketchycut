import { rm } from "node:fs/promises";

for (const path of ["dist", "artifacts/m1"]) {
  await rm(path, { force: true, recursive: true });
}
