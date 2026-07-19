"use client";

import dynamic from "next/dynamic";

import type { LandingStaticManifest } from "../../landing/static-manifest-contract";

const LazyInteractiveDemo = dynamic(
  () => import("./landing-interactive-demo").then((module) => module.LandingInteractiveDemo),
  { ssr: false, loading: () => null },
);

export function LandingDemo({ manifest }: { manifest: LandingStaticManifest }) {
  return (
    <section
      className="landing-demo"
      aria-label="Interactive canonical assembly and matching cut sheet"
      data-source-document-hash={manifest.sourceDocumentHash}
      data-sheet-hash={manifest.sheetHash}
    >
      <div className="landing-demo-fallback" data-testid="landing-static-fallback">
        <figure>
          <img
            src={manifest.assembledScene.path}
            alt="Assembled canonical Basic construction"
            width="1000"
            height="700"
          />
        </figure>
        <figure>
          <img
            src={manifest.sheet.path}
            alt="Matching canonical Basic fabrication sheet"
          />
        </figure>
      </div>
      <LazyInteractiveDemo />
    </section>
  );
}
