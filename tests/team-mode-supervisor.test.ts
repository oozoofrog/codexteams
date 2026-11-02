import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/core/store.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";

function setup(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-supervisor-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root);
  t.after(() => store.close());
  let resolve!: (result: WorkerResult) => void;
  let request!: WorkerRequest;
  let runner: (req: WorkerRequest) => Promise<WorkerResult>;
  const started = new Promise<void>(done => {
    runner = req => { request = req; done(); return new Promise(r => { resolve = r; }); };
  });
  const supervisor = new TeamModeSupervisor(store, { runner: req => runner(req), validateProfile: async () => {} });
  return { store, supervisor, started, request: () => request, finish: (text: string) => resolve({ outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: ["actual-model"], sessionId: request.sessionId }) };
}

test("question is persisted before coordination and answered without tasks", async t => {
  const f = setup(t); await f.supervisor.setMode(true);
  const id = f.supervisor.ingest({ text: "What is the status?", origin: "rpc", sessionId: "session-1" });
  assert.equal(f.store.snapshot().teamMode?.requests[0].id, id);
  await f.started;
  assert.deepEqual(f.request().tools, ["read", "grep", "find", "ls"]);
  const attempt = f.store.snapshot().teamMode!.coordinatorAttempts[0];
  f.finish(JSON.stringify({ kind: "answer", requestId: id, generation: attempt.generation, revision: 1, text: "No work yet" }));
  await f.supervisor.whenIdle();
  assert.equal(f.store.snapshot().teamMode?.requests[0].status, "answered");
  assert.equal(f.store.snapshot().tasks.length, 0);
  assert.deepEqual(f.store.snapshot().teamMode?.coordinatorAttempts[0].effectiveModels, ["actual-model"]);
  await f.supervisor.shutdown();
});

test("OFF fences a late successful coordinator result", async t => {
  const f = setup(t); await f.supervisor.setMode(true);
  const id = f.supervisor.ingest({ text: "What is the status?", origin: "interactive", sessionId: "session-1" });
  await f.started;
  const attempt = f.store.snapshot().teamMode!.coordinatorAttempts[0];
  await f.supervisor.setMode(false);
  assert.equal(f.request().signal?.aborted, true);
  f.finish(JSON.stringify({ kind: "answer", requestId: id, generation: attempt.generation, revision: 1, text: "late" }));
  await f.supervisor.whenIdle();
  assert.notEqual(f.store.snapshot().teamMode?.requests[0].status, "answered");
  assert.equal(f.store.snapshot().teamMode?.enabled, false);
  await f.supervisor.shutdown();
});
