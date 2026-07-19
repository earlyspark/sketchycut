import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  measuredBasswoodProfile,
  provisionalFabricationProfiles,
  type CapturedSlideProgramV1
} from "../../src/index.js";
import { compileCapturedSlideProgram } from "../../src/operators/captured-panel-slide.js";
import {
  createCapturedSlideProgram,
  type CapturedSlideProgramContent
} from "../../src/ui/content/presets.js";

const FixtureSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    fixtureId: z.string(),
    proofRole: z.enum(["named", "off-family"]),
    operatorProgram: z.array(
      z.object({ operatorId: z.string(), operatorVersion: z.string() }).strict(),
    ),
    profiles: z
      .object({
        measuredThicknessMm: z.number(),
        kerfXmm: z.number(),
        kerfYmm: z.number()
      })
      .strict(),
    content: z.custom<CapturedSlideProgramContent>()
  })
  .strict();

export type CapturedSlideFixture = z.infer<typeof FixtureSchema>;
export const CAPTURED_SLIDE_FIXTURE_NAMES = ["sliding-lid-box", "drawer-in-sleeve"] as const;

export async function loadCapturedSlideFixture(
  name: (typeof CAPTURED_SLIDE_FIXTURE_NAMES)[number],
): Promise<CapturedSlideFixture> {
  return FixtureSchema.parse(
    JSON.parse(
      await readFile(
        new URL(`../fixtures/anti-overfit/captured-slide/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as unknown,
  );
}

export function capturedSlideFixtureProfiles(fixture: CapturedSlideFixture) {
  return provisionalFabricationProfiles(
    measuredBasswoodProfile([
      fixture.profiles.measuredThicknessMm,
      fixture.profiles.measuredThicknessMm,
      fixture.profiles.measuredThicknessMm
    ]),
    fixture.profiles.kerfXmm,
    fixture.profiles.kerfYmm,
  );
}

export function capturedSlideFixtureProgram(
  fixture: CapturedSlideFixture,
  profiles: ReturnType<typeof capturedSlideFixtureProfiles>,
): CapturedSlideProgramV1 {
  return createCapturedSlideProgram(fixture.content, profiles);
}

export async function compileCapturedSlideFixture(name: (typeof CAPTURED_SLIDE_FIXTURE_NAMES)[number]) {
  const fixture = await loadCapturedSlideFixture(name);
  const profiles = capturedSlideFixtureProfiles(fixture);
  const program = capturedSlideFixtureProgram(fixture, profiles);
  const result = await compileCapturedSlideProgram(program, profiles);
  return { fixture, profiles, program, ...result };
}
