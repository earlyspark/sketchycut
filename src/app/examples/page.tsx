import type { Metadata } from "next";

import { GuidedExamplesController } from "../../ui/components/guided-examples-controller";

export const metadata: Metadata = {
  title: "Guided fabrication examples — SketchyCut",
  description: "Explore matching 3D, cut-sheet, build, and fabrication views for three editable glue-free plywood constructions."
};

export default function ExamplesPage() {
  return <GuidedExamplesController />;
}
