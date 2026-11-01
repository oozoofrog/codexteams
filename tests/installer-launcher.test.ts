import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

test("Mac installer registers the launcher alongside the extension in the selected prefix", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-cli-install-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const commands = join(root, "commands");
  const prefix = join(root, "prefix");
  const target = join(root, "installed source");
  const source = join(root, "source");
  mkdirSync(join(source, "scripts"), { recursive: true });
  copyFileSync(resolve("scripts/install-macos.sh"), join(source, "scripts", "install-macos.sh"));
  writeFileSync(join(source, "package.json"), '{"name":"codexteams-installer-fixture"}\n');
  mkdirSync(commands);
  writeFileSync(join(commands, "uname"), "#!/bin/sh\necho Darwin\n", { mode: 0o755 });
  writeFileSync(join(commands, "npm"), `#!/bin/sh
set -eu
case "$1" in
  ci) mkdir -p node_modules ;;
  install)
    [ "$2" = "-g" ] || exit 10
    mkdir -p "$NPM_CONFIG_PREFIX/bin"
    printf '#!/bin/sh\\necho installed-launcher\\n' > "$NPM_CONFIG_PREFIX/bin/codexteams"
    chmod +x "$NPM_CONFIG_PREFIX/bin/codexteams"
    ;;
  *) exit 11 ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(commands, "pi"), `#!/bin/sh
set -eu
case "$1" in
  --version) echo 1.4.0 ;;
  install) printf '%s' "$2" > "$PI_CODING_AGENT_DIR/registered-path" ;;
  *) exit 12 ;;
esac
`, { mode: 0o755 });
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  await promisify(execFile)("bash", [join(source, "scripts", "install-macos.sh"), "--target", target], {
    env: { ...process.env, PATH: `${commands}:${process.env.PATH}`, NPM_CONFIG_PREFIX: prefix, PI_CODING_AGENT_DIR: agentDir },
    timeout: 15_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(readFileSync(join(agentDir, "registered-path"), "utf8"), target);
  assert.equal(existsSync(join(prefix, "bin", "codexteams")), true);
  const { stdout } = await promisify(execFile)(join(prefix, "bin", "codexteams"));
  assert.equal(stdout.trim(), "installed-launcher");
});
