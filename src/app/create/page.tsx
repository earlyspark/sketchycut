import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { GeneratedProjectController } from "../../ui/components/generated-project-controller";
import { SiteShell } from "../../ui/components/site-shell";
import {
  sessionCookieName,
  verifySessionToken
} from "../../server/generation/access";
import { readRuntimeConfig } from "../../server/generation/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create a project · SketchyCut",
  description: "Interpret a prompt and reference images, then inspect the deterministic construction, validation, and fabrication handoff.",
  robots: { index: false, follow: false }
};

export default async function CreatePage() {
  try {
    const config = readRuntimeConfig();
    const token = (await cookies()).get(sessionCookieName(config.security))?.value;
    if (token === undefined) notFound();
    const payload = verifySessionToken({ token, nowMs: Date.now(), security: config.security });
    if (payload === null) notFound();
    return (
      <SiteShell active="create" authenticated>
        <GeneratedProjectController generationExperience={config.generationExperience} />
      </SiteShell>
    );
  } catch {
    notFound();
  }
}
