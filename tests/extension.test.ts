import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../src/index.ts";
import { formatBoard, formatTask } from "../src/ui/format.ts";
import { TeamController } from "../src/core/controller.ts";
import { ProjectStore } from "../src/core/store.ts";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

function harness(t: { after: (fn: () => void | Promise<void>) => void }, trusted = true) {
  const root = mkdtempSync(join(tmpdir(), "codexteams-extension-"));
  const notifications: string[] = [];
  const messages: string[] = [];
  let command: ((args: string, ctx: ExtensionCommandContext) => Promise<void> | void) | undefined;
  const events = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void> | void>();
  const tools: unknown[] = [];
  const api = {
    registerCommand: (_name: string, definition: { handler: typeof command }) => { command = definition.handler; },
    registerTool: (definition: unknown) => tools.push(definition),
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) => { events.set(event, handler); return () => {}; },
    sendMessage: (message: { content: string }) => { messages.push(message.content); },
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: root, hasUI: true, mode: "tui", isProjectTrusted: () => trusted,
    ui: { notify: (message: string) => notifications.push(message), setStatus: () => {}, setWidget: () => {}, confirm: async () => true },
    modelRegistry: { find: () => undefined, hasConfiguredAuth: () => false },
  } as unknown as ExtensionCommandContext;
  extension(api);
  t.after(async () => { await events.get("session_shutdown")?.({ reason: "quit" }, ctx); rmSync(root, { recursive: true, force: true }); });
  return { root, notifications, messages, ctx, events, command: async (args: string) => { await command!(args, ctx); }, tools };
}

test("Pi extension registers one command/read-only tool; status creates no project files", async t => {
  const h = harness(t);
  await h.command("status");
  assert.equal(h.tools.length, 1);
  assert.equal(existsSync(join(h.root, ".codexteams")), false);
  assert.match(h.messages.join("\n"), /teams start/);
});

test("untrusted project cannot start a writing action", async t => {
  const h = harness(t, false);
  await h.command("add developer work");
  assert.equal(existsSync(join(h.root, ".codexteams")), false);
  assert.match(h.notifications.join("\n"), /신뢰/);
});

test("explicit add/profile writes durable tasks without calling a model", async t => {
  const h = harness(t);
  await h.command("add designer 화면을 개선해 줘");
  await h.command("profile designer openai/gpt-6.1-terra high");
  const state = ProjectStore.read(h.root)!;
  assert.equal(state.tasks[0].role, "designer");
  assert.equal(state.profiles.designer.effort, "high");
  assert.match(formatBoard(state, "준비"), /화면을 개선/);
  assert.match(formatTask(state.tasks[0]), /검증/);
});

test("ultra is rejected as native effort and status remains unknown before calls", async t => {
  const h = harness(t);
  await h.command("add developer 기능 구현");
  await h.command("profile developer openai/gpt-6-astra ultra");
  assert.match(h.notifications.join("\n"), /ultra/);
  const state = ProjectStore.read(h.root)!;
  assert.equal(state.profiles.developer.model, "gpt-6.1-sol");
  assert.match(formatBoard(state, "준비"), /기록 없음|미확인|unknown/);
});


test("launch without a goal is read-only status", async t => {
  const h = harness(t);
  await h.command("launch");
  assert.equal(existsSync(join(h.root, ".codexteams")), false);
  assert.match(h.messages.join("\n"), /teams/);
});

test("launch displays saved state and recovery actions instead of restarting", async t => {
  const h = harness(t);
  const store = ProjectStore.open(h.root);
  store.update(state => { state.goal = "saved goal"; state.recoveryRequired = true; });
  const before = store.snapshot(); store.close();
  let calls = 0;
  t.mock.method(TeamController.prototype, "launch", async () => { calls++; throw new Error("must not restart"); });
  await h.command("launch replacement goal");
  assert.equal(calls, 0);
  assert.deepEqual(ProjectStore.read(h.root), before);
  assert.match(h.messages.join("\n"), /saved goal/);
  assert.match(h.messages.join("\n"), /resume/);
  assert.match(h.messages.join("\n"), /recover/);
});

test("non-UI launch awaits controller completion and displays its summary", async t => {
  const h = harness(t); h.ctx.hasUI = false;
  let finish!: () => void;
  let began!: () => void;
  const ready = new Promise<void>(resolve => { began = resolve; });
  t.mock.method(TeamController.prototype, "launch", function (goal: string) {
    assert.equal(goal, 'literal goal "quoted"; $HOME');
    began();
    return new Promise(resolve => { finish = () => resolve({ executed: ["one"], blocked: ["two"], waitingReview: ["one"] }); });
  });
  let settled = false;
  const pending = h.command('launch literal goal "quoted"; $HOME').then(() => { settled = true; });
  await Promise.race([ready, pending]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  finish(); await pending;
  assert.match(h.messages.join("\n"), /실행 1개.*검토 대기 1개.*남은 대기 1개/);
});

test("non-UI launch surfaces controller errors", async t => {
  const h = harness(t); h.ctx.hasUI = false;
  t.mock.method(TeamController.prototype, "launch", async () => { throw new Error("fixture planner failure"); });
  await h.command("launch goal");
  assert.match(h.messages.join("\n"), /fixture planner failure/);
});

test("TUI launch returns while controller runs and leaves cancel responsive", async t => {
  const h = harness(t);
  let finish!: () => void;
  let calls = 0;
  t.mock.method(TeamController.prototype, "launch", () => {
    calls++;
    return new Promise(resolve => { finish = () => resolve({ executed: [], blocked: [], waitingReview: [] }); });
  });
  t.mock.method(TeamController.prototype, "cancel", async () => { finish(); });
  await h.command("launch goal");
  assert.equal(calls, 1);
  await h.command("cancel");
  assert.match(h.notifications.join("\n"), /중단/);
});

test("session start and reload cannot replay an explicit startup goal", async t => {
  const h = harness(t); h.ctx.hasUI = false;
  let calls = 0;
  t.mock.method(TeamController.prototype, "launch", async () => { calls++; return { executed: [], blocked: [], waitingReview: [] }; });
  await h.events.get("session_start")?.({}, h.ctx);
  assert.equal(calls, 0);
  await h.command("launch once");
  await h.events.get("session_shutdown")?.({}, h.ctx);
  await h.events.get("session_start")?.({}, h.ctx);
  await h.events.get("session_start")?.({}, h.ctx);
  assert.equal(calls, 1);
});

test("worker environment excludes the extension startup command and handlers", t => {
  const previous = process.env.CODEXTEAMS_WORKER;
  process.env.CODEXTEAMS_WORKER = "1";
  t.after(() => { if (previous === undefined) delete process.env.CODEXTEAMS_WORKER; else process.env.CODEXTEAMS_WORKER = previous; });
  let registrations = 0;
  extension({ registerCommand: () => { registrations++; }, registerTool: () => { registrations++; }, on: () => { registrations++; } } as unknown as ExtensionAPI);
  assert.equal(registrations, 0);
});
