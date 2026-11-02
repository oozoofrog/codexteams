import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { emptyUsage } from "../src/core/usage.ts";

test("accept confirmation cannot accept a result changed while the dialog is open", { timeout: 5000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-home-stale-"))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => {}, runner: async req => ({ outcome: "success", text: "original", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: req.sessionId }) });
  team.add("developer", "stale target"); await team.run("task-1"); await team.shutdown();
  const selections = ["수동 작업", "stale target", "결과 수락", null]; let errorShown = false;
  const ui = { notify() {}, setStatus() {}, setWidget() {}, async confirm() {
    const other = ProjectStore.open(root); other.update(state => { state.tasks[0].updatedAt = "2030-01-01T00:00:00.000Z"; }); other.close(); return true;
  }, async custom(factory: any) {
    return await new Promise(resolve => {
      let component: any;
      try {
      component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, { matches: (a: string, b: string) => a === b }, (value: unknown) => { component.dispose(); resolve(value); });
      let lines = component.render(120); if (lines.some((line: string) => line.includes("변경되었습니다"))) errorShown = true;
      const pick = selections.shift(); if (pick === null) { component.handleInput("tui.select.cancel"); return; }
      assert.ok(pick); for (let i = 0; i < 15 && !lines.some((line: string) => line.startsWith("→ ") && line.includes(pick)); i++) { component.handleInput("tui.select.down"); lines = component.render(120); }
      assert.ok(lines.some((line: string) => line.startsWith("→ ") && line.includes(pick))); component.handleInput("tui.select.confirm");
      } catch (error) { component?.dispose(); throw error; }
    });
  } };
  const events = new Map<string, Function>(); let command!: (s: string, c: ExtensionCommandContext) => Promise<void>;
  const api = { registerCommand: (_: string, v: { handler: typeof command }) => { command = v.handler; }, registerTool() {}, on: (n: string, f: Function) => events.set(n, f), sendMessage() {}, sendUserMessage() {} } as unknown as ExtensionAPI;
  const ctx = { cwd: root, mode: "tui", hasUI: true, isProjectTrusted: () => true, sessionManager: SessionManager.create(root, root), modelRegistry: {}, ui } as unknown as ExtensionCommandContext;
  extension(api); await events.get("session_start")!({}, ctx); await command("home", ctx); await events.get("session_shutdown")!({ reason: "quit" }, ctx);
  assert.equal(ProjectStore.read(root)!.tasks[0].status, "needs_review"); assert.equal(errorShown, true);
});
