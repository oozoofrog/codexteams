import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import extension from "../src/index.ts";
import { ensureView } from "../src/core/navigation.ts";
import { emptyUsage } from "../src/core/usage.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

test("native startup and resume into a saved view restore its live viewer", async t => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),"sessions-native-view-"))); t.after(()=>rmSync(root,{recursive:true,force:true}));
 const store=ProjectStore.open(root), team=new TeamController(store,{runner:async()=>{throw Error("unexpected")},validateProfile:async()=>{}}); team.add("developer","native view");
 const parent=SessionManager.create(root,root); parent.appendMessage({role:"user",content:[{type:"text",text:"checkpoint"}],timestamp:Date.now()});
 const view=ensureView(store,{cwd:root,sessionManager:parent} as unknown as ExtensionContext,"task","task-1"); await team.shutdown();
 for (const reason of ["startup","resume"]) {
  const events=new Map<string,(event:any,ctx:ExtensionCommandContext)=>Promise<void>>(); let shown=0;
  const ui={notify:()=>{},setStatus:()=>{},setWidget:()=>{},custom:async (factory:any)=>{shown++; const c=factory({terminal:{rows:30},requestRender:()=>{}},{},{matches:()=>false},()=>{}); c.render(120); c.dispose();}};
  const ctx={cwd:root,mode:"tui",hasUI:true,isProjectTrusted:()=>true,sessionManager:SessionManager.open(view.file),modelRegistry:{},ui} as unknown as ExtensionCommandContext;
  const api={registerCommand:()=>{},registerTool:()=>{},on:(n:string,f:any)=>events.set(n,f),sendMessage:()=>{},sendUserMessage:()=>{}} as unknown as ExtensionAPI;
  extension(api); await events.get("session_start")!({reason},ctx); await new Promise(r=>setTimeout(r,50)); await events.get("session_shutdown")!({reason:"quit"},ctx);
  assert.equal(shown,1,reason);
 }
});

test("viewer keeps range controls inside 30-row terminal and disposes polling", async t => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),"sessions-ui-"))); t.after(()=>rmSync(root,{recursive:true,force:true}));
 const store=ProjectStore.open(root), team=new TeamController(store,{runner:async req=>({outcome:"success",text:"done",exitCode:0,usage:emptyUsage(),effectiveModels:[],sessionId:req.sessionId}),validateProfile:async()=>{}}); team.add("developer","viewport");await team.run("task-1");
 const manager=SessionManager.create(root,root); manager.appendMessage({role:"user",content:[{type:"text",text:"checkpoint"}],timestamp:Date.now()});
 const view=ensureView(store,{cwd:root,sessionManager:manager} as unknown as ExtensionContext,"task","task-1"); await team.shutdown();
 const events=new Map<string,(event:any,ctx:ExtensionCommandContext)=>Promise<void>>(); let command!: (s:string,c:ExtensionCommandContext)=>Promise<void>; let renders:string[]=[]; let disposed=false;
 const ui={notify:()=>{},setStatus:()=>{},setWidget:()=>{},custom:async (factory:any)=>{const terminal={rows:30};const component=factory({terminal,requestRender:()=>{}},{},{matches:()=>false},()=>{});for(const rows of [12,18,30,60]){terminal.rows=rows;const lines=component.render(120);assert.ok(lines.length<=Math.floor(rows*0.6));assert.match(lines.at(-1),/줄.*↑\/↓/);if(rows===30)renders=lines;} component.dispose(); disposed=true;}};
 const ctx={cwd:root,mode:"tui",hasUI:true,isProjectTrusted:()=>true,sessionManager:SessionManager.open(view.file),modelRegistry:{},ui} as unknown as ExtensionCommandContext;
 const api={registerCommand:(_:string,d:{handler:typeof command})=>{command=d.handler},registerTool:()=>{},on:(n:string,f:any)=>events.set(n,f),sendMessage:()=>{},sendUserMessage:()=>{}} as unknown as ExtensionAPI;
 extension(api); await events.get("session_start")!({reason:"resume"},ctx); await new Promise(r=>setTimeout(r,50)); await events.get("session_shutdown")?.({reason:"quit"},ctx);
 assert.ok(disposed); assert.ok(renders.length<=20,`viewer rendered ${renders.length} lines in 30 rows`); assert.match(renders.at(-1)!,/줄.*↑\/↓/); assert.match(renders.join("\n"),/파일 누락/);
});
