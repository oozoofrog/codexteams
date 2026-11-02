import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Hash Git-indexed and non-ignored untracked file contents; fail closed on unsafe or unbounded scope. */
export function artifactDigest(root: string): string {
  const canonical = realpathSync(root);
  const output = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: canonical, encoding: "buffer", timeout: 15000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  const names = [...new Set(output.toString("utf8").split("\0").filter(Boolean))].sort();
  if (names.length > 10000 || names.some(name => name.includes("\ufffd"))) throw new Error("검토 파일 범위가 너무 크거나 인코딩을 확인할 수 없습니다.");
  const hash = createHash("sha256"); let total = 0;
  for (const name of names) {
    if (name === ".codexteams" || name.startsWith(".codexteams/")) continue;
    const path = join(canonical, name), rel = relative(canonical, path);
    if (!rel || rel.startsWith(`..${sep}`) || rel === "..") throw new Error("검토 파일 경로가 프로젝트 밖입니다.");
    let stat;
    try { stat = lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { hash.update(JSON.stringify([name, "deleted"]) + "\n"); continue; } throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path) throw new Error(`안전하게 검토할 수 없는 파일: ${name}`);
    if (stat.size > 8 * 1024 * 1024 || (total += stat.size) > 64 * 1024 * 1024) throw new Error("검토 파일 크기 한도를 초과했습니다.");
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = fstatSync(fd), content = readFileSync(fd), after = fstatSync(fd);
      if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || content.length !== before.size) throw new Error(`검토 중 파일이 변경되었습니다: ${name}`);
      hash.update(JSON.stringify([name, before.mode & 0o777, content.length]) + "\n"); hash.update(content); hash.update("\n");
    } finally { closeSync(fd); }
  }
  return hash.digest("hex");
}
