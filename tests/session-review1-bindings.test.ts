import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { TeamController } from "../src/core/controller.ts";
import { ProjectStore } from "../src/core/store.ts";
import { emptyUsage } from "../src/core/usage.ts";

test("queued dispatch uses refreshed same-project registry without stale ctx", async t => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),"sessions-registry-refresh-"))); let release!:()=>void; let ready!:()=>void; const started=new Promise<void>(r=>{ready=r}); let calls=0;
 const original=TeamController.prototype.run; t.mock.method(TeamController.prototype,"run",function(this:TeamController,id?:string){const options=(this as any).options; options.runner=(req:any)=>new Promise(resolve=>{calls++; release=()=>resolve({outcome:"success",text:"ok",exitCode:0,usage:emptyUsage(),effectiveModels:[],sessionId:req.sessionId});ready()}); return original.call(this,id)});
 function screen(valid:boolean) { let cmd!:any; let stale=false, staleAccesses=0; const lookups:string[][]=[], results:unknown[]=[], notices:string[]=[]; const handlers=new Map<string,any>(); const modelRegistry={find:(...args:string[])=>{lookups.push(args);const result=valid?{reasoning:true}:undefined;results.push(result);return result},hasConfiguredAuth:()=>true}; const ctx={cwd:root,mode:"tui",hasUI:true,isProjectTrusted:()=>true,get modelRegistry(){if(stale){staleAccesses++;throw Error("stale registry getter")}return modelRegistry},ui:{notify:(s:string)=>notices.push(s),setStatus:()=>{},setWidget:()=>{}}} as unknown as ExtensionCommandContext; const pi={registerCommand:(_:string,d:any)=>{cmd=d.handler},registerTool:()=>{},on:(n:string,f:any)=>handlers.set(n,f),sendMessage:()=>{}} as unknown as ExtensionAPI; extension(pi); return {ctx,handlers,lookups,results,notices,staleAccesses:()=>staleAccesses,cmd:(s:string)=>cmd(s,ctx),stale:()=>{stale=true}} }
 const a=screen(true); let b:ReturnType<typeof screen>|undefined; t.after(async()=>{release?.(); if(b) await b.handlers.get("session_shutdown")({reason:"quit"},b.ctx); rmSync(root,{recursive:true,force:true})});
 await a.handlers.get("session_start")({reason:"startup"},a.ctx); await a.cmd("add developer first"); await a.cmd("add developer second"); await a.cmd("run"); await started;
 await a.handlers.get("session_shutdown")({reason:"resume"},a.ctx); a.stale(); b=screen(false); await b.handlers.get("session_start")({reason:"resume"},b.ctx); release();
 for(let i=0;i<100 && ProjectStore.read(root)!.tasks[0].status!=="needs_review";i++) await new Promise(r=>setTimeout(r,10));
 await new Promise(r=>setTimeout(r,30)); const state=ProjectStore.read(root)!; assert.equal(state.tasks[0].status,"needs_review"); assert.equal(state.tasks[1].status,"queued"); assert.equal(state.tasks[1].attempts.length,0); assert.equal(calls,1); assert.equal(a.staleAccesses(),0); assert.deepEqual(b!.lookups,[[state.profiles.developer.provider,state.profiles.developer.model]]); assert.deepEqual(b!.results,[undefined]);
});

test("delayed handoff result is delivered to replacement binding only", async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),"sessions-handoff-bind-"))); let finish!:(x:any)=>void;
 t.mock.method(TeamController.prototype,"handoff",()=>new Promise(resolve=>{finish=resolve}));
 const file=join(root,"request.json"); writeFileSync(file,JSON.stringify({schemaVersion:1,requestId:"binding-1",projectRoot:root,source:{kind:"codex",checkpoint:"stopped",stopped:true},goal:"goal",task:{title:"task",description:"desc",role:"developer",acceptance:["done"]},context:{summary:"",completed:[],constraints:[],files:[],evidence:[]}}));
 function screen(){let command!:any, stale=false; const handlers=new Map<string,any>(),messages:string[]=[]; const ctx={cwd:root,mode:"tui",hasUI:true,isProjectTrusted:()=>true,modelRegistry:{},ui:{notify:()=>{if(stale) throw Error("stale")},setStatus:()=>{if(stale) throw Error("stale")},setWidget:()=>{if(stale) throw Error("stale")}}} as unknown as ExtensionCommandContext; const pi={registerCommand:(_:string,d:any)=>command=d.handler,registerTool:()=>{},on:(n:string,f:any)=>handlers.set(n,f),sendMessage:(m:any)=>{if(stale) throw Error("stale pi"); messages.push(m.content)}} as unknown as ExtensionAPI; extension(pi); return {ctx,handlers,messages,cmd:(s:string)=>command(s,ctx),stale:()=>{stale=true}}}
 const a=screen();let b:ReturnType<typeof screen>|undefined;t.after(async()=>{finish?.({status:"done"});if(b)await b.handlers.get("session_shutdown")({reason:"quit"},b.ctx);rmSync(root,{recursive:true,force:true})});
 await a.handlers.get("session_start")({reason:"startup"},a.ctx); await a.cmd(`handoff ${JSON.stringify(file)}`); await a.handlers.get("session_shutdown")({reason:"new"},a.ctx);a.stale();b=screen();await b.handlers.get("session_start")({reason:"new"},b.ctx);finish({status:"done"});await new Promise(r=>setImmediate(r));assert.equal(a.messages.length,0);assert.equal(JSON.parse(b.messages.at(-1)!).status,"done");
});
