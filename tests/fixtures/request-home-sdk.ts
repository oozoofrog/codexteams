import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { ProjectStore } from "../../src/core/store.ts";
import { TeamController } from "../../src/core/controller.ts";
import { TeamModeSupervisor } from "../../src/core/team-mode.ts";
import { processRegistry } from "../../src/core/process-registry.ts";
import { emptyUsage } from "../../src/core/usage.ts";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "request-sdk-")));
const root = join(temp, "project"), agent = join(temp, "agent"), sessions = join(temp, "sessions");
for (const path of [root, agent, sessions]) mkdirSync(path);
const store = ProjectStore.open(root);
const runner = async (req: any) => { const input = JSON.parse(req.prompt.split("\n").at(-1)); return { outcome: "success" as const, text: JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "answer", text: "SDK 답변" }), exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: req.sessionId }; };
const controller = new TeamController(store, { runner, validateProfile: async () => {} });
const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} });
processRegistry().owners.set(root, { controller, supervisor, registry: {} as any });
const screens: string[] = [], picks = ["새 요청", "SDK 요청", "결과 보기", null, null, null]; let confirmations = 0, starts = 0;
const ui = { notify() {}, setStatus() {}, setWidget() {}, async editor() { return "SDK 요청"; }, async confirm() { confirmations++; return true; }, async custom(factory: any) {
  await supervisor.whenIdle();
  return await new Promise(resolveCustom => {
    let component: any;
    try {
      component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, { matches: (a: string, b: string) => a === b }, (value: unknown) => { component.dispose(); resolveCustom(value); });
      let lines = component.render(120); screens.push(lines.join("\n")); const pick = picks.shift();
      if (pick === null) { component.handleInput("tui.select.cancel"); return; }
      assert.ok(pick);
      for (let i = 0; i < 25 && !lines.some((line: string) => line.startsWith("→ ") && line.includes(pick)); i++) { component.handleInput("tui.select.down"); lines = component.render(120); }
      assert.ok(lines.some((line: string) => line.startsWith("→ ") && line.includes(pick)), `missing ${pick}: ${lines.join(" | ")}`);
      component.handleInput("tui.select.confirm");
    } catch (error) { component?.dispose(); throw error; }
  });
} };
const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }: any) => {
  const services = await createAgentSessionServices({ cwd, agentDir: agent, settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }), resourceLoaderOptions: { noExtensions: true, additionalExtensionPaths: [resolve("src/index.ts")], noSkills: true, noPromptTemplates: true, noThemes: true } });
  return { ...await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent }), services, diagnostics: services.diagnostics };
};
let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
try {
  runtime = await createAgentSessionRuntime(createRuntime, { cwd: root, agentDir: agent, sessionManager: SessionManager.create(root, sessions) });
  const current = runtime;
  const bind = async () => {
    current.session.subscribe(e => { if (e.type === "agent_start") starts++; });
    await current.session.bindExtensions({ mode: "tui", uiContext: ui as never, commandContextActions: { waitForIdle: () => current.session.waitForIdle(), newSession: o => current.newSession(o), fork: (id, o) => current.fork(id, o), navigateTree: async () => ({ cancelled: true }), switchSession: (p, o) => current.switchSession(p, o), reload: () => current.session.reload() } });
  };
  current.setRebindSession(bind); await bind();
  await current.session.prompt("/teams");
  assert.equal(confirmations, 1); assert.ok(screens.some(s => s.includes("SDK 답변"))); assert.equal(starts, 0);
  console.log(JSON.stringify({ ok: true, screens: screens.length, agentStarts: starts }));
} finally { await runtime?.dispose(); await supervisor.shutdown(); await controller.shutdown(); rmSync(temp, { recursive: true, force: true }); }
