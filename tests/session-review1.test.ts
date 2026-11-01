import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { emptyUsage } from "../src/core/usage.ts";
import { processRegistry } from "../src/core/process-registry.ts";
import { formatTask } from "../src/ui/format.ts";
import { catalog } from "../src/ui/session-catalog.ts";
import extension from "../src/index.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

test("task displays every attempt with distinct identity, model, outcome, time and error", async t => {
 const root = realpathSync(mkdtempSync(join(tmpdir(), "sessions-history-"))); t.after(() => rmSync(root,{recursive:true,force:true}));
 const store = ProjectStore.open(root); const team = new TeamController(store,{runner:async()=>{throw Error("unexpected")},validateProfile:async()=>{}}); team.add("developer","history");
 const time = "2026-01-01T00:00:00.000Z";
 store.update(s => { const p=s.profiles.developer; s.tasks[0].attempts.push({id:"attempt-old",sessionId:"worker-1",profile:p,startedAt:time,endedAt:time,outcome:"failed",error:"old failure",text:"",usage:emptyUsage(),effectiveModels:[],logFile:"logs/attempt-old.jsonl"},{id:"attempt-new",sessionId:"worker-1",profile:p,startedAt:time,endedAt:time,outcome:"success",text:"done",usage:emptyUsage(),effectiveModels:[],logFile:"logs/attempt-new.jsonl"}); s.tasks[0].status="needs_review"; });
 const text = formatTask(store.snapshot().tasks[0]); assert.match(text,/attempt-old/); assert.match(text,/old failure/); assert.match(text,/attempt-new/); assert.match(text,/2026-01-01/); assert.match(text,/high|medium/); const first=formatTask(store.snapshot().tasks[0],{start:0,limit:1}), second=formatTask(store.snapshot().tasks[0],{start:1,limit:1}); assert.match(first,/attempt-old/); assert.doesNotMatch(first,/attempt-new/); assert.match(second,/attempt-new/); assert.doesNotMatch(second,/attempt-old/); await team.shutdown();
});

test("planning-only recovery catalog shows recovery, timing and recent activity", async t => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),"sessions-planning-"))); t.after(()=>rmSync(root,{recursive:true,force:true})); const store=ProjectStore.open(root); const time="2026-01-01T00:00:00.000Z";
 store.update(s=>{s.recoveryRequired=true; s.planningAttempts.push({id:"planning-1",sessionId:"worker-1",profile:s.profiles.planner,startedAt:time,endedAt:time,outcome:"aborted",text:"",usage:emptyUsage(),effectiveModels:[],logFile:"logs/planning-1.jsonl"});});
 const output=catalog(store.snapshot(),"fixture activity")[0].label; assert.match(output,/복구 필요/); assert.match(output,/2026-01-01/); assert.match(output,/fixture activity/); store.close();
});

test("duplicate team goals retain separate canonical roots, project IDs and task children", async t => {
 const a=realpathSync(mkdtempSync(join(tmpdir(),"sessions-duplicate-a-"))), b=realpathSync(mkdtempSync(join(tmpdir(),"sessions-duplicate-b-"))), registry=processRegistry();
 const roots=[a,b], teams=roots.map(root=>{const store=ProjectStore.open(root),team=new TeamController(store,{runner:async()=>{throw Error("unexpected")},validateProfile:async()=>{}});team.add("developer","same goal");registry.owners.set(root,{controller:team,registry:{} as never});return team});
 t.after(async()=>{for(const team of teams){registry.owners.delete(team.store.root);await team.shutdown()}for(const root of roots)rmSync(root,{recursive:true,force:true})});
 let handler!: (s:string,c:ExtensionCommandContext)=>Promise<void>;const messages:string[]=[];
 const api={registerCommand:(_:string,d:{handler:typeof handler})=>{handler=d.handler},registerTool:()=>{},on:()=>{},sendMessage:(m:{content:string})=>messages.push(m.content)} as unknown as ExtensionAPI;
 extension(api);await handler("sessions",{cwd:a,mode:"rpc",hasUI:false,isProjectTrusted:()=>true} as unknown as ExtensionCommandContext);
 const output=messages.join("\n"); for(const [i,root] of roots.entries()){assert.ok(output.includes(root));assert.ok(output.includes(teams[i].snapshot().id))} assert.equal((output.match(/task-1/g)||[]).length,2);assert.equal((output.match(/팀 · ID/g)||[]).length,2);
});

test("headless sessions has explicit project root row and indented task children",  async t => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),"sessions-hierarchy-"))); t.after(()=>rmSync(root,{recursive:true,force:true})); const store=ProjectStore.open(root); const team=new TeamController(store,{runner:async()=>{throw Error("unexpected")},validateProfile:async()=>{}}); team.add("developer","duplicate goal"); await team.shutdown();
 let handler!: (s:string,c:ExtensionCommandContext)=>Promise<void>; const messages:string[]=[];
 const api={registerCommand:(_:string,d:{handler:typeof handler})=>{handler=d.handler},registerTool:()=>{},on:()=>{},sendMessage:(m:{content:string})=>messages.push(m.content)} as unknown as ExtensionAPI;
 const ctx={cwd:root,mode:"rpc",hasUI:false,isProjectTrusted:()=>true} as unknown as ExtensionCommandContext;
 extension(api); await handler("sessions",ctx); assert.match(messages.join("\n"),new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"))); assert.match(messages.join("\n"),/\n\s+└|\n\s+├/);
});
