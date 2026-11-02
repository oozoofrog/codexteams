import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/core/store.ts";
import { emptyUsage } from "../src/core/usage.ts";

test("team-mode state validates references and preserves failed writes", t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-store-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root); t.after(() => store.close());
  store.update(s => { (s as any).teamMode = { version: 1, enabled: true, generation: 1, requests: [], coordinatorAttempts: [], events: [], reviewEvidence: [] }; });
  const before = store.snapshot();
  assert.throws(() => store.update(s => { (s as any).teamMode.events.push({ id: "event-1", requestId: "missing", kind: "received", at: new Date().toISOString() }); }));
  assert.deepEqual(store.snapshot(), before);
  assert.throws(() => store.update(s => { (s as any).teamMode.generation = -1; }));
});

test("persisted received request pauses even without an unfinished process", t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-store-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root);
  store.update(s => { s.teamMode = { version: 1, enabled: true, generation: 1, requests: [{ id: "request-1", text: "hello", origin: "rpc", sessionId: "session-1", receivedAt: s.createdAt, revision: 1, status: "received", taskIds: [] }], coordinatorAttempts: [], events: [], reviewEvidence: [] }; });
  store.close();
  const reopened = ProjectStore.open(root); t.after(() => reopened.close());
  assert.equal(reopened.snapshot().teamMode?.requests[0].status, "paused");
});

test("unfinished coordinator is recovery-pending, never replayed on reopen", t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-store-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root);
  store.update(s => { (s as any).teamMode = { version: 1, enabled: true, generation: 1, requests: [{ id: "request-1", text: "hello", origin: "interactive", sessionId: "session-1", receivedAt: s.createdAt, revision: 1, status: "classifying", taskIds: [] }], coordinatorAttempts: [{ id: "attempt-1", sessionId: "session-2", requestId: "request-1", generation: 1, requestRevision: 1, profile: s.profiles.planner, startedAt: s.createdAt, text: "", effectiveModels: [], usage: emptyUsage(), logFile: "logs/attempt-1.jsonl" }], events: [], reviewEvidence: [] }; });
  store.close();
  const reopened = ProjectStore.open(root); t.after(() => reopened.close());
  const state = reopened.snapshot() as any;
  assert.equal(state.recoveryRequired, true);
  assert.equal(state.teamMode.requests[0].status, "paused");
  assert.equal(state.teamMode.coordinatorAttempts[0].recoveryPending, true);
  assert.equal(state.teamMode.coordinatorAttempts[0].outcome, "aborted");
});
