import { test } from "node:test";
import assert from "node:assert/strict";
import { requestActions, requestDetailLines, requestResultLines } from "../src/ui/request-view.ts";
import type { ProjectState, TeamModeRequest } from "../src/core/types.ts";
test("OFF result actions do not advertise unavailable revise or recheck and explain mode", () => {
  const request = { id: "r", text: "request", status: "awaiting_user_acceptance", taskIds: ["w", "v"], revision: 2, amendments: [{ requestId: "a", instruction: "Change exactly this", timing: "after_current", status: "applied" }] } as TeamModeRequest;
  const state = { tasks: [{ id: "w", role: "developer", attempts: [], checks: [] }, { id: "v", role: "reviewer", attempts: [], checks: [] }], teamMode: { enabled: false, requests: [request], reviewEvidence: [{ requestId: "r", id: "review", scopeDigest: "digest", verdict: "pass", scope: { requestText: "request" } }] } } as unknown as ProjectState;
  assert.deepEqual(requestActions(state, request), ["result", "accept", "details"]);
  const result = requestResultLines(state, request).join("\n"); assert.match(result, /Change exactly this/); assert.match(result, /팀 모드를 켜세요/);
  const detail = requestDetailLines(state, request).join("\n"); assert.match(detail, /developer/); assert.match(detail, /reviewer/); assert.match(detail, /scopeDigest/); assert.match(detail, /digest/);
  state.teamMode!.enabled = true; assert.ok(requestActions(state, request).includes("recheck")); assert.ok(requestActions(state, request).includes("revise"));
});
