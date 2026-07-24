import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { sha256 } from "../src/domain/hash.js";
import { registeredOperatorVersions } from "../src/operators/registry.js";
import { GUIDED_EXAMPLE_CATALOG } from "../src/ui/content/guided-examples.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const antiOverfitRoot = path.join(repositoryRoot, "tests/fixtures/anti-overfit");
const manifestPath = path.join(antiOverfitRoot, "manifest.json");
const rootRouteEntry = path.join(repositoryRoot, "src/app/page.tsx");

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
    schemaVersion: z.literal("2.0"),
    retainedScopeProofs: z.array(z.object({
      id: z.enum([
        "deep-reverse-dependency-closure",
        "shared-record-multiple-retained-owners",
        "stable-identity-tie-break",
        "finite-domain-completeness-and-fail-closed",
        "whole-branch-evidence-insufficient-boundary"
      ]),
      fixture: FixturePathSchema,
      sha256: z.string().regex(/^[a-f0-9]{64}$/u)
    }).strict()).length(5),
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

const rootForbiddenPathFragments = [
  "/workers/",
  "/kernel/",
  "/compiler/",
  "/interpretation/",
  "/canonical-project-workspace.",
  "/guided-examples-controller.",
  "/workbench.",
  "/tools/local-live/"
] as const;

const rootForbiddenExternalImports = [
  "three",
  "@react-three/fiber",
  "@react-three/drei",
  "openai"
] as const;

const rootAllowedClientModules = new Set([
  "src/ui/components/landing-demo.tsx",
  "src/ui/components/sheet-view.tsx"
]);

const semanticBoundaryFiles = new Set([
  "src/interpretation/semantic-input-contracts.ts",
  "src/interpretation/source-evidence.ts",
  "src/interpretation/semantic-interpretation.ts",
  "src/interpretation/semantic-atom-registry.ts",
  "src/interpretation/semantic-model-contract.ts",
  "src/interpretation/semantic-boundary-reconciliation.ts",
  "src/interpretation/inventory-realization.ts",
  "src/interpretation/semantic-request.ts",
  "src/interpretation/measurement-binding.ts",
  "src/interpretation/orchestrator.ts",
  "src/server/generation/semantic-interpretation-prompt.ts",
  "src/server/generation/generation-service.ts"
]);

const deterministicConstructionPathPatterns = [
  /^src\/compiler\//u,
  /^src\/kernel\//u,
  /^src\/operators\//u,
  /^src\/interpretation\/(?:construction-|constraint-sizing-|topology-synthesis|procedural-motif-|generated-fabrication)/u
] as const;

const obsoleteSemanticRuntimePaths = [
  "src/interpretation/intent-graph-v2.ts",
  "src/interpretation/semantic-request-v2.ts",
  "src/interpretation/generation-outcome-v2.ts",
  "src/interpretation/observation-realization.ts",
  "src/interpretation/mvp-safe-omission-policy.ts",
  "src/interpretation/semantic-review.ts",
  "src/evaluation/live-semantic-review-evaluation.ts",
  "src/server/generation/reference-interpretation-prompt.ts"
] as const;

function sourceImportSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) specifiers.add(match[1]);
    }
  }
  return [...specifiers].sort();
}

async function resolveSourceImport(importer: string, specifier: string): Promise<string | null> {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.json`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js")
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function verifyRootRouteSourceGraph(): Promise<Failure[]> {
  const failures: Failure[] = [];
  const pending = [rootRouteEntry];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const location = relative(file);
    const normalizedPath = `/${location.replaceAll("\\", "/")}`;
    for (const fragment of rootForbiddenPathFragments) {
      if (normalizedPath.includes(fragment)) {
        failures.push({
          location,
          message: `ROOT001_FORBIDDEN_SOURCE_REACHABILITY: root route reaches ${fragment}.`
        });
      }
    }
    const source = await readFile(file, "utf8");
    if (/^[\s\n\r]*["']use client["'];?/m.test(source) &&
        !rootAllowedClientModules.has(location)) {
      failures.push({
        location,
        message: "ROOT002_CLIENT_MODULE_REACHABLE: root route reaches a non-allowlisted client module."
      });
    }
    for (const token of ["new Worker(", "WebGLRenderingContext", "fetch(", "OPENAI_API_KEY"]) {
      if (source.includes(token)) {
        failures.push({
          location,
          message: `ROOT003_FORBIDDEN_RUNTIME_TOKEN: root source contains ${token}.`
        });
      }
    }
    for (const specifier of sourceImportSpecifiers(source)) {
      if (rootForbiddenExternalImports.some((forbidden) =>
        specifier === forbidden || specifier.startsWith(`${forbidden}/`)
      )) {
        failures.push({
          location,
          message: `ROOT004_FORBIDDEN_EXTERNAL_IMPORT: root imports ${specifier}.`
        });
      }
      const resolved = await resolveSourceImport(file, specifier);
      if (resolved !== null) pending.push(resolved);
    }
  }
  return failures;
}

function lexicalInterpretationFailures(location: string, source: string): Failure[] {
  const failures: Failure[] = [];
  const prohibitedClassifierIdentifiers = /\b(?:keyword|keywords|synonym|synonyms|nounList|phraseList|hazardTaxonomy|productClassifier|motifClassifier)\b/iu;
  const textReceiverHeuristic = /\b(?:semanticBrief|brief|claim|rationale|omissionConsequence)\s*\.\s*(?:includes|startsWith|endsWith|match|matchAll|search|split|toLowerCase|toLocaleLowerCase)\s*\(/u;
  const regexAgainstText = /\.(?:test|exec)\(\s*(?:input\.)?(?:semanticBrief|brief|claim|rationale|omissionConsequence)\b/u;
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (prohibitedClassifierIdentifiers.test(line) || textReceiverHeuristic.test(line) || regexAgainstText.test(line)) {
      failures.push({
        location: `${location}:${String(index + 1)}`,
        message: "SEM001_LEXICAL_INTERPRETATION_HEURISTIC: semantic meaning must come from the evidence-bound model inventory, not deterministic word or phrase matching."
      });
    }
  }
  for (const prohibited of [
    "case-specific semantic policy",
    "named-use-case override",
    "product-specific semantic classifier"
  ]) {
    if (source.toLowerCase().includes(prohibited)) {
      failures.push({
        location,
        message: `SEM002_CASE_SPECIFIC_SEMANTIC_POLICY: semantic boundary source contains prohibited case-specific policy text "${prohibited}".`
      });
    }
  }
  return failures;
}

function freeTextConstructionFailures(location: string, source: string): Failure[] {
  const failures: Failure[] = [];
  const forbiddenPatterns = [
    { token: "OpenSemanticInventory", pattern: /\bOpenSemanticInventory\b/u },
    { token: "SemanticInterpretation", pattern: /\bSemanticInterpretation\b/u },
    { token: "SemanticInterpretationCandidate", pattern: /\bSemanticInterpretationCandidate\b/u },
    { token: "CompactSemanticProjection", pattern: /\bCompactSemanticProjection\b/u },
    { token: "SemanticAtom", pattern: /\bSemanticAtom(?:InventoryItem)?\b/u },
    { token: "semantic-atom-registry", pattern: /semantic-atom-registry/u },
    { token: ".inventory", pattern: /\.inventory\b/u },
    { token: ".bindings", pattern: /\.bindings\b/u },
    { token: ".atoms", pattern: /\.atoms\b/u },
    { token: ".claim", pattern: /\.claim\b/u },
    { token: ".omissionConsequence", pattern: /\.omissionConsequence\b/u },
    { token: ".uncertainty", pattern: /\.uncertainty\b/u },
    { token: ".semanticBrief", pattern: /\.semanticBrief\b/u }
  ];
  for (const entry of forbiddenPatterns) {
    if (entry.pattern.test(source)) {
      failures.push({
        location,
        message: `SEM003_OPEN_TEXT_REACHES_CONSTRUCTION: deterministic construction source contains ${entry.token}; accept only the closed typed projection.`
      });
    }
  }
  return failures;
}

async function verifySemanticAuthorityBoundary(): Promise<Failure[]> {
  const failures: Failure[] = [];
  for (const location of semanticBoundaryFiles) {
    const file = path.join(repositoryRoot, location);
    if (!(await pathExists(file))) {
      failures.push({ location, message: "SEM004_SEMANTIC_BOUNDARY_FILE_MISSING: required current semantic boundary module is absent." });
      continue;
    }
    failures.push(...lexicalInterpretationFailures(location, await readFile(file, "utf8")));
  }
  const productionFiles = (await collectFiles(path.join(repositoryRoot, "src"))).filter((file) => /\.(?:[cm]?js|tsx?)$/u.test(file));
  for (const file of productionFiles) {
    const location = relative(file);
    const source = await readFile(file, "utf8");
    if (deterministicConstructionPathPatterns.some((pattern) => pattern.test(location))) {
      failures.push(...freeTextConstructionFailures(location, source));
    }
    if (/\b(?:CompactSemanticProjection|SemanticProjectionBinding|compactSemanticInterpretationCandidateFromNormalized)\b/u.test(source)) {
      failures.push({
        location,
        message: "SEM006_OBSOLETE_COMPACT_PROJECTION_CONTRACT: current source must use only item-local semantic atoms."
      });
    }
    if (!location.startsWith("src/evaluation/")) {
      for (const developmentCaseId of [
        "organization-count-composite-control-dev",
        "organization-grid-composite-control-dev",
        "storage-purpose-nonorganization-control-dev",
        "storage-context-nonorganization-control-dev"
      ]) {
        if (source.includes(developmentCaseId)) {
          failures.push({
            location,
            message: `SEM010_DEVELOPMENT_CASE_LEAK: production runtime source must not branch on development case ID ${developmentCaseId}.`
          });
        }
      }
    }
  }
  const promptLocation = "src/server/generation/semantic-interpretation-prompt.ts";
  const atomLocation = "src/interpretation/semantic-atom-registry.ts";
  const prompt = await readFile(path.join(repositoryRoot, promptLocation), "utf8");
  const atomRegistry = await readFile(path.join(repositoryRoot, atomLocation), "utf8");
  if (!prompt.includes("Every construction-affecting semantic relationship must receive registered typed authority") ||
      !prompt.includes("It jointly contains enclosure, access, and space subchoices") ||
      !prompt.includes("including when that function is expressed through its ordinary functional name")) {
    failures.push({
      location: promptLocation,
      message: "SEM011_CONSTRUCTION_RELATIONSHIP_UNDERCOVERAGE: prompt must require typed authority and one complete primary-enclosure topology choice."
    });
  }
  if (!prompt.includes("storage purpose, storage destination") ||
      !atomRegistry.includes("Primary-enclosure space layout belongs exclusively to the complete primary-enclosure atom.")) {
    failures.push({
      location: atomLocation,
      message: "SEM011_CONSTRUCTION_RELATIONSHIP_UNDERCOVERAGE: topology policy must keep primary-enclosure layout complete while preserving purpose and destination as context."
    });
  }
  for (const location of obsoleteSemanticRuntimePaths) {
    if (await pathExists(path.join(repositoryRoot, location))) {
      failures.push({ location, message: "SEM005_PARALLEL_SEMANTIC_RUNTIME: obsolete semantic runtime path must not coexist with the current contract." });
    }
  }
  return failures;
}

async function verifyProviderParserBoundary(): Promise<Failure[]> {
  const failures: Failure[] = [];
  const contractLocation = "src/interpretation/semantic-model-contract.ts";
  const atomLocation = "src/interpretation/semantic-atom-registry.ts";
  const transportLocation = "src/server/generation/openai-transport.ts";
  const contract = await readFile(path.join(repositoryRoot, contractLocation), "utf8");
  const atomRegistry = await readFile(path.join(repositoryRoot, atomLocation), "utf8");
  const transport = await readFile(path.join(repositoryRoot, transportLocation), "utf8");
  const forbiddenProviderEffects = [
    ".refine(",
    ".superRefine(",
    ".transform(",
    ".default(",
    ".catch(",
    "z.preprocess("
  ];
  for (const token of forbiddenProviderEffects) {
    if (contract.includes(token)) {
      failures.push({
        location: contractLocation,
        message: `SEM007_PROVIDER_SCHEMA_HIDDEN_EFFECT: provider candidate tree contains ${token}.`
      });
    }
  }
  const candidateAtomSection = atomRegistry.split(
    "export const SemanticAtomSchema = SemanticAtomCandidateSchema.superRefine",
  )[0] ?? atomRegistry;
  for (const token of forbiddenProviderEffects) {
    if (candidateAtomSection.includes(token)) {
      failures.push({
        location: atomLocation,
        message: `SEM007_PROVIDER_SCHEMA_HIDDEN_EFFECT: provider atom candidate tree contains ${token}.`
      });
    }
  }
  if (!transport.includes("zodTextFormat(input.candidateSchema")) {
    failures.push({
      location: transportLocation,
      message: "SEM008_SDK_LOCAL_PARSER_DIVERGENCE: transport must supply the exact candidate Zod tree to the SDK parser."
    });
  }
  if (!contract.includes("semanticInterpretationCandidateSchema(index).safeParse") &&
      !contract.includes("providerBoundSchema.safeParse")) {
    failures.push({
      location: contractLocation,
      message: "SEM008_SDK_LOCAL_PARSER_DIVERGENCE: local authorization must parse the same evidence-bound candidate tree."
    });
  }
  for (const obsolete of [
    "src/interpretation/semantic-review.ts",
    "src/evaluation/live-semantic-review-evaluation.ts"
  ]) {
    if (await pathExists(path.join(repositoryRoot, obsolete))) {
      failures.push({
        location: obsolete,
        message: "SEM009_SECOND_CALL_RUNTIME_PRESENT: M7.3 must not retain a Call B runtime or evaluator lane."
      });
    }
  }
  return failures;
}

async function verifyEvaluationOnlySemanticReviewBoundary(): Promise<Failure[]> {
  const failures: Failure[] = [];
  const reviewModuleFragments = [
    "evaluation/bounded-semantic-review",
    "evaluation/openai-semantic-review-transport",
    "evaluation/paired-semantic-review-evaluator",
    "evaluation/semantic-review-dispatch"
  ] as const;
  const productionFiles = (
    await collectFiles(path.join(repositoryRoot, "src"))
  ).filter((file) =>
    /\.(?:[cm]?js|tsx?)$/u.test(file) &&
    !relative(file).startsWith("src/evaluation/")
  );
  for (const file of productionFiles) {
    const location = relative(file);
    const source = await readFile(file, "utf8");
    for (const specifier of sourceImportSpecifiers(source)) {
      if (reviewModuleFragments.some((fragment) =>
        specifier.replaceAll("\\", "/").includes(fragment)
      )) {
        failures.push({
          location,
          message:
            "SEM012_EVALUATION_ONLY_REVIEW_IMPORT: production source may not import the M7.4 Call B contract, transport, dispatch, or evaluator."
        });
      }
    }
    if (
      location !== "src/server/generation/generation-service.ts" &&
      source.includes("evaluatePatchedSemanticCandidateForEvaluation")
    ) {
      failures.push({
        location,
        message:
          "SEM013_EVALUATION_ONLY_PATCH_EXECUTION: only the generation-service definition and evaluation tooling may reference deterministic patched-candidate execution."
      });
    }
  }
  const generationService = await readFile(
    path.join(
      repositoryRoot,
      "src/server/generation/generation-service.ts",
    ),
    "utf8",
  );
  if (
    !generationService.includes(
      "export async function evaluatePatchedSemanticCandidateForEvaluation",
    ) ||
    !generationService.includes(
      "SEMANTIC_REVIEW_CALL_A_PROVENANCE_INVALID",
    )
  ) {
    failures.push({
      location: "src/server/generation/generation-service.ts",
      message:
        "SEM014_EVALUATION_PATCH_PROVENANCE_GUARD_MISSING: deterministic review evaluation must require a confirmed live-evaluation Call A attempt."
    });
  }
  return failures;
}

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
  const retainedScopeProofIds = new Set<string>();

  for (const proof of manifest.retainedScopeProofs) {
    if (retainedScopeProofIds.has(proof.id)) {
      failures.push({
        location: relative(manifestPath),
        message: `AOF016_RETAINED_SCOPE_PROOF_DUPLICATED: retained-scope proof ${proof.id} is duplicated.`
      });
    }
    retainedScopeProofIds.add(proof.id);
    if (declaredFixturePaths.has(proof.fixture)) {
      failures.push({
        location: relative(manifestPath),
        message: `AOF017_RETAINED_SCOPE_FIXTURE_DUPLICATED: fixture ${proof.fixture} is declared more than once.`
      });
    }
    declaredFixturePaths.add(proof.fixture);
    const fixturePath = path.join(repositoryRoot, proof.fixture);
    if (!await pathExists(fixturePath)) {
      failures.push({
        location: proof.fixture,
        message: "AOF018_RETAINED_SCOPE_FIXTURE_MISSING: frozen retained-scope proof fixture is missing."
      });
      continue;
    }
    const observedDigest = await sha256(await readFile(fixturePath));
    if (observedDigest !== proof.sha256) {
      failures.push({
        location: proof.fixture,
        message: "AOF019_RETAINED_SCOPE_FIXTURE_DIGEST_DRIFT: frozen retained-scope proof fixture digest does not match the strict manifest."
      });
    }
  }

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

  expectCode(
    "lexical-brief-classifier",
    lexicalInterpretationFailures("src/seeded.ts", "if (semanticBrief.toLowerCase().includes('seeded phrase')) bind();"),
    "SEM001_LEXICAL_INTERPRETATION_HEURISTIC",
  );
  expectCode(
    "case-specific-semantic-policy",
    lexicalInterpretationFailures("src/seeded.ts", "const casePolicy = 'named-use-case override';"),
    "SEM002_CASE_SPECIFIC_SEMANTIC_POLICY",
  );
  expectCode(
    "open-inventory-compiler-input",
    freeTextConstructionFailures("src/seeded.ts", "function compile(input: SemanticInterpretation) { return input.inventory; }"),
    "SEM003_OPEN_TEXT_REACHES_CONSTRUCTION",
  );
  expectCode(
    "compact-model-binding-compiler-input",
    freeTextConstructionFailures("src/seeded.ts", "function compile(input: SemanticInterpretationCandidate) { return input.projection.bindings; }"),
    "SEM003_OPEN_TEXT_REACHES_CONSTRUCTION",
  );
  const allowedClosedProjection = freeTextConstructionFailures(
    "src/seeded.ts",
    "function compile(projection: ClosedSemanticProjection) { return projection.requirements; }",
  );
  if (allowedClosedProjection.length > 0) {
    failures.push({
      location: "tools/verify-architecture-guards.ts",
      message: "Architecture-guard self-test rejected a closed typed projection consumer."
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
    verifyRootRouteSourceGraph(),
    verifySemanticAuthorityBoundary(),
    verifyProviderParserBoundary(),
    verifyEvaluationOnlySemanticReviewBoundary(),
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
    `Architecture guards, semantic authority boundary, root-route source graph, and seeded self-tests passed for ${String(registeredVersions.size)} registered operators and ${String(forbiddenCoreConcepts.length)} forbidden core concepts.\n`,
  );
}
