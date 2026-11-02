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

test("explicit home start runs one queued task and closing home preserves its pending worker", { timeout: 5000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-home-run-")));
  let calls = 0, release!: (result: WorkerResult) => void, sessionId = "";
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => {}, runner: req => new Promise(resolve => { calls++; sessionId = req.sessionId; release = resolve; }) });
  t.after(async () => { if (team.busy && release) release({ outcome: "aborted", text: "", exitCode: null, usage: emptyUsage(), effectiveModels: [], sessionId }); await team.shutdown(); if (processRegistry().owners.get(root)?.controller === team) processRegistry().owners.delete(root); rmSync(root, { recursive: true, force: true }); });
  team.add("developer", "start target");
  processRegistry().owners.set(root, { controller: team, registry: {} as any });
  const choices = ["start target", "작업 시작", null]; let sawActive = false;
  const ui = { notify() {}, setStatus() {}, setWidget() {}, async custom(factory: any) {
    await new Promise(resolve => setTimeout(resolve, 10));
    return await new Promise(resolve => {
      let component: any;
      try { component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, { matches: (a: string, b: string) => a === b }, (value: unknown) => { component.dispose(); resolve(value); });
      let lines = component.render(120); if (lines.some((line: string) => line.includes("현재 진행 보기"))) sawActive = true;
      const pick = choices.shift(); if (pick === null) { component.handleInput("tui.select.cancel"); return; }
      assert.ok(pick); for (let i = 0; i < 15 && !lines.some((line: string) => line.startsWith("→ ") && line.includes(pick)); i++) { component.handleInput("tui.select.down"); lines = component.render(120); }
      assert.ok(lines.some((line: string) => line.startsWith("→ ") && line.includes(pick))); component.handleInput("tui.select.confirm");
      } catch (error) { component?.dispose(); throw error; }
    });
  } };
  const events = new Map<string, Function>(); let command!: (s: string, c: ExtensionCommandContext) => Promise<void>;
  const api = { registerCommand: (_: string, v: { handler: typeof command }) => { command = v.handler; }, registerTool() {}, on: (n: string, f: Function) => events.set(n, f), sendMessage() {}, sendUserMessage() {} } as unknown as ExtensionAPI;
  const ctx = { cwd: root, mode: "tui", hasUI: true, isProjectTrusted: () => true, sessionManager: SessionManager.create(root, root), modelRegistry: {}, ui } as unknown as ExtensionCommandContext;
  extension(api); await events.get("session_start")!({}, ctx); await command("", ctx);
  assert.equal(calls, 1); assert.equal(team.busy, true); assert.equal(sawActive, true);
  release({ outcome: "success", text: "done", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId });
  while (team.busy) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(team.snapshot().tasks[0].status, "needs_review");
  await events.get("session_shutdown")!({ reason: "quit" }, ctx);
});
