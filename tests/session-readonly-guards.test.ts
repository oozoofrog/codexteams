import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { VIEW_MARKER } from "../src/core/navigation.ts";

test("readonly marker blocks prompt, tools, shell and Teams mutations", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexteams-guards-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const handlers = new Map<string, (event: any, ctx: ExtensionCommandContext) => Promise<any>>();
  let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  const notices: string[] = [];
  const pi = { on: (name: string, handler: any) => handlers.set(name, handler), registerCommand: (_: string, def: { handler: typeof command }) => { command = def.handler; }, registerTool: () => {}, sendMessage: () => {} } as unknown as ExtensionAPI;
  const ctx = { cwd: root, mode: "tui", hasUI: true, isProjectTrusted: () => true, modelRegistry: {},
    sessionManager: { getBranch: () => [{ type: "custom", customType: VIEW_MARKER, data: { root, projectId: "fixture", kind: "task", targetId: "task-1" } }] },
    ui: { notify: (s: string) => notices.push(s), setWidget: () => {}, setStatus: () => {} },
  } as unknown as ExtensionCommandContext;
  extension(pi); await handlers.get("session_start")!({ reason: "startup" }, ctx);
  assert.deepEqual(await handlers.get("input")!({ text: "prompt" }, ctx), { action: "handled" });
  assert.equal((await handlers.get("tool_call")!({ toolName: "write" }, ctx)).block, true);
  assert.equal((await handlers.get("user_bash")!({ command: "touch bad" }, ctx)).result.exitCode, 1);
  await command("add developer forbidden", ctx);
  assert.match(notices.join("\n"), /읽기 전용/);
  await handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
});
