import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { processRegistry } from "../src/core/process-registry.ts";
import { emptyUsage } from "../src/core/usage.ts";
for (const held of ["action", "action-stale", "result", "details"] as const) test(`same ${held} component renders worker/check/review completion and supports read-only return`, { timeout: 10000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "request-live-panel-"))); t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
  const store = ProjectStore.open(root); let release!: () => void, runs = 0;
  const runner = async (req: any) => { runs++; let text: string; if (req.systemPrompt.includes("read-only team coordinator")) { const i = JSON.parse(req.prompt.split("\n").at(-1)); text = JSON.stringify({ requestId: i.requestId, generation: i.generation, revision: i.revision, kind: "propose_plan", tasks: [{ id: "work", title: "Work", description: "Work", role: "developer", dependsOn: [], acceptance: ["works"] }], checks: ["node -e \"process.exit(0)\""] }); } else if (req.tools.includes("bash")) { await new Promise<void>(r => { release = r; }); writeFileSync(join(root, "work.txt"), "result"); text = "done"; } else { const i = JSON.parse(req.prompt.match(/\{"implementationAttemptId"[^\n]+/)[0]); text = JSON.stringify({ implementationAttemptId: i.implementationAttemptId, artifactDigest: i.artifactDigest, checkIds: i.checkIds, requestId: i.requestId, requestRevision: i.requestRevision, scopeDigest: i.scopeDigest, verdict: "pass", findings: [] }); } return { outcome: "success" as const, text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: req.sessionId }; };
  const controller = new TeamController(store, { runner, validateProfile: async () => {} }), supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} });
  processRegistry().owners.set(root, { controller, supervisor, registry: {} as any }); await supervisor.setMode(true); supervisor.ingest({ text: "라이브 요청", origin: "rpc", sessionId: "session" });
  for (let i = 0; i < 200 && !release; i++) await new Promise(r => setTimeout(r, 5)); assert.ok(release);
  let panel = 0, confirms = 0; const errors: string[] = [];
  const ui = { notify(s: string) { errors.push(s); }, setStatus() {}, setWidget() {}, async confirm() { confirms++; if (held === "action-stale") { store.update(s => { s.teamMode!.requests[0].revision++; }); return true; } return false; }, async custom(factory: any) { return await new Promise((resolve, reject) => { let component: any;
    component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, { matches: (a: string, b: string) => a === b }, (v: unknown) => { component.dispose(); resolve(v); });
    let lines = component.render(120); panel++;
    if (panel === 1) { for (let i = 0; i < 10 && !lines.some((l: string) => l.startsWith("→ ") && l.includes("라이브 요청")); i++) { component.handleInput("tui.select.down"); lines = component.render(120); } assert.ok(lines.some((l: string) => l.startsWith("→ ") && l.includes("라이브 요청"))); component.handleInput("tui.select.confirm"); }
    else if (panel === 2 && !held.startsWith("action")) { const label = held === "result" ? "결과 보기" : "상세 기록"; for (let i = 0; i < 10 && !lines.some((l: string) => l.startsWith("→ ") && l.includes(label)); i++) { component.handleInput("tui.select.down"); lines = component.render(120); } assert.ok(lines.some((l: string) => l.startsWith("→ ") && l.includes(label))); component.handleInput("tui.select.confirm"); }
    else if ((panel === 2 && held.startsWith("action")) || (panel === 3 && !held.startsWith("action"))) {
      if (held.startsWith("action")) assert.match(lines.join("\n"), /작업 중/); else if (held === "result") assert.match(lines.join("\n"), /작업 중/);
      release(); void supervisor.whenIdle().then(() => {
        lines = component.render(120); let all = lines.join("\n");
        if (held.startsWith("action")) { assert.match(all, /결과 확인 필요/); assert.match(all, /결과 수락/); }
        else { for (let i = 0; i < 30; i++) { component.handleInput("\u001b[6~"); all += "\n" + component.render(120).join("\n"); }
          if (held === "result") { assert.match(all, /결과 확인 필요/); assert.match(all, /검증 통과/); assert.match(all, /독립 검토: 통과/); }
          else { assert.match(all, /linkedTasks/); assert.match(all, /reviewEvidence/); assert.match(all, /scopeDigest/); assert.match(all, /passed/); }
        }
        if (held.startsWith("action")) { for (let i = 0; i < 12 && !lines.some((l: string) => l.startsWith("→ ") && l.includes("결과 수락")); i++) { component.handleInput("tui.select.down"); lines = component.render(120); } assert.ok(lines.some((l: string) => l.startsWith("→ ") && l.includes("결과 수락"))); component.handleInput("tui.select.confirm"); }
        else component.handleInput(held === "details" ? "tui.select.cancel" : "tui.select.confirm");
      }).catch(error => { component.dispose(); reject(error); });
    }
    else component.handleInput("tui.select.cancel");
  }); } };
  const events = new Map<string, Function>(); let command!: (s: string, c: ExtensionCommandContext) => Promise<void>; const api = { registerCommand: (_: string, v: { handler: typeof command }) => { command = v.handler; }, registerTool() {}, on: (n: string, f: Function) => events.set(n, f), sendMessage() {}, sendUserMessage() {} } as unknown as ExtensionAPI;
  const ctx = { cwd: root, mode: "tui", hasUI: true, isProjectTrusted: () => true, sessionManager: SessionManager.create(root, root), modelRegistry: {}, ui } as unknown as ExtensionCommandContext;
  extension(api); await events.get("session_start")!({}, ctx); await command("", ctx); assert.equal(runs, 3); assert.equal(confirms, held.startsWith("action") ? 1 : 0); if (held === "action-stale") assert.equal(store.snapshot().teamMode!.requests[0].receipt, undefined); assert.deepEqual(errors, []); await events.get("session_shutdown")!({ reason: "quit" }, ctx);
});
