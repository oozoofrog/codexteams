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

test("one request executes, reviews, fixes and reviews again without acceptance", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-pipeline-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
  const store = ProjectStore.open(root); let writers = 0, reviews = 0;
  const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
    let text: string;
    if (request.systemPrompt.includes("read-only team coordinator")) {
      const input = JSON.parse(request.prompt.split("\n").at(-1)!);
      text = JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "propose_plan", tasks: [{ id: "work", title: "Implement", description: "Implement feature", role: "developer", dependsOn: [], acceptance: ["feature works"] }], checks: ["node -e \"process.exit(0)\""] });
    } else if (request.tools.includes("bash")) {
      writers++; writeFileSync(join(root, "feature.txt"), `version ${writers}`); text = "Implemented";
    } else {
      reviews++;
      const match = request.prompt.match(/\{"implementationAttemptId"[^\n]+/);
      assert.ok(match, "review prompt includes evidence");
      const identity = JSON.parse(match[0]);
      assert.equal(identity.scope.writer.description, "Implement feature");
      assert.deepEqual(identity.scope.writer.acceptance, ["feature works"]);
      assert.equal(identity.scope.checks[0].status, "passed");
      text = JSON.stringify({ implementationAttemptId: identity.implementationAttemptId, artifactDigest: identity.artifactDigest, checkIds: identity.checkIds, requestId: identity.requestId, requestRevision: identity.requestRevision, scopeDigest: identity.scopeDigest, verdict: reviews === 1 ? "changes_required" : "pass", findings: reviews === 1 ? ["Fix feature"] : [] });
    }
    return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [request.profile.model], sessionId: request.sessionId };
  };
  const controller = new TeamController(store, { runner, validateProfile: async () => {} });
  const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} });
  t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); });
  await supervisor.setMode(true);
  const id = supervisor.ingest({ text: "Implement feature", origin: "rpc", sessionId: "session-1" });
  await supervisor.whenIdle();
  const state = store.snapshot(), item = state.teamMode!.requests.find(r => r.id === id)!;
  assert.equal(item.status, "awaiting_user_acceptance");
  assert.equal(writers, 2); assert.equal(reviews, 2);
  assert.equal(item.taskIds.length, 2);
  const writer = state.tasks.find(task => task.id === item.taskIds[0])!;
  const reviewer = state.tasks.find(task => task.id === item.taskIds[1])!;
  assert.equal(writer.attempts.length, 2); assert.equal(reviewer.attempts.length, 2);
  assert.equal(writer.attempts[0].sessionId, writer.attempts[1].sessionId);
  assert.equal(reviewer.attempts[0].sessionId, reviewer.attempts[1].sessionId);
  assert.equal(writer.status, "needs_review"); assert.equal(writer.acceptanceSource, undefined);
  assert.equal(writer.checks.length, 2); assert.ok(writer.checks.every(check => check.status === "passed" && check.source === "team_coordinator"));
  assert.equal(state.teamMode!.reviewEvidence.at(-1)?.implementationAttemptId, writer.attempts.at(-1)?.id);
  assert.throws(() => store.update(s => { s.teamMode!.reviewEvidence.at(-1)!.scope!.writer.description = "tampered"; }));
  assert.throws(() => store.update(s => { s.teamMode!.reviewEvidence.at(-1)!.requestRevision = 999; }));
  const secondId = supervisor.ingest({ text: "Second feature", origin: "rpc", sessionId: "session-1" });
  await supervisor.whenIdle();
  assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === secondId)!.status, "awaiting_user_acceptance");
  assert.throws(() => controller.accept(writer.id), /검토|변경/);
  writeFileSync(join(root, "feature.txt"), "changed after review");
  assert.throws(() => controller.accept(writer.id), /검토|변경/);
  assert.equal(store.snapshot().tasks.find(task => task.id === writer.id)!.acceptanceSource, undefined);
  supervisor.resume(id); await supervisor.whenIdle();
  assert.equal(writers, 3); assert.equal(reviews, 4);
  assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === id)!.status, "awaiting_user_acceptance");
  assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === secondId)!.status, "awaiting_user_acceptance");
  assert.equal(store.snapshot().tasks.find(t => t.id === writer.id)!.checks.length, 3);
  assert.equal(store.snapshot().teamMode!.reviewEvidence.at(-1)!.artifactDigest, (await import("../src/core/team-mode-artifacts.ts")).artifactDigest(root));
});
