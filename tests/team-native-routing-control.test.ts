import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../src/index.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import test from "node:test";
import assert from "node:assert/strict";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import * as chat from "../src/core/team-chat.ts";
const original = { role: "assistant", content: [], api: "openai-responses", provider: "openai", model: "gpt-6.1-sol", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "aborted", errorMessage: "Request was aborted", timestamp: 123 };
const provenance = { requestId: "request", sessionId: "session", confirmationContextId: "context", humanEntryId: "human-entry", expectedProvider: "openai", expectedApi: "openai-responses", expectedModel: "gpt-6.1-sol", ownedPrestartCancel: true, signalAborted: true };
test("owned empty native bootstrap abort becomes a truthful local control artifact with exact audit", () => {
 const before = JSON.stringify(original), control = (chat as any).parentRoutingControl(original, provenance); assert.ok(control); assert.equal(JSON.stringify(original), before); assert.equal(JSON.stringify(control.audit.original), before); assert.equal(JSON.stringify(control.message.codexteamsControl.originalAbort), before); assert.equal(control.message.software_generated_control, true); assert.equal(control.message.provider, "codexteams-local"); assert.equal(control.message.api, "codexteams-local/control"); assert.equal(control.message.model, "control"); assert.equal(control.message.stopReason, "stop"); assert.deepEqual(control.message.usage, original.usage);
 initTheme("dark", false); assert.match(new AssistantMessageComponent(original as any).render(100).join("\n"), /Operation aborted/); const rendered = new AssistantMessageComponent(control.message).render(100).join("\n"); assert.match(rendered, /요청을 확인/); assert.doesNotMatch(rendered, /Operation aborted|Error:/);
});
for (const kind of ["partial", "tokens", "cost", "unknown", "foreign", "not-aborted"] as const) test(`native routing control leaves ${kind} evidence untouched`, () => {
 const message: any = structuredClone(original); if (kind === "partial") message.content = [{ type: "text", text: "Partial model answer" }]; if (kind === "tokens") message.usage.input = 1; if (kind === "cost") message.usage.cost.total = 0.1; if (kind === "unknown") delete message.usage.totalTokens; if (kind === "foreign") message.provider = "other"; if (kind === "not-aborted") message.stopReason = "error";
 assert.equal((chat as any).parentRoutingControl(message, provenance), undefined);
});


test("exact official Responses abort error is local control only under owned aborted signal", () => {
 const measured = { ...structuredClone(original), stopReason: "error", errorMessage: "This operation was aborted" };
 const control = (chat as any).parentRoutingControl(measured, provenance); assert.ok(control); assert.equal(JSON.stringify(control.audit.original), JSON.stringify(measured)); assert.equal(control.audit.original.stopReason, "error");
 for (const flags of [{ ownedPrestartCancel: false, signalAborted: true }, { ownedPrestartCancel: true, signalAborted: false }]) assert.equal((chat as any).parentRoutingControl(measured, { ...provenance, ...flags }), undefined);
});
for (const flag of ["ownedPrestartCancel", "signalAborted"] as const) test(`native abort without ${flag} cannot become local control`, () => { assert.equal((chat as any).parentRoutingControl(original, { ...provenance, [flag]: false }), undefined); });


test("registered public hooks cancel owned automatic compaction and cache warming without changing OFF behavior", async t => {
 const root = mkdtempSync(join(tmpdir(), "native-public-guards-")), handlers = new Map<string, Function>(); let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
 const ctx = { cwd: root, mode: "rpc", hasUI: false, isProjectTrusted: () => true, isIdle: () => true, modelRegistry: {}, sessionManager: { getSessionId: () => "session", getSessionFile: () => undefined, getBranch: () => [] } } as unknown as ExtensionCommandContext;
 const pi = { registerCommand: (_: string, definition: { handler: typeof command }) => { command = definition.handler; }, registerTool() {}, on: (name: string, handler: Function) => { handlers.set(name, handler); return () => {}; }, sendMessage() {} } as unknown as ExtensionAPI;
 extension(pi); t.after(async () => { await handlers.get("session_shutdown")!({ reason: "quit" }, ctx); rmSync(root, { recursive: true, force: true }); }); await command("mode on", ctx);
 for (const reason of ["threshold", "overflow"]) assert.deepEqual(await handlers.get("session_before_compact")!({ reason }, ctx), { cancel: true }); assert.equal(await handlers.get("session_before_compact")!({ reason: "manual" }, ctx), undefined); assert.deepEqual(await handlers.get("cache_warming_decision")!({ action: "warm" }, ctx), { action: "stop" });
 await command("mode off", ctx); assert.equal(await handlers.get("session_before_compact")!({ reason: "threshold" }, ctx), undefined); assert.equal(await handlers.get("cache_warming_decision")!({ action: "warm" }, ctx), undefined);
});

for (const scenario of ["current", "absent-current", "disk-mismatch", "wrong-header", "malformed", "directory", "dangling-symlink"] as const) {
 test(`native admission requires a safe file and exact human receipt: ${scenario}`, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-receipt-")));
  const file = join(root, "session.jsonl"), handlers = new Map<string, Function>(), audits: any[] = [];
  const old = { type: "message", id: "old", message: { role: "user", content: [{ type: "text", text: "Earlier question" }] } };
  const current = { type: "message", id: "current", message: { role: "user", content: [{ type: "text", text: "New question" }] } };
  const branch = [old], header = { type: "session", cwd: root, id: "session" };
  const save = (...entries: object[]) => writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
  let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  const ctx = { cwd: root, mode: "rpc", hasUI: false, isProjectTrusted: () => true, isIdle: () => true, modelRegistry: {}, model: { provider: "openai", api: "openai-responses", id: "gpt-6.1-sol" }, signal: AbortSignal.abort(), abort() {}, sessionManager: { getSessionId: () => "session", getSessionFile: () => file, getBranch: () => branch, getLeafId: () => "old" } } as unknown as ExtensionCommandContext;
  const pi = { registerCommand: (_: string, def: { handler: typeof command }) => { command = def.handler; }, registerTool() {}, on: (name: string, handler: Function) => { handlers.set(name, handler); return () => {}; }, sendMessage() {}, getThinkingLevel: () => "high", appendEntry: (_type: string, data: unknown) => audits.push(data) } as unknown as ExtensionAPI;
  if (scenario === "wrong-header") save({ ...header, id: "other" });
  if (scenario === "malformed") writeFileSync(file, "malformed\n");
  if (scenario === "directory") mkdirSync(file);
  if (scenario === "dangling-symlink") symlinkSync(join(root, "absent"), file);
  extension(pi);
  t.after(async () => { await handlers.get("session_shutdown")!({ reason: "quit" }, ctx); rmSync(root, { recursive: true, force: true }); });
  await command("mode on", ctx);
  const input = await handlers.get("input")!({ source: "rpc", text: "New question" }, ctx);
  if (scenario !== "current" && scenario !== "absent-current" && scenario !== "disk-mismatch") {
   assert.equal(input.action, "handled");
   return;
  }
  assert.equal(input.action, "continue");
  await handlers.get("before_agent_start")!({ messageType: "user", prompt: "New question" }, ctx);
  if (scenario !== "absent-current") branch.push(current);
  save(header, old, ...(scenario === "current" ? [current] : scenario === "disk-mismatch" ? [{ ...current, message: old.message }] : []));
  await handlers.get("message_end")!({ message: original }, ctx);
  assert.deepEqual(audits.map(audit => audit.humanEntryId), scenario === "current" ? ["current"] : []);
 });
}
