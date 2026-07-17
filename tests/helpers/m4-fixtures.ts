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

export type M4Fixture = z.infer<typeof FixtureSchema>;
export const M4_FIXTURE_NAMES = ["sliding-lid-box", "drawer-in-sleeve"] as const;

export async function loadM4Fixture(
  name: (typeof M4_FIXTURE_NAMES)[number],
): Promise<M4Fixture> {
  return FixtureSchema.parse(
    JSON.parse(
      await readFile(
        new URL(`../fixtures/anti-overfit/m4/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as unknown,
  );
}

export function m4FixtureProfiles(fixture: M4Fixture) {
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

export function m4FixtureProgram(
  fixture: M4Fixture,
  profiles: ReturnType<typeof m4FixtureProfiles>,
): CapturedSlideProgramV1 {
  return createCapturedSlideProgram(fixture.content, profiles);
}

export async function compileM4Fixture(name: (typeof M4_FIXTURE_NAMES)[number]) {
  const fixture = await loadM4Fixture(name);
  const profiles = m4FixtureProfiles(fixture);
  const program = m4FixtureProgram(fixture, profiles);
  const result = await compileCapturedSlideProgram(program, profiles);
  return { fixture, profiles, program, ...result };
}
