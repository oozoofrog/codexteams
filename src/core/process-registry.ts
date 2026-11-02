import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TeamController } from "./controller.ts";
import type { TeamModeSupervisor } from "./team-mode.ts";

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
  supervisor?: TeamModeSupervisor;
  registry: ExtensionContext["modelRegistry"];
  sessionDir?: string;
  binding?: ScreenBinding;
}
interface Registry { version: 1; source: string; owners: Map<string, ProcessOwner>; cleanup?: Promise<void>; pendingHome?: { root: string; file: string } }
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
  const failures: unknown[] = [];
  const failedFences = new Set<ProcessOwner>();
  for (const owner of registry.owners.values()) owner.binding = undefined;
  for (const owner of registry.owners.values()) {
    try { owner.supervisor?.fenceScheduling?.(); } catch (error) { failedFences.add(owner); failures.push(error); }
    try { owner.controller.fenceScheduling?.(); } catch (error) { failedFences.add(owner); failures.push(error); }
  }
  for (const owner of registry.owners.values()) {
    try { owner.supervisor?.beginShutdown(); } catch (error) { failedFences.add(owner); failures.push(error); }
    try { owner.controller.beginShutdown?.(); } catch (error) { failedFences.add(owner); failures.push(error); }
  }
  registry.cleanup = (async () => {
    for (const [root, owner] of registry.owners) {
      let failed = failedFences.has(owner);
      try { await owner.supervisor?.shutdown(); } catch (error) { failed = true; failures.push(error); }
      try { await owner.controller.shutdown(); } catch (error) { failed = true; failures.push(error); }
      if (!failed) registry.owners.delete(root);
    }
    if (failures.length) throw new AggregateError(failures, "Some codexteams owners could not be cleaned up.");
  })();
  try { await registry.cleanup; } finally { registry.cleanup = undefined; }
}
