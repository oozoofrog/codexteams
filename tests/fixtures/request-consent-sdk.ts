import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { ProjectStore } from "../../src/core/store.ts";
import { TeamController } from "../../src/core/controller.ts";
import { TeamModeSupervisor } from "../../src/core/team-mode.ts";
import { processRegistry } from "../../src/core/process-registry.ts";
import { emptyUsage } from "../../src/core/usage.ts";
const mode = process.argv[2] === "rpc" ? "rpc" : process.argv[2] === "print" ? "print" : "tui";
const temp = realpathSync(mkdtempSync(join(tmpdir(), "request-consent-sdk-"))), root = join(temp, "project"), agent = join(temp, "agent"), sessions = join(temp, "sessions"); for (const p of [root, agent, sessions]) mkdirSync(p); execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
const store = ProjectStore.open(root); let runs = 0;
const runner = async (req: any) => { runs++; let text: string; if (req.systemPrompt.includes("read-only team coordinator")) { const i = JSON.parse(req.prompt.split("\n").at(-1)); text = JSON.stringify({ requestId: i.requestId, generation: i.generation, revision: i.revision, kind: "propose_plan", tasks: [{ id: "work", title: "Work", description: "Work", role: "developer", dependsOn: [], acceptance: ["works"] }], checks: [] }); } else if (req.tools.includes("bash")) { writeFileSync(join(root, "work.txt"), "work"); text = "done"; } else { const i = JSON.parse(req.prompt.match(/\{"implementationAttemptId"[^\n]+/)[0]); text = JSON.stringify({ implementationAttemptId: i.implementationAttemptId, artifactDigest: i.artifactDigest, checkIds: i.checkIds, requestId: i.requestId, requestRevision: i.requestRevision, scopeDigest: i.scopeDigest, verdict: "pass", findings: [] }); } return { outcome: "success" as const, text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: req.sessionId }; };
const controller = new TeamController(store, { runner, validateProfile: async () => {} }), supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} }); processRegistry().owners.set(root, { controller, supervisor, registry: {} as any });
let calls = 0, answer = false, pending = true, settle!: (value: boolean) => void; const ui = { notify() {}, setStatus() {}, setWidget() {}, async confirm() { calls++; if (pending) return await new Promise<boolean>(resolve => { settle = resolve; }); return answer; } };
async function until(f: () => boolean) { for (let i = 0; i < 300; i++) { if (f()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error("confirmation timed out"); }
const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }: any) => { const services = await createAgentSessionServices({ cwd, agentDir: agent, settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }), resourceLoaderOptions: { noExtensions: true, additionalExtensionPaths: [resolve("src/index.ts")], noSkills: true, noPromptTemplates: true, noThemes: true } }); return { ...await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent }), services, diagnostics: services.diagnostics }; };
let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
try {
  controller.add("developer", "manual check"); await controller.run("task-1");
  await supervisor.setMode(true); const ids = [supervisor.ingest({ text: "first", origin: "rpc", sessionId: "session" }), supervisor.ingest({ text: "second", origin: "rpc", sessionId: "session" })]; await supervisor.whenIdle();
  const current = runtime = await createAgentSessionRuntime(createRuntime, { cwd: root, agentDir: agent, sessionManager: SessionManager.create(root, sessions) });
  const emitted: unknown[] = []; current.session.subscribe(event => { emitted.push(event); });
  await current.session.bindExtensions({ mode, ...(mode === "print" ? {} : { uiContext: ui as never }), commandContextActions: { waitForIdle: () => current.session.waitForIdle(), newSession: o => current.newSession(o), fork: (id, o) => current.fork(id, o), navigateTree: async () => ({ cancelled: true }), switchSession: (p, o) => current.switchSession(p, o), reload: () => current.session.reload() } });
  const first = store.snapshot().teamMode!.requests.find(r => r.id === ids[0])!, second = store.snapshot().teamMode!.requests.find(r => r.id === ids[1])!; const previousRuns = runs;
  if (mode === "print") {
    const before = JSON.stringify(store.snapshot());
    await current.session.sendUserMessage(`/teams accept ${first.taskIds[0]}`, { expandPromptTemplates: true });
    await current.session.sendUserMessage(`/teams request accept ${second.id}`, { expandPromptTemplates: true });
    assert.equal(JSON.stringify(store.snapshot()), before); assert.equal(calls, 0); assert.equal(runs, previousRuns); assert.match(JSON.stringify(emitted), /결과 수락에는 Pi TUI 또는 RPC 확인이 필요합니다/);
    console.log(JSON.stringify({ ok: true, mode, calls }));
  } else {
  let submitted = current.session.sendUserMessage(`/teams accept ${first.taskIds[0]}`, { expandPromptTemplates: true }); await until(() => calls === 1); assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === ids[0])!.status, "awaiting_user_acceptance"); settle(false); await submitted; assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === ids[0])!.status, "awaiting_user_acceptance");
  submitted = current.session.sendUserMessage(`/teams request accept ${second.id}`, { expandPromptTemplates: true }); await until(() => calls === 2); assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === ids[1])!.status, "awaiting_user_acceptance"); settle(false); await submitted; assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === ids[1])!.status, "awaiting_user_acceptance");
  const checking = controller.check("task-1", "node -e \"setTimeout(() => {}, 300)\"");
  await until(() => controller.activeOperation?.kind === "check");
  submitted = current.session.sendUserMessage(`/teams accept ${first.taskIds[0]}`, { expandPromptTemplates: true }); await until(() => calls === 3);
  await checking; settle(true); await submitted; assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === ids[0])!.status, "accepted");
  submitted = current.session.sendUserMessage(`/teams request accept ${second.id}`, { expandPromptTemplates: true }); await until(() => calls === 4);
  store.update(s => { s.teamMode!.requests.find(r => r.id === second.id)!.revision++; }); settle(true); await submitted;
  assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === second.id)!.status, "awaiting_user_acceptance");
  store.update(s => { s.teamMode!.requests.find(r => r.id === second.id)!.revision--; });
  submitted = current.session.sendUserMessage(`/teams request accept ${second.id}`, { expandPromptTemplates: true }); await until(() => calls === 5);
  writeFileSync(join(root, "work.txt"), "tampered"); settle(true); await submitted; assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === second.id)!.status, "awaiting_user_acceptance");
  writeFileSync(join(root, "work.txt"), "work"); pending = false; answer = true; await current.session.sendUserMessage(`/teams request accept ${second.id}`, { expandPromptTemplates: true }); assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === ids[1])!.status, "accepted"); assert.equal(runs, previousRuns); console.log(JSON.stringify({ ok: true, mode, calls }));
  }
} finally { await runtime?.dispose(); await supervisor.shutdown(); await controller.shutdown(); rmSync(temp, { recursive: true, force: true }); }
