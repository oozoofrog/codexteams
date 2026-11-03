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
import { isLegacyAccepted } from "../src/ui/request-view.ts";
import type { WorkerRequest, WorkerResult } from "../src/core/types.ts";

test("managed acceptance persists a linked request receipt atomically", async t => {
  const root = mkdtempSync(join(tmpdir(), "request-acceptance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), ".codexteams/\n");
  const store = ProjectStore.open(root);
  const runner = async (request: WorkerRequest): Promise<WorkerResult> => {
    let text: string;
    if (request.systemPrompt.includes("read-only team coordinator")) {
      const input = JSON.parse(request.prompt.split("\n").at(-1)!);
      text = JSON.stringify({ requestId: input.requestId, generation: input.generation, revision: input.revision, kind: "propose_plan", tasks: [{ id: "work", title: "Implement", description: "Implement feature", role: "developer", dependsOn: [], acceptance: ["works"] }], checks: [] });
    } else if (request.tools.includes("bash")) {
      writeFileSync(join(root, "feature.txt"), "result"); text = "Implemented";
    } else {
      const identity = JSON.parse(request.prompt.match(/\{"implementationAttemptId"[^\n]+/)![0]);
      text = JSON.stringify({ implementationAttemptId: identity.implementationAttemptId, artifactDigest: identity.artifactDigest, checkIds: identity.checkIds, requestId: identity.requestId, requestRevision: identity.requestRevision, scopeDigest: identity.scopeDigest, verdict: "pass", findings: [] });
    }
    return { outcome: "success", text, exitCode: 0, usage: emptyUsage(), effectiveModels: [request.profile.model], sessionId: request.sessionId };
  };
  const controller = new TeamController(store, { runner, validateProfile: async () => {} });
  const supervisor = new TeamModeSupervisor(store, { controller, runner, validateProfile: async () => {} });
  t.after(async () => { await supervisor.shutdown(); await controller.shutdown(); });
  await supervisor.setMode(true);
  const id = supervisor.ingest({ text: "Implement feature", origin: "rpc", sessionId: "session" });
  await supervisor.whenIdle();
  const before = store.snapshot();
  const request = before.teamMode!.requests.find(r => r.id === id)!;
  assert.equal(request.status, "awaiting_user_acceptance");
  const originalPersist = (store as any).persist;
  (store as any).persist = () => { throw new Error("simulated persistence failure"); };
  try { assert.throws(() => controller.accept(request.taskIds[0]), /simulated persistence failure/); }
  finally { (store as any).persist = originalPersist; }
  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(ProjectStore.read(root), JSON.parse(JSON.stringify(before)));
  controller.accept(request.taskIds[0]);
  const after = store.snapshot();
  const accepted = after.teamMode!.requests.find(r => r.id === id)!;
  const writer = after.tasks.find(t => t.id === request.taskIds[0])!;
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.receipt?.implementationAttemptId, writer.acceptedAttemptId);
  assert.equal(accepted.receipt?.requestRevision, request.revision);
  assert.equal(accepted.receipt?.acceptedAt, writer.acceptedAt);
  assert.equal(accepted.receipt?.reviewEvidenceId, after.teamMode!.reviewEvidence.at(-1)!.id);
  assert.throws(() => controller.accept(writer.id));
  assert.throws(() => store.update(s => { s.teamMode!.requests.find(r => r.id === id)!.receipt!.reviewEvidenceId = "tampered"; }));
  assert.throws(() => store.update(s => { const r = s.teamMode!.requests.find(r => r.id === id)!; r.status = "awaiting_user_acceptance"; delete r.receipt; }), /수락한 요청/);
  // Load a genuine historical shape through the reader, rather than rewriting an accepted record with the current writer.
  const historical = structuredClone(after);
  const old = historical.teamMode!.requests.find(r => r.id === id)!; old.status = "awaiting_user_acceptance"; delete old.receipt;
  await supervisor.shutdown(); store.close();
  writeFileSync(join(root, ".codexteams", "state.json"), JSON.stringify(historical));
  const legacyStore = ProjectStore.open(root);
  const legacySupervisor = new TeamModeSupervisor(legacyStore, { runner, validateProfile: async () => {} });
  t.after(async () => { await legacySupervisor.shutdown(); legacyStore.close(); });
  const legacy = legacyStore.snapshot();
  assert.equal(isLegacyAccepted(legacy, legacy.teamMode!.requests.find(r => r.id === id)!), true);
  assert.throws(() => legacySupervisor.resume(id), /이전 수락/);
  assert.deepEqual(legacyStore.snapshot(), legacy);
});
