import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { parseCoordinatorAction } from "../src/core/team-mode-protocol.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";
const check = (status: string) => `node -e "const fs=require('fs');if(fs.readFileSync('README.md','utf8').trim().split('\\n').at(-1)!=='상태: ${status}')process.exit(1)"`;
const stable = "git diff --check";
for (const reviseChecks of [true, false]) test(`literal outcome amendment ${reviseChecks ? "updates authorized validation scope" : "keeps existing checks unless leader changes them"}`, async t => {
 const root = mkdtempSync(join(tmpdir(), "chat-check-scope-")); t.after(() => rmSync(root, { recursive: true, force: true })); execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n"); writeFileSync(join(root, "README.md"), "Existing\n"); const store = ProjectStore.open(root); let writers = 0;
 const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
  let text: string;
  if (request.systemPrompt.includes("read-only team coordinator")) { const p = JSON.parse(request.prompt.split("\n").at(-1)!); const target = p.actualState.requests.find((r: any) => r.text === "상태 준비 추가"); const action = p.currentUserRequest === "상태 준비 추가" ? { kind: "propose_plan", rationale: "One status edit with explicit verification", tasks: [{ id: "work", title: "상태 변경", description: "README 상태 변경", role: "developer", dependsOn: [], acceptance: ["요청한 상태가 마지막 줄에 있다"] }], checks: [stable, check("준비")] } : { kind: "amend", targetRequestId: target.id, targetRevision: target.revision, timing: reviseChecks ? "after_current_task" : "after_current", instruction: "상태: 진행으로 바꿔 주세요", restartFromTaskId: target.tasks.find((task: any) => task.role === "developer").id, rationale: "Only the final status literal changes", ...(reviseChecks ? { checks: [stable, check("진행")], checksReason: "Expected final status changed from 준비 to 진행; preserve the repository diff check" } : {}) }; text = JSON.stringify({ requestId: p.requestId, generation: p.generation, revision: p.revision, ...action }); }
  else if (request.tools.includes("bash")) { writers++; writeFileSync(join(root, "README.md"), `Existing\n상태: ${request.prompt.includes("진행으로") ? "진행" : "준비"}\n`); text = "상태 줄 변경 완료"; }
  else { const p = JSON.parse(request.prompt.match(/\{"implementationAttemptId"[^\n]+/)![0]); text = JSON.stringify({ implementationAttemptId: p.implementationAttemptId, artifactDigest: p.artifactDigest, checkIds: p.checkIds, requestId: p.requestId, requestRevision: p.requestRevision, scopeDigest: p.scopeDigest, verdict: "pass", findings: [] }); }
  return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId };
 };
 const controller = new TeamController(store, { runner, validateProfile: async () => {} }), supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} }); t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); }); await supervisor.setMode(true); const id = supervisor.ingest({ text: "상태 준비 추가", origin: "rpc", sessionId: "session" }); await supervisor.whenIdle(); const original = store.snapshot(), old = original.teamMode!.requests.find(r => r.id === id)!; assert.equal(old.status, "awaiting_user_acceptance", old.reason);
 supervisor.ingest({ text: "그 결과를 진행으로 변경하고 필요한 검증도 갱신해 주세요", origin: "rpc", sessionId: "session" }); await supervisor.whenIdle(); const state = store.snapshot(), current = state.teamMode!.requests.find(r => r.id === id)!;
 assert.equal(writers, 2); assert.equal(current.status, reviseChecks ? "awaiting_user_acceptance" : "paused", current.reason); const writer = state.tasks.find(task => task.id === current.taskIds[0])!; assert.ok(writer.checks.some(c => c.command === check("준비") && c.status === "passed"));
 if (reviseChecks) { assert.deepEqual(current.checks, [stable, check("진행")]); assert.ok(writer.checks.some(c => c.command === check("진행") && c.status === "passed")); const delta = (current.amendments![0] as any); assert.equal(delta.timing, "after_current"); assert.deepEqual(delta.previousChecks, [stable, check("준비")]); assert.deepEqual(delta.checks, [stable, check("진행")]); assert.match(delta.checksReason, /Expected final status changed/); const scope = state.teamMode!.reviewEvidence.at(-1)!.scope!; assert.deepEqual((scope.amendments[0] as any).checks, { previous: [stable, check("준비")], next: [stable, check("진행")], reason: delta.checksReason }); } else assert.deepEqual(current.checks, [stable, check("준비")]);
});

test("amendment cannot replace checks without an explicit validation-scope reason", () => {
 const identity = { requestId: "request", generation: 1, revision: 1 };
 assert.throws(() => parseCoordinatorAction(JSON.stringify({ ...identity, kind: "amend", targetRequestId: "target", targetRevision: 1, timing: "after_current", instruction: "Change status", checks: [] }), identity));
});

test("amendment timing rejects an unknown value", () => {
 const identity = { requestId: "request", generation: 1, revision: 1 };
 assert.throws(() => parseCoordinatorAction(JSON.stringify({ ...identity, kind: "amend", targetRequestId: "target", targetRevision: 1, timing: "after_all_tasks", instruction: "Change status" }), identity), /Invalid amendment timing/);
});
