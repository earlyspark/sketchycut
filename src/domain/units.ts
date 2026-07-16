const MICROMETRES_PER_MILLIMETRE = 1_000;

declare const micrometreBrand: unique symbol;
declare const millimetreBrand: unique symbol;

export type Micrometre = number & { readonly [micrometreBrand]: "Micrometre" };
export type Millimetre = number & { readonly [millimetreBrand]: "Millimetre" };

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
}

export function um(value: number): Micrometre {
  assertFinite(value, "Micrometre value");
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Micrometre value must be a safe integer.");
  }
  return value as Micrometre;
}

export function mm(value: number): Millimetre {
  assertFinite(value, "Millimetre value");
  return value as Millimetre;
}

export function mmToUm(value: number): Micrometre {
  assertFinite(value, "Millimetre value");
  return um(Math.round(value * MICROMETRES_PER_MILLIMETRE));
}

export function umToMm(value: number): Millimetre {
  return mm(value / MICROMETRES_PER_MILLIMETRE);
}

export function addUm(...values: readonly number[]): Micrometre {
  return um(values.reduce((sum, value) => sum + value, 0));
}

export function subtractUm(left: number, right: number): Micrometre {
  return um(left - right);
}

export function scaleUm(value: number, factor: number): Micrometre {
  assertFinite(factor, "Scale factor");
  return um(Math.round(value * factor));
}
