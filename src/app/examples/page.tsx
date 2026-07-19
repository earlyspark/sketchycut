import type { Metadata } from "next";

import { GuidedExamplesController } from "../../ui/components/guided-examples-controller";
import { SiteShell } from "../../ui/components/site-shell";

export const metadata: Metadata = {
  title: "Pre-made example · SketchyCut",
  description: "Explore three supported glue-free plywood constructions from matching 3D preview through fabrication handoff."
};

export default function ExamplesPage() {
  return (
    <SiteShell active="examples">
      <GuidedExamplesController />
    </SiteShell>
  );
}
