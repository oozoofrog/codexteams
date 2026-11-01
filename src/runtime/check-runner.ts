import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export interface CheckRequest {
  cwd: string;
  command: string;
  signal: AbortSignal;
  onProcess?: (pid: number) => void;
}
export interface CheckResult { exitCode: number | null; output: string; interrupted: boolean }

export function runCheck(request: CheckRequest): Promise<CheckResult> {
  if (request.signal.aborted) return Promise.resolve({ exitCode: null, output: "", interrupted: true });
  return new Promise(resolve => {
    const child = spawn("/bin/sh", ["-c", request.command], { cwd: request.cwd, detached: process.platform !== "win32", shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let internalError: string | undefined;
    let escalation: NodeJS.Timeout | undefined;
    const decoders = [new StringDecoder("utf8"), new StringDecoder("utf8")];
    const add = (text: string) => { output = (output + text).slice(-65536); };
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { if (process.platform === "win32") child.kill(signal); else process.kill(-child.pid, signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") internalError ??= String(error); }
    };
    const abort = () => {
      kill("SIGTERM");
      escalation ??= setTimeout(() => kill("SIGKILL"), 1000);
    };
    request.signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (bytes: Buffer) => add(decoders[0].write(bytes)));
    child.stderr.on("data", (bytes: Buffer) => add(decoders[1].write(bytes)));
    child.on("error", error => { internalError = error.message; add(error.message); });
    // The shell can exit before inherited stdout/stderr close in a background child.
    // Start group cleanup at exit, rather than waiting for those very pipes to close.
    child.once("exit", () => {
      kill("SIGTERM");
      escalation ??= setTimeout(() => kill("SIGKILL"), 400);
    });
    child.on("close", (code, signal) => {
      request.signal.removeEventListener("abort", abort);
      if (escalation) clearTimeout(escalation);
      // A shell may exit while an inherited background command keeps running.
      kill("SIGKILL");
      add(decoders[0].end()); add(decoders[1].end());
      if (internalError && !output.includes(internalError)) add(`\n${internalError}`);
      resolve({ exitCode: internalError ? null : code, output, interrupted: request.signal.aborted || signal !== null });
    });
    try { if (child.pid) request.onProcess?.(child.pid); }
    catch (error) { internalError = error instanceof Error ? error.message : String(error); abort(); }
    if (request.signal.aborted) abort();
  });
}
