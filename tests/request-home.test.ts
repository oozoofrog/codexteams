import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { processRegistry } from "../src/core/process-registry.ts";
import { emptyUsage } from "../src/core/usage.ts";

test("Home creates an ID-free request and shows its answer", { timeout: 5000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "request-home-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root);
  const runner = async (req: any) => { const input = JSON.parse(req.prompt.split("\n").at(-1)); return { outcome: "success" as const, text: JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "answer", text: "실제 답변" }), exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: req.sessionId }; };
  const team = new TeamController(store, { runner, validateProfile: async () => {} });
  const supervisor = new TeamModeSupervisor(store, { controller: team, runner, validateProfile: async () => {} });
  processRegistry().owners.set(root, { controller: team, supervisor, registry: {} as any });
  const choices = ["새 요청", "문의합니다", "결과 보기", null, null, null]; const screens: string[] = []; let confirms = 0;
  const ui = { notify() {}, setStatus() {}, setWidget() {}, async editor() { return "문의합니다"; }, async confirm() { confirms++; return true; }, async custom(factory: any) {
    await supervisor.whenIdle();
    return await new Promise(resolve => { let component: any;
      try { component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, { matches: (a: string, b: string) => a === b }, (v: unknown) => { component.dispose(); resolve(v); });
        let lines = component.render(120); screens.push(lines.join("\n")); const choice = choices.shift();
        if (choice === null) { component.handleInput("tui.select.cancel"); return; }
        assert.ok(choice);
        for (let i = 0; i < 30 && !lines.some((l: string) => l.startsWith("→ ") && l.includes(choice)); i++) { component.handleInput("tui.select.down"); lines = component.render(120); }
        assert.ok(lines.some((l: string) => l.startsWith("→ ") && l.includes(choice)), `missing ${choice}: ${lines.join(" | ")}`); component.handleInput("tui.select.confirm");
      } catch (e) { component?.dispose(); throw e; }
    });
  } };
  const events = new Map<string, Function>(); let command!: (s: string, c: ExtensionCommandContext) => Promise<void>;
  const api = { registerCommand: (_: string, v: { handler: typeof command }) => { command = v.handler; }, registerTool() {}, on: (n: string, f: Function) => events.set(n, f), sendMessage() {}, sendUserMessage() {} } as unknown as ExtensionAPI;
  const ctx = { cwd: root, mode: "tui", hasUI: true, isIdle: () => true, isProjectTrusted: () => true, sessionManager: SessionManager.create(root, root), modelRegistry: {}, ui } as unknown as ExtensionCommandContext;
  extension(api); await events.get("session_start")!({}, ctx); await command("", ctx); await events.get("session_shutdown")!({ reason: "quit" }, ctx);
  assert.equal(confirms, 1); assert.ok(screens.some(s => s.includes("실제 답변")));
});
