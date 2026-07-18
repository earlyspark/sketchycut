import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { GeneratedProjectController } from "../../ui/components/generated-project-controller";
import {
  sessionCookieName,
  verifySessionToken
} from "../../server/m6/access";
import { readM6RuntimeConfig } from "../../server/m6/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create a fabrication candidate · SketchyCut",
  description: "Turn a maker brief and references into a deterministically validated fabrication candidate.",
  robots: { index: false, follow: false }
};

export default async function CreatePage() {
  try {
    const config = readM6RuntimeConfig();
    const token = (await cookies()).get(sessionCookieName(config.security))?.value;
    if (token === undefined) notFound();
    const payload = verifySessionToken({ token, nowMs: Date.now(), security: config.security });
    if (payload === null) notFound();
    return <GeneratedProjectController generationExperience={config.generationExperience} />;
  } catch {
    notFound();
  }
}
