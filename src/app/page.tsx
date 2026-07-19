import type { Metadata } from "next";

import landingStaticManifest from "../landing/basic-demo-static-manifest.json";
import { readLandingStaticManifest } from "../landing/static-manifest-contract";
import { LandingDemo } from "../ui/components/landing-demo";
import { SiteShell } from "../ui/components/site-shell";

export const metadata: Metadata = {
  title: "From idea to laser-cut 3D construction · SketchyCut",
  description: "Describe a supported three-dimensional construction, inspect its matching assembly and sheet, and prepare the SVG for laser cutting."
};

export default function Page() {
  const manifest = readLandingStaticManifest(landingStaticManifest);
  return (
    <SiteShell active="home">
      <main className="landing-page">
        <header className="landing-hero">
          <h1>From idea to laser-cut 3D construction</h1>
          <p className="landing-lede">
            Describe your 3-dimensional idea and provide 1–3 images to SketchyCut. For
            supported constructions, it will provide an SVG pattern that you can inspect and
            prepare for laser cutting, then piece together into a 3D structure; unsupported
            ideas remain concept-only.
          </p>
        </header>

        <LandingDemo manifest={manifest} />

        <p className="landing-vision">
          You have the vision but you don&apos;t know how to draw the vectors. SketchyCut provides
          the part in the middle: the joint math, the cut file, and the assembly instructions.
          Now you can just... build things.
        </p>

        <p className="landing-examples-link">
          <a className="primary-link" href="/examples">See the example</a>
        </p>
      </main>
    </SiteShell>
  );
}
