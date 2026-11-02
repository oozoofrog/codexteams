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

test("unchanged artifact and repeated review findings pause rather than retry forever", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-stall-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
  const store = ProjectStore.open(root); let writes = 0, reviews = 0;
  const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
    let text: string;
    if (request.systemPrompt.includes("read-only team coordinator")) {
      const input = JSON.parse(request.prompt.split("\n").at(-1)!);
      text = JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "propose_plan", tasks: [{ id: "work", title: "Work", description: "Implement", role: "developer", dependsOn: [], acceptance: ["works"] }], checks: [] });
    } else if (request.tools.includes("bash")) { writes++; writeFileSync(join(root, "feature"), "unchanged"); text = "done"; }
    else { reviews++; const match = request.prompt.match(/\{"implementationAttemptId"[^\n]+/); assert.ok(match); const i = JSON.parse(match[0]); text = JSON.stringify({ implementationAttemptId: i.implementationAttemptId, artifactDigest: i.artifactDigest, checkIds: i.checkIds, requestId: i.requestId, requestRevision: i.requestRevision, scopeDigest: i.scopeDigest, verdict: "changes_required", findings: ["same finding"] }); }
    return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId };
  };
  const controller = new TeamController(store, { runner, validateProfile: async () => {} });
  const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} });
  t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); });
  await supervisor.setMode(true); const id = supervisor.ingest({ text: "Implement", origin: "rpc", sessionId: "session-1" }); await supervisor.whenIdle();
  const request = store.snapshot().teamMode!.requests.find(r => r.id === id)!;
  assert.equal(request.status, "paused"); assert.match(request.reason!, /바뀌지 않아/); assert.equal(writes, 2); assert.equal(reviews, 2);
});
