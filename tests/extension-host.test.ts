import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolvePiInvocation } from "../src/runtime/pi-runner.ts";

test("registered package handles real Pi commands and releases its project lock without model calls", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-host-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project");
  mkdirSync(project);
  // Isolate Pi settings and omit provider credentials from the child environment.
  const env: NodeJS.ProcessEnv = { PI_CODING_AGENT_DIR: join(root, "pi-agent") };
  for (const key of ["PATH", "Path", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SystemRoot"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const invocation = resolvePiInvocation();
  const run = (args: string[]) => {
    const pending = promisify(execFile)(invocation.command, [...invocation.args, ...args], {
      cwd: project, env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    pending.child.stdin?.end();
    return pending;
  };
  await run(["install", fileURLToPath(new URL("../", import.meta.url))]);
  const { stdout, stderr } = await run([
    "--mode", "json", "-p", "--no-session", "--no-skills", "--no-prompt-templates", "--no-mcp", "--",
    "/teams help", "/teams status", "/teams add designer Host integration fixture",
    "/teams profile designer openai/gpt-6.1-terra high", "/teams show task-1", "/teams status",
  ]);
  assert.equal(stderr, "");
  const events = stdout.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events.some(event => event.type === "agent_start"), false);
  const messages = events.filter(event => event.type === "message_end" && event.message?.customType === "codexteams");
  assert.equal(messages.length, 4);
  assert.match(messages[0].message.content, /teams start/);
  assert.match(messages[2].message.content, /Host integration fixture/);
  const state = JSON.parse(readFileSync(join(project, ".codexteams", "state.json"), "utf8"));
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].description, "Host integration fixture");
  assert.equal(state.tasks[0].status, "queued");
  assert.deepEqual(state.tasks[0].attempts, []);
  assert.equal(state.profiles.designer.effort, "high");
  assert.equal(existsSync(join(project, ".codexteams", "lock.json")), false);
});
