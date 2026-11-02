import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamController } from "../src/core/controller.ts";
import { ProjectStore } from "../src/core/store.ts";
import { emptyUsage } from "../src/core/usage.ts";

test("legacy run cannot launch a team-mode managed task", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-boundary-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root); let launches = 0;
  const controller = new TeamController(store, { validateProfile: async () => {}, runner: async () => { launches++; throw new Error("unexpected runner"); } });
  t.after(() => controller.shutdown());
  store.update(s => {
    s.tasks.push({ id: "managed", title: "Managed", description: "work", role: "developer", dependsOn: [], acceptance: ["works"], status: "queued", createdAt: s.createdAt, updatedAt: s.updatedAt, attempts: [], checks: [] });
    s.teamMode = { version: 1, enabled: true, generation: 1, requests: [{ id: "request-1", text: "work", origin: "rpc", sessionId: "session-1", receivedAt: s.createdAt, revision: 1, status: "queued", taskIds: ["managed"] }], coordinatorAttempts: [], events: [], reviewEvidence: [] };
  });
  await assert.rejects(controller.run("managed"));
  const result = await controller.run();
  assert.deepEqual(result.executed, []);
  assert.equal(launches, 0);
});

test("OFF during managed preflight prevents worker dispatch", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-boundary-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root); let release!: () => void, started!: () => void, launches = 0;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const controller = new TeamController(store, { validateProfile: () => { started(); return new Promise<void>(resolve => { release = resolve; }); }, runner: async () => { launches++; throw new Error("unexpected runner"); } });
  t.after(() => controller.shutdown());
  store.update(s => {
    s.tasks.push({ id: "managed", title: "Managed", description: "work", role: "developer", dependsOn: [], acceptance: ["works"], status: "queued", createdAt: s.createdAt, updatedAt: s.updatedAt, attempts: [], checks: [] });
    s.teamMode = { version: 1, enabled: true, generation: 1, requests: [{ id: "request-1", text: "work", origin: "rpc", sessionId: "session-1", receivedAt: s.createdAt, revision: 1, status: "running", taskIds: ["managed"] }], coordinatorAttempts: [], events: [], reviewEvidence: [] };
  });
  const operation = controller.runManaged("request-1", "managed", 1);
  await ready; store.update(s => { s.teamMode!.enabled = false; s.teamMode!.generation++; }); release();
  await assert.rejects(operation);
  assert.equal(launches, 0);
  assert.equal(store.snapshot().tasks[0].attempts.length, 0);
});

test("request-scoped execution uses the current request and never accepts automatically", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-boundary-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root); let prompt = "";
  const controller = new TeamController(store, { validateProfile: async () => {}, runner: async request => { prompt = request.prompt; return { outcome: "success", text: "done", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId }; } });
  t.after(() => controller.shutdown());
  store.update(s => {
    s.goal = "historical goal";
    s.tasks.push({ id: "managed", title: "Managed", description: "work", role: "developer", dependsOn: [], acceptance: ["works"], status: "queued", createdAt: s.createdAt, updatedAt: s.updatedAt, attempts: [], checks: [] });
    s.teamMode = { version: 1, enabled: true, generation: 1, requests: [{ id: "request-1", text: "current new goal", origin: "rpc", sessionId: "session-1", receivedAt: s.createdAt, revision: 1, status: "running", taskIds: ["managed"] }], coordinatorAttempts: [], events: [], reviewEvidence: [] };
  });
  await assert.rejects(controller.runManaged("request-1", "managed", 2));
  await controller.runManaged("request-1", "managed", 1);
  assert.match(prompt, /current new goal/);
  assert.doesNotMatch(prompt, /historical goal/);
  const task = store.snapshot().tasks[0];
  assert.equal(task.status, "needs_review");
  assert.equal(task.acceptanceSource, undefined);
});
