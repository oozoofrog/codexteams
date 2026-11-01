import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { ProjectStore } from "../src/core/store.ts";

test("launcher drives real Pi planning and guarded worker execution against a local protocol fixture", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-launch-host-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project");
  const agentDir = join(root, "agent");
  mkdirSync(project); mkdirSync(agentDir);
  const requests: { messages: { role: string; content?: unknown }[]; model: string }[] = [];
  const errors: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.url, "/v1/chat/completions");
      let body = "";
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      requests.push(payload);
      const planning = payload.messages.some((message: { role: string; content?: unknown }) =>
        ["system", "developer"].includes(message.role) && JSON.stringify(message.content).includes("planning worker for codexteams"));
      const afterTool = payload.messages.some((message: { role: string }) => message.role === "tool");
      const plan = { tasks: [
        { id: "implement", title: "Implementation", description: "Write a local fixture proof", role: "developer", dependsOn: [], acceptance: ["Proof file exists"] },
        { id: "review", title: "Review", description: "Read the proof", role: "reviewer", dependsOn: ["implement"], acceptance: ["Review reports evidence"] },
      ] };
      const delta = planning ? { role: "assistant", content: JSON.stringify(plan) }
        : afterTool ? { role: "assistant", content: "Local protocol fixture completed its guarded Bash command." }
        : { role: "assistant", tool_calls: [{ index: 0, id: "local-proof-call", type: "function", function: {
          name: "bash", arguments: JSON.stringify({ command: "printf fixture-worked > launcher-proof.txt" }),
        } }] };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ id: "local-fixture", object: "chat.completion.chunk", created: 1,
        model: payload.model, choices: [{ index: 0, delta, finish_reason: planning || afterTool ? "stop" : "tool_calls" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      })}\n\ndata: [DONE]\n\n`);
    } catch (error) {
      errors.push(String(error));
      res.writeHead(500); res.end("Local fixture rejected the request.");
    }
  });
  await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { openai: {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "local-fixture-only",
    models: ["gpt-6.1-sol", "gpt-6.1-terra"].map(id => ({ id, name: "Local protocol fixture", reasoning: true,
      input: ["text"], contextWindow: 32000, maxTokens: 2048,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
  } } }));
  const env: NodeJS.ProcessEnv = { PI_CODING_AGENT_DIR: agentDir };
  for (const key of ["PATH", "Path", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SystemRoot"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const prefix = join(root, "npm-prefix");
  const packed = await promisify(execFile)("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", root], {
    cwd: resolve("."), env, encoding: "utf8", timeout: 30_000,
  });
  const tarball = join(root, JSON.parse(packed.stdout)[0].filename);
  await promisify(execFile)("npm", ["install", "-g", "--prefix", prefix, "--ignore-scripts", "--omit=dev", "--legacy-peer-deps", "--no-audit", "--no-fund", tarball], {
    cwd: project, env, encoding: "utf8", timeout: 30_000,
  });
  const installed = join(prefix, "lib", "node_modules", "codexteams");
  assert.equal(existsSync(join(installed, "bin", "codexteams.mjs")), true);
  assert.equal(existsSync(join(installed, "node_modules", "@earendil-works", "pi-coding-agent")), false);
  const launch = (goal?: string, input = "") => {
    const pending = promisify(execFile)(process.execPath, [join(prefix, "bin", "codexteams"), "--pi", resolve("node_modules/.bin/pi"), ...(goal ? [goal] : [])], {
      cwd: project, env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    pending.child.stdin?.end(input);
    return pending;
  };
  for (const goal of [undefined, "A goal with forbidden piped context"]) {
    await assert.rejects(launch(goal, "piped context"));
    assert.equal(requests.length, 0);
    assert.equal(existsSync(join(project, ".codexteams")), false);
  }
  const finalized = (stdout: string) => stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
    .filter(event => event.type === "message_end" && event.message?.customType === "codexteams")
    .map(event => event.message.content as string);
  const opened = await launch();
  assert.equal(finalized(opened.stdout).some(content => content.includes("/teams launch")), true);
  assert.equal(existsSync(join(project, ".codexteams")), false);
  assert.equal(requests.length, 0);
  const configured = ProjectStore.open(project);
  configured.update(state => { state.profiles.planner.model = "codexteams-nonexistent-fixture"; });
  configured.close();
  const failed = await launch("A missing model must be visible without starting a worker.");
  assert.equal(finalized(failed.stdout).some(content => content.includes("모델을 찾을 수 없습니다")), true);
  assert.equal(requests.length, 0);
  const restored = ProjectStore.open(project);
  assert.equal(restored.snapshot().planningAttempts.length, 0);
  restored.update(state => { state.profiles.planner.model = "gpt-6.1-sol"; });
  restored.close();
  const launched = await launch("Create the synthetic proof with a dependent review.");
  assert.equal(finalized(launched.stdout).some(content => content.includes("실행 1개")), true);
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 3);
  assert.equal(readFileSync(join(project, "launcher-proof.txt"), "utf8"), "fixture-worked");
  const state = JSON.parse(readFileSync(join(project, ".codexteams", "state.json"), "utf8"));
  assert.equal(state.planningAttempts.length, 1);
  assert.equal(state.planningAttempts[0].outcome, "success");
  assert.equal(state.tasks[0].status, "needs_review");
  assert.equal(state.tasks[0].attempts.length, 1);
  assert.equal(state.tasks[0].attempts[0].outcome, "success");
  assert.equal(state.tasks[1].status, "queued");
  assert.deepEqual(state.tasks[1].attempts, []);
  assert.equal(existsSync(join(project, ".codexteams", "lock.json")), false);
  const before = readFileSync(join(project, ".codexteams", "state.json"), "utf8");
  const reopened = await launch("A different goal must not overwrite the saved project.");
  assert.equal(finalized(reopened.stdout).some(content => content.includes("Create the synthetic proof")), true);
  assert.equal(requests.length, 3);
  assert.equal(readFileSync(join(project, ".codexteams", "state.json"), "utf8"), before);
});
