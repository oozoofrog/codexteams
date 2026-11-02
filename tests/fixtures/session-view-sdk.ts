import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { ProjectStore } from "../../src/core/store.ts";
import { TeamController } from "../../src/core/controller.ts";
import { ensureView } from "../../src/core/navigation.ts";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "sessions-sdk-view-")));
const root = join(temp, "project"), agent = join(temp, "agent"), dir = join(temp, "sessions");
for (const path of [root, agent, dir]) mkdirSync(path);
const store = ProjectStore.open(root);
const team = new TeamController(store, { validateProfile: async () => {}, runner: async () => { throw Error("no inference"); } });
team.add("developer", "view fixture");
const parent = SessionManager.create(root, dir);
parent.appendMessage({ role: "user", content: [{ type: "text", text: "view checkpoint" }], timestamp: Date.now() });
const view = ensureView(store, { cwd: root, sessionManager: parent } as never, "task", "task-1");
await team.shutdown();
const stateFile = join(root, ".codexteams", "state.json"), initialState = readFileSync(stateFile);
const ext = resolve("src/index.ts");
let viewers = 0, homes = 0, disposed = 0, events = 0;
const errors: string[] = [];
let active: { component: any; close: () => void; kind: "viewer" | "home" } | undefined;
const ui = {
  notify: (s: string) => { errors.push(s); }, setStatus() {}, setWidget() {},
  custom: (factory: any, opts: any) => new Promise((resolveCustom, reject) => {
    let component: any, closed = false;
    const close = (value?: unknown) => {
      if (closed) return;
      closed = true;
      try { component?.dispose?.(); } finally { disposed++; active = undefined; resolveCustom(value); }
    };
    try {
      assert.equal(opts.overlay, true);
      component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, { matches: (_: string, key: string) => key === "tui.select.cancel" }, close);
      const lines = component.render(120);
      const kind = lines.at(-1)?.includes("줄") ? "viewer" : "home";
      if (kind === "viewer") { viewers++; assert.ok(lines.length <= 18); assert.match(lines.at(-1), /줄/); }
      else { homes++; assert.ok(lines.length <= 24); assert.match(lines[0], /팀/); assert.match(lines.join("\n"), /view fixture/); assert.match(lines.at(-1), /Enter.*Esc/); }
      active = { component, close, kind };
    } catch (error) { try { component?.dispose?.(); } finally { active = undefined; reject(error); } }
  }),
};
const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }: any) => {
  const services = await createAgentSessionServices({ cwd, agentDir: agent, settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }), resourceLoaderOptions: { noExtensions: true, additionalExtensionPaths: [ext], noSkills: true, noPromptTemplates: true, noThemes: true } });
  return { ...await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent }), services, diagnostics: services.diagnostics };
};
async function until(f: () => boolean) {
  for (let i = 0; i < 250; i++) { if (f()) return; await new Promise(r => setTimeout(r, 20)); }
  throw Error(`timed out viewers=${viewers} homes=${homes} active=${active?.kind} errors=${errors.join("|")}`);
}
async function run(startView: boolean, replaceWhileOpen = false, openCommand = false) {
  const expectedViewer = viewers + 1, expectedHome = homes + (replaceWhileOpen ? 0 : 1);
  const runtime = await createAgentSessionRuntime(createRuntime, { cwd: root, agentDir: agent, sessionManager: startView ? SessionManager.open(view.file) : SessionManager.open(parent.getSessionFile()!) });
  try {
    const bind = async () => {
      runtime.session.subscribe(e => { if (e.type === "agent_start") events++; });
      await runtime.session.bindExtensions({ mode: "tui", uiContext: ui as never, commandContextActions: { waitForIdle: () => runtime.session.waitForIdle(), newSession: o => runtime.newSession(o), fork: (id, o) => runtime.fork(id, o), navigateTree: async () => ({ cancelled: true }), switchSession: (p, o) => runtime.switchSession(p, o), reload: () => runtime.session.reload() } });
    };
    runtime.setRebindSession(bind); await bind();
    if (!startView) { if (openCommand) await runtime.session.prompt("/teams open task-1"); else await runtime.switchSession(view.file); }
    await until(() => viewers >= expectedViewer && active?.kind === "viewer");
    if (replaceWhileOpen) await runtime.switchSession(parent.getSessionFile()!);
    else active!.component.handleInput("escape");
    await until(() => runtime.session.sessionFile === parent.getSessionFile());
    if (!replaceWhileOpen) { await until(() => homes >= expectedHome && active?.kind === "home"); active!.component.handleInput("escape"); await until(() => !active); }
    assert.equal(events, 0);
  } finally { active?.close(); await runtime.dispose(); }
  assert.deepEqual(readFileSync(stateFile), initialState);
}
try {
  await run(false); await run(true); await run(false, true); await run(false, false, true);
  assert.equal(viewers, 4); assert.equal(homes, 3); assert.equal(disposed, 7);
  console.log(JSON.stringify({ ok: true, viewers, homes, disposed, agentStarts: events }));
} finally { active?.close(); rmSync(temp, { recursive: true, force: true }); }
