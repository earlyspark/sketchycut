import type { CurrentGenerationResponse } from "../server/generation/api-contracts-v2.js";
import type {
  DiversityCaseObservation,
  DiversityCaseProtocol,
  SemanticOpportunityKind,
  SemanticOpportunityObservation
} from "./semantic-diversity.js";

type SupportedResponse = CurrentGenerationResponse & {
  outcome: Extract<CurrentGenerationResponse["outcome"], { kind: "supported" | "simplified" }>;
};

const axisValue = (
  dimensions: NonNullable<DiversityCaseObservation["dimensions"]>,
  axis: "widthMm" | "depthMm" | "heightMm",
): number => dimensions[axis];

function dimensionDirectionPass(
  protocol: DiversityCaseProtocol,
  dimensions: NonNullable<DiversityCaseObservation["dimensions"]>,
): boolean {
  return protocol.aspectRatioPredicates.every((predicate) => {
    const ratio = axisValue(dimensions, predicate.numerator) /
      axisValue(dimensions, predicate.denominator);
    return predicate.comparison === "at-least"
      ? ratio >= predicate.threshold
      : ratio <= predicate.threshold;
  });
}

function topologyDirectionPass(
  protocol: DiversityCaseProtocol,
  response: SupportedResponse,
): boolean {
  const topology = response.outcome.source.selectedPlan.topology;
  return protocol.topologyPredicates.every((predicate) => {
    switch (predicate.kind) {
      case "opening-face-includes":
        return (topology.access === "open-front" ? "front" : "top") === predicate.face;
      case "usable-space-count":
        return topology.canonicalSpaces.length === predicate.count;
      case "divider-partition-present":
        return topology.canonicalSpaces.length > 1;
      case "closure-mechanism":
        return (topology.mechanism === "rigid" ? "none" : topology.mechanism) ===
          predicate.mechanism;
      case "construction-body-role-includes":
        return response.outcome.source.intent.constructionBodies.some((body) =>
          body.role === predicate.role
        );
    }
  });
}

function opportunityFacts(
  kind: SemanticOpportunityKind,
  protocol: DiversityCaseProtocol,
  response: SupportedResponse,
): { correctlyTargeted: boolean; correctDirection: boolean }[] {
  const { intent, selectedPlan, selectedSizing } = response.outcome.source;
  const bodyIds = new Set(intent.constructionBodies.map((body) => body.id));
  const objectIds = new Set(intent.objects.map((object) => object.id));
  const dimensions = {
    widthMm: selectedSizing.external.widthUm / 1_000,
    depthMm: selectedSizing.external.depthUm / 1_000,
    heightMm: selectedSizing.external.heightUm / 1_000
  };
  switch (kind) {
    case "proportions":
      return intent.proportions.map((item) => ({
        correctlyTargeted: bodyIds.has(item.targetBodyId),
        correctDirection: dimensionDirectionPass(protocol, dimensions)
      }));
    case "counts":
      return intent.organization
        .filter((item) => item.desiredSpaceCount !== null || item.rows !== null || item.columns !== null)
        .map((item) => ({
          correctlyTargeted: bodyIds.has(item.bodyId),
          correctDirection: item.desiredSpaceCount === null ||
            item.desiredSpaceCount === selectedPlan.topology.canonicalSpaces.length
        }));
    case "scaleEvidence":
      return intent.scaleEvidence.map((item) => ({
        correctlyTargeted: objectIds.has(item.objectId),
        correctDirection: item.long.minimumUm <= item.long.maximumUm &&
          item.short.minimumUm <= item.short.maximumUm &&
          item.height.minimumUm <= item.height.maximumUm
      }));
    case "access":
      return intent.access.map((item) => ({
        correctlyTargeted: bodyIds.has(item.bodyId),
        correctDirection: topologyDirectionPass(protocol, response)
      }));
  }
}

function observationsForKind(
  kind: SemanticOpportunityKind,
  protocol: DiversityCaseProtocol,
  response: SupportedResponse,
): SemanticOpportunityObservation[] {
  const facts = opportunityFacts(kind, protocol, response);
  return protocol.expectedFieldOpportunities[kind].map((opportunityId, index) => ({
    opportunityId,
    kind,
    schemaValid: true,
    evidenceAuthorized: true,
    correctlyTargeted: facts[index]?.correctlyTargeted ?? false,
    correctDirection: facts[index]?.correctDirection ?? false
  }));
}

export function buildDiversityCaseObservation(input: {
  protocol: DiversityCaseProtocol;
  response: CurrentGenerationResponse;
}): DiversityCaseObservation {
  const response = input.response;
  if ((response.outcome.kind !== "supported" && response.outcome.kind !== "simplified") ||
      response.compiled === null) {
    return {
      caseId: input.protocol.id,
      outcome: response.outcome.kind,
      deterministicGatesPass: false,
      opportunities: [],
      dimensions: null,
      topology: null,
      canonicalDefaultProportionsUsed: false
    };
  }
  const supportedResponse = response as SupportedResponse;
  const topology = supportedResponse.outcome.source.selectedPlan.topology;
  const spaces = topology.canonicalSpaces.map((item) => item.id);
  const opportunityKinds = ["proportions", "counts", "scaleEvidence", "access"] as const;
  return {
    caseId: input.protocol.id,
    outcome: response.outcome.kind,
    deterministicGatesPass: response.compiled.document.validation.status === "pass",
    opportunities: opportunityKinds.flatMap((kind) =>
      observationsForKind(kind, input.protocol, supportedResponse)
    ),
    dimensions: {
      widthMm: supportedResponse.outcome.source.selectedSizing.external.widthUm / 1_000,
      depthMm: supportedResponse.outcome.source.selectedSizing.external.depthUm / 1_000,
      heightMm: supportedResponse.outcome.source.selectedSizing.external.heightUm / 1_000
    },
    topology: {
      constructionBodyRoles: supportedResponse.outcome.source.intent.constructionBodies
        .map((body) => body.role).sort(),
      openingFaces: [topology.access === "open-front" ? "front" : "top"],
      usableSpaceCount: spaces.length,
      dividerPartitionGraph: spaces.slice(1).map((space, index) =>
        `${spaces[index]!}|${space}`
      ),
      closureMechanism:
        topology.mechanism === "rigid" || topology.mechanism === "fixed-top-frame"
          ? "none"
          : topology.mechanism
    },
    canonicalDefaultProportionsUsed:
      supportedResponse.outcome.source.selectedSizing.canonicalDefaultProportions.used
  };
}
