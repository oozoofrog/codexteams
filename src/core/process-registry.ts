import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TeamController } from "./controller.ts";

// This symbol intentionally has a stable name across independently loaded module graphs.
const KEY = Symbol.for("codexteams.process-owners");
const source = realpathSync(fileURLToPath(new URL("../index.ts", import.meta.url)));
export interface ScreenBinding {
  token: object;
  changed(): void;
  message(content: string, type?: string): void;
  notify(content: string, level?: "info" | "warning" | "error"): void;
}
export interface ProcessOwner {
  controller: TeamController;
  registry: ExtensionContext["modelRegistry"];
  sessionDir?: string;
  binding?: ScreenBinding;
}
interface Registry { version: 1; source: string; owners: Map<string, ProcessOwner>; cleanup?: Promise<void> }
export function processRegistry(): Registry {
  const global = globalThis as typeof globalThis & { [KEY]?: Registry };
  const existing = global[KEY];
  if (existing) {
    if (existing.version !== 1 || existing.source !== source || !existing.owners || typeof existing.owners.get !== "function" || typeof existing.owners.set !== "function" || typeof existing.owners[Symbol.iterator] !== "function") throw new Error("Incompatible codexteams process registry; restart Pi without active work.");
    return existing;
  }
  return global[KEY] = { version: 1, source, owners: new Map() };
}
export async function cleanupOwners(registry: Registry): Promise<void> {
  if (registry.cleanup) return registry.cleanup;
  registry.cleanup = (async () => {
    const failures: unknown[] = [];
    for (const [root, owner] of registry.owners) {
      owner.binding = undefined;
      try { await owner.controller.shutdown(); registry.owners.delete(root); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Some codexteams owners could not be cleaned up.");
  })();
  try { await registry.cleanup; } finally { registry.cleanup = undefined; }
}
