import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { artifactDigest } from "../src/core/team-mode-artifacts.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";

test("resume at review checkpoint does not rerun completed writer", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-checkpoint-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n"); writeFileSync(join(root, "file"), "implementation");
  const store = ProjectStore.open(root); let writers = 0, reviews = 0;
  const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
    if (request.tools.includes("bash")) { writers++; throw Error("writer must not run"); }
    reviews++; const match = request.prompt.match(/\{"implementationAttemptId"[^\n]+/); assert.ok(match); const identity = JSON.parse(match[0]);
    return { outcome: "success", text: JSON.stringify({ implementationAttemptId: identity.implementationAttemptId, artifactDigest: identity.artifactDigest, checkIds: identity.checkIds, requestId: identity.requestId, requestRevision: identity.requestRevision, scopeDigest: identity.scopeDigest, verdict: "pass", findings: [] }), exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId };
  };
  const controller = new TeamController(store, { runner, validateProfile: async () => {} }); const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} });
  t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); });
  const digest = artifactDigest(root);
  store.update(s => {
    const now = s.createdAt;
    s.tasks.push({ id: "writer", title: "work", description: "work", role: "developer", dependsOn: [], acceptance: ["works"], status: "needs_review", createdAt: now, updatedAt: now, attempts: [{ id: "attempt-1", sessionId: "session-1", profile: s.profiles.developer, startedAt: now, endedAt: now, outcome: "success", text: "done", effectiveModels: [], usage: emptyUsage(), logFile: "logs/attempt-1.jsonl" }], checks: [] }, { id: "review", title: "review", description: "review", role: "reviewer", dependsOn: [], acceptance: ["review"], status: "queued", createdAt: now, updatedAt: now, attempts: [], checks: [] });
    s.teamMode = { version: 1, enabled: true, generation: 1, requests: [{ id: "request-1", text: "work", origin: "rpc", sessionId: "session-1", receivedAt: now, revision: 1, status: "paused", taskIds: ["writer", "review"], checks: [], checkpoint: "review", artifactDigest: digest }], coordinatorAttempts: [], events: [], reviewEvidence: [] };
  });
  supervisor.resume("request-1"); await supervisor.whenIdle();
  assert.equal(writers, 0); assert.equal(reviews, 1); assert.equal(store.snapshot().teamMode!.requests[0].status, "awaiting_user_acceptance");
  store.update(s => { const request = s.teamMode!.requests[0]; request.status = "paused"; request.checkpoint = "review"; request.artifactDigest = digest; });
  writeFileSync(join(root, "file"), "modified after review");
  supervisor.resume("request-1"); await supervisor.whenIdle();
  const after = store.snapshot().teamMode!.requests[0];
  assert.equal(after.status, "paused"); assert.match(after.reason!, /변경/); assert.equal(writers, 0); assert.equal(reviews, 1);
});
