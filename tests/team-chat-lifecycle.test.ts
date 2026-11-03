import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateState } from "../src/core/state-validation.mjs";
import { execFileSync } from "node:child_process";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { deliverChat } from "../src/core/team-chat.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";

const stage = (id: string, role = "developer") => ({ id, title: id, description: `${id} scope`, role, dependsOn: [], acceptance: [`${id} works`] });
const plan = { kind: "propose_plan", rationale: "Design before implementation", tasks: [stage("design", "designer"), stage("code")], checks: ["node -e \"process.exit(0)\""] };
async function harness(t: TestContext, decide: (context: any) => object, extra?: { review?: (identity: any, index: number) => { verdict: string; findings: string[] }; stage?: (title: string, request: WorkerRequest) => Promise<void> }) {
 const root = mkdtempSync(join(tmpdir(), "chat-lifecycle-")); t.after(() => rmSync(root, { recursive: true, force: true })); execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
 const store = ProjectStore.open(root), order: string[] = [], contexts: any[] = [], history: any[] = [], coordinatorRequests: WorkerRequest[] = []; let reviews = 0;
 const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
  let text: string;
  if (request.systemPrompt.includes("read-only team coordinator")) { coordinatorRequests.push(request); const p = JSON.parse(request.prompt.split("\n").at(-1)!); contexts.push(p); text = JSON.stringify({ requestId: p.requestId, generation: p.generation, revision: p.revision, ...decide(p) }); }
  else if (request.prompt.includes("implementationAttemptId")) { const p = JSON.parse(request.prompt.match(/\{"implementationAttemptId"[^\n]+/)![0]); const verdict = extra?.review?.(p, ++reviews) ?? { verdict: "pass", findings: [] }; text = JSON.stringify({ implementationAttemptId: p.implementationAttemptId, artifactDigest: p.artifactDigest, checkIds: p.checkIds, requestId: p.requestId, requestRevision: p.requestRevision, scopeDigest: p.scopeDigest, ...verdict }); }
  else { const title = request.prompt.match(/"title": "([^"]+)"/)![1]; order.push(title); await extra?.stage?.(title, request); if (request.tools.includes("bash")) writeFileSync(join(root, `${title}.txt`), `${title} ${order.length}`); text = `${title} result ${order.length}`; }
  return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId };
 };
 const controller = new TeamController(store, { runner, validateProfile: async () => {} }), supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {}, canAccept: () => true });
 t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); }); await supervisor.setMode(true);
 const deliver = () => { const target = { sessionId: "session", history, send: (message: any) => history.push({ id: `history-${history.length}`, type: "custom_message", ...message }) }; deliverChat(store, target); deliverChat(store, target); };
 const say = async (text: string, visible = true) => { deliver(); const id = supervisor.ingest({ text, origin: "rpc", sessionId: "session", visibleJournalIds: visible ? history.map(e => e.details.journalId) : [] } as any); await supervisor.whenIdle(); deliver(); return store.snapshot().teamMode!.requests.find(r => r.id === id)!; };
 return { root, store, controller, supervisor, say, deliver, order, contexts, history, coordinatorRequests };
}
const target = (p: any) => p.actualState.requests.find((r: any) => r.text === "Build");

test("post-result amendment reruns only selected stage and recheck never reruns writers", async t => {
 const h = await harness(t, p => { const r = target(p); if (p.currentUserRequest === "Change its code") return { kind: "amend", targetRequestId: r.id, targetRevision: r.revision, timing: "after_current", instruction: "Add B", restartFromTaskId: r.tasks.find((task: any) => task.title === "code").id, rationale: "The design remains valid; only code needs B" }; if (p.currentUserRequest === "Verify that again") return { kind: "recheck", targetRequestId: r.id, targetRevision: r.revision }; return plan; });
 const initial = await h.say("Build"); assert.equal(initial.status, "awaiting_user_acceptance"); const originalDesign = h.store.snapshot().tasks.find(task => task.title === "design")!.attempts.at(-1)!.id;
 await h.say("Change its code"); assert.deepEqual(h.order, ["design", "code", "code"]); let r = h.store.snapshot().teamMode!.requests.find(r => r.id === initial.id)!; assert.equal(r.revision, 2); assert.equal(r.status, "awaiting_user_acceptance", r.reason); assert.equal(h.store.snapshot().tasks.find(task => task.title === "design")!.attempts.at(-1)!.id, originalDesign);
 const writerId = r.taskIds[0];
 h.store.update(state => {
  const writer = state.tasks.find(task => task.id === writerId)!;
  const prior = writer.checks.at(-1)!;
  writer.checks.push({ ...prior, id: "prior-failed-check", status: "failed", exitCode: 1, output: "Old check failure" });
 });
 await h.say("Verify that again"); assert.deepEqual(h.order, ["design", "code", "code"]); r = h.store.snapshot().teamMode!.requests.find(r => r.id === initial.id)!; assert.equal(r.revision, 3); assert.equal(r.status, "awaiting_user_acceptance", r.reason);
 assert.equal((h.store.snapshot().teamMode!.reviewEvidence.at(-1)!.scope as any).stages[0].attemptId, originalDesign);
 const state = h.store.snapshot();
 const writer = state.tasks.find(task => task.id === writerId)!;
 const current = writer.checks.at(-1)!;
 assert.deepEqual(state.teamMode!.reviewEvidence.at(-1)!.checkIds, [current.id]);
 assert.ok(writer.checks.some(check => check.output === "Old check failure"));
 const result = state.teamMode!.journal!.filter(entry => entry.kind === "result" && entry.requestId === r.id && entry.requestRevision === r.revision).map(entry => entry.text).join("");
 assert.doesNotMatch(result, /Old check failure|검증 failed/);
 assert.equal(result.split(`검증 passed: ${current.command}`).length, 2);

});

test("a paused revision reports its reason without repeating an earlier implementation or review", async t => {
 const h = await harness(t, p => {
  if (p.currentUserRequest === "Build") return plan;
  const r = target(p);
  return { kind: "amend", targetRequestId: r.id, targetRevision: r.revision, timing: "after_current", instruction: "Add B", restartFromTaskId: r.tasks.find((task: any) => task.title === "code").id, rationale: "Only code needs B" };
 });
 const initial = await h.say("Build");
 assert.equal(initial.status, "awaiting_user_acceptance");
 writeFileSync(join(h.root, "code.txt"), "external edit");
 await h.say("Change its code");

 const state = h.store.snapshot();
 const paused = state.teamMode!.requests.find(r => r.id === initial.id)!;
 assert.equal(paused.status, "paused");
 assert.match(paused.reason!, /이전 단계 이후 파일이 변경되었습니다/);
 const notice = state.teamMode!.journal!.filter(e => e.requestId === paused.id && e.requestRevision === paused.revision);
 assert.deepEqual(notice.map(e => [e.kind, e.text]), [["control", `${paused.text} · revision ${paused.revision}\n\n${paused.reason}`]]);
 assert.equal(state.teamMode!.reviewEvidence.at(-1)!.requestRevision, initial.revision);
});

test("ambiguous acknowledgement and an offer absent from current branch cannot accept", async t => {
 const h = await harness(t, p => { const r = target(p); return p.currentUserRequest === "Build" ? plan : { kind: "accept", targetRequestId: r.id, targetRevision: r.revision, offerId: p.offers.at(-1).id, acceptanceQuote: p.currentUserRequest }; }); const r = await h.say("Build");
 const acknowledgement = await h.say("네, 좋아요. 알겠어요."); assert.equal(acknowledgement.status, "clarifying"); assert.equal(h.store.snapshot().teamMode!.requests.find(x => x.id === r.id)!.status, "awaiting_user_acceptance");
 const invisible = await h.say("I accept this exact result.", false); assert.equal(invisible.status, "clarifying"); assert.equal(h.store.snapshot().teamMode!.requests.find(x => x.id === r.id)!.receipt, undefined);
});

test("explicit delivered exact-revision acceptance links a new follow-up without changing history", async t => {
 const h = await harness(t, p => { const r = target(p); if (p.currentUserRequest === "I accept this exact result.") return { kind: "accept", targetRequestId: r.id, targetRevision: r.revision, offerId: p.offers.at(-1).id, acceptanceQuote: p.currentUserRequest }; if (p.currentUserRequest === "Add a follow-up") return { ...plan, parentRequestId: r.id, targetRevision: r.revision }; return plan; }); const initial = await h.say("Build"); await h.say("I accept this exact result."); const accepted = h.store.snapshot().teamMode!.requests.find(r => r.id === initial.id)!; assert.equal(accepted.status, "accepted"); assert.equal(accepted.receipt!.stageAttempts!.length, 2);
 const approval = h.coordinatorRequests.at(-1)!;
 assert.match(approval.systemPrompt, /may propose kind="accept"/);
 assert.match(approval.systemPrompt, /trusted controller validates and applies proposals/);
 assert.match(approval.systemPrompt, /Never mutate files or directly accept work/);
 assert.match(approval.prompt, /propose kind="accept" only for a current HUMAN turn/);
 assert.match(approval.prompt, /Only the trusted controller can apply acceptance/);
 assert.ok(!approval.tools.includes("bash"));
 assert.equal(h.contexts.at(-1).offers.at(-1).requestRevision, accepted.receipt!.requestRevision);

 const follow = await h.say("Add a follow-up"); assert.equal(follow.parentRequestId, initial.id); assert.equal(follow.status, "awaiting_user_acceptance", follow.reason); assert.deepEqual(h.store.snapshot().teamMode!.requests.find(r => r.id === initial.id), accepted);
});

test("review findings return to leader for targeted repair with no internal human authority", async t => {
 const h = await harness(t, p => { if (p.provenance === "review") { const r = target(p); return { kind: "amend", targetRequestId: r.id, targetRevision: r.revision, timing: "after_current", instruction: "Fix actual missing branch", restartFromTaskId: r.tasks.find((task: any) => task.title === "code").id, rationale: "Finding affects code only" }; } return plan; }, { review: (_p, i) => i === 1 ? { verdict: "changes_required", findings: ["Missing branch"] } : { verdict: "pass", findings: [] } }); const r = await h.say("Build");
 assert.equal(r.status, "awaiting_user_acceptance", r.reason); assert.deepEqual(h.order, ["design", "code", "code"]); assert.ok(h.contexts.some(p => p.provenance === "review" && p.currentUserRequest.includes("Missing branch"))); assert.equal(r.receipt, undefined);
});

test("ordinary stop waits for worker settlement and resume preserves earlier completed stage", async t => {
 let codeStarted!: () => void; const started = new Promise<void>(r => { codeStarted = r; }); let settled = false, codeCalls = 0;
 const h = await harness(t, p => { const r = target(p); if (p.currentUserRequest === "Stop this work") return { kind: "stop", targetRequestId: r.id, targetRevision: r.revision }; if (p.currentUserRequest === "Resume it") return { kind: "resume", targetRequestId: r.id, targetRevision: r.revision }; return plan; }, { stage: async (title, request) => { if (title !== "code" || ++codeCalls > 1) return; codeStarted(); await new Promise<void>(resolve => { request.signal!.addEventListener("abort", () => { setTimeout(() => { settled = true; resolve(); }, 20); }, { once: true }); }); } });
 const build = h.say("Build"); await started; const stopped = await h.say("Stop this work"); await build; assert.equal(stopped.status, "answered"); assert.equal(settled, true); const paused = h.store.snapshot().teamMode!.requests.find(r => r.text === "Build")!; assert.equal(paused.status, "cancelled");
 const designAttempt = h.store.snapshot().tasks.find(task => task.title === "design")!.attempts.at(-1)!.id; await h.say("Resume it"); const resumed = h.store.snapshot().teamMode!.requests.find(r => r.id === paused.id)!; assert.equal(resumed.status, "awaiting_user_acceptance", resumed.reason); assert.deepEqual(h.order, ["design", "code", "code"]); assert.equal(h.store.snapshot().tasks.find(task => task.title === "design")!.attempts.at(-1)!.id, designAttempt);
});

test("stop during a check preserves the old check without publishing it under the stop revision", async t => {
 const h = await harness(t, () => plan);
 const check = h.controller.check.bind(h.controller);
 let checkFinished!: () => void, release!: () => void;
 const finishedCheck = new Promise<void>(resolve => { checkFinished = resolve; });
 const released = new Promise<void>(resolve => { release = resolve; });
 h.controller.check = async (...args) => {
  await check(...args);
  checkFinished();
  await released;
 };
 const id = h.supervisor.ingest({ text: "Build", origin: "rpc", sessionId: "session" });
 await finishedCheck;
 const before = h.store.snapshot();
 const request = before.teamMode!.requests.find(r => r.id === id)!;
 const oldCheck = before.tasks.find(task => task.id === request.taskIds[0])!.checks.at(-1)!;
 assert.equal(oldCheck.status, "passed");
 const stopping = h.supervisor.stop(id);
 release();
 await stopping;
 await h.supervisor.whenIdle();

 const state = h.store.snapshot();
 const stopped = state.teamMode!.requests.find(r => r.id === id)!;
 assert.equal(stopped.status, "cancelled");
 assert.deepEqual(state.tasks.find(task => task.id === request.taskIds[0])!.checks.at(-1), oldCheck);
 const journal = state.teamMode!.journal!.filter(e => e.requestId === id && e.requestRevision === stopped.revision);
 assert.deepEqual(journal.map(e => [e.kind, e.text]), [["control", "요청이 중단되었습니다. 실행 종료를 확인했습니다."]]);
});

test("stale offer cannot accept after revision or artifact changes", async t => {
 let oldOffer: any;
 const h = await harness(t, p => { const r = target(p); if (p.currentUserRequest === "Build") return plan; return { kind: "accept", targetRequestId: r.id, targetRevision: r.revision, offerId: oldOffer.id, acceptanceQuote: p.currentUserRequest }; }); const initial = await h.say("Build"); oldOffer = h.store.snapshot().teamMode!.offers!.at(-1);
 writeFileSync(join(h.root, "code.txt"), "external edit"); const stale = await h.say("I accept this exact result."); assert.equal(stale.status, "blocked"); assert.equal(h.store.snapshot().teamMode!.requests.find(r => r.id === initial.id)!.receipt, undefined);
 h.supervisor.recheck(initial.id); await h.supervisor.whenIdle(); h.deliver(); const afterRevision = await h.say("I accept this exact result."); assert.equal(afterRevision.status, "clarifying"); assert.equal(h.store.snapshot().teamMode!.requests.find(r => r.id === initial.id)!.receipt, undefined);
});

test("identical staged review failure without artifact progress pauses instead of looping", { timeout: 10000 }, async t => {
 let adaptations = 0;
 const h = await harness(t, p => { if (p.provenance !== "review") return plan; adaptations++; const r = target(p); if (adaptations > 2) return { kind: "block", reason: "fixture guard" }; return { kind: "amend", targetRequestId: r.id, targetRevision: r.revision, timing: "after_current", instruction: "Fix same finding", restartFromTaskId: r.tasks.find((task: any) => task.title === "code").id, rationale: "Code only" }; }, { stage: async (title, _request) => { if (title === "code") { /* harness output is deliberately reset below through review */ } }, review: (_identity, _index) => ({ verdict: "changes_required", findings: ["Same finding"] }) });
 // Keep the artifact unchanged across repeated repair attempts; repeated finding+digest must terminate autonomously.
 const original = (h.controller as any).options.runner;
 (h.controller as any).options.runner = async (request: WorkerRequest) => { const r = await original(request); if (request.tools.includes("bash")) writeFileSync(join(h.root, "code.txt"), "unchanged implementation"); return r; };
 const request = await h.say("Build"); assert.equal(request.status, "paused"); assert.match(request.reason!, /바뀌지|진전|동일/); assert.equal(adaptations, 1);
});

test("clarification reply resolves the named pending question in ordinary chat", async t => {
 let questionId = "";
 const h = await harness(t, p => { if (p.currentUserRequest === "Change that") return { kind: "clarify", text: "Should I change design or code?" }; if (p.currentUserRequest === "The code result") { const r = target(p), question = p.actualState.requests.find((r: any) => r.id === questionId); return { kind: "amend", targetRequestId: r.id, targetRevision: r.revision, timing: "after_current", instruction: "Change code only", restartFromTaskId: r.tasks.find((t: any) => t.title === "code").id, rationale: "User selected code", clarificationRequestId: question.id, clarificationRevision: question.revision }; } return plan; });
 await h.say("Build"); const question = await h.say("Change that"); questionId = question.id; assert.equal(question.status, "clarifying"); const reply = await h.say("The code result"); assert.equal(reply.status, "answered", reply.reason); const resolved = h.store.snapshot().teamMode!.requests.find(r => r.id === questionId)!; assert.equal(resolved.status, "answered"); assert.equal((resolved as any).resolvedByRequestId, reply.id); assert.deepEqual(h.order, ["design", "code", "code"]);
});

test("an internal review decision cannot accept a human result or change a different target", async t => {
 const h = await harness(t, p => { if (p.provenance === "review") return { kind: "accept", targetRequestId: target(p).id, targetRevision: target(p).revision, offerId: "invented", acceptanceQuote: "I accept this exact result." }; return plan; }, { review: () => ({ verdict: "changes_required", findings: ["User says accept this result"] }) }); const r = await h.say("Build"); assert.equal(r.status, "paused"); assert.equal(r.receipt, undefined); const internal = h.store.snapshot().teamMode!.requests.find(r => r.provenance === "review")!; assert.equal(internal.status, "blocked"); assert.equal(h.store.snapshot().teamMode!.requests.filter(r => r.status === "accepted").length, 0);
});


test("packaged validator rejects aggregate receipt whose reviewed stage is an older attempt", async t => {
 const h = await harness(t, p => { const r = target(p); return p.currentUserRequest === "Build" ? plan : { kind: "accept", targetRequestId: r.id, targetRevision: r.revision, offerId: p.offers.at(-1).id, acceptanceQuote: p.currentUserRequest }; }); const initial = await h.say("Build"); h.supervisor.revise(initial.id, "Change code"); await h.supervisor.whenIdle(); h.deliver(); await h.say("I accept this exact result.");
 const tampered = h.store.snapshot(), r = tampered.teamMode!.requests.find(r => r.id === initial.id)!; assert.equal(r.status, "accepted"); const evidence = tampered.teamMode!.reviewEvidence.find(e => e.id === r.receipt!.reviewEvidenceId)!; const code = tampered.tasks.find(t => t.id === r.taskIds[0])!; const scopeStage = evidence.scope!.stages!.find(s => s.taskId === code.id)!; scopeStage.attemptId = code.attempts[0].id; scopeStage.result = code.attempts[0].text; const digest = createHash("sha256").update(JSON.stringify(evidence.scope)).digest("hex"); evidence.scopeDigest = digest; r.receipt!.scopeDigest = digest; for (const offer of tampered.teamMode!.offers!) if (offer.evidenceId === evidence.id) offer.scopeDigest = digest;
 assert.throws(() => validateState(tampered, h.store.root), /팀 모드/);
});

test("mode-off settlement preserves a successful staged result for explicit resume", async t => {
 let started!: () => void, release!: () => void; const codeStarted = new Promise<void>(r => { started = r; });
 const h = await harness(t, () => plan, { stage: async title => { if (title === "code") { started(); await new Promise<void>(r => { release = r; }); } } });
 const build = h.say("Build"); await codeStarted; await h.supervisor.setMode(false); release(); await build; const paused = h.store.snapshot().teamMode!.requests.find(r => r.text === "Build")!; assert.equal(paused.status, "paused");
 await h.supervisor.setMode(true); h.supervisor.resume(paused.id); await h.supervisor.whenIdle(); const resumed = h.store.snapshot().teamMode!.requests.find(r => r.id === paused.id)!; assert.equal(resumed.status, "awaiting_user_acceptance", resumed.reason); assert.deepEqual(h.order, ["design", "code"]);
});

test("internal review cannot replace declared checks", async t => {
 const h = await harness(t, p => {
  if (p.provenance !== "review") return plan;
  const r = target(p);
  return { kind: "amend", targetRequestId: r.id, targetRevision: r.revision, timing: "after_current", instruction: "Fix the missing branch", restartFromTaskId: r.tasks.find((task: any) => task.title === "code").id, rationale: "Repair the code", checks: [], checksReason: "Remove the check" };
 }, { review: (_identity, index) => index === 1 ? { verdict: "changes_required", findings: ["Missing branch"] } : { verdict: "pass", findings: [] } });
 const request = await h.say("Build");
 assert.deepEqual(request.checks, plan.checks);
 assert.equal(request.revision, 1);
 assert.equal(request.status, "paused");
 assert.deepEqual(h.order, ["design", "code"]);
 const reviewRequest = h.store.snapshot().teamMode!.requests.find(r => r.provenance === "review");
 assert.equal(reviewRequest?.status, "blocked");
});

test("read-only question naming two targets clarifies the selection and answers the visible reply", async t => {
 const statusWork = "README 상태 줄 작업";
 const reviewWork = "README 검토 표시 작업";
 const questionText = "README의 상태 줄 작업과 검토 표시 작업 중 하나의 최종 진행 상태와 검증 결과를 알려 주세요.";
 const selected = "상태 줄 작업입니다.";
 let clarificationId: string;
 const h = await harness(t, context => {
  if (context.currentUserRequest === questionText) {
   assert.ok(context.actualState.requests.some((r: any) => r.text === statusWork));
   assert.ok(context.actualState.requests.some((r: any) => r.text === reviewWork));
   return { kind: "clarify", text: "상태 줄 작업과 검토 표시 작업 중 어느 작업을 확인할까요?" };
  }
  if (context.currentUserRequest === selected) {
   const question = context.actualState.requests.find((r: any) => r.id === clarificationId);
   assert.equal(question.status, "clarifying");
   assert.ok(context.conversation.some((e: any) => e.requestId === question.id && e.role === "assistant" && e.delivery === "delivered"));
   return { kind: "answer", text: "상태 줄 작업의 검증 결과를 확인했습니다.", clarificationRequestId: question.id, clarificationRevision: question.revision };
  }
  return { kind: "propose_plan", rationale: "Inspect the recorded status", tasks: [stage("inspect", "reviewer")], checks: [] };
 });

 await h.say(statusWork);
 await h.say(reviewWork);
 const originalTasks = h.store.snapshot().tasks;
 const question = await h.say(questionText);
 clarificationId = question.id;
 assert.equal(question.status, "clarifying");
 assert.match(question.answer!, /상태 줄 작업과 검토 표시 작업/);
 const coordinator = h.coordinatorRequests.at(-1)!;
 assert.match(coordinator.prompt, /multiple plausible targets.*including named alternatives.*read-only progress or result questions/);
 assert.match(coordinator.prompt, /Do not default to the newest target/);
 assert.match(coordinator.prompt, /delegates the choice or the conversation identifies one exact target/);

 const reply = await h.say(selected);
 assert.equal(reply.status, "answered");
 assert.match(reply.answer!, /상태 줄 작업/);
 const final = h.store.snapshot();
 assert.equal(final.teamMode!.requests.find(r => r.id === question.id)!.resolvedByRequestId, reply.id);
 assert.deepEqual(final.tasks, originalTasks);
});
