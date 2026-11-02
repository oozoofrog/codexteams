import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";
const wait = async (f: () => boolean) => { for (let i = 0; i < 300; i++) { if (f()) return; await new Promise(r => setTimeout(r, 10)); } throw Error("timed out"); };
test("natural stop remains stopping until aborted worker settles", { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "request-natural-stop-")); t.after(() => rmSync(root, { recursive: true, force: true })); execFileSync("git", ["init", "-q"], { cwd: root }); writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
  const store = ProjectStore.open(root); let target = "", started = false, aborted = false, release!: () => void;
  const runner = async (req: WorkerRequest): Promise<WorkerResult> => {
    let text = "done";
    if (req.systemPrompt.includes("read-only team coordinator")) { const i = JSON.parse(req.prompt.split("\n").at(-1)!); text = i.currentUserRequest === "stop it" ? JSON.stringify({ requestId: i.requestId, generation: i.generation, revision: i.revision, kind: "stop", targetRequestId: target }) : JSON.stringify({ requestId: i.requestId, generation: i.generation, revision: i.revision, kind: "propose_plan", tasks: [{ id: "work", title: "Work", description: "Work", role: "developer", dependsOn: [], acceptance: ["works"] }], checks: [] }); }
    else if (req.tools.includes("bash")) { started = true; req.signal?.addEventListener("abort", () => { aborted = true; }); await new Promise<void>(r => { release = r; }); }
    return { outcome: req.signal?.aborted ? "aborted" : "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: req.sessionId };
  };
  const controller = new TeamController(store, { runner, validateProfile: async () => {} }); const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} });
  t.after(async () => { release?.(); await supervisor.shutdown(); await controller.shutdown(); });
  await supervisor.setMode(true); target = supervisor.ingest({ text: "build", origin: "rpc", sessionId: "session" }); await wait(() => started);
  supervisor.ingest({ text: "stop it", origin: "rpc", sessionId: "session" }); await wait(() => aborted);
  assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === target)!.status, "stopping"); assert.throws(() => supervisor.resume(target));
  release(); await supervisor.whenIdle(); assert.equal(store.snapshot().teamMode!.requests.find(r => r.id === target)!.status, "cancelled");
});
