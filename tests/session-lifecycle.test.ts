import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamController } from "../src/core/controller.ts";
import { ProjectStore } from "../src/core/store.ts";
import { emptyUsage } from "../src/core/usage.ts";
import extension from "../src/index.ts";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// Separate extension factories model Pi's discarded screen bindings. The worker is
// held pending while the first binding is torn down, then completes on its owner.
test("pending worker survives replacement and reattaches without stale UI", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-lifecycle-")));
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const original = TeamController.prototype.run;
  t.mock.method(TeamController.prototype, "run", function (this: TeamController, id?: string) {
    const options = (this as unknown as { options: { validateProfile: () => Promise<void>; runner: (r: any) => Promise<any> } }).options;
    options.validateProfile = async () => {};
    options.runner = request => new Promise(resolve => {
      request.onEvent?.({ type: "process", pid: process.pid });
      finish = () => resolve({ outcome: "success", text: "done", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId });
      started();
    });
    return original.call(this, id);
  });
  function screen() {
    let cmd!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    const events = new Map<string, (event: any, ctx: ExtensionCommandContext) => Promise<any>>();
    let stale = false;
    const guard = () => { if (stale) throw new Error("stale UI used"); };
    const ctx = { cwd: root, mode: "tui", hasUI: true, isProjectTrusted: () => true,
      modelRegistry: { find: () => undefined, hasConfiguredAuth: () => false },
      ui: { notify: guard, setStatus: guard, setWidget: guard } } as unknown as ExtensionCommandContext;
    const pi = { registerCommand: (_: string, d: { handler: typeof cmd }) => { cmd = d.handler; }, registerTool: () => {},
      on: (name: string, fn: any) => { events.set(name, fn); }, sendMessage: guard } as unknown as ExtensionAPI;
    extension(pi);
    return { ctx, events, command: (s: string) => cmd(s, ctx), stale: () => { stale = true; } };
  }
  const a = screen(); let b: ReturnType<typeof screen> | undefined;
  t.after(async () => { finish?.(); await b?.events.get("session_shutdown")?.({ reason: "quit" }, b.ctx); await a.events.get("session_shutdown")?.({ reason: "quit" }, a.ctx); rmSync(root, { recursive: true, force: true }); });
  await a.events.get("session_start")?.({ reason: "startup" }, a.ctx);
  await a.command("add developer pending");
  await a.command("run task-1"); await ready;
  const before = ProjectStore.read(root)!.tasks[0].attempts[0];
  const otherRoot = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-lifecycle-other-")));
  t.after(() => rmSync(otherRoot, { recursive: true, force: true }));
  const other = SessionManager.create(otherRoot, otherRoot);
  other.appendMessage({ role: "user", content: [{ type: "text", text: "other project" }], timestamp: Date.now() });
  const blocked = await a.events.get("session_before_switch")!({ reason: "resume", targetSessionFile: other.getSessionFile() }, a.ctx);
  assert.equal(blocked.cancel, true);
  assert.equal(ProjectStore.read(root)!.tasks[0].status, "running");
  const transition = a.events.get("session_shutdown")!({ reason: "new" }, a.ctx);
  await Promise.race([transition, new Promise((_, reject) => setTimeout(() => reject(new Error("replacement waited for worker")), 100))]);
  a.stale(); b = screen(); await b.events.get("session_start")?.({ reason: "new" }, b.ctx);
  await b.command("add designer attached");
  assert.equal(ProjectStore.read(root)!.tasks.length, 2);
  const during = ProjectStore.read(root)!.tasks[0].attempts[0];
  assert.equal(during.id, before.id); assert.equal(during.workerPid, before.workerPid);
  finish();
  for (let i = 0; i < 100 && ProjectStore.read(root)!.tasks[0].status !== "needs_review"; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(ProjectStore.read(root)!.tasks[0].status, "needs_review");
});
