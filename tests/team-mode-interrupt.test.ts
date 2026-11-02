import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";
const wait = async (fn: () => boolean) => { for (let i = 0; i < 300; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw Error("timed out"); };
test("interrupt amendment waits for actual old worker settlement before same-session resume", { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-interrupt-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root); let target = "", release!: () => void, aborted = false; const writers: WorkerRequest[] = [];
  const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
    let text = "done";
    if (request.systemPrompt.includes("read-only team coordinator")) {
      const input = JSON.parse(request.prompt.split("\n").at(-1)!);
      text = input.currentUserRequest === "change" ? JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "amend", targetRequestId: target, timing: "interrupt_then_resume", instruction: "Use new direction" }) : JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "propose_plan", tasks: [{ id: "task", title: "Implement", description: "work", role: "developer", dependsOn: [], acceptance: ["works"] }], checks: [] });
    } else if (request.tools.includes("bash")) { writers.push(request); if (writers.length === 1) { request.signal!.addEventListener("abort", () => { aborted = true; }); await new Promise<void>(resolve => { release = resolve; }); } }
    return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId };
  };
  const controller = new TeamController(store, { runner, validateProfile: async () => {} }); const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} });
  t.after(async () => { release?.(); await supervisor.shutdown(); await controller.shutdown(); });
  await supervisor.setMode(true); target = supervisor.ingest({ text: "build", origin: "rpc", sessionId: "session-1" }); await wait(() => writers.length === 1);
  supervisor.ingest({ text: "change", origin: "rpc", sessionId: "session-1" }); await wait(() => aborted);
  assert.equal(writers.length, 1); release(); await wait(() => writers.length === 2);
  assert.equal(writers[0].sessionId, writers[1].sessionId); assert.match(writers[1].prompt, /Use new direction/);
  await supervisor.setMode(false); await supervisor.whenIdle();
});
