import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/core/store.ts";

test("cancelled selection and headless listing do not alter project state", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-cancel-view-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root);
  const { TeamController } = await import("../src/core/controller.ts");
  const team = new TeamController(store, { runner: async () => { throw Error("unexpected inference"); }, validateProfile: async () => {} });
  team.add("developer", "cancel selection"); await team.shutdown();
  const statePath = join(root, ".codexteams", "state.json"), before = readFileSync(statePath);
  let handler!: (s: string, ctx: ExtensionCommandContext) => Promise<void>, shutdown!: (e: any, ctx: ExtensionCommandContext) => Promise<void>;
  const messages: string[] = [];
  const api = { registerCommand: (_: string, d: { handler: typeof handler }) => { handler = d.handler; }, registerTool: () => {}, on: (name: string, fn: typeof shutdown) => { if (name === "session_shutdown") shutdown = fn; }, sendMessage: (m: { content: string }) => messages.push(m.content) } as unknown as ExtensionAPI;
  const ctx = { cwd: root, mode: "tui", hasUI: true, isProjectTrusted: () => true, sessionManager: SessionManager.inMemory(root), ui: { custom: async () => undefined, notify: () => {} } } as unknown as ExtensionCommandContext;
  extension(api); await handler("sessions", ctx); assert.deepEqual(readFileSync(statePath), before);
  assert.equal(existsSync(join(root, ".codexteams", "lock.json")), false);
  ctx.mode = "rpc"; await handler("sessions", ctx); assert.match(messages.join("\n"), /task-1/); assert.deepEqual(readFileSync(statePath), before);
  await shutdown({ reason: "quit" }, ctx);
});

test("catalog groups duplicate titles by stable task ID without creating views", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-catalog-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root);
  t.after(() => store.close());
  const { TeamController } = await import("../src/core/controller.ts");
  const controller = new TeamController(store, { runner: async () => { throw Error("unexpected inference"); }, validateProfile: async () => {} });
  controller.add("developer", "same title"); controller.add("developer", "same title");
  const before = store.snapshot();
  const { catalog } = await import("../src/ui/session-catalog.ts");
  const items = catalog(before);
  assert.deepEqual(items.map((x: { id: string }) => x.id), ["task-1", "task-2"]);
  assert.deepEqual(store.snapshot(), before);
});

test("SDK creates truthful root and child only on confirmed open", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-views-"))), dir = join(root, "sessions");
  mkdirSync(dir, { mode: 0o755 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root); t.after(() => store.close());
  const { TeamController } = await import("../src/core/controller.ts");
  const team = new TeamController(store, { runner: async () => { throw Error("unexpected inference"); }, validateProfile: async () => {} });
  team.add("developer", "open real view");
  const parent = SessionManager.create(root, dir);
  assert.equal(existsSync(parent.getSessionFile()!), false);
  const ctx = { cwd: root, sessionManager: parent } as unknown as ExtensionContext;
  const { ensureView, checkedHeader, VIEW_MARKER } = await import("../src/core/navigation.ts");
  const view = ensureView(store, ctx, "task", "task-1"), nav = store.snapshot().navigation!;
  assert.ok(existsSync(nav.root.file)); assert.ok(existsSync(view.file));
  assert.notEqual(nav.root.file, parent.getSessionFile());
  checkedHeader(nav.root.file, root, nav.root.id); checkedHeader(view.file, root, view.sessionId, nav.root.file);
  assert.throws(() => checkedHeader(view.file, root, "substituted", nav.root.file), /header/);
  assert.throws(() => checkedHeader(view.file, root, view.sessionId, join(root, "wrong.jsonl")), /header/);
  const link = join(dir, "link.jsonl"); symlinkSync(view.file, link);
  assert.throws(() => checkedHeader(link, root, view.sessionId, nav.root.file));
  if (process.platform !== "win32") { const fifo = join(dir, "fifo.jsonl"); execFileSync("mkfifo", [fifo]); assert.throws(() => checkedHeader(fifo, root, view.sessionId)); }
  assert.equal(statSync(nav.root.file).mode & 0o077, 0); assert.equal(statSync(view.file).mode & 0o077, 0);
  assert.equal(statSync(dir).mode & 0o777, 0o755);
  const opened = SessionManager.open(view.file);
  assert.equal(opened.getBranch().some(e => e.type === "custom" && e.customType === VIEW_MARKER), true);
  assert.deepEqual(ensureView(store, ctx, "task", "task-1"), view);
  assert.throws(() => store.update(state => { state.navigation!.views.push(view); }), /state/);
  const memory = { cwd: root, sessionManager: SessionManager.inMemory(root) } as unknown as ExtensionContext;
  assert.throws(() => ensureView(store, memory, "task", "task-1"), /no-session/);
  store.update(state => { delete state.navigation; });
  assert.throws(() => ensureView(store, memory, "task", "task-1"), /no-session/);
});

test("readonly transcript excludes hidden reasoning and leaves worker bytes intact", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-readonly-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "worker.jsonl");
  const data = [JSON.stringify({type:"session", id:"worker", cwd:root}), JSON.stringify({type:"message", message:{role:"assistant",content:[{type:"thinking",thinking:"SECRET"},{type:"text",text:"Visible 한글"}]}}), '{"type":"message"'].join("\n");
  writeFileSync(file, data);
  const { readPublicTranscript } = await import("../src/ui/session-transcript.ts");
  const beforeStat = statSync(file);
  const result = readPublicTranscript(file);
  assert.match(result.text, /Visible 한글/);
  assert.doesNotMatch(result.text, /SECRET/);
  assert.match(result.text, /incomplete/i);
  const { readFileSync } = await import("node:fs");
  assert.equal(readFileSync(file, "utf8"), data);
  assert.equal(statSync(file).ino, beforeStat.ino);
  assert.equal(statSync(file).mtimeMs, beforeStat.mtimeMs);
});

test("bounded transcript pages preserve UTF-8 and omit corrupt records", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-unicode-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "worker.jsonl");
  const record = JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "한글🔧".repeat(1000) }] } });
  writeFileSync(file, `${Array(70).fill(record).join("\n")}\n{broken}\n`);
  const { readPublicTranscript } = await import("../src/ui/session-transcript.ts");
  const result = readPublicTranscript(file);
  assert.ok(result.start > 0); assert.ok(result.end - result.start <= 256 * 1024);
  assert.match(result.text, /truncated/i); assert.match(result.text, /Corrupt record/);
  assert.doesNotMatch(result.text, /�/); assert.match(result.text, /한글🔧/);
});
