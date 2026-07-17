"use client";

import { useMemo, useState } from "react";

import {
  createStarterFabricationSetup,
  type AppliedFabricationSetup
} from "../../domain/fabrication-setup";
import type { NominalStockPresetId } from "../../domain/stock-catalog";

export type FabricationSetupDraft = {
  stockPresetId: NominalStockPresetId;
  thickness: {
    basis: "nominal-preset" | "user-reported-caliper";
    readings: [string, string, string];
  };
  cutWidth: {
    source: "provisional-preset" | "user-reported-manual" | "fixture-derived";
    manualX: string;
    manualY: string;
    packedRow: string;
    packedColumn: string;
  };
  pin: {
    basis: "nominal-preset" | "user-reported-caliper";
    diameter: string;
  };
};

function formatMm(value: number): string {
  return value.toFixed(2);
}

export function draftFromApplied(
  applied: AppliedFabricationSetup,
): FabricationSetupDraft {
  const thicknessReadings = applied.thickness.basis === "nominal-preset"
    ? [formatMm(applied.thickness.effectiveThicknessMm), "", ""] as [string, string, string]
    : [
        formatMm(applied.thickness.readingsMm[0]),
        applied.thickness.readingsMm[1] === undefined
          ? ""
          : formatMm(applied.thickness.readingsMm[1]),
        applied.thickness.readingsMm[2] === undefined
          ? ""
          : formatMm(applied.thickness.readingsMm[2])
      ] as [string, string, string];
  return {
    stockPresetId: applied.stockPresetId,
    thickness: {
      basis: applied.thickness.basis,
      readings: thicknessReadings
    },
    cutWidth: {
      source: applied.cutWidth.source === "fixture-derived"
        ? "fixture-derived"
        : applied.cutWidth.source === "user-reported-manual"
        ? "user-reported-manual"
        : "provisional-preset",
      manualX: formatMm(applied.cutWidth.xMm),
      manualY: formatMm(applied.cutWidth.yMm),
      packedRow: applied.cutWidth.fixtureEvidence === undefined
        ? ""
        : formatMm(applied.cutWidth.fixtureEvidence.enteredPackedSpanMm.row),
      packedColumn: applied.cutWidth.fixtureEvidence === undefined
        ? ""
        : formatMm(applied.cutWidth.fixtureEvidence.enteredPackedSpanMm.column)
    },
    pin: {
      basis: applied.pin.basis,
      diameter: formatMm(applied.pin.effectiveDiameterMm)
    }
  };
}

export function useAppliedFabricationSetup() {
  const [applied, setApplied] = useState<AppliedFabricationSetup>(() =>
    createStarterFabricationSetup(),
  );
  const [draft, setDraft] = useState<FabricationSetupDraft>(() =>
    draftFromApplied(createStarterFabricationSetup()),
  );
  const stale = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(draftFromApplied(applied)),
    [applied, draft],
  );

  const apply = (nextApplied: AppliedFabricationSetup): void => {
    const immutable = structuredClone(nextApplied);
    setApplied(immutable);
    setDraft(draftFromApplied(immutable));
  };
  const discard = (): void => setDraft(draftFromApplied(applied));
  const chooseStarter = (stockPresetId = draft.stockPresetId): void => {
    setDraft(draftFromApplied(createStarterFabricationSetup(stockPresetId)));
  };

  return {
    applied,
    draft,
    stale,
    setDraft,
    apply,
    discard,
    chooseStarter
  };
}
