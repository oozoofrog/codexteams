import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { combineUsage, emptyUsage } from "../core/usage.ts";
import type { UsageSummary, WorkerEvent, WorkerInvocation, WorkerRequest, WorkerResult } from "../core/types.ts";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_PROGRESS_BYTES = 64 * 1024;
const MAX_EFFECTIVE_MODELS = 64;
const CLEANUP_GRACE_MS = 400;
const TRUNCATED = "[Earlier output truncated to bound retained memory.]\n";

type JsonObject = Record<string, unknown>;
type GuardActivation = { ownerFile: string; token: string };

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function usageFromMessage(value: unknown, stopReason: string): UsageSummary {
  const summary = emptyUsage();
  summary.responses = 1;
  const usage = object(value);
  if (!usage) return summary;
  for (const field of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"] as const) {
    summary[field] = finite(usage[field]);
  }
  summary.costUsd = finite(object(usage.cost)?.total);
  const base = [summary.input, summary.output, summary.cacheRead, summary.cacheWrite];
  if (summary.totalTokens === null && base.every((value) => value !== null)) {
    // Reasoning is already included in output. Cache categories are disjoint in Pi's Usage contract.
    summary.totalTokens = base.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  }
  const required = [...base, summary.totalTokens, summary.costUsd];
  if ((stopReason === "error" || stopReason === "aborted")
    && ![...required, summary.reasoning].some((value) => value !== null && value > 0)) {
    // Pi initializes these fields to zero before contacting the provider. On a failed stream,
    // zero alone cannot distinguish reported accounting from never-received accounting.
    return { ...emptyUsage(), responses: 1 };
  }
  if (required.every((value) => value !== null)) summary.completeness = "known";
  else if ([...required, summary.reasoning].some((value) => value !== null)) summary.completeness = "partial";
  return summary;
}

function tail(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  const bytes = Buffer.from(value);
  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}

class RetainedText {
  private value = "";
  private truncated = false;
  private readonly maxBytes: number;

  constructor(maxBytes: number) { this.maxBytes = maxBytes; }

  append(value: string): void {
    const combined = this.value + value;
    this.truncated ||= Buffer.byteLength(combined) > this.maxBytes;
    this.value = tail(combined, this.maxBytes);
  }

  text(): string { return (this.truncated ? TRUNCATED : "") + this.value; }
}

function installedBin(start: string): string | undefined {
  let directory = dirname(start);
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      if (pkg.name === PI_PACKAGE) {
        const relativeBin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.pi;
        if (typeof relativeBin !== "string") return undefined;
        const bin = realpathSync(resolve(directory, relativeBin));
        return statSync(bin).isFile() ? bin : undefined;
      }
    } catch { /* Continue up from the package's exported entrypoint. */ }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** Resolve an existing installation. Never downloads a CLI or interprets a shell command. */
export function resolvePiInvocation(): WorkerInvocation {
  if (process.env.CODEXTEAMS_PI !== undefined) {
    const selected = process.env.CODEXTEAMS_PI;
    if (!selected.trim()) throw new Error("CODEXTEAMS_PI must name a Pi executable.");
    return { command: selected, args: [] };
  }
  for (const specifier of [`${PI_PACKAGE}/package.json`, PI_PACKAGE]) {
    try {
      const bin = installedBin(fileURLToPath(import.meta.resolve(specifier)));
      if (bin) return { command: process.execPath, args: [bin] };
    } catch { /* Pi 1.4 does not export package.json; its main export is sufficient. */ }
  }
  if (process.argv[1]) {
    try {
      const current = realpathSync(process.argv[1]);
      const bin = installedBin(current);
      if (bin === current) return { command: process.execPath, args: [current] };
    } catch { /* The current process is not a resolvable Pi script. */ }
  }
  if (/^pi(?:\.exe)?$/i.test(basename(process.execPath))) {
    return { command: process.execPath, args: [] };
  }
  throw new Error(`Cannot locate an installed ${PI_PACKAGE} CLI. Install Pi before starting a worker.`);
}

function initialResult(request: WorkerRequest): WorkerResult {
  return {
    outcome: "failed", text: "", exitCode: null, usage: emptyUsage(), effectiveModels: [], sessionId: request.sessionId,
  };
}

/** Execute one Pi JSON-mode request and retain only public text and canonical assistant usage. */
export async function runPiWorker(request: WorkerRequest): Promise<WorkerResult> {
  if (request.signal?.aborted) return { ...initialResult(request), outcome: "aborted", error: "Worker cancelled before launch." };
  let promptDirectory: string | undefined;
  try {
    const invocation = request.invocation ?? resolvePiInvocation();
    // Pi accepts either literal text or a filename here. A private file avoids path/text ambiguity.
    promptDirectory = await mkdtemp(join(tmpdir(), "codexteams-worker-"));
    const systemPromptFile = join(promptDirectory, "system-prompt.txt");
    await writeFile(systemPromptFile, request.systemPrompt, { mode: 0o600 });
    let guard: GuardActivation | undefined;
    if (request.tools.includes("bash")) {
      guard = { ownerFile: join(promptDirectory, "worker-owner.json"), token: randomUUID() };
      await writeFile(guard.ownerFile, JSON.stringify({
        schemaVersion: 1, parentPid: process.pid, token: guard.token, detached: true,
      }), { mode: 0o600 });
    }
    if (request.signal?.aborted) return { ...initialResult(request), outcome: "aborted", error: "Worker cancelled before launch." };
    return await collectWorker(request, invocation, systemPromptFile, guard);
  } catch (error) {
    return {
      ...initialResult(request), outcome: request.signal?.aborted ? "aborted" : "failed",
      error: tail(error instanceof Error ? error.message : String(error), MAX_STDERR_BYTES),
    };
  } finally {
    if (promptDirectory) await rm(promptDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

function collectWorker(request: WorkerRequest, invocation: WorkerInvocation, systemPromptFile: string, guard?: GuardActivation): Promise<WorkerResult> {
  return new Promise((resolveResult) => {
    const args = [
      ...invocation.args, "--mode", "json", "-p", "--session-id", request.sessionId,
      "--session-dir", request.sessionDir, "--model", `${request.profile.provider}/${request.profile.model}`,
      "--thinking", request.profile.effort, "--tools", request.tools.join(","),
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-mcp",
      ...(guard ? ["-e", fileURLToPath(new URL("./worker-guard.ts", import.meta.url))] : []),
      "--append-system-prompt", systemPromptFile, "--", request.prompt,
    ];
    const env: NodeJS.ProcessEnv = { ...process.env, CODEXTEAMS_WORKER: "1" };
    delete env.CODEXTEAMS_WORKER_OWNER_FILE;
    delete env.CODEXTEAMS_WORKER_TOKEN;
    if (guard) {
      env.CODEXTEAMS_WORKER_OWNER_FILE = guard.ownerFile;
      env.CODEXTEAMS_WORKER_TOKEN = guard.token;
    }
    const child = spawn(invocation.command, args, {
      cwd: request.cwd, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      env, windowsHide: true,
    });
    const stdoutDecoder = new TextDecoder("utf-8", { fatal: true });
    const stderrDecoder = new TextDecoder("utf-8");
    const stderr = new RetainedText(MAX_STDERR_BYTES);
    const progress = new RetainedText(MAX_TEXT_BYTES);
    const models = new Set<string>();
    let usage: UsageSummary | undefined;
    let lineBuffer = "";
    let lineNumber = 0;
    let stdoutEnded = false;
    let failure: string | undefined;
    let eventHandlerFailed = false;
    let lastAssistant: { text: string; stopReason: string; error?: string } | undefined;
    let assistantPending = false;
    let settled = false;
    let settledAborted = false;
    let cancelled = false;
    let closed = false;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let cleanupStarted = false;
    let cleanupDone = false;
    let cleanupTimer: NodeJS.Timeout | undefined;

    function emit(event: WorkerEvent): void {
      try { request.onEvent?.(event); }
      catch (error) {
        eventHandlerFailed = true;
        failure ??= `Worker event handler failed: ${tail(error instanceof Error ? error.message : String(error), MAX_STDERR_BYTES)}`;
        beginCleanup();
      }
    }

    function groupExists(): boolean {
      if (!child.pid) return false;
      if (process.platform === "win32") return !exited;
      try { process.kill(-child.pid, 0); return true; }
      catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
    }

    function signalGroup(signal: NodeJS.Signals): void {
      if (!child.pid) return;
      if (process.platform !== "win32") {
        try { process.kill(-child.pid, signal); return; }
        catch { /* A spawn failure or a vanished group can require the direct fallback. */ }
      }
      if (!exited) { try { child.kill(signal); } catch {} }
    }

    function beginCleanup(): void {
      if (cleanupStarted) return;
      cleanupStarted = true;
      signalGroup("SIGTERM");
      if (!groupExists()) {
        cleanupDone = true;
        finish();
        return;
      }
      cleanupTimer = setTimeout(() => {
        signalGroup("SIGKILL");
        // Allow signal delivery before resolving even when descendants closed their inherited pipes.
        cleanupTimer = setTimeout(() => { cleanupDone = true; finish(); }, 25);
      }, CLEANUP_GRACE_MS);
    }

    function failProtocol(message: string): void {
      failure ??= `Pi JSON protocol error at record ${lineNumber + 1}: ${message}`;
      lineBuffer = "";
      beginCleanup();
    }

    function readRecord(line: string): void {
      if (Buffer.byteLength(line) > MAX_RECORD_BYTES) throw new Error("JSON record exceeds the retained-memory limit.");
      const event = object(JSON.parse(line));
      if (!event || typeof event.type !== "string") throw new Error("Expected a JSON event object with a type.");
      if (event.type === "message_start") {
        if (object(event.message)?.role === "assistant") assistantPending = true;
      } else if (event.type === "message_update") {
        assistantPending = true;
        const update = object(event.assistantMessageEvent);
        if (!update || typeof update.type !== "string") throw new Error("Malformed assistant update.");
        if (update.type === "text_delta") {
          if (typeof update.delta !== "string") throw new Error("Malformed public text delta.");
          progress.append(update.delta);
          emit({ type: "text", text: tail(update.delta, MAX_PROGRESS_BYTES) });
        }
        // Streaming usage is a cumulative snapshot. Thinking and tool arguments are never logged.
      } else if (event.type === "message_end") {
        const message = object(event.message);
        if (!message || typeof message.role !== "string") throw new Error("Malformed finalized message.");
        // Nested tool-result usage is deliberately excluded from this accounting scope.
        if (message.role !== "assistant") return;
        if (!Array.isArray(message.content) || typeof message.stopReason !== "string") throw new Error("Malformed finalized assistant.");
        assistantPending = false;
        const text = new RetainedText(MAX_TEXT_BYTES);
        for (const raw of message.content) {
          const content = object(raw);
          if (content?.type === "text") {
            if (typeof content.text !== "string") throw new Error("Malformed assistant text content.");
            text.append(content.text);
          }
        }
        lastAssistant = {
          text: text.text(), stopReason: message.stopReason,
          ...(typeof message.errorMessage === "string" && message.errorMessage.length > 0
            ? { error: tail(message.errorMessage, MAX_STDERR_BYTES) } : {}),
        };
        const finalized = usageFromMessage(message.usage, message.stopReason);
        usage = usage ? combineUsage([usage, finalized]) : finalized;
        const model = typeof message.model === "string"
          ? (typeof message.provider === "string" ? `${message.provider}/${message.model}` : message.model) : undefined;
        if (model && models.size < MAX_EFFECTIVE_MODELS) models.add(tail(model, 1024));
        emit({ type: "usage", usage: { ...usage }, ...(model ? { model: tail(model, 1024) } : {}) });
      } else if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
        if (typeof event.toolName !== "string") throw new Error("Malformed tool event.");
        emit({ type: "tool", name: tail(event.toolName, 1024), phase: event.type === "tool_execution_start" ? "start" : "end",
          ...(event.type === "tool_execution_end" && typeof event.isError === "boolean" ? { isError: event.isError } : {}) });
      } else if (event.type === "agent_settled") {
        if (typeof event.aborted !== "boolean") throw new Error("Malformed agent_settled event.");
        settled = true;
        settledAborted = event.aborted;
      } else if (event.type === "agent_start") {
        settled = false;
      }
    }

    function readStdout(chunk: Uint8Array): void {
      if (failure) return;
      try {
        lineBuffer += stdoutDecoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = lineBuffer.indexOf("\n")) !== -1) {
          const line = lineBuffer.slice(0, newline).replace(/\r$/, "");
          lineBuffer = lineBuffer.slice(newline + 1);
          readRecord(line);
          lineNumber++;
          if (failure) { lineBuffer = ""; return; }
        }
        if (Buffer.byteLength(lineBuffer) > MAX_RECORD_BYTES) throw new Error("JSON record exceeds the retained-memory limit.");
      } catch (error) {
        // Parse errors deliberately omit the raw record; it may contain private thinking.
        const message = error instanceof SyntaxError ? "Malformed JSON record." : error instanceof TypeError
          ? "Invalid UTF-8 encoding." : error instanceof Error ? error.message : "Invalid event.";
        failProtocol(message);
      }
    }

    function endStdout(): void {
      if (stdoutEnded) return;
      stdoutEnded = true;
      if (failure) return;
      try { lineBuffer += stdoutDecoder.decode(); }
      catch { failProtocol("Truncated or invalid UTF-8 encoding."); return; }
      if (lineBuffer.length > 0) failProtocol("Truncated JSONL record: final newline is missing.");
    }

    function finish(): void {
      if (!closed || !cleanupDone) return;
      if (cleanupTimer) clearTimeout(cleanupTimer);
      request.signal?.removeEventListener("abort", abort);
      let outcome: WorkerResult["outcome"] = "failed";
      let error = failure;
      if (eventHandlerFailed) {
        // Durable ownership/logging failures must remain failures, including during cancellation.
      } else if (cancelled || settledAborted || lastAssistant?.stopReason === "aborted") {
        outcome = "aborted";
        error ??= lastAssistant?.error ?? "Worker cancelled.";
      } else if (error) {
        // Keep the earlier, more specific launch or protocol failure.
      } else if (exitSignal) {
        error = `Pi worker terminated by ${exitSignal}.`;
      } else if (exitCode !== 0) {
        error = `Pi worker exited with code ${exitCode ?? "unknown"}.`;
      } else if (!lastAssistant || assistantPending) {
        error = "Pi worker ended without a finalized assistant response.";
      } else if (lastAssistant.stopReason === "error" || lastAssistant.error) {
        error = lastAssistant.error ?? "Pi model request failed.";
      } else if (lastAssistant.stopReason === "length") {
        error = "Pi response was truncated at the model's output token limit.";
      } else if (lastAssistant.stopReason !== "stop") {
        error = `Pi worker ended with incomplete assistant stop reason: ${lastAssistant.stopReason}.`;
      } else if (!settled) {
        error = "Pi worker ended without an agent_settled completion event.";
      } else {
        outcome = "success";
      }
      const diagnostic = stderr.text().trim();
      if (outcome !== "success" && diagnostic) error = `${error ?? "Pi worker failed."}\n${diagnostic}`;
      resolveResult({
        outcome, text: lastAssistant?.text ?? progress.text(), ...(error ? { error } : {}), exitCode,
        usage: usage && assistantPending ? combineUsage([usage, emptyUsage()]) : usage ?? emptyUsage(),
        effectiveModels: [...models], sessionId: request.sessionId,
      });
    }

    function abort(): void {
      cancelled = true;
      beginCleanup();
    }

    child.stdout.on("data", readStdout);
    child.stdout.once("end", endStdout);
    child.stderr.on("data", (chunk: Uint8Array) => stderr.append(stderrDecoder.decode(chunk, { stream: true })));
    child.stderr.once("end", () => stderr.append(stderrDecoder.decode()));
    child.once("error", (error) => { failure ??= `Failed to launch Pi worker: ${error.message}`; beginCleanup(); });
    child.once("exit", () => {
      exited = true;
      // A successful worker may leave tool descendants holding the pipes open.
      beginCleanup();
    });
    child.once("close", (code, signal) => {
      closed = true;
      exitCode = child.pid ? code : null;
      exitSignal = signal;
      endStdout();
      beginCleanup();
      finish();
    });
    // Publish the PID in the spawn turn so crash recovery can persist ownership promptly.
    if (child.pid) emit({ type: "process", pid: child.pid });
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) abort();
  });
}
