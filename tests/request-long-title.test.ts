import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ProjectStore } from "../src/core/store.ts";
import { TeamModeSupervisor } from "../src/core/team-mode.ts";
import { homeOverview, homePanel } from "../src/ui/home.ts";
test("duplicate long Korean request rows remain distinct at 120 columns and target the second key", async t => {
 const root = mkdtempSync(join(tmpdir(), "request-title-")); t.after(() => rmSync(root, { recursive: true, force: true })); const store = ProjectStore.open(root); const supervisor = new TeamModeSupervisor(store, { runner: async () => { throw Error("unexpected"); }, validateProfile: async () => {} }); t.after(async () => { await supervisor.shutdown(); store.close(); }); await supervisor.setMode(true);
 store.update(s => { for (const id of ["first", "second"]) s.teamMode!.requests.push({ id, text: "긴요청내용".repeat(35), origin: "rpc", sessionId: "session", receivedAt: s.createdAt, revision: 1, status: "answered", answer: "answer", taskIds: [] }); });
 let component: any; const ctx = { ui: { custom: (factory: any) => new Promise(resolve => { component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, { matches: (a: string, b: string) => a === b }, resolve); }) } } as unknown as ExtensionContext;
 let close: (() => void) | undefined; const pending = homePanel(ctx, () => homeOverview(root, store.snapshot(), undefined, "", ""), c => { close = c; });
 try { let lines = component.render(120); const rows = lines.filter((line: string) => line.includes("긴요청내용")); assert.equal(rows.length, 2); assert.notEqual(rows[0].replace(/^. /, ""), rows[1].replace(/^. /, "")); assert.match(rows[0], /1/); assert.match(rows[1], /2/);
 component.handleInput("tui.select.down"); component.render(120); component.handleInput("tui.select.down"); component.render(120); component.handleInput("tui.select.confirm"); assert.equal(await pending, "request:second"); } finally { close?.(); }
});
