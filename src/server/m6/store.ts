import type { M6RuntimeConfig } from "./config.js";
import type { M6Store } from "./contracts.js";
import { MemoryM6Store } from "./memory-store.js";
import { UpstashM6Store } from "./upstash-store.js";

const DEVELOPMENT_MEMORY_STORE = Symbol.for("sketchycut.m6.memory-store.v1");
let memoryStore: MemoryM6Store | undefined;

function developmentMemoryStore(): MemoryM6Store {
  const shared = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = shared[DEVELOPMENT_MEMORY_STORE] as MemoryM6Store | undefined;
  if (existing !== undefined) return existing;
  const created = new MemoryM6Store();
  shared[DEVELOPMENT_MEMORY_STORE] = created;
  return created;
}

export function createM6Store(
  config: M6RuntimeConfig,
): M6Store {
  if (config.storeMode === "memory") {
    if (process.env.NODE_ENV === "development") return developmentMemoryStore();
    memoryStore ??= new MemoryM6Store();
    return memoryStore;
  }
  if (config.upstash === null) throw new Error("M6_STORE_UPSTASH_CONFIG_MISSING");
  return new UpstashM6Store(config.upstash);
}
