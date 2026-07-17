import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { registeredOperatorVersions } from "../src/operators/registry.js";
import { GUIDED_EXAMPLE_CATALOG } from "../src/ui/content/guided-examples.js";

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

function vocabularyFailures(location: string, source: string): Failure[] {
  const failures: Failure[] = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const normalized = normalizedTokenLine(line);
    for (const concept of forbiddenCoreConcepts) {
      if (normalized.includes(concept)) {
        failures.push({
          location: `${location}:${String(index + 1)}`,
          message: `AOF001_BANNED_VOCABULARY: production source contains forbidden family/fixture concept "${concept}". Keep product labels in src/ui/content and map fabrication through topology/capability rules.`
        });
      }
    }
    for (const identifier of forbiddenSelectorIdentifiers) {
      if (normalized.includes(identifier)) {
        failures.push({
          location: `${location}:${String(index + 1)}`,
          message: `AOF002_FORBIDDEN_SELECTOR_IDENTIFIER: production source contains selector-style identifier "${identifier}".`
        });
      }
    }
    if (normalized.includes("ui/content".replaceAll("/", ""))) {
      failures.push({
        location: `${location}:${String(index + 1)}`,
        message:
          "AOF003_CORE_IMPORTS_PRESENTATION: non-presentation source may not import product-label content."
      });
    }
  }
  return failures;
}

async function verifyCoreVocabulary(): Promise<Failure[]> {
  const failures: Failure[] = [];
  const files = (await collectFiles(path.join(repositoryRoot, "src"))).filter(
    (file) =>
      /\.(?:[cm]?js|tsx?)$/.test(file) &&
      !presentationOnlyRoots.some((root) => relative(file).startsWith(`${root}/`)),
  );
  for (const file of files) {
    failures.push(...vocabularyFailures(relative(file), await readFile(file, "utf8")));
  }
  return failures;
}

function verifyCatalogVocabularyCoverage(): Failure[] {
  const protectedConcepts = new Set<string>(forbiddenCoreConcepts);
  return GUIDED_EXAMPLE_CATALOG.flatMap((entry) => {
    const normalizedId = normalizedTokenLine(entry.id);
    return protectedConcepts.has(normalizedId)
      ? []
      : [{
          location: "src/ui/content/guided-examples.ts",
          message: `AOF004_UNGUARDED_CATALOG_TOKEN: public example token "${normalizedId}" is not covered by forbiddenCoreConcepts.`
        }];
  });
}

function invocationVersionFailures(
  fixturePath: string,
  invocations: readonly { operatorId: string; operatorVersion: string }[],
  registeredVersions: ReadonlyMap<string, string>,
): { versions: Map<string, string>; failures: Failure[] } {
  const failures: Failure[] = [];
  const versions = new Map<string, string>();
  for (const invocation of invocations) {
    if (versions.has(invocation.operatorId)) {
      failures.push({
        location: fixturePath,
        message: `Operator ${invocation.operatorId} appears more than once in operatorProgram.`
      });
      continue;
    }
    versions.set(invocation.operatorId, invocation.operatorVersion);
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
  return { versions, failures };
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
  const checked = invocationVersionFailures(
    fixturePath,
    fixture.operatorProgram,
    registeredVersions,
  );
  failures.push(...checked.failures);
  return checked.versions;
}

function parityFailures(
  fixturePath: string,
  requiredSharedOperatorIds: readonly string[],
  namedVersions: ReadonlyMap<string, string>,
  candidateVersions: ReadonlyMap<string, string>,
  candidateRole: "named" | "off-family",
): Failure[] {
  const failures: Failure[] = [];
  for (const operatorId of requiredSharedOperatorIds) {
    if (!candidateVersions.has(operatorId)) {
      failures.push({
        location: fixturePath,
        message: `AOF014_REQUIRED_OPERATOR_MISSING: ${candidateRole} fixture must invoke shared operator ${operatorId}.`
      });
    }
  }
  if (candidateRole === "off-family") {
    for (const [operatorId, operatorVersion] of candidateVersions) {
      const namedVersion = namedVersions.get(operatorId);
      if (namedVersion === undefined) {
        failures.push({
          location: fixturePath,
          message: `AOF013_OFF_FAMILY_ONLY_OPERATOR: off-family fixture invokes ${operatorId}, which the named-family fixture does not use.`
        });
      } else if (namedVersion !== operatorVersion) {
        failures.push({
          location: fixturePath,
          message: `AOF012_REGISTRY_VERSION_MISMATCH: off-family fixture uses ${operatorId}@${operatorVersion}; named-family fixture uses ${namedVersion}.`
        });
      }
    }
  }
  return failures;
}

function missingFixtureFailures(
  groupId: string,
  fixturePaths: readonly string[],
  existingFixturePaths: ReadonlySet<string>,
): Failure[] {
  return fixturePaths
    .filter((fixturePath) => !existingFixturePaths.has(fixturePath))
    .map((fixturePath) => ({
      location: fixturePath,
      message: `Active anti-overfit group ${groupId} is missing this required fixture.`
    }));
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
    failures.push(...missingFixtureFailures(
      group.id,
      groupFixturePaths,
      new Set(existingFixturePaths.map((item) => item.fixturePath)),
    ));
    if (groupFixturePaths.some((fixturePath) => !existingFixturePaths.some((item) => item.fixturePath === fixturePath))) {
      continue;
    }

    const namedVersions = await readFixtureOperatorVersions(
      group.namedFamilyFixture,
      registeredVersions,
      failures,
    );
    failures.push(...parityFailures(
      group.namedFamilyFixture,
      group.requiredSharedOperatorIds,
      namedVersions,
      namedVersions,
      "named",
    ));

    for (const offFamilyFixture of group.offFamilyFixtures) {
      const offFamilyVersions = await readFixtureOperatorVersions(
        offFamilyFixture,
        registeredVersions,
        failures,
      );
      failures.push(...parityFailures(
        offFamilyFixture,
        group.requiredSharedOperatorIds,
        namedVersions,
        offFamilyVersions,
        "off-family",
      ));
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

function verifyGuardSelfTests(): Failure[] {
  const failures: Failure[] = [];
  const expectCode = (id: string, candidates: readonly Failure[], code: string): void => {
    if (!candidates.some((candidate) => candidate.message.includes(code))) {
      failures.push({
        location: "tools/verify-architecture-guards.ts",
        message: `Architecture-guard self-test ${id} did not detect ${code}.`
      });
    }
  };
  const rejectedFamilyDispatch = vocabularyFailures(
    "src/seeded.ts",
    "if (selectedExampleId === 'basic-box') dispatch();\nconst familyId = 'seeded';",
  );
  expectCode("public-example-dispatch", rejectedFamilyDispatch, "AOF001_BANNED_VOCABULARY");
  expectCode("family-selector", rejectedFamilyDispatch, "AOF002_FORBIDDEN_SELECTOR_IDENTIFIER");
  const rejectedPresentationImport = vocabularyFailures(
    "src/seeded.ts",
    "import '../ui/content/example';",
  );
  expectCode("presentation-import", rejectedPresentationImport, "AOF003_CORE_IMPORTS_PRESENTATION");
  const allowedCapabilityDispatch = vocabularyFailures(
    "src/seeded.ts",
    "if (activeStructuralKind === 'retained-pin') activate();\nif (request.structuralKind === 'orthogonal-panel') compile();",
  );
  if (allowedCapabilityDispatch.length > 0) {
    failures.push({
      location: "tools/verify-architecture-guards.ts",
      message: "Architecture-guard self-test rejected permitted structural-capability dispatch."
    });
  }
  const allowedOpaqueSelection = vocabularyFailures(
    "src/seeded.ts",
    "const selectedId = selectedExampleId; announce(selectedId);",
  );
  if (allowedOpaqueSelection.length > 0) {
    failures.push({
      location: "tools/verify-architecture-guards.ts",
      message: "Architecture-guard self-test rejected opaque generic selected-ID flow."
    });
  }

  const registry = new Map([["shared-operator", "1.0.0"]]);
  const versionFailures = invocationVersionFailures(
    "tests/seeded.json",
    [
      { operatorId: "shared-operator", operatorVersion: "2.0.0" },
      { operatorId: "unregistered-operator", operatorVersion: "1.0.0" }
    ],
    registry,
  ).failures;
  if (!versionFailures.some((failure) => failure.message.includes("does not match registered version"))) {
    failures.push({
      location: "tools/verify-architecture-guards.ts",
      message: "Architecture-guard self-test did not detect registered-version drift."
    });
  }
  if (!versionFailures.some((failure) => failure.message.includes("not in the production registry"))) {
    failures.push({
      location: "tools/verify-architecture-guards.ts",
      message: "Architecture-guard self-test did not detect an unregistered operator."
    });
  }
  const parity = parityFailures(
    "tests/off-family.json",
    ["shared-operator", "missing-shared"],
    new Map([["shared-operator", "1.0.0"]]),
    new Map([
      ["shared-operator", "2.0.0"],
      ["off-only", "1.0.0"]
    ]),
    "off-family",
  );
  expectCode("missing-shared", parity, "AOF014_REQUIRED_OPERATOR_MISSING");
  expectCode("off-only", parity, "AOF013_OFF_FAMILY_ONLY_OPERATOR");
  expectCode("parity-version", parity, "AOF012_REGISTRY_VERSION_MISMATCH");
  const missing = missingFixtureFailures(
    "seeded-group",
    ["tests/named.json", "tests/off.json"],
    new Set(["tests/named.json"]),
  );
  if (!missing.some((failure) => failure.location === "tests/off.json")) {
    failures.push({
      location: "tools/verify-architecture-guards.ts",
      message: "Architecture-guard self-test did not detect a missing active proof fixture."
    });
  }
  return failures;
}

const registeredVersions = registeredOperatorVersions();
const failures = (
  await Promise.all([
    verifyCoreVocabulary(),
    Promise.resolve(verifyCatalogVocabularyCoverage()),
    verifyOperatorRegistration(registeredVersions),
    verifyAntiOverfitFixtures(registeredVersions),
    Promise.resolve(verifyGuardSelfTests())
  ])
).flat();

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`${failure.location}: ${failure.message}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Architecture guards and seeded self-tests passed for ${String(registeredVersions.size)} registered operators and ${String(forbiddenCoreConcepts.length)} forbidden core concepts.\n`,
  );
}
