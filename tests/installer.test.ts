import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function install(target: string): Promise<{ code: number | null; output: string }> {
  return new Promise(resolveResult => {
    const child = spawn("bash", [resolve("scripts/install-macos.sh"), "--copy-only", "--target", target], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", bytes => output += String(bytes)); child.stderr.on("data", bytes => output += String(bytes));
    child.on("close", code => resolveResult({ code, output }));
  });
}

test("Mac source installer copies a clean package without overwriting an existing project", async t => {
  const root = mkdtempSync(join(tmpdir(), "codexteams-install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, "develop", "codexteams");
  assert.equal((await install(target)).code, 0);
  assert.equal(JSON.parse(readFileSync(join(target, "package.json"), "utf8")).name, "codexteams");
  assert.equal(existsSync(join(target, "node_modules")), false);
  assert.equal(existsSync(join(target, ".git")), false);
  writeFileSync(join(target, "keep.txt"), "user work");
  assert.notEqual((await install(target)).code, 0);
  assert.equal(readFileSync(join(target, "keep.txt"), "utf8"), "user work");
  const empty = join(root, "empty"); mkdirSync(empty);
  assert.equal((await install(empty)).code, 0);
});
