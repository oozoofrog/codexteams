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
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";

for (const scenario of ["direct", "resume", "truncated"] as const) test(`four successful full-output checks reach independent review (${scenario})`, { timeout: 20000 }, async t => {
 const interrupted = scenario === "resume";
 const root = mkdtempSync(join(tmpdir(), "mode-large-review-")); t.after(() => rmSync(root, { recursive: true, force: true }));
 execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
 const store = ProjectStore.open(root); let reviews = 0, writers = 0;
 const checks = Array.from({ length: 4 }, (_, i) => `node -e "process.stdout.write('x'.repeat(${scenario === "truncated" && i === 0 ? 4001 : 4000}))" #check${i + 1}`);
 const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
  let text = "implemented";
  if (request.systemPrompt.includes("read-only team coordinator")) { const input = JSON.parse(request.prompt.split("\n").at(-1)!); text = JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "propose_plan", tasks: [{ id: "work", title: "Implement", description: "Implement feature", role: "developer", dependsOn: [], acceptance: ["feature works"] }], checks }); }
  else if (request.tools.includes("bash")) writers++;
  else { reviews++; const match = request.prompt.match(/\{"implementationAttemptId"[^\n]+/); assert.ok(match); const identity = JSON.parse(match[0]); assert.equal(identity.scope.checks.length, 4); for (const [i, c] of identity.scope.checks.entries()) { assert.equal(c.output, "x".repeat(4000)); assert.equal(c.outputTruncated, scenario === "truncated" && i === 0); } text = JSON.stringify({ implementationAttemptId: identity.implementationAttemptId, artifactDigest: identity.artifactDigest, checkIds: identity.checkIds, requestId: identity.requestId, requestRevision: identity.requestRevision, scopeDigest: identity.scopeDigest, verdict: "pass", findings: [] }); }
  return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId };
 };
 const controller = new TeamController(store, { runner, validateProfile: async () => {} }); const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} }); t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); });
 await assert.rejects(controller.runManaged("request", "task", 1, "x".repeat(16385), 1), /수정 지시가 너무 깁니다/);
 let restore: (() => void) | undefined;
 if (interrupted) { const original = controller.runManagedReview.bind(controller); controller.runManagedReview = async () => { throw new Error("수정 지시가 너무 깁니다."); }; restore = () => { controller.runManagedReview = original; }; }
 await supervisor.setMode(true); const id = supervisor.ingest({ text: "Implement feature", origin: "rpc", sessionId: "session-1" }); await supervisor.whenIdle();
 if (restore) { const paused = store.snapshot().teamMode!.requests.find(r => r.id === id)!; assert.equal(paused.status, "paused"); assert.equal(paused.checkpoint, "review"); restore(); supervisor.resume(id); await supervisor.whenIdle(); }
 assert.equal(writers, 1);
 const state = store.snapshot(), request = state.teamMode!.requests.find(r => r.id === id)!;
 assert.equal(request.status, "awaiting_user_acceptance", request.reason); assert.equal(reviews, 1); assert.equal(state.tasks.find(t => t.id === request.taskIds[0])!.acceptanceSource, undefined);
});
