import type { Metadata } from "next";

import { GuidedExamplesController } from "../../ui/components/guided-examples-controller";
import { SiteShell } from "../../ui/components/site-shell";

export const metadata: Metadata = {
  title: "Pre-made example · SketchyCut",
  description: "Explore three deterministic glue-free plywood construction previews; fabrication downloads appear only for the current physically retained release."
};

export default function ExamplesPage() {
  return (
    <SiteShell active="examples">
      <GuidedExamplesController />
    </SiteShell>
  );
}
