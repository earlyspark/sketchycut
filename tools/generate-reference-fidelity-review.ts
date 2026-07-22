import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPublicFabricationSetup, createStarterPinSetup, resolveFabricationSetup } from "../src/domain/fabrication-setup.js";
import { renderSceneSvg, type SceneSvgView } from "../src/projections/mesh/render-svg.js";
import { AVAILABLE_GUIDED_EXAMPLES, buildGuidedProductCompileRequest } from "../src/ui/content/guided-examples.js";
import { compileProductRequest } from "../src/workers/compile-service.js";

type Corpus = {
  corpusId: string;
  references: { id: string; path: string; assertionCodes: string[] }[];
  cases: {
    id: string;
    partition: "comparison" | "heldout";
    brief: string;
    referenceIds: string[];
    expectedRelationships: string[];
    relationshipAcceptance: string[];
    expectedOutcome: string;
    outcomeAcceptance: string;
    predicateCodes: string[];
  }[];
};

const ROOT = "artifacts/m7-1";
const VIEWS = ["isometric", "opposed-isometric", "top", "front"] as const satisfies readonly SceneSvgView[];
const REFRESH_INDEX_ONLY = process.argv.slice(2).includes("--refresh-index-only");

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function compileScene(exampleIndex: 0 | 2) {
  const setup = resolveFabricationSetup(createPublicFabricationSetup());
  const profiles = {
    material: setup.material,
    machine: setup.machine,
    processRecipe: setup.processRecipe,
    fabricationContext: setup.fabricationContext,
    fit: setup.fit
  };
  return compileProductRequest(buildGuidedProductCompileRequest(AVAILABLE_GUIDED_EXAMPLES[exampleIndex]!, {
    requestId: `m7-1-review-${String(exampleIndex)}`,
    presetId: "medium",
    profiles,
    inputPolicyEvaluation: setup.inputPolicyEvaluation,
    retainedPin: createStarterPinSetup()
  }));
}

function sceneKind(candidate: Corpus["cases"][number]): "basic" | "sliding" {
  return candidate.referenceIds.includes("covered-box") || candidate.referenceIds.includes("sliding-cover")
    ? "sliding"
    : "basic";
}

async function main(): Promise<void> {
  const corpus = JSON.parse(await readFile("tests/fixtures/reference-fidelity/manifest.json", "utf8")) as Corpus;
  const [basic, sliding] = await Promise.all([compileScene(0), compileScene(2)]);
  if (!REFRESH_INDEX_ONLY) {
    await mkdir(join(ROOT, "views", "basic"), { recursive: true });
    await mkdir(join(ROOT, "views", "sliding"), { recursive: true });
    for (const [kind, result] of [["basic", basic], ["sliding", sliding]] as const) {
      for (const view of VIEWS) {
        await writeFile(
          join(ROOT, "views", kind, `${view}.svg`),
          renderSceneSvg(result.bundle.scene, "assembled", 800, 560, view),
          { encoding: "utf8", flag: "wx" },
        );
      }
    }
  }
  const referenceById = new Map(corpus.references.map((item) => [item.id, item]));
  const sections = corpus.cases.map((candidate) => {
    const kind = sceneKind(candidate);
    const references = candidate.referenceIds.length === 0
      ? '<div class="reference empty">Text-only control</div>'
      : candidate.referenceIds.map((id) => {
          const reference = referenceById.get(id)!;
          const relative = `../../${reference.path}`;
          return `<figure><img src="${escapeHtml(relative)}" alt="Synthetic ${escapeHtml(id)} reference"><figcaption>${escapeHtml(id)} · ${reference.assertionCodes.map(escapeHtml).join(", ")}</figcaption></figure>`;
        }).join("");
    const views = VIEWS.map((view) => `<figure><img src="views/${kind}/${view}.svg" alt="${escapeHtml(kind)} ${escapeHtml(view)} canonical view"><figcaption>${escapeHtml(view)}</figcaption></figure>`).join("");
    return `<section id="${escapeHtml(candidate.id)}">
      <header><div><span>${escapeHtml(candidate.partition)}</span><h2>${escapeHtml(candidate.id)}</h2></div><strong>${escapeHtml(candidate.expectedOutcome)} · ${escapeHtml(candidate.outcomeAcceptance)}</strong></header>
      <p>${escapeHtml(candidate.brief)}</p>
      <div class="comparison"><div><h3>Supplied reference</h3><div class="reference-grid">${references}</div></div><div><h3>Closest registered construction views</h3><div class="view-grid">${views}</div></div></div>
      <dl><dt>Relationships</dt><dd>${candidate.expectedRelationships.map((relationship, index) => `${escapeHtml(relationship)} (${escapeHtml(candidate.relationshipAcceptance[index]!)})`).join(", ") || "none"}</dd><dt>Typed assertions</dt><dd>${candidate.predicateCodes.map(escapeHtml).join(", ")}</dd><dt>Boundary</dt><dd>These views expose the closest registered deterministic construction. A deterministically safe simplification may satisfy only the declared truthfulness-aware acceptance mode; mandatory unsupported or uncertain gaps remain concept-only. They do not claim pixel similarity, unsupported ornament/aperture realization, or physical validation.</dd></dl>
    </section>`;
  }).join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>M7.1 reference-fidelity review</title><style>
    :root{color-scheme:dark;background:#091116;color:#e9f1f3;font:15px/1.45 system-ui,sans-serif}body{margin:0;padding:32px;max-width:1500px}h1{font-size:2rem}h2,h3{margin:.2rem 0}section{border:1px solid #31505a;background:#0d181e;padding:20px;margin:24px 0}header{display:flex;justify-content:space-between;gap:16px}header span,dt{color:#ff914d;text-transform:uppercase;letter-spacing:.09em;font-size:.75rem}.comparison{display:grid;grid-template-columns:minmax(240px,1fr) 3fr;gap:18px}.reference-grid,.view-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}figure{margin:0;background:#f7f3eb;color:#16242a;border:1px solid #31505a}img{display:block;width:100%;height:auto}figcaption{padding:7px;font-size:.75rem;overflow-wrap:anywhere}.empty{min-height:220px;display:grid;place-items:center;border:1px dashed #55717a;color:#a8bdc4}dl{display:grid;grid-template-columns:130px 1fr;gap:6px 12px}dd{margin:0}@media(max-width:850px){body{padding:14px}.comparison{grid-template-columns:1fr}.view-grid{grid-template-columns:1fr}}
  </style></head><body><h1>M7.1 reference-fidelity review packets</h1><p>Corpus ${escapeHtml(corpus.corpusId)}. Synthetic references are compared with shared canonical projections. Every visual concern is tied to the listed typed assertions or the explicit boundary.</p><p><strong>Review limitation:</strong> faint triangle seams in the static views are renderer artifacts, not canonical joints, score paths, or fabrication features. Shared Basic/Sliding views show the closest registered construction class rather than claiming a case-specific visual match.</p>${sections}</body></html>\n`;
  await writeFile(join(ROOT, "index.html"), html, {
    encoding: "utf8",
    flag: REFRESH_INDEX_ONLY ? "w" : "wx"
  });
}

await main();
