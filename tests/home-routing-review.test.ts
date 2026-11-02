import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { processRegistry } from "../src/core/process-registry.ts";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { WorkerResult } from "../src/core/types.ts";

function request(root: string) { return { schemaVersion: 1, requestId: "home-reserved", projectRoot: root, source: { kind: "codex", checkpoint: "stopped", stopped: true }, goal: "handoff goal", task: { title: "reserved handoff", description: "do it", role: "developer", acceptance: ["done"] }, context: { summary: "packet", completed: [], constraints: [], files: [], evidence: [] } }; }
async function waitFor(predicate: () => boolean) { for (let i = 0; i < 250; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error("timed out waiting for operation"); }
function harness(root: string, choices: (string | null)[], options: { role?: string | null; content?: string | null; onEditor?: () => void; trusted?: () => boolean } = {}) {
  choices.unshift("수동 작업");
  const errors: string[] = [];
  const ui = { notify(message: string) { errors.push(message); }, setStatus() {}, setWidget() {},
    async select() { return options.role === null ? undefined : options.role ?? "designer"; },
    async editor() { options.onEditor?.(); return options.content === null ? undefined : options.content ?? "follow-up"; },
    async custom(factory: any) { return await new Promise(resolve => {
      let component: any;
      try {
        component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, { matches: (a: string, b: string) => a === b }, (value: unknown) => { component.dispose(); resolve(value); });
        let lines = component.render(120); errors.push(...lines.filter((s: string) => s.startsWith("오류:")));
        const pick = choices.shift(); if (pick === null) { component.handleInput("tui.select.cancel"); return; }
        assert.ok(pick, "unexpected panel");
        for (let i = 0; i < 30 && !lines.some((line: string) => line.startsWith("→ ") && line.includes(pick)); i++) { component.handleInput("tui.select.down"); lines = component.render(120); }
        assert.ok(lines.some((line: string) => line.startsWith("→ ") && line.includes(pick)), `missing ${pick}: ${lines.join(" | ")}`);
        component.handleInput("tui.select.confirm");
      } catch (error) { component?.dispose(); throw error; }
    }); },
  };
  const events = new Map<string, Function>(); let command!: (s: string, c: ExtensionCommandContext) => Promise<void>;
  const api = { registerCommand: (_: string, value: { handler: typeof command }) => { command = value.handler; }, registerTool() {}, on: (name: string, f: Function) => events.set(name, f), sendMessage() {}, sendUserMessage() {} } as unknown as ExtensionAPI;
  const ctx = { cwd: root, mode: "tui", hasUI: true, isProjectTrusted: options.trusted ?? (() => true), sessionManager: SessionManager.create(root, root), modelRegistry: {}, ui } as unknown as ExtensionCommandContext;
  extension(api);
  return { errors, events, ctx, async open() { await events.get("session_start")!({}, ctx); await command("home", ctx); } };
}

test("Home starts the original reserved queued handoff after preflight is fixed", { timeout: 10000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-home-handoff-")));
  let allowed = false, calls = 0, release: ((value: WorkerResult) => void) | undefined, sessionId = "";
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => { if (!allowed) throw Error("profile unavailable"); }, runner: req => new Promise(resolve => { calls++; sessionId = req.sessionId; release = resolve; }) });
  t.after(async () => { release?.({ outcome: "aborted", text: "", exitCode: null, usage: emptyUsage(), effectiveModels: [], sessionId }); await team.shutdown(); if (processRegistry().owners.get(root)?.controller === team) processRegistry().owners.delete(root); rmSync(root, { recursive: true, force: true }); });
  const input = request(root); await team.handoff(input);
  const reserved = team.snapshot().tasks[0]; assert.equal(reserved.status, "queued"); assert.equal(reserved.attempts.length, 0);
  allowed = true; team.setProfile("developer", team.snapshot().profiles.developer);
  processRegistry().owners.set(root, { controller: team, registry: {} as any });
  const h = harness(root, ["reserved handoff", "작업 시작", null]); await h.open();
  await waitFor(() => calls === 1);
  const state = team.snapshot(); assert.equal(state.tasks.length, 1); assert.equal(state.tasks[0].id, reserved.id); assert.equal(state.tasks[0].handoff?.request.requestId, input.requestId); assert.equal(state.tasks[0].attempts.length, 1); assert.equal(state.tasks[0].status, "running");
  release!({ outcome: "success", text: "result", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId }); release = undefined;
  await waitFor(() => !team.busy); assert.equal(team.snapshot().tasks[0].status, "needs_review"); assert.equal(team.snapshot().tasks[0].acceptedAt, undefined); assert.deepEqual(h.errors, []);
});

for (const kind of ["worker", "check"] as const) test(`Home adds queued work during a genuinely pending ${kind}`, { timeout: 10000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `codexteams-home-add-${kind}-`)));
  let calls = 0, release: ((value: WorkerResult) => void) | undefined, sessionId = "";
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => {}, runner: req => { calls++; sessionId = req.sessionId; if (kind === "check") return Promise.resolve({ outcome: "success", text: "result", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId }); return new Promise(resolve => { release = resolve; }); } });
  t.after(async () => { release?.({ outcome: "aborted", text: "", exitCode: null, usage: emptyUsage(), effectiveModels: [], sessionId }); await team.shutdown(); if (processRegistry().owners.get(root)?.controller === team) processRegistry().owners.delete(root); rmSync(root, { recursive: true, force: true }); });
  const task = team.add("developer", "active task");
  let pending: Promise<unknown>;
  if (kind === "worker") { pending = team.run(task.id); await waitFor(() => Boolean(release)); }
  else { await team.run(task.id); pending = team.check(task.id, `${JSON.stringify(process.execPath)} -e 'setInterval(() => {}, 1000)'`); await waitFor(() => Boolean(team.snapshot().tasks[0].checks[0]?.workerPid)); }
  const opId = team.activeOperation!.id, goal = team.snapshot().goal, beforeCalls = calls;
  processRegistry().owners.set(root, { controller: team, registry: {} as any });
  const h = harness(root, ["새 작업 추가", null]); await h.open();
  const state = team.snapshot(); assert.equal(state.tasks.length, 2, h.errors.join(" | ")); assert.equal(state.tasks[1].status, "queued"); assert.equal(state.tasks[1].description, "follow-up"); assert.equal(state.tasks[1].attempts.length, 0); assert.equal(state.goal, goal); assert.equal(team.activeOperation?.id, opId); assert.equal(calls, beforeCalls); assert.deepEqual(h.errors, []);
  if (kind === "worker") { release!({ outcome: "success", text: "done", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId }); release = undefined; } else await team.cancel();
  await pending;
});

for (const scenario of ["blank", "cancel-role", "cancel-content", "stale-trust"] as const) test(`Home addition during a pending worker rejects ${scenario}`, { timeout: 10000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-home-add-guard-")));
  let release: ((value: WorkerResult) => void) | undefined, sessionId = "", calls = 0, trusted = true;
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => {}, runner: req => new Promise(resolve => { calls++; sessionId = req.sessionId; release = resolve; }) });
  t.after(async () => { release?.({ outcome: "aborted", text: "", exitCode: null, usage: emptyUsage(), effectiveModels: [], sessionId }); await team.shutdown(); if (processRegistry().owners.get(root)?.controller === team) processRegistry().owners.delete(root); rmSync(root, { recursive: true, force: true }); });
  const task = team.add("developer", "active"); const pending = team.run(task.id); await waitFor(() => Boolean(release));
  const opId = team.activeOperation!.id;
  processRegistry().owners.set(root, { controller: team, registry: {} as any });
  const options = { role: scenario === "cancel-role" ? null : "designer", content: scenario === "blank" ? "   " : scenario === "cancel-content" ? null : "follow-up", trusted: () => trusted, onEditor: () => { if (scenario === "stale-trust") trusted = false; } };
  const h = harness(root, ["새 작업 추가", null], options); await h.open();
  assert.equal(team.snapshot().tasks.length, 1); assert.equal(team.activeOperation?.id, opId); assert.equal(calls, 1);
  if (scenario === "stale-trust") assert.ok(h.errors.some(error => error.includes("변경")));
  release!({ outcome: "success", text: "done", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId }); release = undefined; await pending;
});

for (const mode of ["run", "launch"] as const) test(`Home addition stays queued after ${mode} finishes its authorized queue`, { timeout: 10000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `codexteams-home-bounded-${mode}-`)));
  let release: ((value: WorkerResult) => void) | undefined, heldSession = "";
  const dispatched: string[] = [];
  const plan = { tasks: [
    { id: "first", title: "first authorized", description: "one", role: "developer", dependsOn: [], acceptance: ["done"] },
    { id: "second", title: "second authorized", description: "two", role: "designer", dependsOn: [], acceptance: ["done"] },
  ] };
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => {}, runner: req => {
    const result = (text: string): WorkerResult => ({ outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: req.sessionId });
    if (req.prompt.startsWith("사용자 목표:")) return Promise.resolve(result(JSON.stringify(plan)));
    dispatched.push(req.prompt);
    if (dispatched.length === 1) return new Promise(resolve => { heldSession = req.sessionId; release = resolve; });
    return Promise.resolve(result("done"));
  } });
  t.after(async () => { release?.({ outcome: "aborted", text: "", exitCode: null, usage: emptyUsage(), effectiveModels: [], sessionId: heldSession }); await team.shutdown(); if (processRegistry().owners.get(root)?.controller === team) processRegistry().owners.delete(root); rmSync(root, { recursive: true, force: true }); });
  if (mode === "run") { team.add("developer", "first authorized"); team.add("designer", "second authorized"); }
  const pending = mode === "run" ? team.run() : team.launch("goal");
  await waitFor(() => Boolean(release));
  const authorized = team.snapshot().tasks.map(task => task.id), opId = team.activeOperation!.id;
  processRegistry().owners.set(root, { controller: team, registry: {} as any });
  const h = harness(root, ["새 작업 추가", null]); await h.open();
  assert.deepEqual(h.errors, []); assert.equal(team.activeOperation?.id, opId);
  const added = team.snapshot().tasks.find(task => task.description === "follow-up")!;
  assert.ok(added); assert.equal(added.status, "queued");
  release!({ outcome: "success", text: "done", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: heldSession }); release = undefined;
  const summary = await pending;
  assert.deepEqual(summary.executed, authorized); assert.equal(dispatched.length, 2); assert.ok(dispatched[0].includes("first authorized")); assert.ok(dispatched[1].includes("second authorized"));
  const final = team.snapshot().tasks.find(task => task.id === added.id)!;
  assert.equal(final.status, "queued"); assert.equal(final.attempts.length, 0); assert.equal(final.acceptedAt, undefined); assert.ok(summary.blocked.includes(added.id));
});

test("queue authorization is captured synchronously at run request, before its worker microtask", { timeout: 10000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-home-queue-boundary-")));
  let calls = 0;
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => {}, runner: async req => { calls++; return { outcome: "success", text: "done", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: req.sessionId }; } });
  t.after(async () => { await team.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const first = team.add("developer", "first");
  const pending = team.run();
  const later = team.add("designer", "added immediately");
  const summary = await pending;
  assert.deepEqual(summary.executed, [first.id]); assert.equal(calls, 1);
  const task = team.snapshot().tasks.find(t => t.id === later.id)!;
  assert.equal(task.status, "queued"); assert.equal(task.attempts.length, 0);
});

test("bounded queue still checks current dependencies before dispatch", { timeout: 10000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-home-queue-deps-")));
  let release: ((value: WorkerResult) => void) | undefined, sessionId = "", calls = 0;
  const store = ProjectStore.open(root);
  const team = new TeamController(store, { validateProfile: async () => {}, runner: req => new Promise(resolve => { calls++; sessionId = req.sessionId; release = resolve; }) });
  t.after(async () => { release?.({ outcome: "aborted", text: "", exitCode: null, usage: emptyUsage(), effectiveModels: [], sessionId }); await team.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const first = team.add("developer", "first"); const second = team.add("designer", "second");
  const pending = team.run(); await waitFor(() => Boolean(release));
  store.update(state => { state.tasks.find(task => task.id === second.id)!.dependsOn = [first.id]; });
  release!({ outcome: "success", text: "done", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId }); release = undefined;
  const summary = await pending; assert.deepEqual(summary.executed, [first.id]); assert.ok(summary.blocked.includes(second.id));
  assert.equal(calls, 1); assert.equal(team.snapshot().tasks.find(task => task.id === second.id)!.attempts.length, 0);
});

test("Home addition remains blocked during a genuinely pending planning preflight", { timeout: 10000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-home-add-plan-")));
  let release: (() => void) | undefined, entered = false;
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => { entered = true; await new Promise<void>(resolve => { release = resolve; }); throw Error("preflight stopped"); }, runner: async () => { throw Error("unexpected worker"); } });
  t.after(async () => { release?.(); await team.shutdown(); if (processRegistry().owners.get(root)?.controller === team) processRegistry().owners.delete(root); rmSync(root, { recursive: true, force: true }); });
  const pending = team.start("planning goal"); await waitFor(() => entered);
  const opId = team.activeOperation!.id;
  processRegistry().owners.set(root, { controller: team, registry: {} as any });
  const h = harness(root, ["새 작업 추가", null]); await h.open();
  assert.equal(team.snapshot().tasks.length, 0); assert.equal(team.activeOperation?.id, opId); assert.ok(h.errors.some(error => error.includes("계획")));
  release!(); release = undefined; await assert.rejects(pending, /preflight stopped/);
});
