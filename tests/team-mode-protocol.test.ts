import test from "node:test";
import assert from "node:assert/strict";
import { buildCoordinatorPrompt, parseCoordinatorAction, parseReviewVerdict } from "../src/core/team-mode-protocol.ts";

test("current request, not historical project goal, defines team-mode scope", () => {
  const prompt = buildCoordinatorPrompt({ goal: "Only plan 0.4; do not implement", requestId: "request-1", text: "Implement 0.6", generation: 3, revision: 1 });
  assert.match(prompt, /historical/i);
  assert.match(prompt, /current user request/i);
  assert.match(prompt, /Only plan 0\.4/);
  assert.match(prompt, /Implement 0\.6/);
});

test("plans have exactly one writer and bounded declared checks", () => {
  const identity = { requestId: "request-1", generation: 3, revision: 1 };
  const task = { id: "work", title: "Work", description: "Implement", role: "developer", dependsOn: [], acceptance: ["works"] };
  const plan = { ...identity, kind: "propose_plan", tasks: [task], checks: ["npm test"] };
  assert.equal(parseCoordinatorAction(JSON.stringify(plan), identity).kind, "propose_plan");
  assert.throws(() => parseCoordinatorAction(JSON.stringify({ ...plan, tasks: [task, { ...task, id: "other" }] }), identity));
  assert.throws(() => parseCoordinatorAction(JSON.stringify({ ...plan, tasks: [{ ...task, role: "reviewer" }] }), identity));
  assert.throws(() => parseCoordinatorAction(JSON.stringify({ ...plan, checks: [""] }), identity));
});

test("review verdict is strictly bound to implementation attempt and artifact digest", () => {
  const identity = { implementationAttemptId: "attempt-1", artifactDigest: "a".repeat(64), checkIds: ["check-1"], requestId: "request-1", requestRevision: 2, scopeDigest: "c".repeat(64) };
  const verdict = { ...identity, verdict: "pass", findings: [] };
  assert.deepEqual(parseReviewVerdict(JSON.stringify(verdict), identity), verdict);
  assert.throws(() => parseReviewVerdict(JSON.stringify({ ...verdict, artifactDigest: "b".repeat(64) }), identity));
  assert.throws(() => parseReviewVerdict(JSON.stringify({ ...verdict, checkIds: [] }), identity));
  assert.throws(() => parseReviewVerdict(JSON.stringify({ ...verdict, requestRevision: 3 }), identity));
  assert.throws(() => parseReviewVerdict(JSON.stringify({ ...verdict, scopeDigest: "d".repeat(64) }), identity));
  assert.throws(() => parseReviewVerdict(JSON.stringify({ ...verdict, verdict: "PASS" }), identity));
  assert.throws(() => parseReviewVerdict(JSON.stringify({ ...verdict, verdict: "changes_required", findings: [] }), identity));
});

test("coordinator proposals must identify the exact request, generation and revision", () => {
  const expected = { requestId: "request-1", generation: 3, revision: 1 };
  assert.deepEqual(parseCoordinatorAction(JSON.stringify({ ...expected, kind: "answer", text: "ready" }), expected), { ...expected, kind: "answer", text: "ready" });
  for (const value of [
    { ...expected, generation: 2, kind: "answer", text: "ready" },
    { ...expected, revision: 0, kind: "answer", text: "ready" },
    { ...expected, requestId: "other", kind: "answer", text: "ready" },
    { ...expected, kind: "accept", text: "ready" },
    { ...expected, kind: "answer", text: "ready", command: "rm -rf /" },
  ]) assert.throws(() => parseCoordinatorAction(JSON.stringify(value), expected));
});
