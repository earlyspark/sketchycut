import type { Metadata } from "next";

import { SiteShell } from "../../ui/components/site-shell";

export const metadata: Metadata = {
  title: "About · SketchyCut",
  description: "How SketchyCut connects semantic interpretation to deterministic laser-cut construction geometry."
};

export default function AboutPage() {
  return (
    <SiteShell active="about">
      <main className="about-page">
        <h1>About SketchyCut</h1>
        <div className="about-copy">
          <p>
            SketchyCut turns a three-dimensional idea and 1–3 reference images into a
            laser-cut construction project when the requested construction is supported.
          </p>
          <p>
            The OpenAI model interprets semantic intent. Deterministic SketchyCut code owns
            dimensions, joint math, cut paths, assembly order, validation, and SVG export.
          </p>
          <p>
            SketchyCut supplies the missing middle between a maker&apos;s vision and buildable
            vectors.
          </p>
          <p>
            The <a href="https://github.com/earlyspark/sketchycut" target="_blank" rel="noopener noreferrer">project by @earlyspark</a> was
            built for <a href="https://openai.com/build-week/" target="_blank" rel="noopener noreferrer">OpenAI Build Week 2026</a>.
            Software-only fabrication results remain subject to deterministic validation and
            the recorded physical-evidence boundary.
          </p>
        </div>
      </main>
    </SiteShell>
  );
}
