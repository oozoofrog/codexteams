import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { homePanel } from "../src/ui/home.ts";

const keys = { matches: (a: string, b: string) => a === b };
test("home and result panels paint every column at 120x30", { timeout: 3000 }, async () => {
  for (const title of ["팀 · 한글", "결과 확인"]) {
    let component: any, close: (() => void) | undefined, options: any;
    const ctx = { ui: { custom: (factory: any, opts: any) => { options = opts; return new Promise(resolve => { component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, keys, resolve); }); } } } as unknown as ExtensionContext;
    const pending = homePanel(ctx, () => ({ title, status: "상태", lines: ["한글 👩‍💻 long result", "", "e\u0301"], choices: [{ id: "task", label: "작업 선택" }] }), c => { close = c; });
    try {
      assert.equal(options.overlayOptions.width, "100%");
      for (const width of [120, 79, 40]) {
        const lines = component.render(width);
        assert.ok(lines.length <= 24);
        assert.ok(lines.every((line: string) => visibleWidth(line) === width), JSON.stringify(lines.map((line: string) => visibleWidth(line))));
        assert.match(lines.at(-1), /Enter.*Esc/);
      }
    } finally { close?.(); await pending; }
  }
});
test("selection keeps task identity across removal and Enter before redraw", { timeout: 3000 }, async () => {
  let items = [{ id: "progress", label: "progress" }, { id: "a", label: "task A" }, { id: "b", label: "task B" }];
  let component: any, close: (() => void) | undefined, finish!: (id?: string) => void;
  const ctx = { ui: { custom: (factory: any) => new Promise(resolve => { finish = resolve; component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, keys, resolve); }) } } as unknown as ExtensionContext;
  const pending = homePanel(ctx, () => ({ title: "home", choices: items }), c => { close = c; });
  try {
    component.render(120); component.handleInput("tui.select.down"); component.render(120); component.handleInput("tui.select.down"); component.render(120);
    items = items.slice(1);
    component.handleInput("tui.select.confirm"); assert.equal(await pending, "b");
  } finally { close?.(); finish?.(); }
});

test("selection remains on the same task after a progress row disappears and redraws", { timeout: 3000 }, async () => {
  let items = [{ id: "progress", label: "progress" }, { id: "a", label: "task A" }, { id: "b", label: "task B" }];
  let component: any, close: (() => void) | undefined;
  const ctx = { ui: { custom: (factory: any) => new Promise(resolve => { component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, keys, resolve); }) } } as unknown as ExtensionContext;
  const pending = homePanel(ctx, () => ({ title: "home", choices: items }), c => { close = c; });
  try { component.render(120); component.handleInput("tui.select.down"); component.render(120); component.handleInput("tui.select.down"); component.render(120); items = items.slice(1); assert.ok(component.render(120).some((line: string) => line.trimEnd() === "→ task B")); component.handleInput("tui.select.confirm"); assert.equal(await pending, "b"); }
  finally { close?.(); }
});

test("result panel wraps a long line and scrolls through its end", { timeout: 3000 }, async () => {
  let component: any, close: (() => void) | undefined;
  const ctx = { ui: { custom: (factory: any) => new Promise(resolve => { component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, keys, resolve); }) } } as unknown as ExtensionContext;
  const pending = homePanel(ctx, () => ({ title: "result", lines: ["한글 ".repeat(300) + "TAIL-END"], choices: [{ id: "back", label: "뒤로" }] }), c => { close = c; });
  try { let lines = component.render(40); assert.ok(lines.length <= 24); for (let i = 0; i < 15 && !lines.join(" ").includes("TAIL-END"); i++) { component.handleInput("\u001b[6~"); lines = component.render(40); } assert.match(lines.join(" "), /TAIL-END/); }
  finally { close?.(); await pending; }
});

test("a removed selected row cannot turn Enter into a different action", { timeout: 3000 }, async () => {
  let items = [{ id: "progress", label: "progress" }, { id: "a", label: "task A" }]; let component: any, close: (() => void) | undefined, done = false;
  const ctx = { ui: { custom: (factory: any) => new Promise(resolve => { component = factory({ terminal: { rows: 30 }, requestRender() {} }, {}, keys, (v: unknown) => { done = true; resolve(v); }); }) } } as unknown as ExtensionContext;
  const pending = homePanel(ctx, () => ({ title: "home", choices: items }), c => { close = c; });
  try { component.render(120); items = items.slice(1); component.render(120); component.handleInput("tui.select.confirm"); assert.equal(done, false); }
  finally { close?.(); await pending; }
});

test("custom UI rejection disposes the panel and clears its registered close", { timeout: 3000 }, async () => {
  let close: (() => void) | undefined;
  const ctx = { ui: { custom: async (factory: any) => { factory({ terminal: { rows: 30 }, requestRender() {} }, {}, keys, () => {}); throw Error("mount failed"); } } } as unknown as ExtensionContext;
  try { await assert.rejects(homePanel(ctx, () => ({ title: "home", choices: [] }), c => { close = c; }), /mount failed/); assert.equal(close, undefined); }
  finally { close?.(); }
});
