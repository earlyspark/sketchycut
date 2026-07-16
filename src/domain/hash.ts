const textEncoder = new TextEncoder();

type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function normalize(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot contain non-finite numbers.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, normalize(record[key])]),
    );
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? textEncoder.encode(value) : value;
  const buffer = Uint8Array.from(bytes).buffer;
  return toHex(await globalThis.crypto.subtle.digest("SHA-256", buffer));
}

export async function hashCanonical(value: unknown): Promise<string> {
  return sha256(stableJson(value));
}
