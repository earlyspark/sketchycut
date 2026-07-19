import type { RuntimeConfig } from "./config.js";
import type { GenerationStore } from "./contracts.js";
import { MemoryGenerationStore } from "./memory-store.js";
import { UpstashGenerationStore } from "./upstash-store.js";

const DEVELOPMENT_MEMORY_STORE = Symbol.for("sketchycut.current.memory-store.v1");
let memoryStore: MemoryGenerationStore | undefined;

function developmentMemoryStore(): MemoryGenerationStore {
  const shared = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = shared[DEVELOPMENT_MEMORY_STORE] as MemoryGenerationStore | undefined;
  if (existing !== undefined) return existing;
  const created = new MemoryGenerationStore();
  shared[DEVELOPMENT_MEMORY_STORE] = created;
  return created;
}

export function createGenerationStore(
  config: RuntimeConfig,
): GenerationStore {
  if (config.storeMode === "memory") {
    if (process.env.NODE_ENV === "development") return developmentMemoryStore();
    memoryStore ??= new MemoryGenerationStore();
    return memoryStore;
  }
  if (config.upstash === null) throw new Error("GENERATION_STORE_UPSTASH_CONFIG_MISSING");
  return new UpstashGenerationStore(config.upstash);
}
