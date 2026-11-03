import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { TeamController } from "../src/core/controller.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { ProjectStore } from "../src/core/store.ts";
import { emptyUsage } from "../src/core/usage.ts";
import { parseCoordinatorAction } from "../src/core/team-mode-protocol.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";

const identity = { requestId: "turn", generation: 1, revision: 1 };
const stage = (id: string, role = "developer") => ({ id, title: id, description: `${id} scope`, role, dependsOn: [], acceptance: [`${id} works`] });
function result(request: WorkerRequest, text: string): WorkerResult { return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [request.profile.model], sessionId: request.sessionId }; }
function review(request: WorkerRequest): string { const p = JSON.parse(request.prompt.match(/\{"implementationAttemptId"[^\n]+/)![0]); return JSON.stringify({ implementationAttemptId: p.implementationAttemptId, artifactDigest: p.artifactDigest, checkIds: p.checkIds, requestId: p.requestId, requestRevision: p.requestRevision, scopeDigest: p.scopeDigest, verdict: "pass", findings: [] }); }

test("leader can select serial design, read-only analysis, and development scopes", () => {
 const action = parseCoordinatorAction(JSON.stringify({ ...identity, kind: "propose_plan", rationale: "Inspect design before implementation", tasks: [stage("design", "designer"), stage("analysis", "reviewer"), stage("code")], checks: [] }), identity);
 assert.equal(action.kind, "propose_plan");
});

test("ordinary conversation retains results and clarifies ambiguous follow-up without another writer", async t => {
 const root = mkdtempSync(join(tmpdir(), "chat-context-")); t.after(() => rmSync(root, { recursive: true, force: true }));
 const store = ProjectStore.open(root); const contexts: any[] = [];
 const runner = async (request: WorkerRequest) => { const p = JSON.parse(request.prompt.split("\n").at(-1)!); contexts.push(p); return result(request, JSON.stringify({ requestId: p.requestId, generation: p.generation, revision: p.revision, kind: contexts.length === 1 ? "answer" : "clarify", text: contexts.length === 1 ? "The project is CodexTeams." : "Which result should I change?" })); };
 const supervisor = new TeamModeSupervisor(store, { runner, validateProfile: async () => {} }); t.after(async () => { await supervisor.shutdown(); store.close(); });
 await supervisor.setMode(true); supervisor.ingest({ text: "What is the project?", origin: "rpc", sessionId: "session" }); await supervisor.whenIdle();
 supervisor.ingest({ text: "Change that", origin: "rpc", sessionId: "session" }); await supervisor.whenIdle();
 assert.ok(contexts[1].conversation.some((turn: any) => turn.role === "assistant" && turn.text.includes("CodexTeams")));
 assert.equal(store.snapshot().teamMode!.requests.at(-1)!.status, "clarifying");
 assert.equal(store.snapshot().tasks.length, 0);
 assert.ok((store.snapshot().teamMode as any).journal.some((entry: any) => entry.role === "assistant" && entry.text.includes("Which result")));
});

test("serial stages bind all writer attempts and preserve immutable accepted history", async t => {
 const root = mkdtempSync(join(tmpdir(), "chat-stages-")); t.after(() => rmSync(root, { recursive: true, force: true })); execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
 const store = ProjectStore.open(root); const order: string[] = []; let leaderContext: any;
 const runner = async (request: WorkerRequest) => {
  if (request.systemPrompt.includes("read-only team coordinator")) { const p = JSON.parse(request.prompt.split("\n").at(-1)!); leaderContext = p; return result(request, JSON.stringify({ requestId: p.requestId, generation: p.generation, revision: p.revision, kind: "propose_plan", rationale: "Design, inspect, implement", tasks: [stage("design", "designer"), stage("inspect", "reviewer"), stage("code")], checks: ["node -e \"process.exit(0)\""] })); }
  if (request.prompt.includes("implementationAttemptId")) { order.push("final review"); return result(request, review(request)); }
  const current = request.prompt.match(/"title": "(design|inspect|code)"/)![1]; order.push(current); if (request.tools.includes("bash")) writeFileSync(join(root, `${current}.txt`), current); else assert.ok(!request.tools.includes("write")); return result(request, `${current} result`);
 };
 const controller = new TeamController(store, { runner, validateProfile: async () => {} }); const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} }); t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); });
 await supervisor.setMode(true); const id = supervisor.ingest({ text: "Design and implement", origin: "rpc", sessionId: "session" }); await supervisor.whenIdle();
 let state = store.snapshot(), request = state.teamMode!.requests.find(r => r.id === id)!;
 assert.equal(request.status, "awaiting_user_acceptance", request.reason); assert.deepEqual(order, ["design", "inspect", "code", "final review"]);
 const scope = state.teamMode!.reviewEvidence.at(-1)!.scope as any; assert.deepEqual(scope.stages.map((s: any) => s.title), ["design", "inspect", "code"]);
 assert.ok(scope.stages.every((s: any) => s.attemptId && s.result));
 controller.accept(request.taskIds[0]); state = store.snapshot(); request = state.teamMode!.requests.find(r => r.id === id)!;
 assert.equal((request.receipt as any).stageAttempts.length, 2);
 assert.throws(() => store.update(s => { s.teamMode!.requests.find(r => r.id === id)!.text = "rewritten accepted history"; }));
 assert.equal(leaderContext.currentUserRequest, "Design and implement");
});

test("read-only reviewer stages finish with findings and no mutable acceptance", async t => {
 const root = mkdtempSync(join(tmpdir(), "chat-readonly-")); t.after(() => rmSync(root, { recursive: true, force: true })); const store = ProjectStore.open(root); let ran = 0;
 const runner = async (request: WorkerRequest) => { if (request.systemPrompt.includes("read-only team coordinator")) { const p = JSON.parse(request.prompt.split("\n").at(-1)!); return result(request, JSON.stringify({ requestId: p.requestId, generation: p.generation, revision: p.revision, kind: "propose_plan", rationale: "Only inspect", tasks: [stage("inspect", "reviewer")], checks: [] })); } ran++; assert.deepEqual(request.tools, ["read", "grep", "find", "ls"]); return result(request, "Found a missing error path."); };
 const controller = new TeamController(store, { runner, validateProfile: async () => {} }); const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} }); t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); }); await supervisor.setMode(true); const id = supervisor.ingest({ text: "Review current implementation", origin: "rpc", sessionId: "session" }); await supervisor.whenIdle();
 const state = store.snapshot(), r = state.teamMode!.requests.find(r => r.id === id)!; assert.equal(r.status, "answered", r.reason); assert.match(r.answer!, /missing error path/); assert.equal(r.receipt, undefined); assert.equal(state.teamMode!.reviewEvidence.length, 0); assert.equal(ran, 1); assert.equal(state.tasks[0].status, "needs_review");
});

test("targeted mid-stage amendment does not skip unfinished intervening read-only stages", async t => {
 const root = mkdtempSync(join(tmpdir(), "chat-midstage-")); t.after(() => rmSync(root, { recursive: true, force: true })); execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n"); const store = ProjectStore.open(root); const order: string[] = []; let release!: () => void;
 const runner = async (request: WorkerRequest) => {
  if (request.systemPrompt.includes("read-only team coordinator")) { const p = JSON.parse(request.prompt.split("\n").at(-1)!); const target = p.actualState.requests.find((r: any) => r.text === "Build"); return result(request, JSON.stringify(p.currentUserRequest === "Adjust code" ? { requestId: p.requestId, generation: p.generation, revision: p.revision, kind: "amend", targetRequestId: target.id, targetRevision: target.revision, timing: "after_current", instruction: "Code should include B", restartFromTaskId: target.tasks.find((t: any) => t.title === "code").id, rationale: "Only code scope changes" } : { requestId: p.requestId, generation: p.generation, revision: p.revision, kind: "propose_plan", rationale: "Design inspect code", tasks: [stage("design", "designer"), stage("inspect", "reviewer"), stage("code")], checks: [] })); }
  if (request.prompt.includes("implementationAttemptId")) return result(request, review(request)); const title = request.prompt.match(/"title": "(design|inspect|code)"/)![1]; order.push(title); if (title === "design") await new Promise<void>(resolve => { release = resolve; }); if (title === "code") assert.match(request.prompt, /include B/); return result(request, `${title} result`);
 };
 const controller = new TeamController(store, { runner, validateProfile: async () => {} }); const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} }); t.after(async () => { release?.(); await supervisor.shutdown(); await controller.shutdown(); }); await supervisor.setMode(true); const id = supervisor.ingest({ text: "Build", origin: "rpc", sessionId: "session" });
 for (let i = 0; i < 100 && !release; i++) await new Promise(r => setTimeout(r, 5)); assert.ok(release); const amend = supervisor.ingest({ text: "Adjust code", origin: "rpc", sessionId: "session" }); for (let i = 0; i < 100 && store.snapshot().teamMode!.requests.find(r => r.id === amend)!.status !== "answered"; i++) await new Promise(r => setTimeout(r, 5)); release(); await supervisor.whenIdle();
 assert.deepEqual(order, ["design", "inspect", "code"]); assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === id)!.status, "awaiting_user_acceptance");
});

test("intake cannot persist an orphan request if its durable user journal fails", async t => {
 const root = mkdtempSync(join(tmpdir(), "chat-atomic-")); t.after(() => rmSync(root, { recursive: true, force: true })); const store = ProjectStore.open(root); const supervisor = new TeamModeSupervisor(store, { runner: async () => { throw Error("must not run"); }, validateProfile: async () => {} }); t.after(async () => { await supervisor.shutdown(); store.close(); }); await supervisor.setMode(true);
 const before = store.snapshot(), original = (store as any).persist;
 (store as any).persist = (state: any) => { if (state.teamMode?.journal?.length) throw Error("disk failure on intake journal"); return original.call(store, state); };
 assert.throws(() => supervisor.ingest({ text: "Do work", origin: "rpc", sessionId: "session" }), /disk failure/); (store as any).persist = original; assert.deepEqual(store.snapshot(), before);
});

test("large Unicode read-only findings remain complete in durable response chunks", async t => {
 const root = mkdtempSync(join(tmpdir(), "chat-unicode-")); t.after(() => rmSync(root, { recursive: true, force: true })); const store = ProjectStore.open(root); const findings = "검토 결과 🐸\n".repeat(7000);
 const runner = async (request: WorkerRequest) => { if (request.systemPrompt.includes("read-only team coordinator")) { const p = JSON.parse(request.prompt.split("\n").at(-1)!); return result(request, JSON.stringify({ requestId: p.requestId, generation: p.generation, revision: p.revision, kind: "propose_plan", rationale: "Read-only findings", tasks: [stage("inspect", "reviewer")], checks: [] })); } return result(request, findings); };
 const controller = new TeamController(store, { runner, validateProfile: async () => {} }), supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} }); t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); }); await supervisor.setMode(true); const id = supervisor.ingest({ text: "Inspect", origin: "rpc", sessionId: "session" }); await supervisor.whenIdle(); const state = store.snapshot(); assert.equal(state.teamMode!.requests.find(r => r.id === id)!.status, "answered"); const response = state.teamMode!.journal!.filter(e => e.requestId === id && e.kind === "result"); assert.ok(response.length > 1); assert.ok(response.every(e => Buffer.byteLength(e.text) <= 65536)); assert.ok(response.map(e => e.text).join("").includes(findings));
});

test("reopening an existing explicit profile never replaces it with new-project defaults", t => {
 const root = mkdtempSync(join(tmpdir(), "chat-profiles-")); t.after(() => rmSync(root, { recursive: true, force: true })); const store = ProjectStore.open(root); store.update(s => { s.profiles.designer = { provider: "openai", model: "gpt-6.1-terra", effort: "medium" }; s.profiles.planner.effort = "max"; }); const expected = store.snapshot().profiles; store.close(); const reopened = ProjectStore.open(root); t.after(() => reopened.close()); assert.deepEqual(reopened.snapshot().profiles, expected);
});
