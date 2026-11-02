import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectStore } from "../src/core/store.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";

test("paused requests never replay on ON and explicit stop preserves the receipt", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-mode-control-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = ProjectStore.open(root); t.after(() => store.close());
  let runs = 0;
  const supervisor = new TeamModeSupervisor(store, { runner: async () => { runs++; throw new Error("should not run"); }, validateProfile: async () => {} });
  await supervisor.setMode(true);
  store.update(s => { s.teamMode!.requests.push({ id: "request-1", text: "work", origin: "rpc", sessionId: "session-1", receivedAt: s.createdAt, revision: 1, status: "paused", taskIds: [] }); });
  await supervisor.setMode(false); await supervisor.setMode(true); await supervisor.whenIdle();
  assert.equal(runs, 0); assert.equal(store.snapshot().teamMode!.requests[0].status, "paused");
  await supervisor.stop("request-1");
  assert.equal(store.snapshot().teamMode!.requests[0].status, "cancelled");
  await supervisor.shutdown();
});
