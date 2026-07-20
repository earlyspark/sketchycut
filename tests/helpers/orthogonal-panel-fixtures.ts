import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  MachineProfileSchema,
  basswoodProfile,
  defaultFabricationContext,
  provisionalFitProfile,
  provisionalProcessRecipe,
  xtoolM2Profile,
  type DesignDocumentV1,
  type MachineProfile,
  type OrthogonalPanelProgramV1
} from "../../src/index.js";
import { compileOrthogonalPanelProgram } from "../../src/operators/orthogonal-compiler.js";
import { createPanelProgram } from "../../src/ui/content/presets.js";

const FixtureSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    fixtureId: z.string(),
    proofRole: z.enum(["named", "off-family"]),
    operatorProgram: z.array(
      z
        .object({
          operatorId: z.string(),
          operatorVersion: z.string()
        })
        .strict(),
    ),
    profiles: z
      .object({
        measuredThicknessMm: z.number(),
        kerfMm: z.number(),
        bedMm: z
          .object({
            width: z.number(),
            height: z.number(),
            margin: z.number()
          })
          .strict()
      })
      .strict(),
    content: z
      .object({
        programId: z.string(),
        projectId: z.string(),
        title: z.string(),
        description: z.string(),
        dimensions: z
          .object({
            widthMm: z.number(),
            depthMm: z.number(),
            heightMm: z.number()
          })
          .strict(),
        includeFront: z.boolean(),
        dividerCount: z.number().int().nonnegative(),
        dividerAxis: z.enum(["width", "depth"]),
        treatmentPrimitive: z.enum(["parallel-lines", "inset-frame", "corner-ticks"])
      })
      .strict()
  })
  .strict();

export type OrthogonalPanelFixture = z.infer<typeof FixtureSchema>;

export const ORTHOGONAL_PANEL_FIXTURE_NAMES = [
  "basic-box",
  "open-tray",
  "divided-organizer",
  "depth-divided-organizer",
  "open-front-cubby"
] as const;

export async function loadOrthogonalPanelFixture(
  name: (typeof ORTHOGONAL_PANEL_FIXTURE_NAMES)[number],
): Promise<OrthogonalPanelFixture> {
  return FixtureSchema.parse(
    JSON.parse(
      await readFile(
        new URL(`../fixtures/anti-overfit/orthogonal-panels/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as unknown,
  );
}

export function fixtureProfiles(
  fixture: OrthogonalPanelFixture,
  override: {
    measuredThicknessMm?: number;
    kerfMm?: number;
    bedMm?: { width: number; height: number; margin: number };
  } = {},
) {
  const measuredThicknessMm = override.measuredThicknessMm ?? fixture.profiles.measuredThicknessMm;
  const kerfMm = override.kerfMm ?? fixture.profiles.kerfMm;
  const standardMachine = xtoolM2Profile();
  const bedMm = override.bedMm ?? fixture.profiles.bedMm;
  const machine: MachineProfile = MachineProfileSchema.parse({
    ...standardMachine,
    id: bedMm.width === standardMachine.processingEnvelopeMm.width && bedMm.height === standardMachine.processingEnvelopeMm.height
      ? standardMachine.id
      : `${standardMachine.id}-envelope-${String(Math.round(bedMm.width))}-${String(Math.round(bedMm.height))}`,
    name: bedMm.width === standardMachine.processingEnvelopeMm.width && bedMm.height === standardMachine.processingEnvelopeMm.height
      ? standardMachine.name
      : "Fixture proof processing envelope",
    processingEnvelopeMm: { width: bedMm.width, height: bedMm.height }
  });
  const material = basswoodProfile(measuredThicknessMm);
  return {
    material,
    machine,
    processRecipe: provisionalProcessRecipe(material, machine, kerfMm),
    fabricationContext: defaultFabricationContext(),
    fit: provisionalFitProfile()
  };
}

export function fixtureProgram(
  fixture: OrthogonalPanelFixture,
  profiles: ReturnType<typeof fixtureProfiles>,
): OrthogonalPanelProgramV1 {
  return createPanelProgram(fixture.content, profiles);
}

export async function compileOrthogonalPanelFixture(
  name: (typeof ORTHOGONAL_PANEL_FIXTURE_NAMES)[number],
  override: Parameters<typeof fixtureProfiles>[1] = {},
): Promise<{
  fixture: OrthogonalPanelFixture;
  profiles: ReturnType<typeof fixtureProfiles>;
  program: OrthogonalPanelProgramV1;
  document: DesignDocumentV1;
}> {
  const fixture = await loadOrthogonalPanelFixture(name);
  const profiles = fixtureProfiles(fixture, override);
  const program = fixtureProgram(fixture, profiles);
  const document = await compileOrthogonalPanelProgram(program, profiles);
  return { fixture, profiles, program, document };
}
