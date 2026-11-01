import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, open, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runPiWorker, resolvePiInvocation } from "../src/runtime/pi-runner.ts";
import type { WorkerEvent, WorkerRequest } from "../src/core/types.ts";

const fixture = fileURLToPath(new URL("./fixtures/pi-worker.mjs", import.meta.url));
const bashFixture = fileURLToPath(new URL("./fixtures/pi-bash-worker.mjs", import.meta.url));
async function request(t: TestContext, mode: string, overrides: Partial<WorkerRequest> = {}): Promise<WorkerRequest> {
  const cwd = await mkdtemp(join(tmpdir(), "codexteams-runner-test-"));
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  return {
    cwd, prompt: "--do not execute $(touch shell-injection); 🔧", systemPrompt: "Worker rules\nRead carefully.",
    profile: { provider: "fixture", model: "test-model", effort: "high" },
    tools: ["read", "bash"], sessionId: "9b949f6a-cf37-4c39-8697-a4c7f46819a1", sessionDir: join(cwd, "sessions"),
    invocation: { command: process.execPath, args: [fixture, mode] }, ...overrides,
  };
}

test("worker invocation keeps cwd, literal prompt, explicit routing, session, and tool permissions", async (t) => {
  const req = await request(t, "arguments");
  const result = await runPiWorker(req);
  assert.equal(result.outcome, "success");
  const captured = JSON.parse(result.text);
  assert.equal(captured.cwd, await realpath(req.cwd));
  assert.equal(captured.systemPrompt, req.systemPrompt);
  const args: string[] = captured.args;
  for (const [flag, value] of [["--mode", "json"], ["--model", "fixture/test-model"], ["--thinking", "high"],
    ["--tools", "read,bash"], ["--session-id", req.sessionId], ["--session-dir", req.sessionDir]]) {
    assert.equal(args[args.indexOf(flag) + 1], value);
  }
  for (const flag of ["-p", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-mcp"]) {
    assert.ok(args.includes(flag), flag);
  }
  assert.deepEqual(args.slice(-2), ["--", req.prompt]);
  assert.equal(result.sessionId, req.sessionId);
});

test("only Bash workers load the private guard while discovered extensions stay disabled", async (t) => {
  const bash = await runPiWorker(await request(t, "arguments", { tools: ["read", "bash"] }));
  const bashArguments = JSON.parse(bash.text);
  assert.equal(bashArguments.worker, "1");
  assert.ok(bashArguments.args.includes("--no-extensions"));
  const extension = bashArguments.args.indexOf("-e");
  assert.ok(extension >= 0);
  assert.match(bashArguments.args[extension + 1], /worker-guard\.ts$/);
  const readonly = await runPiWorker(await request(t, "arguments", { tools: ["read", "grep", "find", "ls"] }));
  const readonlyArguments = JSON.parse(readonly.text);
  assert.ok(readonlyArguments.args.includes("--no-extensions"));
  assert.equal(readonlyArguments.args.includes("-e"), false);
  assert.equal(readonlyArguments.args[readonlyArguments.args.indexOf("--tools") + 1], "read,grep,find,ls");
});

test("streaming handles split UTF-8 and CRLF without splitting Unicode line separators", async (t) => {
  const events: WorkerEvent[] = [];
  const result = await runPiWorker(await request(t, "success", { onEvent: (event) => events.push(event) }));
  assert.equal(result.outcome, "success");
  assert.equal(result.text, "Finished 🔧\u2028line");
  assert.deepEqual(events.filter((event) => event.type === "text"), [{ type: "text", text: "Working 🔧\u2028line" }]);
  assert.deepEqual(events.filter((event) => event.type === "tool"), [
    { type: "tool", name: "read", phase: "start" },
    { type: "tool", name: "read", phase: "end", isError: false },
  ]);
  assert.ok(!JSON.stringify({ events, result }).includes("PRIVATE THINKING"));
  assert.deepEqual(result.usage, {
    input: 10, output: 8, cacheRead: 3, cacheWrite: 2, reasoning: 4,
    totalTokens: 23, costUsd: 0.012, responses: 1, completeness: "known",
  });
  assert.equal(events.filter((event) => event.type === "usage").length, 1);
  assert.deepEqual(result.effectiveModels, ["fixture/test-model"]);
});

test("only finalized own assistant responses add usage, and the final response supplies result text", async (t) => {
  const result = await runPiWorker(await request(t, "multiple"));
  assert.equal(result.outcome, "success");
  assert.equal(result.text, "Final response");
  assert.equal(result.usage.responses, 2);
  assert.equal(result.usage.totalTokens, 46);
  assert.equal(result.usage.reasoning, 4);
  assert.equal(result.usage.costUsd, 0.024);
  assert.deepEqual(result.effectiveModels, ["fixture/test-model", "fixture/second-model"]);
});

test("a successfully retried response is judged by the final settled assistant", async (t) => {
  const result = await runPiWorker(await request(t, "retry"));
  assert.equal(result.outcome, "success");
  assert.equal(result.usage.responses, 2);
});

for (const [mode, pattern] of [
  ["error", /Provider rejected/], ["length", /truncat|token limit/i],
  ["missing-assistant", /assistant/i], ["missing-settled", /settled|completion/i],
  ["missing-latest-assistant", /assistant|incomplete/i],
  ["malformed", /JSON|protocol/i], ["truncated", /truncat|newline|unterminated/i],
  ["invalid-utf8", /UTF|encoding|protocol/i],
] as const) {
  test(`exit 0 is a failure for ${mode}`, async (t) => {
    const result = await runPiWorker(await request(t, mode));
    assert.equal(result.outcome, "failed");
    assert.match(result.error ?? "", pattern);
    assert.ok(!JSON.stringify(result).includes("PRIVATE THINKING"));
  });
}

test("agent cancellation remains aborted even if the CLI exits zero", async (t) => {
  const result = await runPiWorker(await request(t, "aborted"));
  assert.equal(result.outcome, "aborted");
  assert.equal(result.exitCode, 0);
});

test("missing usage stays unknown while a response still counts as one response", async (t) => {
  const result = await runPiWorker(await request(t, "missing-usage"));
  assert.equal(result.outcome, "success");
  assert.equal(result.usage.completeness, "unknown");
  assert.equal(result.usage.responses, 1);
  assert.equal(result.usage.totalTokens, null);
  assert.equal(result.usage.costUsd, null);
});

for (const mode of ["zero-error", "zero-aborted"] as const) {
  test(`${mode} does not mistake Pi's initialized zero usage for reported provider accounting`, async (t) => {
    const result = await runPiWorker(await request(t, mode));
    assert.equal(result.outcome, mode === "zero-error" ? "failed" : "aborted");
    assert.equal(result.usage.responses, 1);
    assert.equal(result.usage.completeness, "unknown");
    assert.equal(result.usage.totalTokens, null);
    assert.equal(result.usage.costUsd, null);
  });
}

test("a successful retry after unreported failure keeps the known usage subtotal partial", async (t) => {
  const result = await runPiWorker(await request(t, "zero-error-retry"));
  assert.equal(result.outcome, "success");
  assert.equal(result.usage.responses, 2);
  assert.equal(result.usage.completeness, "partial");
  assert.equal(result.usage.totalTokens, 23);
  assert.equal(result.usage.costUsd, 0.012);
});

test("incomplete usage preserves reported values and marks its estimate partial", async (t) => {
  const result = await runPiWorker(await request(t, "partial-usage"));
  assert.equal(result.usage.input, 10);
  assert.equal(result.usage.output, 8);
  assert.equal(result.usage.totalTokens, null);
  assert.equal(result.usage.costUsd, null);
  assert.equal(result.usage.completeness, "partial");
});

test("an unfinished subsequent response makes earlier known usage a partial subtotal", async (t) => {
  const result = await runPiWorker(await request(t, "unfinished-response"));
  assert.equal(result.outcome, "failed");
  assert.equal(result.usage.input, 10);
  assert.equal(result.usage.totalTokens, 23);
  assert.equal(result.usage.responses, 1);
  assert.equal(result.usage.completeness, "partial");
});

test("a derived token total excludes reasoning already included in output", async (t) => {
  const result = await runPiWorker(await request(t, "derived-total"));
  assert.equal(result.usage.totalTokens, 23);
});

test("a nonzero worker exit reports stderr even after a valid final message", async (t) => {
  const result = await runPiWorker(await request(t, "nonzero"));
  assert.equal(result.outcome, "failed");
  assert.equal(result.exitCode, 7);
  assert.match(result.error ?? "", /fixture execution failed/);
});

test("launch failures return a failed worker result with unknown usage", async (t) => {
  const req = await request(t, "success", { invocation: { command: "/nonexistent/codexteams-worker", args: [] } });
  const result = await runPiWorker(req);
  assert.equal(result.outcome, "failed");
  assert.equal(result.usage.completeness, "unknown");
  assert.equal(result.exitCode, null);
  assert.match(result.error ?? "", /ENOENT|spawn|launch/i);
});

test("pre-aborted requests never launch a process", async (t) => {
  const controller = new AbortController();
  controller.abort();
  const events: WorkerEvent[] = [];
  const result = await runPiWorker(await request(t, "success", {
    signal: controller.signal, onEvent: (event) => events.push(event),
  }));
  assert.equal(result.outcome, "aborted");
  assert.equal(result.exitCode, null);
  assert.deepEqual(events, []);
});

async function isRunning(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
  try {
    const { stdout } = await promisify(execFile)("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
    const state = stdout.trim();
    return state.length > 0 && !state.startsWith("Z");
  } catch (error) {
    // Some execution hosts virtualize process IDs but do not provide a matching /proc/ps view.
    // A failed ps query cannot override the successful process-existence probe above.
    if ((error as { code?: unknown }).code === 1) return true;
    throw error;
  }
}

async function bashRequest(t: TestContext, mode: string, overrides: Partial<WorkerRequest> = {}): Promise<WorkerRequest> {
  let req: WorkerRequest | undefined;
  let workerPid = 0;
  t.after(async () => {
    const groups = new Set<number>([workerPid]);
    if (req) {
      try { groups.add(Number((await readFile(join(req.cwd, "background.pgid"), "utf8")).trim())); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      try {
        const pid = Number((await readFile(join(req.cwd, "background.pid"), "utf8")).trim());
        if (pid > 0 && pid !== process.pid) { try { process.kill(pid, "SIGKILL"); } catch {} }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    for (const pid of groups) {
      if (pid > 0 && pid !== process.pid) { try { process.kill(-pid, "SIGKILL"); } catch {} }
    }
  });
  req = await request(t, mode, { tools: ["bash"], invocation: { command: process.execPath, args: [bashFixture, mode] }, ...overrides });
  const onEvent = req.onEvent;
  return { ...req, onEvent: (event) => {
    if (event.type === "process") workerPid = event.pid;
    onEvent?.(event);
  } };
}

for (const mode of ["background", "inherited-background"] as const) {
  test(`real Pi Bash ${mode} descendants cannot survive successful worker completion`, { skip: process.platform === "win32", timeout: 5_000 }, async (t) => {
    const req = await bashRequest(t, mode);
    const result = await runPiWorker(req);
    assert.equal(result.outcome, "success", result.error);
    assert.match(JSON.parse(result.text).structuredContent.output, /foreground complete/);
    const pid = Number(await readFile(join(req.cwd, "background.pid"), "utf8"));
    assert.ok(pid > 0);
    assert.equal(await isRunning(pid), false, "ordinary Bash background process must not outlive its worker");
  });
}

test("guarded Pi Bash retains cwd, configured prefix, environment, stderr and native result shape", { skip: process.platform === "win32" }, async (t) => {
  const req = await bashRequest(t, "shape");
  const result = await runPiWorker(req);
  assert.equal(result.outcome, "success", result.error);
  const toolResult = JSON.parse(result.text);
  assert.equal(toolResult.isError, true);
  assert.equal(toolResult.structuredContent.exit_code, 7);
  assert.match(toolResult.structuredContent.output, /preserved environment/);
  assert.ok(toolResult.structuredContent.output.includes(req.cwd));
  assert.match(toolResult.structuredContent.output, /stderr preserved/);
  assert.ok(toolResult.content[0].text.includes("Command exited with code 7"));
});

for (const mode of ["abort", "timeout"] as const) {
  test(`guarded Bash ${mode} terminates the complete attempt before the model can continue`, { skip: process.platform === "win32", timeout: 5_000 }, async (t) => {
    const req = await bashRequest(t, mode);
    const result = await runPiWorker(req);
    assert.equal(result.outcome, "failed");
    const pid = Number(await readFile(join(req.cwd, "background.pid"), "utf8"));
    assert.equal(await isRunning(pid), false);
    await assert.rejects(readFile(join(req.cwd, "continued-after-stop")), { code: "ENOENT" });
  });
}

test("external worker cancellation also cleans a running native-shaped Bash command", { skip: process.platform === "win32", timeout: 5_000 }, async (t) => {
  const controller = new AbortController();
  const req = await bashRequest(t, "external-abort", { signal: controller.signal, onEvent: (event) => {
    if (event.type === "tool" && event.name === "fixture-bash-ready") controller.abort();
  } });
  const result = await runPiWorker(req);
  assert.equal(result.outcome, "aborted");
  const pid = Number(await readFile(join(req.cwd, "background.pid"), "utf8"));
  assert.equal(await isRunning(pid), false);
});

test("the private guard rejects inherited or forged ownership before executing Bash", { skip: process.platform === "win32", timeout: 5_000 }, async (t) => {
  const req = await bashRequest(t, "invalid-owner");
  const result = await runPiWorker(req);
  assert.equal(result.outcome, "failed");
  assert.match(result.error ?? "", /owner|guard/i);
  await assert.rejects(readFile(join(req.cwd, "background.pid")), { code: "ENOENT" });
});

test("Pi's real resource loader loads only the explicit worker guard with discovery disabled", { skip: process.platform === "win32", timeout: 10_000 }, async (t) => {
  const result = await runPiWorker(await bashRequest(t, "real-loader"));
  assert.equal(result.outcome, "success", result.error);
  const loaded = JSON.parse(result.text);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  assert.match(loaded.extensions[0].path, /worker-guard\.ts$/);
  assert.deepEqual(loaded.extensions[0].tools, ["bash"]);
});

test("a process ownership persistence failure terminates the child and returns a failure", { timeout: 5_000 }, async (t) => {
  let pid = 0;
  const result = await runPiWorker(await request(t, "success", {
    onEvent: (event) => {
      if (event.type === "process") {
        pid = event.pid;
        throw new Error("fixture ownership write failed");
      }
    },
  }));
  assert.equal(result.outcome, "failed");
  assert.match(result.error ?? "", /ownership write failed/);
  assert.ok(pid > 0);
  assert.equal(await isRunning(pid), false);
});

test("a usage persistence error remains failed even when the provider response was aborted", async (t) => {
  const result = await runPiWorker(await request(t, "aborted", {
    onEvent: (event) => {
      if (event.type === "usage") throw new Error("fixture usage write failed");
    },
  }));
  assert.equal(result.outcome, "failed");
  assert.match(result.error ?? "", /usage write failed/);
});

for (const mode of ["abort-tree", "normal-tree"] as const) {
  test(`${mode} waits for child exit and cleans surviving descendants`, { skip: process.platform === "win32", timeout: 5_000 }, async (t) => {
    const controller = new AbortController();
    let workerPid = 0;
    const req = await request(t, mode, {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "process") workerPid = event.pid;
        if (event.type === "tool" && event.name === "fixture-ready" && mode === "abort-tree") controller.abort();
      },
    });
    t.after(async () => {
      if (workerPid) { try { process.kill(-workerPid, "SIGKILL"); } catch {} }
    });
    const result = await runPiWorker(req);
    assert.equal(result.outcome, mode === "abort-tree" ? "aborted" : "success");
    assert.ok(workerPid > 0);
    const descendantPid = Number(await readFile(join(req.cwd, "child.pid"), "utf8"));
    assert.equal(await isRunning(workerPid), false, "worker must actually have exited before resolution");
    assert.equal(await isRunning(descendantPid), false, "descendant must not survive cleanup");
  });
}

test("retained final output is bounded and explicitly marked without limiting worker execution", async (t) => {
  const result = await runPiWorker(await request(t, "large"));
  assert.equal(result.outcome, "success");
  assert.ok(Buffer.byteLength(result.text) <= 1024 * 1024 + 200);
  assert.match(result.text, /truncat/i);
  assert.ok(result.text.endsWith("END OF RESPONSE"));
});

test("an unterminated overlarge JSON record fails before memory can grow without bound", async (t) => {
  const result = await runPiWorker(await request(t, "oversized-record"));
  assert.equal(result.outcome, "failed");
  assert.match(result.error ?? "", /record|limit|large/i);
});

test("installed Pi invocation uses its actual declared CLI entrypoint without npm downloads", async (t) => {
  const invocation = resolvePiInvocation();
  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.args.length, 1);
  assert.match(invocation.args[0], /pi-coding-agent.*dist\/bundle\/cli\.js$/);
  const cwd = (await request(t, "success")).cwd;
  const outputPath = join(cwd, "pi-version.txt");
  const output = await open(outputPath, "w");
  const child = spawn(invocation.command, [...invocation.args, "--version"], { stdio: ["ignore", output.fd, "ignore"] });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  await output.close();
  assert.equal(code, 0);
  const version = (await readFile(outputPath, "utf8")).trim();
  assert.equal(version, "1.4.0");
});
