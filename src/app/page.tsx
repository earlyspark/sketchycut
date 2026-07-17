import type { Metadata } from "next";
import { ROOT_TEASER } from "./root-teaser";

export const metadata: Metadata = {
  title: "SketchyCut — from an idea to matching cut pieces",
  description: "Turn a plywood project idea into matching cut pieces, a 3D assembly, and step-by-step build guidance."
};

export default function Page() {
  return (
    <main className="landing-page">
      <header className="landing-hero">
        <p className="eyebrow">SketchyCut</p>
        <h1>See the build before you cut.</h1>
        <p className="landing-lede">
          Start with an idea. SketchyCut turns it into matching plywood parts,
          an inspectable assembly, and clear build guidance.
        </p>
        <a className="primary-link" href="/examples">Explore the examples</a>
      </header>

      <figure className="root-teaser" data-asset-sha256={ROOT_TEASER.assetSha256}>
        <img
          src={ROOT_TEASER.path}
          width={ROOT_TEASER.width}
          height={ROOT_TEASER.height}
          alt="An assembled glue-free open-top plywood box beside the matching nested cut-sheet parts."
        />
        <figcaption>
          One canonical project, shown as an assembled object and its matching cut sheet.
          <span>fabrication candidate · physical verification required</span>
        </figcaption>
      </figure>

      <section className="landing-summary" aria-labelledby="landing-summary-title">
        <p className="section-kicker">One source, linked views</p>
        <h2 id="landing-summary-title">Inspect the object, parts, and sequence together.</h2>
        <p>
          The editable examples connect exact cut geometry to the 3D assembly,
          part marks, instructions, validation, and xTool Studio handoff.
        </p>
      </section>

      <footer className="landing-footer">
        <span>SketchyCut</span>
        <span>Judge workspace</span>
      </footer>
    </main>
  );
}
