import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";

test("operation snapshot follows a real pending worker and is cleared only after settlement", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-home-operation-"));
  let request!: WorkerRequest;
  let release!: (value: WorkerResult) => void;
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const team = new TeamController(ProjectStore.open(root), {
    validateProfile: async () => {},
    runner: req => new Promise(resolve => { request = req; release = resolve; ready(); }),
  });
  t.after(async () => { await team.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const task = team.add("developer", "작업");
  const pending = team.run(task.id);
  await started;
  try {
    const op = team.activeOperation;
    assert.equal(op?.kind, "task");
    assert.equal(op?.taskId, task.id);
    assert.equal(op?.phase, "waiting");
    assert.ok(op?.startedAt && op.lastActivityAt && op.attemptId);
    request.onEvent!({ type: "text", text: "부분 응답" });
    assert.equal(team.activeOperation?.phase, "response");
    request.onEvent!({ type: "tool", phase: "start", name: "read" });
    assert.equal(team.activeOperation?.phase, "tool");
    assert.equal(team.activeOperation?.toolName, "read");
  } finally {
    release({ outcome: "success", text: "완료", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId });
    await pending;
  }
  assert.equal(team.activeOperation, undefined);
  assert.equal(team.snapshot().tasks[0].status, "needs_review");
});

test("active check remains separate from review status and cancel waits for settlement", { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-home-check-"));
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => {}, runner: async req => ({ outcome: "success", text: "result", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: req.sessionId }) });
  t.after(async () => { await team.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const task = team.add("developer", "check target"); await team.run(task.id);
  const pending = team.check(task.id, `${JSON.stringify(process.execPath)} -e 'setInterval(() => {}, 1000)'`);
  for (let i = 0; i < 200 && !team.snapshot().tasks[0].checks[0]?.workerPid; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(team.snapshot().tasks[0].status, "needs_review");
  assert.equal(team.activeOperation?.kind, "check"); assert.equal(team.activeOperation?.phase, "checking"); assert.ok(team.activeOperation?.checkId);
  const cancellation = team.cancel(); assert.equal(team.activeOperation?.phase, "stopping");
  await cancellation; await pending; assert.equal(team.activeOperation, undefined);
  assert.equal(team.snapshot().tasks[0].checks[0].status, "interrupted");
});

test("planning operation and failed preflight do not fabricate a worker result", { timeout: 5000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-home-plan-"));
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); throw Error("model unavailable"); }, runner: async () => { throw Error("unexpected worker"); } });
  t.after(async () => { release?.(); await team.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const pending = team.start("goal"); await ready;
  assert.equal(team.activeOperation?.kind, "planning"); assert.equal(team.activeOperation?.phase, "preflight");
  release(); await assert.rejects(pending, /model unavailable/);
  assert.equal(team.activeOperation, undefined); assert.equal(team.snapshot().planningAttempts.length, 0);
});
