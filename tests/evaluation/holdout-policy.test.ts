import { describe, expect, it } from "vitest";

import { sha256, stableJson } from "../../src/domain/hash.js";
import { DiversityPanelProtocolSchema } from "../../src/evaluation/semantic-diversity.js";
import {
  HOLDOUT_COMMITMENT_VERSION,
  SealedHoldoutPanelV1Schema,
  holdoutCommitment,
  holdoutDistributionPolicyHash,
  holdoutNoveltyPolicyHash,
  verifyOpenedHoldoutPanel
} from "./support/holdout-policy.js";
import { FROZEN_ITERATION_PANEL_PROTOCOL } from "../fixtures/intent-conditioned-construction/iteration-panel-protocol.js";
import {
  FROZEN_HOLDOUT_DISTRIBUTION_POLICY_HASH,
  FROZEN_HOLDOUT_NOVELTY_POLICY_HASH
} from "../fixtures/intent-conditioned-construction/manifest.js";

function panel() {
  const protocol = DiversityPanelProtocolSchema.parse(FROZEN_ITERATION_PANEL_PROTOCOL);
  protocol.panelId = "sealed-holdout-panel-one";
  const ids = ["paraphrased-writing-tools", "ceramic-tile-tray", "flute-stand", "fastener-sorter", "mail-slot"];
  protocol.cases.forEach((item, index) => { item.id = ids[index]!; });
  protocol.roundPolicy.pairwiseDistinctAspectCaseIds = ids.slice(0, 3);
  return SealedHoldoutPanelV1Schema.parse({
    schemaVersion: "1.0",
    commitmentVersion: HOLDOUT_COMMITMENT_VERSION,
    distributionTemplateVersion: "holdout-distribution-template-v1",
    noveltyPolicyVersion: "holdout-panel-novelty-policy-v1",
    panelOrdinal: 1,
    authoredAt: "2026-07-19T08:00:00Z",
    reservedForPromptRoundOrdinal: 1,
    earlierPromptRoundOrdinals: [],
    earlierIterationRoundOrdinals: [],
    earlierHoldoutPanelOrdinals: [],
    protocol,
    cases: [
      {
        caseId: ids[0],
        syntheticBrief: "Build a narrow covered holder sized conceptually for ordinary writing pencils.",
        references: [],
        objectAliases: ["pencils"],
        relationTuple: { objectRoles: ["contained"], access: "covered", organizationCount: null, scaleEvidenceTarget: "pencils", proportionDirection: "width-over-depth", mechanism: "none" },
        paraphraseOfIterationCaseId: "long-pencil-enclosure",
        comparatorClass: "long-pencil-enclosure"
      },
      {
        caseId: ids[1], syntheticBrief: "Make a low wide open tray for ceramic tiles.", references: [], objectAliases: ["ceramic tiles"],
        relationTuple: { objectRoles: ["contained"], access: "open-top", organizationCount: null, scaleEvidenceTarget: null, proportionDirection: "width-over-height", mechanism: "none" },
        paraphraseOfIterationCaseId: null, comparatorClass: "flat-wide-tray"
      },
      {
        caseId: ids[2], syntheticBrief: "Make a tall narrow front-access support for flutes.", references: [], objectAliases: ["flutes"],
        relationTuple: { objectRoles: ["supported"], access: "open-front", organizationCount: null, scaleEvidenceTarget: null, proportionDirection: "height-over-width", mechanism: "none" },
        paraphraseOfIterationCaseId: null, comparatorClass: "tall-narrow-container"
      },
      {
        caseId: ids[3], syntheticBrief: "Make four spaces for small fastener bins.", references: [], objectAliases: ["fastener bins"],
        relationTuple: { objectRoles: ["contained"], access: "open-top", organizationCount: 4, scaleEvidenceTarget: "fastener bins", proportionDirection: "none", mechanism: "none" },
        paraphraseOfIterationCaseId: null, comparatorClass: "four-sd-card-compartments"
      },
      {
        caseId: ids[4], syntheticBrief: "Make an open-front holder for sorted mail.", references: [], objectAliases: ["sorted mail"],
        relationTuple: { objectRoles: ["contained"], access: "open-front", organizationCount: null, scaleEvidenceTarget: "sorted mail", proportionDirection: "none", mechanism: "none" },
        paraphraseOfIterationCaseId: null, comparatorClass: "open-front-cubby"
      }
    ],
    saltHex: "0123456789abcdef0123456789abcdef"
  });
}

describe("sealed holdout policy and commitment", () => {
  it("verifies the strict distribution, novelty, paraphrase, comparator, and salted commitment gates", async () => {
    const candidate = panel();
    const committed = await holdoutCommitment(candidate);
    const report = await verifyOpenedHoldoutPanel({ panel: candidate, expectedCommitment: committed.commitment });
    expect(report).toMatchObject({
      pass: true,
      commitmentMatches: true,
      schemaPass: true,
      distributionPass: true,
      noveltyPass: true,
      comparatorMappingPass: true,
      paraphrasePass: true,
      novelCaseCount: 4
    });
    expect(report.distributionPolicyHash).toBe(FROZEN_HOLDOUT_DISTRIBUTION_POLICY_HASH);
    expect(report.noveltyPolicyHash).toBe(FROZEN_HOLDOUT_NOVELTY_POLICY_HASH);
    expect(await holdoutDistributionPolicyHash()).toBe(FROZEN_HOLDOUT_DISTRIBUTION_POLICY_HASH);
    expect(await holdoutNoveltyPolicyHash()).toBe(FROZEN_HOLDOUT_NOVELTY_POLICY_HASH);
    expect(JSON.stringify(report)).not.toContain("ceramic");
    expect(JSON.stringify(report)).not.toContain("pencils");
  });

  it("rejects a wrong or unsalted commitment without revealing plaintext", async () => {
    const candidate = panel();
    const unsalted = await sha256(stableJson({ ...candidate, saltHex: undefined }));
    const report = await verifyOpenedHoldoutPanel({ panel: candidate, expectedCommitment: unsalted });
    expect(report.pass).toBe(false);
    expect(report.commitmentMatches).toBe(false);
  });

  it("counts prior sealed panels in the novelty universe", async () => {
    const candidate = panel();
    const committed = await holdoutCommitment(candidate);
    const report = await verifyOpenedHoldoutPanel({
      panel: candidate,
      expectedCommitment: committed.commitment,
      priorNoveltyUniverse: {
        priorObjectAliases: candidate.cases.flatMap((item) => item.objectAliases),
        priorRelationTuples: candidate.cases.map((item) => item.relationTuple)
      }
    });
    expect(report).toMatchObject({ pass: false, noveltyPass: false, novelCaseCount: 0 });
  });

  it("strictly rejects extra protocol fields and insufficient salt", () => {
    const candidate = panel();
    expect(() => SealedHoldoutPanelV1Schema.parse({ ...candidate, saltHex: "abcd" })).toThrow();
    expect(() => SealedHoldoutPanelV1Schema.parse({
      ...candidate,
      protocol: { ...candidate.protocol, executablePredicate: "return true" }
    })).toThrow();
  });
});
