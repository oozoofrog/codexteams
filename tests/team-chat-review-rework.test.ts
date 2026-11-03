import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import extension from "../src/index.ts";
import { processRegistry } from "../src/core/process-registry.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { deliverChat, explicitAcceptanceQuote } from "../src/core/team-chat.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";

const task = (id: string, role = "developer") => ({ id, title: id, description: `${id} scope`, role, dependsOn: [], acceptance: [`${id} works`] });
const plan = { kind: "propose_plan", rationale: "Design inspect code", tasks: [task("design", "designer"), task("analysis", "reviewer"), task("code")], checks: [] };
const target = (p: any) => p.actualState.requests.find((r: any) => r.text === "Build");
async function setup(t: TestContext, decide: (context: any) => object | Promise<object>, stage?: (title: string, request: WorkerRequest) => Promise<void>) {
 const root = mkdtempSync(join(tmpdir(), "chat-review-fix-")); t.after(() => rmSync(root, { recursive: true, force: true })); execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
 const store = ProjectStore.open(root), history: any[] = [], order: string[] = []; let live = true;
 const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
  let text: string;
  if (request.systemPrompt.includes("read-only team coordinator")) { const p = JSON.parse(request.prompt.split("\n").at(-1)!); text = JSON.stringify({ requestId: p.requestId, generation: p.generation, revision: p.revision, ...await decide(p) }); }
  else if (request.prompt.includes("implementationAttemptId")) { const p = JSON.parse(request.prompt.match(/\{"implementationAttemptId"[^\n]+/)![0]); text = JSON.stringify({ implementationAttemptId: p.implementationAttemptId, artifactDigest: p.artifactDigest, checkIds: p.checkIds, requestId: p.requestId, requestRevision: p.requestRevision, scopeDigest: p.scopeDigest, verdict: "pass", findings: ["All selected scopes checked"] }); }
  else { const title = request.prompt.match(/"title": "([^"]+)"/)![1]; order.push(title); await stage?.(title, request); if (request.tools.includes("bash")) writeFileSync(join(root, `${title}.txt`), `${title} ${order.length}`); text = `${title} result`; }
  return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId };
 };
 const controller = new TeamController(store, { runner, validateProfile: async () => {} });
 const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {}, canAccept: () => live } as any);
 t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); }); await supervisor.setMode(true);
 const deliver = () => { for (let i = 0; i < 3; i++) deliverChat(store, { sessionId: "session", history, send: m => history.push({ id: `history-${history.length}`, type: "custom_message", ...m }) }); };
 const ingest = (text: string) => { deliver(); return supervisor.ingest({ text, origin: "rpc", sessionId: "session", visibleJournalIds: history.map(e => e.details.journalId) }); };
 const say = async (text: string) => { const id = ingest(text); await supervisor.whenIdle(); deliver(); return store.snapshot().teamMode!.requests.find(r => r.id === id)!; };
 return { root, store, controller, supervisor, order, history, say, ingest, deliver, setLive: (value: boolean) => { live = value; } };
}

for (const revoke of ["new-human", "live-context"] as const) test(`R1 delayed human acceptance loses authority after ${revoke}`, async t => {
 let release!: () => void, started!: () => void; const pending = new Promise<void>(r => { started = r; });
 const h = await setup(t, async p => { if (p.currentUserRequest === "Build") return plan; if (p.currentUserRequest === "I accept this exact result.") { started(); await new Promise<void>(r => { release = r; }); const r = target(p); return { kind: "accept", targetRequestId: r.id, targetRevision: r.revision, offerId: p.offers.at(-1).id, acceptanceQuote: p.currentUserRequest }; } return { kind: "answer", text: "Acceptance is revoked." }; });
 const build = await h.say("Build"), before = h.store.snapshot(), accept = h.say("I accept this exact result."); await pending;
 if (revoke === "new-human") h.ingest("Wait, do not accept it"); else h.setLive(false);
 release(); await accept; const after = h.store.snapshot(), r = after.teamMode!.requests.find(r => r.id === build.id)!;
 assert.equal(r.receipt, undefined); assert.equal(r.status, "awaiting_user_acceptance"); assert.deepEqual(after.tasks, before.tasks); assert.deepEqual(after.teamMode!.reviewEvidence, before.teamMode!.reviewEvidence);
});

test("R2 natural amendment leaves receipt-less legacy accepted history byte-for-byte unchanged", async t => {
 const root = mkdtempSync(join(tmpdir(), "chat-legacy-review-")); t.after(() => rmSync(root, { recursive: true, force: true })); let store = ProjectStore.open(root);
 store.update(s => { const now = s.createdAt; s.tasks.push({ id: "writer", title: "Legacy", description: "Legacy", role: "developer", dependsOn: [], acceptance: ["works"], status: "completed", createdAt: now, updatedAt: now, acceptedAt: now, acceptanceSource: "user", acceptedAttemptId: "implementation", acceptedCheckIds: [], attempts: [{ id: "implementation", sessionId: "worker", profile: s.profiles.developer, startedAt: now, endedAt: now, outcome: "success", effectiveModels: [], text: "Accepted historical output", usage: emptyUsage(), logFile: "logs/implementation.jsonl" }], checks: [] }, { id: "reviewer", title: "Review", description: "Review", role: "reviewer", dependsOn: [], acceptance: ["review"], status: "queued", createdAt: now, updatedAt: now, attempts: [], checks: [] }); s.teamMode = { version: 1, enabled: true, generation: 1, requests: [{ id: "legacy", text: "Legacy work", origin: "rpc", sessionId: "session", receivedAt: now, revision: 1, status: "awaiting_user_acceptance", taskIds: ["writer", "reviewer"] }], coordinatorAttempts: [], events: [], reviewEvidence: [] }; }); store.close(); store = ProjectStore.open(root); const before = store.snapshot();
 const contexts: any[] = [];
 const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
  let text = "Read-only follow-up findings";
  if (request.systemPrompt.includes("read-only team coordinator")) { const p = JSON.parse(request.prompt.split("\n").at(-1)!); contexts.push(p); const action = p.currentUserRequest === "Create linked follow-up" ? { kind: "propose_plan", rationale: "Preserve accepted history and inspect follow-up", tasks: [task("followup", "reviewer")], checks: [], parentRequestId: "legacy", targetRevision: 1 } : { kind: "amend", targetRequestId: "legacy", targetRevision: 1, timing: "after_current", instruction: "Rewrite historical output" }; text = JSON.stringify({ requestId: p.requestId, generation: p.generation, revision: p.revision, ...action }); }
  return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId };
 };
 const controller = new TeamController(store, { runner, validateProfile: async () => {} }), supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} }); t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); }); const id = supervisor.ingest({ text: "Change that result", origin: "rpc", sessionId: "session" }); await supervisor.whenIdle(); const after = store.snapshot();
 assert.deepEqual(after.teamMode!.requests.find(r => r.id === "legacy"), before.teamMode!.requests[0]); assert.deepEqual(after.tasks, before.tasks); assert.deepEqual(after.teamMode!.reviewEvidence, before.teamMode!.reviewEvidence); assert.ok(["blocked", "clarifying"].includes(after.teamMode!.requests.find(r => r.id === id)!.status));
 assert.throws(() => store.update(s => { s.teamMode!.requests.find(r => r.id === "legacy")!.revision++; }), /수락/);
 assert.equal(contexts[0].actualState.requests.find((r: any) => r.id === "legacy").status, "accepted"); assert.equal(contexts[0].activeRequests.some((r: any) => r.id === "legacy"), false);
 const followId = supervisor.ingest({ text: "Create linked follow-up", origin: "rpc", sessionId: "session" }); await supervisor.whenIdle(); const final = store.snapshot(), follow = final.teamMode!.requests.find(r => r.id === followId)!;
 assert.equal(follow.parentRequestId, "legacy"); assert.match(follow.parentReceiptDigest!, /^[a-f0-9]{64}$/); assert.equal(follow.status, "answered", follow.reason); assert.deepEqual(final.teamMode!.requests.find(r => r.id === "legacy"), before.teamMode!.requests[0]); assert.deepEqual(final.tasks.filter(t => before.tasks.some(old => old.id === t.id)), before.tasks);
});

test("R3 interrupt of earlier stage resumes unfinished current and intervening stages", async t => {
 let started!: () => void; const pending = new Promise<void>(r => { started = r; }); let designs = 0;
 const h = await setup(t, p => { if (p.currentUserRequest === "Build") return plan; const r = target(p); return { kind: "amend", targetRequestId: r.id, targetRevision: r.revision, timing: "interrupt_then_resume", instruction: "Code includes B", restartFromTaskId: r.tasks.find((t: any) => t.title === "code").id, rationale: "Only later code scope changes" }; }, async (title, request) => { if (title === "design" && ++designs === 1) { started(); await new Promise<void>(resolve => request.signal!.addEventListener("abort", () => resolve(), { once: true })); } });
 const build = h.say("Build"); await pending; await h.say("Interrupt and change code"); await build; const r = h.store.snapshot().teamMode!.requests.find(r => r.text === "Build")!;
 assert.deepEqual(h.order, ["design", "design", "analysis", "code"]);
 assert.ok(!h.store.snapshot().teamMode!.journal!.some(e => e.requestId === r.id && e.requestRevision === r.revision && e.kind === "control")); assert.equal(r.status, "awaiting_user_acceptance", r.reason); assert.equal(h.store.snapshot().teamMode!.reviewEvidence.at(-1)!.scope!.stages!.length, 3);
});

test("R4 final chat renders validated review findings without raw identity protocol", async t => {
 const h = await setup(t, () => plan); const r = await h.say("Build"), state = h.store.snapshot(); const content = state.teamMode!.journal!.filter(e => e.requestId === r.id && e.role === "assistant" && e.kind === "result").map(e => e.text).join("");
 assert.match(content, /All selected scopes checked/); assert.match(content, /독립 검토: 통과/); assert.doesNotMatch(content, /implementationAttemptId|scopeDigest|reviewerAttemptId|"verdict"/); assert.match(state.tasks.find(t => t.id === r.taskIds[1])!.attempts.at(-1)!.text, /"implementationAttemptId"/);
});

for (const text of ["이 결과를 수락해.", "이 결과 수락", "조건을 모두 충족했고 누락되지 않았으므로 이 결과를 수락합니다.", "더 변경하지 않아도 됩니다. 이 결과 수락."]) test(`R5 explicit Korean acceptance remains eligible: ${text}`, () => assert.equal(explicitAcceptanceQuote(text, text), true));
for (const text of ["좋아요", "네, 좋아요. 알겠어요.", "이 결과를 수락하지 마.", "이 결과를 수락하지 않습니다.", "테스트가 통과하면 이 결과를 수락합니다.", "'이 결과를 수락해'라고 말하면 되나요?", "문서에 '이 결과 수락'이라고 적혀 있어요.", "수락할지 아직 모르겠어요.", "이 결과를 수락할까요?", "I do not accept this result.", "I would accept this result if checks pass.", "Maybe I accept this result.", "The phrase 'I accept this result' is a sample."]) test(`R5 ambiguous or non-authorizing text is ineligible: ${text}`, () => assert.equal(explicitAcceptanceQuote(text, text), false));


for (const change of ["current", "session", "branch", "tree", "owner"] as const) test(`R1 public adapter acceptance checks live ${change} binding`, async t => {
 const root = realpathSync(mkdtempSync(join(tmpdir(), "chat-live-binding-"))); execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
 const handlers = new Map<string, Function>(), branch: any[] = []; let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>, sessionId = "session", release!: () => void, started!: () => void; const pending = new Promise<void>(resolve => { started = resolve; });
 const ctx = { cwd: root, mode: "rpc", hasUI: false, isProjectTrusted: () => true, isIdle: () => true, modelRegistry: {}, sessionManager: { getSessionId: () => sessionId, getSessionFile: () => undefined, getBranch: () => [...branch], getLeafId: () => branch.at(-1)?.id ?? null } } as unknown as ExtensionCommandContext;
 const pi = { registerCommand: (_: string, definition: { handler: typeof command }) => { command = definition.handler; }, registerTool: () => {}, on: (name: string, handler: Function) => { handlers.set(name, handler); return () => {}; }, sendMessage: (message: any) => { branch.push({ id: `public-${branch.length}`, type: "custom_message", ...message }); } } as unknown as ExtensionAPI;
 extension(pi); await command("mode on", ctx); const registry = processRegistry(), owner = registry.owners.get(root)!;
 t.after(async () => { release?.(); registry.owners.set(root, owner); await handlers.get("session_shutdown")!({ reason: "quit" }, ctx); rmSync(root, { recursive: true, force: true }); });
 const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
  let text: string;
  if (request.systemPrompt.includes("read-only team coordinator")) { const p = JSON.parse(request.prompt.split("\n").at(-1)!); let action: object = plan; if (p.currentUserRequest === "I accept this exact result.") { started(); await new Promise<void>(resolve => { release = resolve; }); const r = target(p); action = { kind: "accept", targetRequestId: r.id, targetRevision: r.revision, offerId: p.offers.at(-1).id, acceptanceQuote: p.currentUserRequest }; } text = JSON.stringify({ requestId: p.requestId, generation: p.generation, revision: p.revision, ...action }); }
  else if (request.prompt.includes("implementationAttemptId")) { const p = JSON.parse(request.prompt.match(/\{"implementationAttemptId"[^\n]+/)![0]); text = JSON.stringify({ implementationAttemptId: p.implementationAttemptId, artifactDigest: p.artifactDigest, checkIds: p.checkIds, requestId: p.requestId, requestRevision: p.requestRevision, scopeDigest: p.scopeDigest, verdict: "pass", findings: [] }); } else text = "Stage result";
  return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId };
 };
 for (const component of [owner.controller, owner.supervisor!]) { (component as any).options.runner = runner; (component as any).options.validateProfile = async () => {}; }
 await handlers.get("input")!({ source: "rpc", text: "Build" }, ctx); await owner.supervisor!.whenIdle(); const before = owner.controller.snapshot(), build = before.teamMode!.requests.find(r => r.text === "Build")!; assert.equal(build.status, "awaiting_user_acceptance");
 await handlers.get("input")!({ source: "rpc", text: "I accept this exact result." }, ctx); await pending;
 if (change === "session") { sessionId = "other-session"; await handlers.get("session_start")!({}, ctx); }
 if (change === "branch") branch.splice(0);
 if (change === "tree") await handlers.get("session_tree")!({}, ctx);
 if (change === "owner") registry.owners.delete(root);
 release(); await owner.supervisor!.whenIdle(); const after = owner.controller.snapshot(), accepted = after.teamMode!.requests.find(r => r.id === build.id)!;
 assert.equal(accepted.status, change === "current" ? "accepted" : "awaiting_user_acceptance"); if (change !== "current") { assert.equal(accepted.receipt, undefined); assert.deepEqual(after.tasks, before.tasks); assert.deepEqual(after.teamMode!.reviewEvidence, before.teamMode!.reviewEvidence); }
});
