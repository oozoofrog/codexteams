import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { resolvePiInvocation } from "../src/runtime/pi-runner.ts";

const launcher = fileURLToPath(new URL("../bin/codexteams.mjs", import.meta.url));
const extension = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const exec = promisify(execFile);
function project(t: { after: (fn: () => void | Promise<void>) => void }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-handoff-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function request(root: string) {
  return { schemaVersion: 1, requestId: "packet-1", projectRoot: root,
    source: { kind: "codex", checkpoint: "stopped", stopped: true }, goal: "Goal", task: { title: "Task", description: "Do work", role: "developer", acceptance: ["Work is done"] },
    context: { summary: "Context", completed: [], constraints: [], files: [], evidence: [] } };
}

test("handoff protocol normalizes object keys without losing text and rejects policy injection", async t => {
  const root = project(t);
  const modulePath = "../src/core/handoff.mjs";
  const protocol = await import(modulePath);
  const original = request(root);
  const reordered = { ...original, task: { acceptance: original.task.acceptance, role: "developer", description: "Do work", title: "Task" } };
  assert.equal(protocol.requestDigest(protocol.normalizeRequest(original, root)), protocol.requestDigest(protocol.normalizeRequest(reordered, root)));
  assert.notEqual(protocol.requestDigest(protocol.normalizeRequest(original, root)), protocol.requestDigest(protocol.normalizeRequest({ ...original, goal: " Goal" }, root)));
  assert.throws(() => protocol.normalizeRequest({ ...original, model: "other" }, root));
});

test("handoff reserves exactly one task and duplicate submission never runs again", async t => {
  const root = project(t);
  const store = ProjectStore.open(root);
  let calls = 0;
  const controller = new TeamController(store, { validateProfile: async () => {}, runner: async r => {
    calls++;
    return { outcome: "success", text: "done", exitCode: 0, usage: { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, totalTokens: null, costUsd: null, responses: 0, completeness: "unknown" }, effectiveModels: [], sessionId: r.sessionId };
  } });
  t.after(() => controller.shutdown());
  const submit = (controller as unknown as { handoff: (value: unknown) => Promise<unknown> }).handoff;
  assert.equal(typeof submit, "function");
  await submit.call(controller, request(root));
  await submit.call(controller, request(root));
  assert.equal(calls, 1);
  assert.equal(controller.snapshot().tasks.length, 1);
  assert.equal(controller.snapshot().tasks[0].status, "needs_review");
});

test("CLI handoff-result returns not_found without creating a project", async t => {
  const root = project(t);
  const pending = exec(process.execPath, [launcher, "--handoff-result", "packet-1"], { cwd: root, timeout: 10000, env: { ...process.env, CODEXTEAMS_WORKER: "" } });
  pending.child.stdin?.end();
  const { stdout } = await pending;
  const result = JSON.parse(stdout);
  assert.equal(result.kind, "codexteams.handoff.result");
  assert.equal(result.status, "not_found");
  assert.equal(existsSync(join(root, ".codexteams")), false);
});

test("real Pi host emits structured not_found for read-only handoff lookup", async t => {
  const root = project(t);
  const invocation = resolvePiInvocation();
  const env: NodeJS.ProcessEnv = { PI_CODING_AGENT_DIR: join(root, "pi-agent") };
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG"]) if (process.env[key] !== undefined) env[key] = process.env[key];
  const pending = exec(invocation.command, [...invocation.args, "--mode", "json", "-p", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-mcp", "-e", extension, "--", "/teams handoff-result packet-1"], { cwd: root, env, timeout: 30000, maxBuffer: 1024 * 1024 });
  pending.child.stdin?.end();
  const { stdout } = await pending;
  const events = stdout.trim().split("\n").map(line => JSON.parse(line));
  const messages = events.filter(event => event.type === "message_end" && event.message?.customType === "codexteams.handoff.result");
  assert.equal(messages.length, 1);
  const result = typeof messages[0].message.content === "string" ? JSON.parse(messages[0].message.content) : messages[0].message.content;
  assert.equal(result.status, "not_found");
  assert.equal(existsSync(join(root, ".codexteams")), false);
});
