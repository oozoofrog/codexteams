import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import type { WorkerRequest, WorkerResult, WorkerRunner } from "../src/core/types.ts";

const known = { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, reasoning: 12, totalTokens: 30, costUsd: 0.001, responses: 1, completeness: "known" as const };
const plan = { tasks: [
  { id: "scan", title: "스캔", description: "폴더를 탐색", role: "developer", dependsOn: [], acceptance: ["파일 수가 일치"] },
  { id: "view", title: "화면", description: "결과 표시", role: "designer", dependsOn: ["scan"], acceptance: ["결과가 보임"] },
] };
function result(request: WorkerRequest, text = "implemented"): WorkerResult {
  return { outcome: "success", text, exitCode: 0, usage: known, effectiveModels: [`${request.profile.provider}/${request.profile.model}`], sessionId: request.sessionId };
}
function setup(t: { after: (fn: () => void | Promise<void>) => void }, runner: WorkerRunner) {
  const root = mkdtempSync(join(tmpdir(), "codexteams-controller-"));
  const store = ProjectStore.open(root);
  const controller = new TeamController(store, { runner, validateProfile: async () => undefined });
  t.after(async () => { await controller.shutdown(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, controller };
}

test("goal -> validated plan -> task -> review -> acceptance unlocks dependency", async t => {
  const requests: WorkerRequest[] = [];
  const { controller } = setup(t, async request => { requests.push(request); return result(request, requests.length === 1 ? JSON.stringify(plan) : "implemented"); });
  await controller.start("디스크 앱");
  assert.deepEqual(requests[0].tools, ["read", "grep", "find", "ls"]);
  assert.equal(requests[0].profile.model, "gpt-6.1-sol");
  const first = await controller.run();
  assert.deepEqual(first.executed, ["scan"]);
  assert.equal(controller.snapshot().tasks[0].status, "needs_review");
  assert.equal(controller.snapshot().tasks[1].status, "queued");
  controller.accept("scan");
  const second = await controller.run();
  assert.deepEqual(second.executed, ["view"]);
  assert.equal(requests[2].profile.model, "gpt-6.1-terra");
  assert.equal(controller.snapshot().tasks[0].acceptanceSource, "user");
});

test("malformed planner output is recorded as failed without publishing tasks", async t => {
  const { controller } = setup(t, async req => result(req, '{"tasks":[{"approval":true}]}'));
  await assert.rejects(controller.start("keep goal"), /작업|계획|필드/);
  assert.equal(controller.snapshot().goal, "keep goal");
  assert.equal(controller.snapshot().tasks.length, 0);
  assert.equal(controller.snapshot().planningAttempts[0].outcome, "failed");
});

test("pending planning rejects additions before they can collide with the plan", async t => {
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const planned = { tasks: [{ ...plan.tasks[0], id: "task-1" }] };
  const { controller } = setup(t, req => new Promise(resolve => {
    release = () => resolve(result(req, JSON.stringify(planned)));
    started();
  }));
  const planning = controller.start("disk app");
  let planningError: unknown;
  await ready;
  try {
    assert.throws(() => controller.add("developer", "follow-up"), /계획/);
    assert.equal(controller.snapshot().tasks.length, 0);
  } finally {
    release();
    await planning.catch(error => { planningError = error; });
  }
  assert.ifError(planningError);
  assert.equal(controller.snapshot().planningAttempts[0].outcome, "success");
  assert.deepEqual(controller.snapshot().tasks.map(task => task.id), ["task-1"]);
  assert.equal(controller.add("developer", "follow-up after planning").id, "task-2");
});

test("follow-up additions remain available during ordinary worker execution", async t => {
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const { controller } = setup(t, req => new Promise(resolve => {
    release = () => resolve(result(req));
    started();
  }));
  const task = controller.add("developer", "initial work");
  const running = controller.run(task.id);
  await ready;
  try {
    assert.equal(controller.add("designer", "follow-up").id, "task-2");
    assert.equal(controller.snapshot().tasks[1].status, "queued");
  } finally { release(); await running; }
  assert.equal(controller.snapshot().tasks[0].status, "needs_review");
  assert.equal(controller.snapshot().tasks[1].status, "queued");
});

test("success is never auto-completed and revision preserves attempt-bound evidence", async t => {
  const { controller } = setup(t, async req => result(req));
  const task = controller.add("developer", "작은 기능 구현");
  await controller.run(task.id);
  await controller.check(task.id, "printf verified");
  const previousAttempt = controller.snapshot().tasks[0].attempts[0].id;
  await controller.resume(task.id, "엣지 케이스도 수정해 줘");
  const revised = controller.snapshot().tasks[0];
  assert.equal(revised.attempts.length, 2);
  assert.equal(revised.checks[0].attemptId, previousAttempt);
  assert.equal(revised.status, "needs_review");
  controller.accept(task.id);
  const accepted = controller.snapshot().tasks[0];
  assert.equal(accepted.acceptedAttemptId, revised.attempts[1].id);
  assert.deepEqual(accepted.acceptedCheckIds, []);
});

test("cancel awaits worker settlement, excludes concurrent check and persists interrupted", async t => {
  let settle: (() => void) | undefined;
  const { controller } = setup(t, req => new Promise(resolve => {
    settle = () => resolve({ ...result(req), outcome: "aborted" });
    req.signal?.addEventListener("abort", () => setTimeout(settle!, 10), { once: true });
  }));
  const task = controller.add("developer", "wait");
  const running = controller.run(task.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.busy, true);
  await assert.rejects(controller.check(task.id, "true"), /실행 중/);
  await assert.rejects(controller.run(task.id), /실행 중/);
  await controller.cancel();
  await running;
  assert.equal(controller.busy, false);
  assert.equal(controller.snapshot().tasks[0].status, "interrupted");
  assert.ok(controller.snapshot().tasks[0].attempts[0].endedAt);
});

test("execution failure keeps diagnostic/usage and retry creates a separate attempt", async t => {
  let calls = 0;
  const { controller } = setup(t, async req => ++calls === 1 ? { ...result(req), outcome: "failed", error: "provider unavailable" } : result(req));
  const task = controller.add("developer", "work");
  await controller.run(task.id);
  assert.equal(controller.snapshot().tasks[0].status, "failed");
  await controller.resume(task.id);
  assert.equal(controller.snapshot().tasks[0].attempts.length, 2);
  assert.equal(controller.snapshot().tasks[0].attempts[0].usage.totalTokens, 30);
  assert.equal(controller.snapshot().tasks[0].attempts[0].error, "provider unavailable");
});

test("unclean recovery blocks dispatch, and live recorded worker prevents acknowledgement", async t => {
  const { store, controller } = setup(t, async req => result(req));
  const task = controller.add("developer", "recover");
  store.update(s => { s.recoveryRequired = true; s.tasks[0].status = "interrupted"; });
  await assert.rejects(controller.resume(task.id), /복구/);
  assert.throws(() => controller.recover(false), /확인/);
  controller.recover(true);
  await controller.resume(task.id);
  store.update(s => { s.recoveryRequired = true; s.tasks[0].attempts[0].workerPid = process.pid; s.tasks[0].attempts[0].recoveryPending = true; });
  assert.throws(() => controller.recover(true), /프로세스|PID/);
});

test("profile changes are explicit and ultra is rejected as physical effort", async t => {
  const { controller } = setup(t, async req => result(req));
  controller.setProfile("developer", { provider: "openai", model: "gpt-6-astra", effort: "max" });
  assert.equal(controller.snapshot().profiles.developer.model, "gpt-6-astra");
  assert.throws(() => controller.setProfile("developer", { provider: "openai", model: "gpt-6-astra", effort: "ultra" as "max" }));
  assert.equal(controller.snapshot().profiles.developer.effort, "max");
});

test("recovery gate prevents acceptance while a recovered check process can still write", async t => {
  const { store, controller } = setup(t, async req => result(req));
  const task = controller.add("developer", "work");
  await controller.run(task.id);
  store.update(s => {
    s.recoveryRequired = true;
    s.tasks[0].checks.push({ id: "recovered-check", attemptId: s.tasks[0].attempts[0].id, command: "previous check", startedAt: s.createdAt, endedAt: new Date().toISOString(), workerPid: process.pid, recoveryPending: true, exitCode: null, output: "", status: "interrupted" });
  });
  assert.throws(() => controller.accept(task.id), /복구/);
  assert.equal(controller.snapshot().tasks[0].status, "needs_review");
});

test("persistence failures retain failed classification when cancellation also occurs", async t => {
  let start!: () => void;
  const began = new Promise<void>(resolve => { start = resolve; });
  const { controller } = setup(t, req => new Promise(resolve => {
    start();
    req.signal!.addEventListener("abort", () => resolve({ ...result(req), outcome: "failed", error: "Worker event handler failed: state ownership lost" }), { once: true });
  }));
  const task = controller.add("developer", "work");
  const running = controller.run(task.id);
  await began;
  await controller.cancel(); await running;
  assert.equal(controller.snapshot().tasks[0].status, "failed");
  assert.match(controller.snapshot().tasks[0].attempts[0].error!, /ownership/);
});

test("finalized response usage is retained during an ongoing task as a partial subtotal", async t => {
  let finish!: () => void;
  let streamed!: () => void;
  const ready = new Promise<void>(resolve => { streamed = resolve; });
  const { controller } = setup(t, req => new Promise(resolve => {
    req.onEvent?.({ type: "usage", usage: known, model: "openai/gpt-6.1-sol" });
    finish = () => resolve(result(req)); streamed();
  }));
  const task = controller.add("developer", "work");
  const running = controller.run(task.id); await ready;
  try {
    assert.equal(controller.snapshot().tasks[0].attempts[0].usage.totalTokens, 30);
    assert.equal(controller.snapshot().tasks[0].attempts[0].usage.completeness, "partial");
  } finally { finish(); await running; }
  assert.equal(controller.snapshot().tasks[0].attempts[0].usage.completeness, "known");
});

test("a failed model capability preflight never invokes a worker or fabricates an attempt", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-preflight-"));
  const store = ProjectStore.open(root);
  let calls = 0;
  const controller = new TeamController(store, { runner: async req => { calls++; return result(req); }, validateProfile: async () => { throw new Error("unavailable model"); } });
  t.after(async () => { await controller.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const task = controller.add("developer", "work");
  await assert.rejects(controller.run(task.id), /unavailable model/);
  assert.equal(calls, 0);
  assert.equal(controller.snapshot().tasks[0].attempts.length, 0);
  assert.equal(controller.snapshot().tasks[0].status, "queued");
});
