import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/core/store.ts";
import { emptyUsage } from "../src/core/usage.ts";

function temporary(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "codexteams-store-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("read is side-effect free and writer is exclusive", t => {
  const root = temporary(t);
  assert.equal(ProjectStore.read(root), null);
  assert.equal(existsSync(join(root, ".codexteams")), false);
  const store = ProjectStore.open(root);
  t.after(() => store.close());
  assert.throws(() => ProjectStore.open(root), /사용|owner|lock|잠금/i);
  store.update(s => { s.goal = "디스크 관리 앱"; });
  assert.equal(ProjectStore.read(root)?.goal, "디스크 관리 앱");
  const copy = store.snapshot();
  copy.goal = "changed externally";
  assert.equal(store.snapshot().goal, "디스크 관리 앱");
});

test("invalid state updates roll back memory and disk", t => {
  const root = temporary(t);
  const store = ProjectStore.open(root);
  t.after(() => store.close());
  const before = readFileSync(join(root, ".codexteams/state.json"), "utf8");
  assert.throws(() => store.update(s => { s.schemaVersion = 2 as 1; }));
  assert.equal(readFileSync(join(root, ".codexteams/state.json"), "utf8"), before);
  assert.equal(store.snapshot().schemaVersion, 1);
});

test("dead owner recovery preserves state and interrupts unfinished checks", t => {
  const root = temporary(t);
  const store = ProjectStore.open(root);
  store.update(s => {
    s.goal = "keep";
    s.tasks.push({ id: "task1", title: "Task", description: "Work", role: "developer", dependsOn: [], acceptance: ["Works"], status: "running", createdAt: s.createdAt, updatedAt: s.updatedAt, attempts: [{ id: "attempt1", sessionId: "session1", profile: s.profiles.developer, startedAt: s.createdAt, text: "", effectiveModels: [], usage: emptyUsage(), logFile: "logs/attempt1.jsonl" }], checks: [{ id: "check1", attemptId: "attempt1", command: "true", startedAt: s.createdAt, exitCode: null, output: "", status: "running" }] });
  });
  store.close();
  writeFileSync(join(root, ".codexteams/lock.json"), JSON.stringify({ pid: 2147483647, hostname: hostname(), nonce: "old", startedAt: new Date().toISOString() }));
  const restored = ProjectStore.open(root);
  t.after(() => restored.close());
  assert.equal(restored.snapshot().goal, "keep");
  assert.equal(restored.snapshot().tasks[0].status, "interrupted");
  assert.equal(restored.snapshot().tasks[0].checks[0].status, "interrupted");
  assert.equal(restored.snapshot().recoveryRequired, true);
});

test("corrupt state is preserved and failed open releases only its own lock", t => {
  const root = temporary(t);
  ProjectStore.open(root).close();
  const state = join(root, ".codexteams/state.json");
  writeFileSync(state, "{broken");
  assert.throws(() => ProjectStore.open(root), /손상|JSON|state/i);
  assert.equal(readFileSync(state, "utf8"), "{broken");
  assert.equal(existsSync(join(root, ".codexteams/lock.json")), false);
});

test("foreign host locks and symlinked state paths are not followed", t => {
  const root = temporary(t);
  ProjectStore.open(root).close();
  const lock = join(root, ".codexteams/lock.json");
  writeFileSync(lock, JSON.stringify({ pid: 2147483647, hostname: "another-machine", nonce: "foreign" }));
  assert.throws(() => ProjectStore.open(root), /호스트|host/i);
  rmSync(lock);
  const state = join(root, ".codexteams/state.json");
  const outside = join(root, "outside.json");
  writeFileSync(outside, "untouched");
  rmSync(state);
  symlinkSync(outside, state);
  assert.throws(() => ProjectStore.open(root), /symlink|심볼릭/i);
  assert.equal(readFileSync(outside, "utf8"), "untouched");
});

test("malformed nested attempts are rejected without rewriting the state file", t => {
  const root = temporary(t);
  const store = ProjectStore.open(root);
  const data = store.snapshot(); store.close();
  const statePath = join(root, ".codexteams/state.json");
  const malformed = { ...data, tasks: [{ id: "unsafe", title: "bad state", description: "bad", role: "developer", dependsOn: [], acceptance: ["works"], status: "needs_review", createdAt: data.createdAt, updatedAt: data.updatedAt, attempts: [{ id: "unfinished", workerPid: process.pid }], checks: [] }] };
  const contents = JSON.stringify(malformed); writeFileSync(statePath, contents);
  assert.throws(() => ProjectStore.open(root), /state|실행|손상|시도/);
  assert.equal(readFileSync(statePath, "utf8"), contents);
});

test("an unfinished attempt requires recovery independently of its outer task status", t => {
  const root = temporary(t);
  const store = ProjectStore.open(root);
  store.update(s => {
    s.tasks.push({ id: "interrupted-write", title: "Work", description: "Interrupted transition", role: "developer", dependsOn: [], acceptance: ["done"], status: "queued", createdAt: s.createdAt, updatedAt: s.updatedAt, attempts: [{ id: "attempt2", sessionId: "session2", profile: s.profiles.developer, startedAt: s.createdAt, text: "", effectiveModels: [], usage: emptyUsage(), logFile: "logs/attempt2.jsonl" }], checks: [] });
  });
  store.close();
  const restored = ProjectStore.open(root); t.after(() => restored.close());
  assert.equal(restored.snapshot().recoveryRequired, true);
  assert.equal(restored.snapshot().tasks[0].status, "interrupted");
  assert.equal(restored.snapshot().tasks[0].attempts[0].outcome, "aborted");
});
