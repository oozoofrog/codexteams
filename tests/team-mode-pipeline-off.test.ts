import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamController } from "../src/core/controller.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { ProjectStore } from "../src/core/store.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";

test("OFF while writer is pending preserves execution but dispatches no check or review", { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-off-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root); let release!: () => void, started!: () => void, questionStarted!: () => void, reviews = 0;
  const pending = new Promise<void>(resolve => { started = resolve; });
  const questionDone = new Promise<void>(resolve => { questionStarted = resolve; });
  const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
    let text = "done";
    if (request.systemPrompt.includes("read-only team coordinator")) {
      const input = JSON.parse(request.prompt.split("\n").at(-1)!);
      if (input.currentUserRequest === "status?") { text = JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "answer", text: "Running" }); questionStarted(); }
      else text = JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "propose_plan", tasks: [{ id: "work", title: "Implement", description: "Implement", role: "developer", dependsOn: [], acceptance: ["works"] }], checks: ["false"] });
    } else if (request.tools.includes("bash")) { started(); await new Promise<void>(resolve => { release = resolve; }); }
    else { reviews++; }
    return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId };
  };
  const controller = new TeamController(store, { runner, validateProfile: async () => {} });
  const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} });
  t.after(async () => { release?.(); await supervisor.shutdown(); await controller.shutdown(); });
  await supervisor.setMode(true); const id = supervisor.ingest({ text: "Implement", origin: "rpc", sessionId: "session-1" });
  await pending;
  const questionId = supervisor.ingest({ text: "status?", origin: "rpc", sessionId: "session-1" });
  await questionDone;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === questionId)?.status, "answered");
  await supervisor.setMode(false); assert.equal(controller.busy, true); release(); await supervisor.whenIdle();
  const state = store.snapshot(), request = state.teamMode!.requests.find(r => r.id === id)!;
  assert.equal(request.status, "paused"); assert.equal(reviews, 0);
  assert.equal(state.tasks.find(t => t.id === request.taskIds[0])!.checks.length, 0);
});
