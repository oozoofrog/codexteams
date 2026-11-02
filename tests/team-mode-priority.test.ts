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
test("priority affects only queued managed requests and rejects unknown targets", { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-priority-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root); let release!: () => void, held = false, order: string[] = [];
  const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
    let text = "done";
    if (request.systemPrompt.includes("read-only team coordinator")) {
      const input = JSON.parse(request.prompt.split("\n").at(-1)!); const base = { requestId: input.requestId, generation: input.generation, revision: input.revision };
      text = input.currentUserRequest === "prioritize" ? JSON.stringify({ ...base, kind: "prioritize", orderedRequestIds: order }) : input.currentUserRequest === "bad" ? JSON.stringify({ ...base, kind: "prioritize", orderedRequestIds: ["unknown"] }) : JSON.stringify({ ...base, kind: "propose_plan", tasks: [{ id: "task", title: "Implement", description: "work", role: "developer", dependsOn: [], acceptance: ["works"] }], checks: [] });
    } else if (request.tools.includes("bash")) { held = true; await new Promise<void>(resolve => { release = resolve; }); }
    return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId };
  };
  const controller = new TeamController(store, { runner, validateProfile: async () => {} }); const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} });
  t.after(async () => { release?.(); await supervisor.shutdown(); await controller.shutdown(); });
  await supervisor.setMode(true); supervisor.ingest({ text: "first", origin: "rpc", sessionId: "session-1" }); await wait(() => held);
  const a = supervisor.ingest({ text: "second", origin: "rpc", sessionId: "session-1" }), b = supervisor.ingest({ text: "third", origin: "rpc", sessionId: "session-1" });
  await wait(() => [a, b].every(id => store.snapshot().teamMode!.requests.find(r => r.id === id)?.status === "queued"));
  order = [b, a]; const priority = supervisor.ingest({ text: "prioritize", origin: "rpc", sessionId: "session-1" });
  await wait(() => store.snapshot().teamMode!.requests.find(r => r.id === priority)?.status === "answered");
  assert.deepEqual(store.snapshot().teamMode!.requests.filter(r => r.status === "queued").map(r => r.id), [b, a]);
  const bad = supervisor.ingest({ text: "bad", origin: "rpc", sessionId: "session-1" }); await wait(() => store.snapshot().teamMode!.requests.find(r => r.id === bad)?.status === "blocked");
  await supervisor.setMode(false); release(); await supervisor.whenIdle();
});
