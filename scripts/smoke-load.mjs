import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

// Pinned Pi loader integration, not a model request. Do not read real auth data.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const loader = await import(pathToFileURL(join(dirname(packageEntry), "core/extensions/loader.js")).href);
const scratch = mkdtempSync(join(tmpdir(), "codexteams-load-"));
try {
  const result = await loader.loadExtensions([join(root, "src/index.ts")], scratch);
  const loaded = result.extensions[0];
  const summary = { errors: result.errors, extensions: result.extensions.length, commands: loaded ? [...loaded.commands.keys()] : [], tools: loaded ? [...loaded.tools.keys()] : [] };
  if (result.errors.length || summary.extensions !== 1 || !summary.commands.includes("teams") || !summary.tools.includes("codexteams_status")) throw new Error(JSON.stringify(summary));
  writeFileSync(join(root, "docs/load-smoke-result.json"), JSON.stringify(summary, null, 2) + "\n");
  process.stdout.write(JSON.stringify(summary) + "\n");
} finally { rmSync(scratch, { recursive: true, force: true }); }
