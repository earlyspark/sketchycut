import type { MotionConstraint } from "../domain/contracts.js";
import { contoursOverlap, offsetRegion } from "../kernel/geometry/clipper-adapter.js";

type PrismaticDetails = NonNullable<MotionConstraint["prismatic"]>;
type ProofPrimitive = PrismaticDetails["proofModel"]["movingPrimitives"][number];
type ForbiddenInterval = PrismaticDetails["proofModel"]["forbiddenIntervals"][number];

export type PrismaticProofReport = {
  schemaVersion: "1.0";
  method: "transverse-overlap-axial-forbidden-intervals";
  constraintId: string;
  status: "pass" | "fail";
  transversePairCount: number;
  overlappingTransversePairCount: number;
  animationSampleMaximumUm: 1_000;
  animationSampleCount: number;
  forbiddenIntervals: ForbiddenInterval[];
  normalTravelConflicts: ForbiddenInterval[];
  endpointContacts: {
    id: string;
    movingPrimitiveId: string;
    stationaryPrimitiveId: string;
    positionUm: number;
    status: "certified" | "failed";
  }[];
  canonicalIntervalsMatch: boolean;
};

function inflatedRegion(
  primitive: ProofPrimitive,
  inflationUm: number,
) {
  if (inflationUm === 0) return primitive.transverseRegion;
  return offsetRegion(
    primitive.transverseRegion,
    inflationUm,
    `${primitive.id}-proof-inflated`,
  );
}

export function derivePrismaticForbiddenIntervals(
  constraint: MotionConstraint,
): ForbiddenInterval[] {
  if (constraint.kind !== "prismatic" || constraint.prismatic === undefined) {
    throw new Error("Prismatic interval proof requires a canonical prismatic constraint.");
  }
  const proof = constraint.prismatic.proofModel;
  const moving = proof.movingPrimitives.map((primitive) => ({
    primitive,
    transverse: inflatedRegion(primitive, proof.transverseInflationUm)
  }));
  const stationary = proof.stationaryPrimitives.map((primitive) => ({
    primitive,
    transverse: inflatedRegion(primitive, proof.transverseInflationUm)
  }));
  const intervals: ForbiddenInterval[] = [];
  for (const movingItem of moving) {
    for (const stationaryItem of stationary) {
      if (!contoursOverlap(movingItem.transverse.outer, stationaryItem.transverse.outer)) {
        continue;
      }
      intervals.push({
        id: `${movingItem.primitive.id}-vs-${stationaryItem.primitive.id}-forbidden`,
        movingPrimitiveId: movingItem.primitive.id,
        stationaryPrimitiveId: stationaryItem.primitive.id,
        minimumExclusiveUm:
          stationaryItem.primitive.axialStartUm - movingItem.primitive.axialEndUm,
        maximumExclusiveUm:
          stationaryItem.primitive.axialEndUm - movingItem.primitive.axialStartUm
      });
    }
  }
  return intervals.sort((left, right) =>
    left.minimumExclusiveUm - right.minimumExclusiveUm ||
    left.maximumExclusiveUm - right.maximumExclusiveUm ||
    left.id.localeCompare(right.id),
  );
}

function openIntervalsIntersect(
  interval: ForbiddenInterval,
  minimumUm: number,
  maximumUm: number,
): boolean {
  return Math.max(interval.minimumExclusiveUm, minimumUm) <
    Math.min(interval.maximumExclusiveUm, maximumUm);
}

function sameIntervals(
  left: readonly ForbiddenInterval[],
  right: readonly ForbiddenInterval[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function certifyPrismaticTravel(
  constraint: MotionConstraint,
): PrismaticProofReport {
  if (constraint.kind !== "prismatic" || constraint.prismatic === undefined) {
    throw new Error("Prismatic interval proof requires a canonical prismatic constraint.");
  }
  const details = constraint.prismatic;
  const derived = derivePrismaticForbiddenIntervals(constraint);
  const normalTravelConflicts = derived.filter((interval) =>
    openIntervalsIntersect(
      interval,
      details.normalTravelUm.minimum,
      details.normalTravelUm.maximum,
    ),
  );
  const endpointContacts = details.proofModel.allowedEndpointContacts.map((contact) => {
    const interval = derived.find(
      (candidate) =>
        candidate.movingPrimitiveId === contact.movingPrimitiveId &&
        candidate.stationaryPrimitiveId === contact.stationaryPrimitiveId,
    );
    const atBoundary = interval !== undefined && (
      interval.minimumExclusiveUm === contact.positionUm ||
      interval.maximumExclusiveUm === contact.positionUm
    );
    const atNormalEndpoint =
      contact.positionUm === details.normalTravelUm.minimum ||
      contact.positionUm === details.normalTravelUm.maximum;
    return {
      id: contact.id,
      movingPrimitiveId: contact.movingPrimitiveId,
      stationaryPrimitiveId: contact.stationaryPrimitiveId,
      positionUm: contact.positionUm,
      status: atBoundary && atNormalEndpoint ? "certified" as const : "failed" as const
    };
  });
  const canonicalIntervals = [...details.proofModel.forbiddenIntervals].sort(
    (left, right) =>
      left.minimumExclusiveUm - right.minimumExclusiveUm ||
      left.maximumExclusiveUm - right.maximumExclusiveUm ||
      left.id.localeCompare(right.id),
  );
  const canonicalIntervalsMatch = sameIntervals(derived, canonicalIntervals);
  const transversePairCount =
    details.proofModel.movingPrimitives.length *
    details.proofModel.stationaryPrimitives.length;
  const status =
    normalTravelConflicts.length === 0 &&
    endpointContacts.every((contact) => contact.status === "certified") &&
    canonicalIntervalsMatch
      ? "pass"
      : "fail";
  return {
    schemaVersion: "1.0",
    method: details.proofModel.method,
    constraintId: constraint.id,
    status,
    transversePairCount,
    overlappingTransversePairCount: derived.length,
    animationSampleMaximumUm: details.proofModel.animationSampleMaximumUm,
    animationSampleCount:
      Math.ceil(
        (details.normalTravelUm.maximum - details.normalTravelUm.minimum) /
          details.proofModel.animationSampleMaximumUm,
      ) + 1,
    forbiddenIntervals: derived,
    normalTravelConflicts,
    endpointContacts,
    canonicalIntervalsMatch
  };
}
