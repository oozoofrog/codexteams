import { execFile, spawn } from "node:child_process";
import { constants, writeSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { dirname, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { getShellConfig, type BashOperations } from "@earendil-works/pi-coding-agent";

const EXIT_DRAIN_MS = 100;
const MAX_TIMEOUT_MS = 2_147_483_647;

interface WorkerOwnership {
  readonly pid: number;
  readonly parentPid: number;
}

/** Refuse activation unless this process is the runner's private POSIX group leader. */
export async function verifyWorkerOwnership(): Promise<WorkerOwnership> {
  if (process.platform === "win32") throw new Error("The codexteams Bash guard requires POSIX process groups.");
  const ownerPath = process.env.CODEXTEAMS_WORKER_OWNER_FILE;
  const token = process.env.CODEXTEAMS_WORKER_TOKEN;
  if (process.env.CODEXTEAMS_WORKER !== "1" || !ownerPath || !isAbsolute(ownerPath) || !token) {
    throw new Error("The codexteams Bash guard requires a verified worker owner.");
  }
  const directory = await lstat(dirname(ownerPath));
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0 || directory.uid !== process.getuid!()) {
    throw new Error("The codexteams worker ownership directory is not private.");
  }
  const file = await open(ownerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let owner: { schemaVersion?: unknown; parentPid?: unknown; token?: unknown; detached?: unknown };
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > 4096 || (metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid!()) {
      throw new Error("The codexteams worker ownership record is not private.");
    }
    owner = JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
  if (owner?.schemaVersion !== 1 || owner.detached !== true || owner.token !== token
    || owner.parentPid !== process.ppid || !Number.isSafeInteger(owner.parentPid) || process.ppid <= 1) {
    throw new Error("The codexteams Bash guard could not verify its worker owner.");
  }
  process.kill(process.ppid, 0);
  const { stdout } = await promisify(execFile)("/bin/ps", ["-o", "pgid=", "-p", String(process.pid)], {
    timeout: 2_000, maxBuffer: 1024, encoding: "utf8", windowsHide: true,
  });
  const group = stdout.trim();
  if (!/^\d+$/.test(group) || Number(group) !== process.pid) {
    throw new Error("The codexteams Bash guard must run inside its own verified process group.");
  }
  return Object.freeze({ pid: process.pid, parentPid: process.ppid });
}

function stopWorker(ownership: WorkerOwnership, reason: string): never {
  if (ownership.pid !== process.pid) throw new Error("Worker process identity changed; refusing group termination.");
  // These operations share the worker group. Stopping just the shell could leave a writer
  // alive while the model continued; abort/timeout therefore ends this entire attempt.
  try { writeSync(2, `codexteams Bash guard: ${reason}; terminating the worker attempt.\n`); } catch {}
  try { process.kill(-ownership.pid, "SIGKILL"); }
  finally { process.kill(process.pid, "SIGKILL"); }
  throw new Error(reason);
}

/** Keep ordinary shell descendants in the verified worker group; Pi retains its native tool UI/schema. */
export function createWorkerBashOperations(
  ownership: WorkerOwnership,
  shellPath: () => string | undefined = () => undefined,
): BashOperations {
  return {
    async exec(command, cwd, { onData, signal, timeout, env }) {
      if (ownership.pid !== process.pid || ownership.parentPid !== process.ppid) {
        throw new Error("The codexteams worker owner changed before Bash execution.");
      }
      let timeoutMs: number | undefined;
      if (timeout !== undefined) {
        timeoutMs = timeout * 1000;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
          throw new Error(`Invalid timeout: must be positive seconds no greater than ${MAX_TIMEOUT_MS / 1000}.`);
        }
      }
      if (signal?.aborted) stopWorker(ownership, "command aborted");
      const shell = getShellConfig(shellPath());
      const stdinCommand = shell.commandTransport === "stdin";
      const child = spawn(shell.shell, stdinCommand ? shell.args : [...shell.args, command], {
        cwd, env: env ?? process.env, detached: false,
        stdio: [stdinCommand ? "pipe" : "ignore", "pipe", "pipe"], windowsHide: true,
      });
      if (stdinCommand) {
        child.stdin?.on("error", () => {});
        child.stdin?.end(command);
      }
      return await new Promise<{ exitCode: number | null }>((resolve, reject) => {
        let finished = false;
        let exited = false;
        let exitCode: number | null = null;
        let stdoutEnded = false;
        let stderrEnded = false;
        let drainTimer: NodeJS.Timeout | undefined;
        let timeoutTimer: NodeJS.Timeout | undefined;

        const abort = () => stopWorker(ownership, "command aborted");
        const data = (chunk: Buffer) => {
          try { onData(chunk); }
          catch { stopWorker(ownership, "command output could not be recorded"); }
        };
        const cleanup = () => {
          if (drainTimer) clearTimeout(drainTimer);
          if (timeoutTimer) clearTimeout(timeoutTimer);
          signal?.removeEventListener("abort", abort);
          child.stdout?.removeListener("data", data);
          child.stderr?.removeListener("data", data);
          child.stdout?.destroy();
          child.stderr?.destroy();
        };
        const finish = (error?: Error) => {
          if (finished) return;
          finished = true;
          cleanup();
          if (error) reject(error);
          else resolve({ exitCode });
        };
        const streamsEnded = () => {
          if (exited && stdoutEnded && stderrEnded) finish();
        };
        child.stdout?.on("data", data);
        child.stderr?.on("data", data);
        child.stdout?.once("end", () => { stdoutEnded = true; streamsEnded(); });
        child.stderr?.once("end", () => { stderrEnded = true; streamsEnded(); });
        child.once("error", (error) => finish(error));
        child.once("exit", (code, terminationSignal) => {
          exited = true;
          exitCode = code ?? (terminationSignal ? 128 + (osConstants.signals[terminationSignal] ?? 0) : null);
          streamsEnded();
          // A background process can inherit pipes even after its shell exits. Bound only this
          // post-exit drain; the command itself has no default timeout. The runner owns the group.
          if (!finished) drainTimer = setTimeout(() => finish(), EXIT_DRAIN_MS);
        });
        child.once("close", () => finish());
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        if (timeoutMs !== undefined) timeoutTimer = setTimeout(() => stopWorker(ownership, `command timed out after ${timeout} seconds`), timeoutMs);
      });
    },
  };
}
