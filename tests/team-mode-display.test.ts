import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/core/store.ts";
import { emptyUsage } from "../src/core/usage.ts";
import { formatBoard, projectUsage, widgetLines } from "../src/ui/format.ts";
import { homeOverview } from "../src/ui/home.ts";

test("coordinator-only activity and usage are visible on board, widget and home", t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-display-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root); t.after(() => store.close());
  store.update(s => { s.teamMode = { version: 1, enabled: true, generation: 1, requests: [{ id: "r", text: "question", origin: "rpc", sessionId: "s", receivedAt: s.createdAt, revision: 1, status: "classifying", taskIds: [] }], coordinatorAttempts: [{ id: "a", sessionId: "worker", requestId: "r", generation: 1, requestRevision: 1, profile: s.profiles.planner, startedAt: s.createdAt, effectiveModels: ["returned-model"], text: "", usage: { ...emptyUsage(), input: 11, totalTokens: 11, completeness: "partial" }, logFile: "logs/a.jsonl" }], events: [], reviewEvidence: [] }; });
  const state = store.snapshot();
  assert.equal(projectUsage(state).input, 11);
  assert.match(formatBoard(state), /returned-model/); assert.doesNotMatch(formatBoard(state), /모델 호출 기록 없음/);
  assert.match(widgetLines(state, "준비", undefined)[0], /ON/); assert.match(widgetLines(state, "준비", undefined)[0], /조율/); assert.doesNotMatch(widgetLines(state, "준비", undefined)[0], /실행 없음/);
  assert.match(homeOverview(root, state, undefined, "준비", "").status!, /조율/);
  const unknown = structuredClone(state); unknown.teamMode!.coordinatorAttempts[0].usage = emptyUsage();
  assert.equal(projectUsage(unknown).completeness, "unknown"); assert.doesNotMatch(formatBoard(unknown), /모델 호출 기록 없음/);
  const mixed = structuredClone(state); mixed.teamMode!.coordinatorAttempts.push({ ...structuredClone(mixed.teamMode!.coordinatorAttempts[0]), id: "a2", logFile: "logs/a2.jsonl", usage: emptyUsage() });
  assert.equal(projectUsage(mixed).input, 11); assert.equal(projectUsage(mixed).completeness, "partial");
  const op = { id: "op", kind: "task", phase: "waiting", startedAt: state.createdAt, lastActivityAt: state.createdAt } as const;
  assert.match(widgetLines(state, "실행", op)[0], /조율/); assert.match(widgetLines(state, "실행", op)[0], /대기/);
});
