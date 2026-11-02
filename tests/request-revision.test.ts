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

test("revision reruns same writer with instruction; recheck requiring changes never writes", async t => {
  const root = mkdtempSync(join(tmpdir(), "request-revision-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
  const store = ProjectStore.open(root);
  let writes = 0, reviews = 0; const prompts: string[] = [];
  const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
    let text: string;
    if (request.systemPrompt.includes("read-only team coordinator")) {
      const input = JSON.parse(request.prompt.split("\n").at(-1)!);
      text = JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "propose_plan", tasks: [{ id: "work", title: "Implement", description: "Implement feature", role: "developer", dependsOn: [], acceptance: ["works"] }], checks: [] });
    } else if (request.tools.includes("bash")) {
      writes++; prompts.push(request.prompt); writeFileSync(join(root, "feature.txt"), `result ${writes}`); text = "Implemented";
    } else {
      reviews++; const identity = JSON.parse(request.prompt.match(/\{"implementationAttemptId"[^\n]+/)![0]);
      text = JSON.stringify({ implementationAttemptId: identity.implementationAttemptId, artifactDigest: identity.artifactDigest, checkIds: identity.checkIds, requestId: identity.requestId, requestRevision: identity.requestRevision, scopeDigest: identity.scopeDigest, verdict: reviews === 3 ? "changes_required" : "pass", findings: reviews === 3 ? ["Needs correction"] : [] });
    }
    return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [request.profile.model], sessionId: request.sessionId };
  };
  const controller = new TeamController(store, { runner, validateProfile: async () => {} });
  const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} });
  t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); });
  await supervisor.setMode(true);
  const id = supervisor.ingest({ text: "Implement feature", origin: "rpc", sessionId: "session" });
  await supervisor.whenIdle();
  const before = store.snapshot().teamMode!.requests.find(r => r.id === id)!;
  assert.equal(before.status, "awaiting_user_acceptance");
  supervisor.revise(id, "Add requested detail");
  assert.throws(() => controller.accept(before.taskIds[0]));
  await supervisor.whenIdle();
  const revised = store.snapshot().teamMode!.requests.find(r => r.id === id)!;
  assert.equal(revised.status, "awaiting_user_acceptance");
  assert.equal(writes, 2); assert.match(prompts[1], /Add requested detail/);
  assert.equal(revised.taskIds[0], before.taskIds[0]);
  supervisor.recheck(id); await supervisor.whenIdle();
  assert.equal(writes, 2); assert.equal(reviews, 3);
  const checked = store.snapshot().teamMode!.requests.find(r => r.id === id)!;
  assert.notEqual(checked.status, "awaiting_user_acceptance");
  assert.match(checked.reason ?? "", /Needs correction/);
  supervisor.revise(id, "Correct the review finding");
  await supervisor.whenIdle();
  assert.equal(writes, 3); assert.match(prompts[2], /Correct the review finding/);
  assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === id)!.status, "awaiting_user_acceptance");
});
