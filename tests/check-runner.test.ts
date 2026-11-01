import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { runCheck } from "../src/runtime/check-runner.ts";

test("verification captures real exit codes and bounded output", async () => {
  const passed = await runCheck({ cwd: tmpdir(), command: "printf '검증 성공'", signal: new AbortController().signal });
  assert.equal(passed.exitCode, 0);
  assert.equal(passed.output, "검증 성공");
  const failed = await runCheck({ cwd: tmpdir(), command: "printf failure >&2; exit 7", signal: new AbortController().signal });
  assert.equal(failed.exitCode, 7);
  assert.match(failed.output, /failure/);
});

test("verification cancellation waits for process close", async () => {
  const abort = new AbortController();
  const pending = runCheck({ cwd: tmpdir(), command: "sleep 30", signal: abort.signal, onProcess: () => abort.abort() });
  const result = await pending;
  assert.equal(result.interrupted, true);
  assert.notEqual(result.exitCode, 0);
});

test("a completed shell does not hang verification on inherited background pipes", async () => {
  const abort = new AbortController();
  const cleanup = setTimeout(() => abort.abort(), 1500);
  try {
    const result = await runCheck({ cwd: tmpdir(), command: "sleep 30 &", signal: abort.signal });
    assert.equal(result.interrupted, false);
    assert.equal(result.exitCode, 0);
  } finally { clearTimeout(cleanup); }
});
