import { validateState } from "../src/core/state-validation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseCoordinatorAction } from "../src/core/team-mode-protocol.ts";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";
const captured = JSON.parse(readFileSync(new URL("./fixtures/actual-astra-plan-20261102.json", import.meta.url), "utf8"));
const identity = { requestId: captured.requestId, generation: captured.generation, revision: captured.revision };

test("actual Astra proposal backward dependency is valid serial intent once checks are executable", () => {
 const proposal = { ...captured, checks: ["git diff --check"] };
 const parsed = parseCoordinatorAction(JSON.stringify(proposal), identity); assert.equal(parsed.kind, "propose_plan");
});

test("captured manual check intentions are rejected as command form before task creation", () => {
 assert.throws(() => parseCoordinatorAction(JSON.stringify(captured), identity), /literal executable shell commands/);
});

for (const mode of ["forward", "cycle", "external"] as const) test(`serial plan rejects ${mode} dependency without normalizing it away`, () => {
 const tasks = structuredClone(captured.tasks); if (mode === "forward") { tasks[0].dependsOn = [tasks[1].id]; tasks[1].dependsOn = []; } else if (mode === "cycle") tasks[0].dependsOn = [tasks[1].id]; else tasks[1].dependsOn = ["outside-task"];
 assert.throws(() => parseCoordinatorAction(JSON.stringify({ ...captured, tasks, checks: [] }), identity));
});

for (const command of ["./검증.sh", "'./검증 스크립트.sh'", "검증.sh", "echo 검증", "git diff --check", ":", "[ -f README.md ]", "PROJECT_CHECK=1 ./future/check.sh"]) test(`literal shell form keeps legitimate launcher: ${command}`, () => {
 assert.equal(parseCoordinatorAction(JSON.stringify({ ...captured, checks: [command] }), identity).kind, "propose_plan");
});

for (const scenario of ["repair", "repair-fails", "dependency-repair-fails", "failed-provider", "already-applied", "selected-final", "selected-final-with-preflight"] as const) test(`known invalid plan repair stays bounded and read-only: ${scenario}`, async t => {
 const root = mkdtempSync(join(tmpdir(), "chat-plan-contract-")); t.after(() => rmSync(root, { recursive: true, force: true })); execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n"); writeFileSync(join(root, "README.md"), "Existing content\n");
 const store = ProjectStore.open(root); let coordinators = 0, writers = 0, reviews = 0, preflights = 0; const reviewDescriptions: string[] = [];
 const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
  let text: string;
  if (request.systemPrompt.includes("read-only team coordinator")) {
   coordinators++; assert.deepEqual(request.tools, ["read", "grep", "find", "ls"]); assert.equal(store.snapshot().tasks.length, 0); assert.equal(readFileSync(join(root, "README.md"), "utf8"), "Existing content\n");
   const input = JSON.parse(request.prompt.split("\n").at(-1)!); const proposal = { ...captured, requestId: input.requestId, generation: input.generation, revision: input.revision, checks: coordinators === 1 || scenario !== "repair" ? captured.checks : ["git diff --check"] };
   if (scenario === "dependency-repair-fails") { proposal.checks = []; proposal.tasks = structuredClone(proposal.tasks); proposal.tasks[0].dependsOn = [proposal.tasks[1].id]; proposal.tasks[1].dependsOn = []; }
   if (scenario.startsWith("selected-final")) { proposal.checks = ["git diff --check"]; proposal.tasks = structuredClone(proposal.tasks); for (const task of proposal.tasks) task.dependsOn = []; if (scenario === "selected-final-with-preflight") proposal.tasks.unshift({ id: "preflight", title: "Read-only preflight", description: "Inspect before editing", role: "reviewer", dependsOn: [], acceptance: ["Current content inspected"] }); }
   if (coordinators === 2) { assert.equal(store.snapshot().teamMode!.coordinatorAttempts.length, 2); assert.ok(input.protocolRepair?.originalProposal.includes("작업 전후" ) || scenario === "dependency-repair-fails"); assert.ok(input.protocolRepair?.diagnostic); }
   text = JSON.stringify(proposal);
   if (scenario === "failed-provider") return { outcome: "failed", error: "provider failed before proposal", text, exitCode: 1, usage: { ...emptyUsage(), input: 12, output: 4, totalTokens: 16, responses: 1, completeness: "known" }, effectiveModels: ["fixture/leader"], sessionId: request.sessionId };
  } else if (request.tools.includes("bash")) { writers++; writeFileSync(join(root, "README.md"), "Existing content\n상태: 준비\n"); text = "README에 상태 줄을 추가했습니다."; }
  else if (request.prompt.includes("implementationAttemptId")) { reviews++; reviewDescriptions.push(request.prompt); const p = JSON.parse(request.prompt.match(/\{"implementationAttemptId"[^\n]+/)![0]); assert.equal(p.scope.stages.length, scenario === "selected-final-with-preflight" ? 2 : 1); assert.equal(p.scope.stages.at(-1).role, "developer"); if (scenario === "selected-final-with-preflight") assert.equal(p.scope.stages[0].role, "reviewer"); text = JSON.stringify({ implementationAttemptId: p.implementationAttemptId, artifactDigest: p.artifactDigest, checkIds: p.checkIds, requestId: p.requestId, requestRevision: p.requestRevision, scopeDigest: p.scopeDigest, verdict: "pass", findings: [] }); }
  else { preflights++; text = "Read-only preflight findings"; }
  return { outcome: "success", text, exitCode: 0, usage: { ...emptyUsage(), input: 12, output: 4, totalTokens: 16, responses: 1, completeness: "known" }, effectiveModels: ["fixture/model"], sessionId: request.sessionId };
 };
 const controller = new TeamController(store, { runner, validateProfile: async () => {} }), supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} }); t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); }); await supervisor.setMode(true);
 let id: string;
 if (scenario === "already-applied") {
  store.update(s => { const now = s.createdAt; s.teamMode!.requests.push({ id: "prior-request", text: "Previously applied action", origin: "rpc", sessionId: "session", receivedAt: now, revision: 2, status: "received", taskIds: [] }); s.teamMode!.events.push({ id: "prior-event", requestId: "prior-request", kind: "applied", at: now }); }); id = "prior-request"; supervisor.wake();
 } else id = supervisor.ingest({ text: "Append README status", origin: "rpc", sessionId: "session" });
 await supervisor.whenIdle(); const state = store.snapshot(), r = state.teamMode!.requests.find(r => r.id === id)!;
 assert.equal(coordinators, scenario === "failed-provider" || scenario === "already-applied" || scenario.startsWith("selected-final") ? 1 : 2);
 if (scenario === "repair" || scenario.startsWith("selected-final")) {
  assert.equal(r.status, "awaiting_user_acceptance", r.reason); assert.equal(writers, 1); assert.equal(reviews, 1); assert.equal(state.tasks.length, scenario === "selected-final-with-preflight" ? 3 : 2); assert.equal(preflights, scenario === "selected-final-with-preflight" ? 1 : 0); assert.ok(state.tasks.every(t => t.dependsOn.length === 0)); assert.equal(r.stages!.length, scenario === "selected-final-with-preflight" ? 2 : 1);
  const reviewer = state.tasks.find(t => t.id === r.taskIds[1])!; assert.equal(reviewer.title, captured.tasks[1].title); assert.equal(reviewer.description, captured.tasks[1].description); assert.deepEqual(reviewer.acceptance, captured.tasks[1].acceptance); assert.match(reviewDescriptions[0], /기존 내용 보존/);
  const workerTaskPrompt = reviewDescriptions[0].split('{"implementationAttemptId"')[0];
  for (const criterion of reviewer.acceptance) assert.ok(workerTaskPrompt.includes(criterion));
  const evidence = state.teamMode!.reviewEvidence.at(-1)!;
  assert.deepEqual(evidence.scope?.reviewer, { id: reviewer.id, title: reviewer.title, description: reviewer.description, acceptance: reviewer.acceptance });
  const changed = structuredClone(state);
  changed.tasks.find(task => task.id === reviewer.id)!.acceptance.push("Unreviewed criterion");
  assert.throws(() => validateState(changed, store.root));
  const attempts = state.teamMode!.coordinatorAttempts; if (scenario === "repair") { assert.match(attempts[0].text, /작업 전후/); assert.ok((attempts[0] as any).protocolError); assert.equal((attempts[1] as any).repairOfAttemptId, attempts[0].id); assert.ok(attempts.every(a => a.usage.totalTokens === 16)); }
 } else { assert.equal(r.status, "blocked"); assert.equal(writers, 0); assert.equal(reviews, 0); assert.equal(state.tasks.length, 0); assert.equal(readFileSync(join(root, "README.md"), "utf8"), "Existing content\n"); if (scenario !== "failed-provider") assert.doesNotMatch(r.reason!, /Team-mode|literal executable|dependsOn|serial and bounded/); }
});
