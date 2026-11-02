import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupOwners, processRegistry } from "../src/core/process-registry.ts";

test("registry rejects incompatible schema and source without replacing them", () => {
  const key = Symbol.for("codexteams.process-owners");
  const global = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const previous = global[key];
  try {
    const bad = { version: 999, source: "other", owners: new Map() };
    global[key] = bad;
    assert.throws(() => processRegistry(), /Incompatible/);
    assert.equal(global[key], bad);
    global[key] = { version: 1, source: "other", owners: new Map() };
    assert.throws(() => processRegistry(), /Incompatible/);
  } finally { if (previous === undefined) delete global[key]; else global[key] = previous; }
});

test("all owners are fenced and detached before the first drain can wait", async () => {
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  const fenced: string[] = [], registry = { version: 1 as const, source: "fixture", owners: new Map([
    ["a", { binding: {}, controller: { beginShutdown: () => fenced.push("controller-a"), shutdown: () => pending }, supervisor: { beginShutdown: () => fenced.push("supervisor-a"), shutdown: async () => {} } }],
    ["b", { binding: {}, controller: { beginShutdown: () => fenced.push("controller-b"), shutdown: async () => {} }, supervisor: { beginShutdown: () => fenced.push("supervisor-b"), shutdown: async () => {} } }],
  ]) };
  const cleanup = cleanupOwners(registry as never);
  assert.deepEqual(fenced, ["supervisor-a", "controller-a", "supervisor-b", "controller-b"]);
  assert.equal(registry.owners.get("b")!.binding, undefined);
  release(); await cleanup;
});

test("final cleanup tries every root and preserves failed owner for retry", async () => {
  const calls: string[] = []; let fails = true;
  const registry = { version: 1 as const, source: "fixture", owners: new Map([
    ["a", { controller: { shutdown: async () => { calls.push("a"); if (fails) throw Error("uncertain cleanup"); } } }],
    ["b", { controller: { shutdown: async () => { calls.push("b"); } } }],
  ]) };
  await assert.rejects(cleanupOwners(registry as never), /could not be cleaned/);
  assert.deepEqual(calls, ["a", "b"]); assert.deepEqual([...registry.owners.keys()], ["a"]);
  fails = false; await cleanupOwners(registry as never); await cleanupOwners(registry as never);
  assert.deepEqual(calls, ["a", "b", "a"]); assert.equal(registry.owners.size, 0);
});
