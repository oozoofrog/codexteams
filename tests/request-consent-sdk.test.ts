import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { test } from "node:test";
for (const mode of ["tui", "rpc", "print"] as const) test(`public SDK ${mode} reinjected acceptance uses supported consent`, { timeout: 60000 }, async () => {
  const env: NodeJS.ProcessEnv = {}; for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]) if (process.env[key] !== undefined) env[key] = process.env[key];
  const result = await promisify(execFile)(process.execPath, [resolve("tests/fixtures/request-consent-sdk.ts"), mode], { env, cwd: resolve("."), timeout: 45000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
  assert.match(result.stdout, /"ok":true/); assert.match(result.stdout, new RegExp(`"mode":"${mode}"`));
});
