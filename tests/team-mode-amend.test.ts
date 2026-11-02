import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";

const wait = async (fn: () => boolean) => { for (let i = 0; i < 250; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw Error("timed out"); };
test("after-current amendment is persisted while writer runs and applied to same session", { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-amend-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
  const store = ProjectStore.open(root); let target = "", release!: () => void, reviewerScope: any; const writers: WorkerRequest[] = [];
  const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
    let text = "done";
    if (request.systemPrompt.includes("read-only team coordinator")) {
      const input = JSON.parse(request.prompt.split("\n").at(-1)!);
      text = input.currentUserRequest === "change" ? JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "amend", targetRequestId: target, timing: "after_current", instruction: "Add feature B" }) : JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "propose_plan", tasks: [{ id: "task", title: "Implement", description: "feature A", role: "developer", dependsOn: [], acceptance: ["works"] }], checks: [] });
    } else if (request.tools.includes("bash")) { writers.push(request); if (writers.length === 1) await new Promise<void>(resolve => { release = resolve; }); }
    else { const match = request.prompt.match(/\{"implementationAttemptId"[^\n]+/); assert.ok(match); const identity = JSON.parse(match[0]); reviewerScope = identity.scope; text = JSON.stringify({ implementationAttemptId: identity.implementationAttemptId, artifactDigest: identity.artifactDigest, checkIds: identity.checkIds, requestId: identity.requestId, requestRevision: identity.requestRevision, scopeDigest: identity.scopeDigest, verdict: "pass", findings: [] }); }
    return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId };
  };
  const controller = new TeamController(store, { runner, validateProfile: async () => {} });
  const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} });
  t.after(async () => { release?.(); await supervisor.shutdown(); await controller.shutdown(); });
  await supervisor.setMode(true); target = supervisor.ingest({ text: "build", origin: "rpc", sessionId: "session-1" });
  await wait(() => writers.length === 1);
  const change = supervisor.ingest({ text: "change", origin: "rpc", sessionId: "session-1" });
  await wait(() => store.snapshot().teamMode!.requests.find(r => r.id === change)?.status !== "received" && store.snapshot().teamMode!.requests.find(r => r.id === change)?.status !== "classifying");
  assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === change)?.status, "answered");
  assert.equal(writers.length, 1); release(); await wait(() => writers.length === 2);
  assert.equal(writers[0].sessionId, writers[1].sessionId); assert.match(writers[1].prompt, /Add feature B/);
  await supervisor.whenIdle();
  assert.deepEqual(reviewerScope.amendments, [{ requestId: change, instruction: "Add feature B" }]);
  assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === target)?.status, "awaiting_user_acceptance");
  await supervisor.setMode(false);
});
