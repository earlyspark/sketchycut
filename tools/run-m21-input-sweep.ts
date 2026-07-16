import { mkdir, writeFile } from "node:fs/promises";

import {
  compileOrthogonalPanelProgram,
  measuredBasswoodProfile,
  provisionalFitProfile,
  xtoolM2Profile,
  type DesignDocumentV1
} from "../src/index.js";
import {
  ORTHOGONAL_PRESETS,
  createPrimaryPreset,
  type OrthogonalPresetId
} from "../src/ui/content/presets.js";
import {
  M2_FIXTURE_NAMES,
  fixtureProfiles,
  fixtureProgram,
  loadM2Fixture,
  type M2Fixture
} from "../tests/helpers/m2-fixtures.js";

const outputDirectoryUrl = new URL("../artifacts/m2.1/", import.meta.url);
const outputUrl = new URL("input-sweep.json", outputDirectoryUrl);

type SweepSnapshot = {
  status: "pass" | "fail";
  inputPolicyCodes: string[];
  validationCodes: string[];
  constructionErrorCode: string | null;
  message: string | null;
};

type SweepTransition = {
  atMm: number;
  from: SweepSnapshot | null;
  to: SweepSnapshot;
};

type SweepRun = {
  id: string;
  variable: "thickness" | "kerf";
  startMm: number;
  endMm: number;
  stepMm: 0.01;
  evaluatedCount: number;
  passCount: number;
  failCount: number;
  transitions: SweepTransition[];
};

function values(startHundredth: number, endHundredth: number): number[] {
  return Array.from(
    { length: endHundredth - startHundredth + 1 },
    (_, index) => (startHundredth + index) / 100,
  );
}

function errorSnapshot(error: unknown): SweepSnapshot {
  if (!(error instanceof Error)) {
    return {
      status: "fail",
      inputPolicyCodes: [],
      validationCodes: [],
      constructionErrorCode: "UNCLASSIFIED_CONSTRUCTION_ERROR",
      message: "Unknown deterministic construction failure."
    };
  }
  const code = "code" in error && typeof error.code === "string"
    ? error.code
    : "UNCLASSIFIED_CONSTRUCTION_ERROR";
  return {
    status: "fail",
    inputPolicyCodes: [],
    validationCodes: [],
    constructionErrorCode: code,
    message: error.message
  };
}

function documentSnapshot(document: DesignDocumentV1): SweepSnapshot {
  return {
    status: document.validation.status,
    inputPolicyCodes:
      document.provenance.inputPolicyEvaluation?.findings
        .map((finding) => finding.code)
        .sort() ?? [],
    validationCodes: document.validation.findings.map((finding) => finding.code).sort(),
    constructionErrorCode: null,
    message: null
  };
}

function snapshotKey(snapshot: SweepSnapshot): string {
  return JSON.stringify({
    status: snapshot.status,
    inputPolicyCodes: snapshot.inputPolicyCodes,
    validationCodes: snapshot.validationCodes,
    constructionErrorCode: snapshot.constructionErrorCode
  });
}

async function runSweep(
  id: string,
  variable: SweepRun["variable"],
  sweepValues: readonly number[],
  compile: (valueMm: number) => Promise<DesignDocumentV1>,
): Promise<SweepRun> {
  const transitions: SweepTransition[] = [];
  let previous: SweepSnapshot | null = null;
  let passCount = 0;
  let failCount = 0;
  for (const valueMm of sweepValues) {
    let snapshot: SweepSnapshot;
    try {
      snapshot = documentSnapshot(await compile(valueMm));
    } catch (error) {
      snapshot = errorSnapshot(error);
    }
    if (snapshot.status === "pass") {
      passCount += 1;
    } else {
      failCount += 1;
    }
    if (previous === null || snapshotKey(previous) !== snapshotKey(snapshot)) {
      transitions.push({ atMm: valueMm, from: previous, to: snapshot });
    }
    previous = snapshot;
  }
  return {
    id,
    variable,
    startMm: sweepValues[0]!,
    endMm: sweepValues.at(-1)!,
    stepMm: 0.01,
    evaluatedCount: sweepValues.length,
    passCount,
    failCount,
    transitions
  };
}

function publicCompile(presetId: OrthogonalPresetId, variable: SweepRun["variable"]) {
  return async (valueMm: number): Promise<DesignDocumentV1> => {
    const thicknessMm = variable === "thickness" ? valueMm : 3;
    const kerfMm = variable === "kerf" ? valueMm : 0.15;
    const profiles = {
      material: measuredBasswoodProfile([thicknessMm, thicknessMm, thicknessMm]),
      machine: xtoolM2Profile(kerfMm),
      fit: provisionalFitProfile()
    };
    return compileOrthogonalPanelProgram(createPrimaryPreset(presetId, profiles), profiles);
  };
}

function fixtureCompile(fixture: M2Fixture, variable: SweepRun["variable"]) {
  return async (valueMm: number): Promise<DesignDocumentV1> => {
    const profiles = fixtureProfiles(fixture, {
      measuredThicknessMm: variable === "thickness" ? valueMm : 3,
      kerfMm: variable === "kerf" ? valueMm : 0.15
    });
    return compileOrthogonalPanelProgram(fixtureProgram(fixture, profiles), profiles);
  };
}

const thicknessValues = values(250, 360);
const kerfValues = values(5, 40);
const fixtures = await Promise.all(M2_FIXTURE_NAMES.map(loadM2Fixture));
const runs: SweepRun[] = [];
for (const preset of ORTHOGONAL_PRESETS) {
  runs.push(
    await runSweep(
      `public-${preset.id}-thickness`,
      "thickness",
      thicknessValues,
      publicCompile(preset.id, "thickness"),
    ),
    await runSweep(
      `public-${preset.id}-kerf`,
      "kerf",
      kerfValues,
      publicCompile(preset.id, "kerf"),
    ),
  );
}
for (const fixture of fixtures) {
  runs.push(
    await runSweep(
      `${fixture.fixtureId}-thickness`,
      "thickness",
      thicknessValues,
      fixtureCompile(fixture, "thickness"),
    ),
    await runSweep(
      `${fixture.fixtureId}-kerf`,
      "kerf",
      kerfValues,
      fixtureCompile(fixture, "kerf"),
    ),
  );
}

const unclassifiedFailures = runs.flatMap((run) =>
  run.transitions
    .filter((transition) => transition.to.constructionErrorCode === "UNCLASSIFIED_CONSTRUCTION_ERROR")
    .map((transition) => ({ runId: run.id, atMm: transition.atMm, message: transition.to.message })),
);
const report = {
  schemaVersion: "1.0",
  milestone: "M2.1",
  sweepId: "m2-1-input-sweep-v1",
  deterministicSeed: "m2-1-input-sweep-v1",
  resolutionUm: 10,
  runtimeApplicationApiCalls: 0,
  monotonicityAsserted: false,
  measurementSubstitutionAllowed: false,
  runs,
  summary: {
    runCount: runs.length,
    evaluatedCount: runs.reduce((sum, run) => sum + run.evaluatedCount, 0),
    passCount: runs.reduce((sum, run) => sum + run.passCount, 0),
    failCount: runs.reduce((sum, run) => sum + run.failCount, 0),
    unclassifiedFailureCount: unclassifiedFailures.length,
    unclassifiedFailures
  }
};

await mkdir(outputDirectoryUrl, { recursive: true });
await writeFile(outputUrl, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `Swept ${String(report.summary.evaluatedCount)} deterministic inputs across ${String(runs.length)} runs; ` +
  `${String(report.summary.failCount)} construction failures, ${String(unclassifiedFailures.length)} unclassified.\n`,
);
