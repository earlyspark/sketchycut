import React from "react";
import { createRoot } from "react-dom/client";

import "../src/app/globals.css";
import { GeneratedProjectController } from "../src/ui/components/generated-project-controller.js";

const root = document.getElementById("m5-create-root");
if (root === null) throw new Error("M5_CREATE_ROOT_MISSING");
const generationExperience = document.querySelector(
  'meta[name="sketchycut-generation-experience"]',
)?.getAttribute("content") === "replay-fixture" ? "replay-fixture" : "live";

createRoot(root).render(
  <React.StrictMode>
    <GeneratedProjectController generationExperience={generationExperience} />
  </React.StrictMode>,
);
