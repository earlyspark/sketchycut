import {
  CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
  SemanticInterpretationCandidateSchema,
  expandSemanticInterpretationCandidate,
  type SemanticInterpretationCandidate
} from "../../src/interpretation/semantic-model-contract.js";
import { CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION } from "../../src/interpretation/semantic-atom-registry.js";
import {
  SemanticInterpretationSchema,
  type SemanticInterpretation
} from "../../src/interpretation/semantic-interpretation.js";
import type { SourceEvidenceIndex } from "../../src/interpretation/source-evidence.js";

export function basicSemanticCandidate(input: {
  sourceEvidenceIndex: SourceEvidenceIndex;
  mutate?: (candidate: SemanticInterpretationCandidate) => void;
}): SemanticInterpretationCandidate {
  const evidenceId = input.sourceEvidenceIndex.spans[0]?.evidenceId;
  if (evidenceId === undefined) throw new Error("TEST_SEMANTIC_BRIEF_EVIDENCE_MISSING");
  const candidate: SemanticInterpretationCandidate = {
    schemaVersion: CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION,
    atomTemplateVersion: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    items: [{
      claim: "The construction retains its intended contents and remains accessible from above.",
      importance: "essential",
      evidenceBindings: [{ evidenceId, aspect: "structure", support: "direct" }],
      relationships: [],
      measurements: [],
      state: "bound",
      atoms: [
        {
          kind: "primary-enclosure",
          enclosure: {
            quantity: null,
            priority: "must",
            evidenceIds: [evidenceId]
          },
          access: {
            kind: "open-top",
            priority: "must",
            evidenceIds: [evidenceId]
          },
          space: {
            layout: "unspecified",
            priority: "must",
            evidenceIds: [evidenceId]
          }
        }
      ]
    }]
  };
  input.mutate?.(candidate);
  return SemanticInterpretationCandidateSchema.parse(candidate);
}

export function basicSemanticInterpretation(input: {
  sourceEvidenceIndex: SourceEvidenceIndex;
  mutate?: (interpretation: SemanticInterpretation) => void;
}): SemanticInterpretation {
  const interpretation = expandSemanticInterpretationCandidate(
    basicSemanticCandidate({ sourceEvidenceIndex: input.sourceEvidenceIndex }),
    input.sourceEvidenceIndex,
  );
  input.mutate?.(interpretation);
  return SemanticInterpretationSchema.parse(interpretation);
}
