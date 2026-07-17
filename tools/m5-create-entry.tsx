import React from "react";
import { createRoot } from "react-dom/client";

import "../src/app/globals.css";
import { GeneratedProjectController } from "../src/ui/components/generated-project-controller.js";

const root = document.getElementById("m5-create-root");
if (root === null) throw new Error("M5_CREATE_ROOT_MISSING");

createRoot(root).render(
  <React.StrictMode>
    <GeneratedProjectController />
  </React.StrictMode>,
);
