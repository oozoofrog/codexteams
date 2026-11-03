import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
for (const mode of ["rpc", "tui"] as const) test(`fresh ${mode} team chat persists genuine human input without parent HTTP or queued escape`, { timeout: 60000 }, async () => {
 const env: NodeJS.ProcessEnv = {}; for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]) if (process.env[key] !== undefined) env[key] = process.env[key];
 const result = await promisify(execFile)(process.execPath, [resolve("tests/fixtures/team-native-persistence-sdk.ts"), mode], { cwd: resolve("."), env, timeout: 45000, maxBuffer: 1024 * 1024 }); assert.match(result.stdout, /"ok":true/); assert.match(result.stdout, /"parentApi":"openai-responses"/); assert.match(result.stdout, /"parentHttpRequests":0/); assert.match(result.stdout, /"resumedFromDisk":true/);
});
