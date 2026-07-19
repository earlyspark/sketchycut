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

export type RetainedPinFixture = z.infer<typeof FixtureSchema>;
export const RETAINED_PIN_FIXTURE_NAMES = ["hinged-lid-box", "hinged-flap"] as const;

export async function loadRetainedPinFixture(
  name: (typeof RETAINED_PIN_FIXTURE_NAMES)[number],
): Promise<RetainedPinFixture> {
  return FixtureSchema.parse(
    JSON.parse(
      await readFile(
        new URL(`../fixtures/anti-overfit/retained-pin/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as unknown,
  );
}

export function retainedPinFixtureProfiles(fixture: RetainedPinFixture) {
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

export function retainedPinFixtureProgram(
  fixture: RetainedPinFixture,
  profiles: ReturnType<typeof retainedPinFixtureProfiles>,
): RetainedPinProgramV1 {
  return createRetainedProgram(fixture.content, profiles);
}

export async function compileRetainedPinFixture(name: (typeof RETAINED_PIN_FIXTURE_NAMES)[number]) {
  const fixture = await loadRetainedPinFixture(name);
  const profiles = retainedPinFixtureProfiles(fixture);
  const program = retainedPinFixtureProgram(fixture, profiles);
  const result = await compileRetainedPinProgram(program, profiles);
  return { fixture, profiles, program, ...result };
}
