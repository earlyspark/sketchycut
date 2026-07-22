import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { stableJson } from "../src/domain/hash.js";
import { DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2, GenerationSubmissionV2Schema } from "../src/interpretation/generation-submission-v2.js";
import { renderSceneSvg } from "../src/projections/mesh/render-svg.js";
import type { RuntimeConfig } from "../src/server/generation/config.js";
import { executeCurrentGeneration } from "../src/server/generation/generation-service-v2.js";
import { MemoryGenerationStore } from "../src/server/generation/memory-store.js";
import { buildFabricationPackage } from "../src/server/generation/package-builder.js";
import { readCurrentPersistedProject } from "../src/server/generation/project-persistence-v2.js";
import { DEFAULT_GENERATED_FABRICATION_CONTROLS } from "../src/ui/content/generated-setup.js";

const destination = "artifacts/m7-2";
const brief = "Make a static flameless tea-light lantern with a circular top opening and repeated lattice walls.";
const config: RuntimeConfig = {
  security: { accessCodeDigest: Buffer.alloc(32), signingSecret: Buffer.alloc(32), secureCookies: false },
  storeMode: "memory",
  upstash: null,
  generationEnabled: true,
  quotaUnlimited: false,
  generationMode: "fixture",
  generationExperience: "fixture",
  liveTransport: null
};

async function main(): Promise<void> {
  const store = new MemoryGenerationStore();
  const response = await executeCurrentGeneration({
    config,
    authenticated: {
      session: {
        schemaVersion: "1.0",
        sessionId: "m7-2-software-candidate",
        issuedAtMs: 1,
        expiresAtMs: Number.MAX_SAFE_INTEGER,
        generationDispatches: 0,
        reservedExposureMicrousd: 0,
        lastDispatchAtMs: null,
        lastProjectId: null
      },
      clientIdentifier: "m7-2-software-candidate"
    },
    store,
    runtimeOrigin: "test-recorded",
    submission: GenerationSubmissionV2Schema.parse({
      schemaVersion: "2.0",
      brief,
      references: [],
      roleConstraints: [],
      deterministicControls: DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
      fabricationControls: DEFAULT_GENERATED_FABRICATION_CONTROLS,
      retry: null
    })
  });
  if (response.project === null || response.compiled === null || !response.outcome.exportAllowed) {
    throw new Error(`M7_2_CANDIDATE_NOT_EXPORTABLE:${response.outcome.kind}`);
  }
  const persistedProject = await readCurrentPersistedProject({
    store,
    ownerSessionId: "m7-2-software-candidate",
    projectId: response.project.projectId
  });
  const artifactPackage = await buildFabricationPackage({
    ...persistedProject,
    projectId: "project-m7-2-software-candidate",
    ownerSessionId: "m7-2-software-candidate",
    createdAtMs: 0,
    updatedAtMs: 0
  });
  const compiled = response.compiled;
  await mkdir(destination, { recursive: true });
  await Promise.all([
    writeFile(join(destination, "lantern-candidate.zip"), artifactPackage.bytes),
    writeFile(join(destination, "product-sheet.svg"), compiled.svgs[0]!.svg, "utf8"),
    writeFile(join(destination, "assembled.svg"), renderSceneSvg(compiled.bundle.scene, "assembled", 900, 640, "isometric"), "utf8"),
    writeFile(join(destination, "exploded.svg"), renderSceneSvg(compiled.bundle.scene, "exploded", 900, 640, "isometric"), "utf8"),
    writeFile(join(destination, "top.svg"), renderSceneSvg(compiled.bundle.scene, "assembled", 900, 640, "top"), "utf8"),
    writeFile(join(destination, "canonical-project.json"), `${stableJson(compiled.document)}\n`, "utf8")
  ]);
  await writeFile(join(destination, "README.md"), [
    "# M7.2 lantern software candidate",
    "",
    "This is the exact M8 carry-forward candidate. It is software-validated only.",
    "xTool Studio import, framing, cutting, handling, bridge survival, and assembly are unperformed.",
    "Use only a non-heating light source. No heat, combustion, or thermal-safety claim is made.",
    "",
    `Source document: ${compiled.bundle.sourceDocumentHash}`,
    `Geometry: ${compiled.geometryHash}`,
    `Package: ${artifactPackage.sha256}`,
    ""
  ].join("\n"), "utf8");
}

await main();
