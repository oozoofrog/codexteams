import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../src/index.ts";
import { TeamController } from "../src/core/controller.ts";
import { ProjectStore } from "../src/core/store.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { Task, TaskStatus } from "../src/core/types.ts";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

function harness(t: { after: (fn: () => void | Promise<void>) => void }) {
  const root = mkdtempSync(join(tmpdir(), "codexteams-resume-picker-"));
  const notices: string[] = [], messages: string[] = [], dialogs: string[][] = [];
  const events = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void> | void>();
  let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  let choose: (options: string[]) => Promise<string | undefined> = async () => undefined;
  const ctx = {
    cwd: root, hasUI: true, mode: "tui", isProjectTrusted: () => true,
    ui: {
      notify: (message: string) => notices.push(message), setWidget: () => {}, setStatus: () => {},
      select: async (_title: string, options: string[]) => { dialogs.push([...options]); return choose(options); },
      input: async () => { throw new Error("resume picker must not ask for instructions"); },
    },
    modelRegistry: { find: () => undefined, hasConfiguredAuth: () => false },
  } as unknown as ExtensionCommandContext;
  extension({
    registerCommand: (_name: string, definition: { handler: typeof handler }) => { handler = definition.handler; },
    registerTool: () => {},
    sendMessage: (message: { content: string }) => { messages.push(message.content); },
    on: (name: string, callback: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) => { events.set(name, callback); },
  } as unknown as ExtensionAPI);
  t.after(async () => { await events.get("session_shutdown")?.({}, ctx); rmSync(root, { recursive: true, force: true }); });
  return { root, ctx, notices, messages, dialogs, events, choose: (fn: typeof choose) => { choose = fn; }, command: (args = "resume", commandCtx = ctx) => handler(args, commandCtx) };
}

function seed(root: string, entries: [string, TaskStatus, string?, Task["role"]?][]) {
  const store = ProjectStore.open(root);
  const now = "2026-11-01T00:00:00.000Z";
  store.update(state => { state.tasks = entries.map(([id, status, title = id, role = "developer"]): Task => {
    const success = status === "needs_review" || status === "completed";
    return {
      id, status, title, role, description: `Original instructions for ${id}`, dependsOn: [], acceptance: ["Original acceptance"], createdAt: now, updatedAt: now, checks: [],
      attempts: success ? [{ id: `attempt-${id}`, sessionId: `session-${id}`, profile: state.profiles[role], startedAt: now, endedAt: now, outcome: "success", effectiveModels: [], text: "Saved result", usage: emptyUsage(), logFile: `logs/attempt-${id}.jsonl` }] : [],
      ...(status === "completed" ? { acceptedAt: now, acceptanceSource: "user" as const, acceptedAttemptId: `attempt-${id}`, acceptedCheckIds: [] } : {}),
    };
  }); });
  store.close();
}

function captureController(t: TestContext) {
  let controller: TeamController | undefined;
  const snapshot = TeamController.prototype.snapshot;
  t.mock.method(TeamController.prototype, "snapshot", function (this: TeamController) { controller = this; return snapshot.call(this); });
  return () => { assert.ok(controller); return controller; };
}

test("resume picker preserves board order and maps duplicate titles to the selected saved ID", async t => {
  const h = harness(t);
  seed(h.root, [["second", "failed", "Same\r\nname", "designer"], ["queued", "queued"], ["first", "interrupted", "Same\nname", "designer"], ["review", "needs_review", "Review", "reviewer"], ["done", "completed"], ["cancel", "cancelled"]]);
  const calls: unknown[] = [];
  t.mock.method(TeamController.prototype, "resume", async (id: string, instruction: string) => { calls.push([id, instruction]); });
  h.choose(async options => options[1]);
  await h.command();
  assert.equal(h.dialogs.length, 1);
  assert.equal(h.dialogs[0].length, 3);
  assert.match(h.dialogs[0][0], /^Same name.*실패.*designer.*second/);
  assert.match(h.dialogs[0][1], /^Same name.*중단.*designer.*first/);
  assert.match(h.dialogs[0][2], /^Review.*검토 대기.*reviewer.*review/);
  assert.ok(h.dialogs[0].every(option => !/[\r\n]/.test(option)));
  assert.deepEqual(calls, [["first", ""]]);
});

test("a single resumable task still requires selection and Escape preserves saved work", async t => {
  const h = harness(t); seed(h.root, [["only", "failed"]]);
  const before = ProjectStore.read(h.root);
  let resumes = 0;
  t.mock.method(TeamController.prototype, "resume", async () => { resumes++; });
  await h.command();
  assert.equal(h.dialogs.length, 1);
  assert.equal(h.dialogs[0].length, 1);
  assert.equal(resumes, 0);
  assert.deepEqual(ProjectStore.read(h.root), before);
});

test("unknown picker return value cannot be interpreted as a task ID", async t => {
  const h = harness(t); seed(h.root, [["only", "failed", "Contains fake-id"]]);
  let resumes = 0;
  t.mock.method(TeamController.prototype, "resume", async () => { resumes++; });
  h.choose(async () => "only");
  await h.command();
  assert.equal(h.dialogs.length, 1);
  assert.equal(resumes, 0);
  assert.match(h.notices.join("\n"), /선택.*확인|선택.*유효/);
});

for (const state of ["absent", "empty", "excluded"] as const) {
  test(`resume picker reports ${state} state without creating a new project`, async t => {
    const h = harness(t);
    if (state !== "absent") seed(h.root, state === "empty" ? [] : [["queued", "queued"], ["done", "completed"], ["cancel", "cancelled"]]);
    const before = ProjectStore.read(h.root);
    await h.command();
    assert.equal(h.dialogs.length, 0);
    assert.match(h.notices.join("\n"), /재개할.*없|이어갈.*없/);
    assert.deepEqual(ProjectStore.read(h.root), before);
    assert.equal(existsSync(join(h.root, ".codexteams", "lock.json")), state === "excluded");
    if (state === "absent") assert.equal(existsSync(join(h.root, ".codexteams")), false);
  });
}

test("non-UI resume lists candidates and explicit-ID guidance without selecting or executing", async t => {
  const h = harness(t); seed(h.root, [["saved", "failed", "Saved title", "designer"], ["skip", "queued", "Must not list"]]);
  h.ctx.hasUI = false;
  let resumes = 0;
  t.mock.method(TeamController.prototype, "resume", async () => { resumes++; });
  await h.command();
  assert.equal(resumes, 0); assert.equal(h.dialogs.length, 0);
  assert.match(h.messages.join("\n"), /Saved title.*실패.*designer.*saved/);
  assert.match(h.messages.join("\n"), /\/teams resume <id>/);
  assert.doesNotMatch(h.messages.join("\n"), /Must not list/);
});

test("resume picker checks trust before offering saved tasks", async t => {
  const h = harness(t); seed(h.root, [["saved", "failed"]]);
  h.ctx.isProjectTrusted = () => false;
  await h.command();
  assert.equal(h.dialogs.length, 0); assert.match(h.notices.join("\n"), /신뢰/);
});

test("resume picker rejects busy controllers before offering tasks", async t => {
  const h = harness(t); seed(h.root, [["saved", "failed"]]);
  t.mock.getter(TeamController.prototype, "busy", () => true);
  await h.command();
  assert.equal(h.dialogs.length, 0); assert.match(h.notices.join("\n"), /실행 중/);
});

test("opening crashed running state reconciles it and requires recovery before selection", async t => {
  const h = harness(t); seed(h.root, [["crashed", "running"]]);
  await h.command();
  assert.equal(h.dialogs.length, 0);
  assert.equal(ProjectStore.read(h.root)!.tasks[0].status, "interrupted");
  assert.equal(ProjectStore.read(h.root)!.recoveryRequired, true);
  assert.match(h.notices.join("\n"), /recover/);
  assert.doesNotMatch(h.notices.join("\n"), /재개할.*없/);
});

test("another live owner prevents offering tasks", async t => {
  const h = harness(t); seed(h.root, [["saved", "failed"]]);
  const owner = ProjectStore.open(h.root); t.after(() => owner.close());
  await h.command();
  assert.equal(h.dialogs.length, 0); assert.match(h.notices.join("\n"), /다른 Pi 세션/);
});

for (const change of ["shutdown", "session", "cwd", "root-command", "status", "recovery", "busy", "trust"] as const) {
  test(`pending resume selection cannot execute after ${change} changes`, async t => {
    const h = harness(t); seed(h.root, [["saved", "failed"]]);
    const current = captureController(t);
    const other = mkdtempSync(join(tmpdir(), "codexteams-picker-other-")); t.after(() => rmSync(other, { recursive: true, force: true }));
    let resumes = 0;
    t.mock.method(TeamController.prototype, "resume", async () => { resumes++; });
    h.choose(async options => {
      if (change === "shutdown") await h.events.get("session_shutdown")?.({}, h.ctx);
      if (change === "session") await h.events.get("session_start")?.({}, h.ctx);
      if (change === "cwd") h.ctx.cwd = other;
      if (change === "root-command") await h.command("add developer Other project", { ...h.ctx, cwd: other });
      if (change === "status") current().store.update(state => { state.tasks[0].status = "queued"; });
      if (change === "recovery") current().store.update(state => { state.recoveryRequired = true; });
      if (change === "busy") t.mock.getter(TeamController.prototype, "busy", () => true);
      if (change === "trust") h.ctx.isProjectTrusted = () => false;
      return options[0];
    });
    await h.command();
    assert.equal(h.dialogs.length, 1); assert.equal(resumes, 0);
  });
}

test("ownership lost during selection prevents worker dispatch", async t => {
  const h = harness(t); seed(h.root, [["saved", "failed"]]);
  h.ctx.modelRegistry.find = () => ({
    id: "synthetic-local-validation", name: "Synthetic local validation", api: "openai-responses", provider: "openai",
    baseUrl: "https://invalid.invalid", input: ["text"], reasoning: true, contextWindow: 8192, maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  });
  h.ctx.modelRegistry.hasConfiguredAuth = () => true;
  h.choose(async options => {
    const lockPath = join(h.root, ".codexteams", "lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    writeFileSync(lockPath, JSON.stringify({ ...lock, nonce: "replacement-owner" }));
    return options[0];
  });
  await h.command(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.dialogs.length, 1);
  assert.equal(ProjectStore.read(h.root)!.tasks[0].attempts.length, 0);
  assert.match(h.notices.join("\n"), /잠금.*소유자/);
});

test("explicit-ID resume preserves optional multiline revision instructions", async t => {
  const h = harness(t); seed(h.root, [["saved", "failed"]]);
  const calls: unknown[] = [];
  t.mock.method(TeamController.prototype, "resume", async (id: string, instruction: string) => { calls.push([id, instruction]); });
  await h.command("resume saved Keep this literal $HOME;\nand next line");
  assert.deepEqual(calls, [["saved", "Keep this literal $HOME;\nand next line"]]);
  assert.equal(h.dialogs.length, 0);
});
