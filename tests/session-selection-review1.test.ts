import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { processRegistry } from "../src/core/process-registry.ts";
import { emptyUsage } from "../src/core/usage.ts";

for (const change of ["worker", "progress"] as const) test(`pending session selection ${change === "worker" ? "rejects changed worker mapping" : "allows normal worker progress"}`, async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"sessions-selection-")));
 const manager=SessionManager.create(root,root);manager.appendMessage({role:"user",content:[{type:"text",text:"checkpoint"}],timestamp:Date.now()});
 let command!:any, select!:()=>void;let switches=0;const events=new Map<string,any>(),notices:string[]=[];
 const ctx={cwd:root,mode:"tui",hasUI:true,isProjectTrusted:()=>true,sessionManager:manager,modelRegistry:{},ui:{notify:(s:string)=>notices.push(s),setStatus:()=>{},setWidget:()=>{},custom:async (factory:any)=>new Promise<number | undefined>(resolve=>{const component=factory({terminal:{rows:30},requestRender:()=>{}},{},{matches:(d:string,k:string)=>d===k},resolve);select=()=>{component.handleInput("tui.select.down");component.handleInput("tui.select.confirm")}})},switchSession:async()=>{switches++;return {cancelled:false}}} as unknown as ExtensionCommandContext;
 const pi={registerCommand:(_:string,d:any)=>command=d.handler,registerTool:()=>{},on:(n:string,f:any)=>events.set(n,f),sendMessage:()=>{}} as unknown as ExtensionAPI;extension(pi);t.after(async()=>{await events.get("session_shutdown")({reason:"quit"},ctx);rmSync(root,{recursive:true,force:true})});
 await events.get("session_start")({reason:"startup"},ctx);await command("add developer selection",ctx);
 const owner=processRegistry().owners.get(root)!;
 owner.controller.store.update(s=>{s.tasks[0].status="running";s.tasks[0].attempts.push({id:"attempt-1",sessionId:"worker-1",profile:s.profiles.developer,startedAt:new Date().toISOString(),text:"",usage:emptyUsage(),effectiveModels:[],logFile:"logs/attempt-1.jsonl"})});
 const pending=command("sessions",ctx);await new Promise(r=>setImmediate(r));assert.ok(select);
 owner.controller.store.update(s=>{if(change==="worker")s.tasks[0].attempts[0].sessionId="worker-2";else s.tasks[0].attempts[0].text="worker progressing"});
 select();await pending;
 if(change==="worker"){assert.equal(switches,0);assert.match(notices.join("\n"),/변경/);assert.equal(owner.controller.snapshot().navigation,undefined)}else assert.equal(switches,1);
});
