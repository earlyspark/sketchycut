import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  measuredBasswoodProfile,
  provisionalFabricationProfiles,
  type RetainedPinProgramV1
} from "../../src/index.js";
import { compileRetainedPinProgram } from "../../src/operators/retained-pin-revolute.js";
import {
  createRetainedProgram,
  type RetainedProgramContent
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
    content: z.custom<RetainedProgramContent>()
  })
  .strict();

export type M3Fixture = z.infer<typeof FixtureSchema>;
export const M3_FIXTURE_NAMES = ["hinged-lid-box", "hinged-flap"] as const;

export async function loadM3Fixture(
  name: (typeof M3_FIXTURE_NAMES)[number],
): Promise<M3Fixture> {
  return FixtureSchema.parse(
    JSON.parse(
      await readFile(
        new URL(`../fixtures/anti-overfit/m3/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as unknown,
  );
}

export function m3FixtureProfiles(fixture: M3Fixture) {
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

export function m3FixtureProgram(
  fixture: M3Fixture,
  profiles: ReturnType<typeof m3FixtureProfiles>,
): RetainedPinProgramV1 {
  return createRetainedProgram(fixture.content, profiles);
}

export async function compileM3Fixture(name: (typeof M3_FIXTURE_NAMES)[number]) {
  const fixture = await loadM3Fixture(name);
  const profiles = m3FixtureProfiles(fixture);
  const program = m3FixtureProgram(fixture, profiles);
  const result = await compileRetainedPinProgram(program, profiles);
  return { fixture, profiles, program, ...result };
}
