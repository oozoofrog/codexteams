import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

test("public Pi SDK opens request Home through /teams and component keys", { timeout: 60000 }, async () => {
  const env: NodeJS.ProcessEnv = {}; for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]) if (process.env[key] !== undefined) env[key] = process.env[key];
  const result = await promisify(execFile)(process.execPath, [resolve("tests/fixtures/request-home-sdk.ts")], { env, cwd: resolve("."), timeout: 45000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
  assert.match(result.stdout, /"ok":true/); assert.match(result.stdout, /"agentStarts":0/);
});
