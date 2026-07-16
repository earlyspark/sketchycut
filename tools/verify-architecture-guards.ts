import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { registeredOperatorVersions } from "../src/operators/registry.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const antiOverfitRoot = path.join(repositoryRoot, "tests/fixtures/anti-overfit");
const manifestPath = path.join(antiOverfitRoot, "manifest.json");

const presentationOnlyRoots = [
  "src/ui/content"
] as const;

const forbiddenCoreConcepts = [
  "basicbox",
  "hingedlidbox",
  "slidinglidbox",
  "opentray",
  "dividedorganizer",
  "openfrontcubby",
  "tallcrate",
  "hingedflap",
  "drawerinsleeve"
] as const;

const forbiddenSelectorIdentifiers = [
  "familyid",
  "familyname",
  "familytype",
  "productfamily",
  "familyselector",
  "selectfamily",
  "fixtureselector",
  "namedfamily"
] as const;

const FixturePathSchema = z
  .string()
  .regex(/^tests\/fixtures\/anti-overfit\/[a-z0-9][a-z0-9./-]*\.json$/);

const AntiOverfitManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    groups: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
          activationOperatorIds: z
            .array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/))
            .min(1),
          requiredSharedOperatorIds: z
            .array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/))
            .min(1),
          minimumOffFamilyFixtures: z.number().int().positive(),
          namedFamilyFixture: FixturePathSchema,
          offFamilyFixtures: z.array(FixturePathSchema).min(1)
        })
        .strict(),
    )
  })
  .strict();

const OperatorProgramFixtureSchema = z
  .object({
    operatorProgram: z
      .array(
        z
          .object({
            operatorId: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
            operatorVersion: z.string().regex(/^\d+\.\d+\.\d+$/)
          })
          .loose(),
      )
      .min(1)
  })
  .loose();

type Failure = {
  location: string;
  message: string;
};

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function collectFiles(directory: string): Promise<string[]> {
  if (!(await pathExists(directory))) {
    return [];
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const candidate = path.join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(candidate) : [candidate];
    }),
  );
  return files.flat().sort();
}

function relative(candidate: string): string {
  return path.relative(repositoryRoot, candidate).split(path.sep).join("/");
}

function normalizedTokenLine(line: string): string {
  return line.normalize("NFKC").toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

async function verifyCoreVocabulary(): Promise<Failure[]> {
  const failures: Failure[] = [];
  const files = (await collectFiles(path.join(repositoryRoot, "src"))).filter(
    (file) =>
      /\.(?:[cm]?js|tsx?)$/.test(file) &&
      !presentationOnlyRoots.some((root) => relative(file).startsWith(`${root}/`)),
  );
  for (const file of files) {
    const lines = (await readFile(file, "utf8")).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const normalized = normalizedTokenLine(line);
      for (const concept of forbiddenCoreConcepts) {
        if (normalized.includes(concept)) {
          failures.push({
            location: `${relative(file)}:${String(index + 1)}`,
            message: `AOF001_BANNED_VOCABULARY: production source contains forbidden family/fixture concept "${concept}". Keep product labels in src/ui/content and map fabrication through topology/capability rules.`
          });
        }
      }
      for (const identifier of forbiddenSelectorIdentifiers) {
        if (normalized.includes(identifier)) {
          failures.push({
            location: `${relative(file)}:${String(index + 1)}`,
            message: `AOF002_FORBIDDEN_SELECTOR_IDENTIFIER: production source contains selector-style identifier "${identifier}".`
          });
        }
      }
      if (normalized.includes("ui/content".replaceAll("/", ""))) {
        failures.push({
          location: `${relative(file)}:${String(index + 1)}`,
          message:
            "AOF003_CORE_IMPORTS_PRESENTATION: non-presentation source may not import product-label content."
        });
      }
    }
  }
  return failures;
}

async function verifyOperatorRegistration(
  registeredVersions: ReadonlyMap<string, string>,
): Promise<Failure[]> {
  const failures: Failure[] = [];
  for (const [operatorId, version] of registeredVersions) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      failures.push({
        location: "src/operators/registry.ts",
        message: `Registered operator ${operatorId} has invalid semantic version ${version}.`
      });
    }
  }

  const registrySource = await readFile(
    path.join(repositoryRoot, "src/operators/registry.ts"),
    "utf8",
  );
  const operatorFiles = (await collectFiles(path.join(repositoryRoot, "src/operators"))).filter(
    (file) => file.endsWith(".ts") && !file.endsWith("/registry.ts"),
  );
  for (const file of operatorFiles) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/export const ([A-Z][A-Z0-9_]*_OPERATOR)\s*=/g)) {
      const constantName = match[1]!;
      if (!registrySource.includes(constantName)) {
        failures.push({
          location: relative(file),
          message: `${constantName} is exported but not included in src/operators/registry.ts.`
        });
      }
    }
  }
  return failures;
}

async function readFixtureOperatorVersions(
  fixturePath: string,
  registeredVersions: ReadonlyMap<string, string>,
  failures: Failure[],
): Promise<Map<string, string>> {
  const absolutePath = path.join(repositoryRoot, fixturePath);
  const fixture = OperatorProgramFixtureSchema.parse(
    JSON.parse(await readFile(absolutePath, "utf8")) as unknown,
  );
  const fixtureVersions = new Map<string, string>();
  for (const invocation of fixture.operatorProgram) {
    if (fixtureVersions.has(invocation.operatorId)) {
      failures.push({
        location: fixturePath,
        message: `Operator ${invocation.operatorId} appears more than once in operatorProgram.`
      });
      continue;
    }
    fixtureVersions.set(invocation.operatorId, invocation.operatorVersion);
    const registeredVersion = registeredVersions.get(invocation.operatorId);
    if (registeredVersion === undefined) {
      failures.push({
        location: fixturePath,
        message: `Operator ${invocation.operatorId} is not in the production registry.`
      });
    } else if (registeredVersion !== invocation.operatorVersion) {
      failures.push({
        location: fixturePath,
        message: `Operator ${invocation.operatorId}@${invocation.operatorVersion} does not match registered version ${registeredVersion}.`
      });
    }
  }
  return fixtureVersions;
}

async function verifyAntiOverfitFixtures(
  registeredVersions: ReadonlyMap<string, string>,
): Promise<Failure[]> {
  const failures: Failure[] = [];
  const manifest = AntiOverfitManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  const groupIds = new Set<string>();
  const declaredFixturePaths = new Set<string>();

  for (const group of manifest.groups) {
    if (groupIds.has(group.id)) {
      failures.push({
        location: relative(manifestPath),
        message: `Anti-overfit group ID ${group.id} is duplicated.`
      });
    }
    groupIds.add(group.id);

    const groupFixturePaths = [group.namedFamilyFixture, ...group.offFamilyFixtures];
    for (const fixturePath of groupFixturePaths) {
      if (declaredFixturePaths.has(fixturePath)) {
        failures.push({
          location: relative(manifestPath),
          message: `Fixture ${fixturePath} is assigned to more than one anti-overfit group.`
        });
      }
      declaredFixturePaths.add(fixturePath);
    }

    const existingFixturePaths = (
      await Promise.all(
        groupFixturePaths.map(async (fixturePath) => ({
          fixturePath,
          exists: await pathExists(path.join(repositoryRoot, fixturePath))
        })),
      )
    ).filter((item) => item.exists);
    const active = group.activationOperatorIds.some((operatorId) =>
      registeredVersions.has(operatorId),
    );

    if (!active) {
      if (existingFixturePaths.length > 0) {
        failures.push({
          location: relative(manifestPath),
          message: `AOF010_ACTIVE_GROUP_FIXTURE_MISSING: group ${group.id} has proof fixtures but none of its activation operators are registered. Register the operator and verify all fixtures together.`
        });
      }
      continue;
    }

    if (group.offFamilyFixtures.length < group.minimumOffFamilyFixtures) {
      failures.push({
        location: relative(manifestPath),
        message: `Active group ${group.id} requires at least ${String(group.minimumOffFamilyFixtures)} off-family fixtures.`
      });
    }
    for (const fixturePath of groupFixturePaths) {
      if (!(await pathExists(path.join(repositoryRoot, fixturePath)))) {
        failures.push({
          location: fixturePath,
          message: `Active anti-overfit group ${group.id} is missing this required fixture.`
        });
      }
    }
    if (groupFixturePaths.some((fixturePath) => !existingFixturePaths.some((item) => item.fixturePath === fixturePath))) {
      continue;
    }

    const namedVersions = await readFixtureOperatorVersions(
      group.namedFamilyFixture,
      registeredVersions,
      failures,
    );
    for (const operatorId of group.requiredSharedOperatorIds) {
      if (!namedVersions.has(operatorId)) {
        failures.push({
          location: group.namedFamilyFixture,
          message: `AOF014_REQUIRED_OPERATOR_MISSING: named-family fixture must invoke shared operator ${operatorId}.`
        });
      }
    }

    for (const offFamilyFixture of group.offFamilyFixtures) {
      const offFamilyVersions = await readFixtureOperatorVersions(
        offFamilyFixture,
        registeredVersions,
        failures,
      );
      for (const operatorId of group.requiredSharedOperatorIds) {
        if (!offFamilyVersions.has(operatorId)) {
          failures.push({
            location: offFamilyFixture,
            message: `AOF014_REQUIRED_OPERATOR_MISSING: off-family fixture must invoke shared operator ${operatorId}.`
          });
        }
      }
      for (const [operatorId, operatorVersion] of offFamilyVersions) {
        const namedVersion = namedVersions.get(operatorId);
        if (namedVersion === undefined) {
          failures.push({
            location: offFamilyFixture,
            message: `AOF013_OFF_FAMILY_ONLY_OPERATOR: off-family fixture invokes ${operatorId}, which the named-family fixture does not use.`
          });
        } else if (namedVersion !== operatorVersion) {
          failures.push({
            location: offFamilyFixture,
            message: `AOF012_REGISTRY_VERSION_MISMATCH: off-family fixture uses ${operatorId}@${operatorVersion}; named-family fixture uses ${namedVersion}.`
          });
        }
      }
    }
  }

  const actualFixturePaths = (await collectFiles(antiOverfitRoot))
    .filter((file) => file.endsWith(".json") && file !== manifestPath)
    .map(relative);
  for (const fixturePath of actualFixturePaths) {
    if (!declaredFixturePaths.has(fixturePath)) {
      failures.push({
        location: fixturePath,
        message: "Anti-overfit fixture is not declared in tests/fixtures/anti-overfit/manifest.json."
      });
    }
  }

  return failures;
}

const registeredVersions = registeredOperatorVersions();
const failures = (
  await Promise.all([
    verifyCoreVocabulary(),
    verifyOperatorRegistration(registeredVersions),
    verifyAntiOverfitFixtures(registeredVersions)
  ])
).flat();

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`${failure.location}: ${failure.message}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Architecture guards passed for ${String(registeredVersions.size)} registered operator and ${String(forbiddenCoreConcepts.length)} forbidden core concepts.\n`,
  );
}
