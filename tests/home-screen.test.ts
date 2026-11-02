import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { emptyUsage } from "../src/core/usage.ts";
import { homeActions, homeResultLines } from "../src/ui/home.ts";

test("home actions follow task status and show only the latest result", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-home-screen-"));
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => {}, runner: async req => ({ outcome: "success", text: "latest\x1b]0;unsafe\x07", exitCode: 0, usage: emptyUsage(), effectiveModels: [], sessionId: req.sessionId }) });
  t.after(async () => { await team.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const task = team.add("developer", "첫 작업");
  assert.equal(homeActions(team.snapshot(), undefined, task.id)[0].id, "run");
  await team.run(task.id);
  const actions = homeActions(team.snapshot(), undefined, task.id).map(a => a.id);
  assert.deepEqual(actions.slice(0, 3), ["result", "revise", "accept"]);
  const result = homeResultLines(team.snapshot().tasks[0]).join("\n");
  assert.match(result, /latest/);
  assert.doesNotMatch(result, /\x1b|\x07/);
  assert.ok(actions.includes("details"));
});
