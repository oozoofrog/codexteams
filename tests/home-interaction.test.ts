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

test("home result loop does not dispatch blank revision or unconfirmed acceptance", { timeout: 5000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-home-interaction-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => {}, runner: async req => ({ outcome: "success", text: "실제 결과", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: req.sessionId }) });
  team.add("developer", "시험 작업"); await team.run("task-1"); await team.shutdown();
  const choices = ["시험 작업", "결과 확인", "수정 요청", "결과 수락", "뒤로", null, null];
  let editors = 0, confirms = 0, messages = 0, timersDisposed = 0;
  const screens: string[] = [];
  const ui = {
    notify() {}, setStatus() {}, setWidget() {},
    async editor() { editors++; return "  "; },
    async confirm() { confirms++; return false; },
    async custom(factory: any) {
      return await new Promise(resolve => {
        let component: any;
        try {
        component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, { matches: (input: string, key: string) => input === key }, (value: unknown) => { component.dispose(); timersDisposed++; resolve(value); });
        let lines = component.render(120); screens.push(lines.join("\n"));
        assert.ok(lines.length <= 24);
        const choice = choices.shift();
        if (choice === null) { component.handleInput("tui.select.cancel"); return; }
        assert.ok(choice, "unexpected panel");
        for (let n = 0; n < 15 && !lines.some((line: string) => line.startsWith("→ ") && line.includes(choice)); n++) { component.handleInput("tui.select.down"); lines = component.render(120); }
        assert.ok(lines.some((line: string) => line.startsWith("→ ") && line.includes(choice)), `missing ${choice}: ${lines.join(" | ")}`);
        component.handleInput("tui.select.confirm");
        } catch (error) { component?.dispose(); throw error; }
      });
    },
  };
  const events = new Map<string, Function>(); let command!: (s: string, c: ExtensionCommandContext) => Promise<void>;
  const api = { registerCommand: (_: string, v: { handler: typeof command }) => { command = v.handler; }, registerTool() {}, on: (name: string, fn: Function) => events.set(name, fn), sendMessage() { messages++; }, sendUserMessage() { messages++; } } as unknown as ExtensionAPI;
  const ctx = { cwd: root, mode: "tui", hasUI: true, isProjectTrusted: () => true, sessionManager: SessionManager.create(root, root), modelRegistry: {}, ui } as unknown as ExtensionCommandContext;
  extension(api); await events.get("session_start")!({}, ctx); await command("", ctx); await events.get("session_shutdown")!({ reason: "quit" }, ctx);
  const state = ProjectStore.read(root)!;
  assert.equal(state.tasks[0].status, "needs_review"); assert.equal(state.tasks[0].attempts.length, 1);
  assert.equal(editors, 1); assert.equal(confirms, 1); assert.equal(messages, 0); assert.equal(timersDisposed, 7);
  assert.ok(screens.some(s => s.includes("실제 결과")));
});
