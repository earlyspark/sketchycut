"use client";

import { useMemo, useReducer, useState } from "react";

import {
  createStarterFabricationSetup,
  type AppliedFabricationSetup,
  type AppliedPinSetup
} from "../../domain/fabrication-setup";
import type { StockFootprint } from "../../domain/contracts";
import type { NominalStockPresetId } from "../../domain/stock-catalog";
import {
  activeCapabilityIsStale,
  capabilityInputReducer,
  createCapabilityInputState,
  type RetainedPinDraft
} from "../capability-input-state";

export type FabricationSetupDraft = {
  stockPresetId: NominalStockPresetId;
  stockFootprint: StockFootprint | null;
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
    stockFootprint: applied.stockFootprint,
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
  const [capabilityInputs, dispatchCapabilityInput] = useReducer(
    capabilityInputReducer,
    undefined,
    () => createCapabilityInputState("retained-pin"),
  );
  const sharedStale = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(draftFromApplied(applied)),
    [applied, draft],
  );
  const capabilityStale = activeCapabilityIsStale(capabilityInputs);
  const stale = sharedStale || capabilityStale;

  const apply = (
    nextApplied: AppliedFabricationSetup,
    nextPin?: AppliedPinSetup,
  ): void => {
    const immutable = structuredClone(nextApplied);
    setApplied(immutable);
    setDraft(draftFromApplied(immutable));
    if (nextPin !== undefined) {
      dispatchCapabilityInput({ type: "apply-retained-pin", applied: nextPin });
    }
  };
  const discard = (): void => {
    setDraft(draftFromApplied(applied));
    dispatchCapabilityInput({ type: "discard-retained-pin" });
  };
  const chooseStarter = (stockPresetId = draft.stockPresetId): void => {
    setDraft(draftFromApplied(createStarterFabricationSetup(stockPresetId)));
  };

  return {
    applied,
    draft,
    stale,
    sharedStale,
    capabilityStale,
    capabilityInputs,
    setDraft,
    setRetainedPinDraft: (next: RetainedPinDraft): void => {
      dispatchCapabilityInput({ type: "edit-retained-pin", draft: next });
    },
    apply,
    discard,
    chooseStarter
  };
}
