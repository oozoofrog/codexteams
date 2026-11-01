import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../src/index.ts";
import { formatBoard, formatTask } from "../src/ui/format.ts";
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
  return { root, notifications, messages, command: (args: string) => command!(args, ctx), tools };
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
