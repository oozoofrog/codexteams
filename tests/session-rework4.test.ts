import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { ProjectStore } from "../src/core/store.ts";
import { TeamController } from "../src/core/controller.ts";
import { ensureView } from "../src/core/navigation.ts";
import { emptyUsage } from "../src/core/usage.ts";
import { TuiMainScreen, stripTerminalSequences, type Terminal } from "@earendil-works/pi-tui";

test("viewer header updates in place with compact owner and task identity", { timeout: 3000 }, async t => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),"sessions-header-"))); t.after(()=>rmSync(root,{recursive:true,force:true}));
 const store=ProjectStore.open(root), team=new TeamController(store,{runner:async()=>{throw Error("unexpected")},validateProfile:async()=>{}}); t.after(async()=>team.shutdown()); team.add("developer","duplicate "+"long ".repeat(100));
 const workerDir=join(root,".codexteams","sessions"); mkdirSync(workerDir,{recursive:true}); const worker=SessionManager.create(root,workerDir);
 store.update(s=>{s.goal="duplicate "+"goal ".repeat(100);s.tasks[0].status="running";s.tasks[0].attempts.push({id:"a1",sessionId:worker.getSessionId(),profile:s.profiles.developer,startedAt:new Date().toISOString(),text:"",usage:emptyUsage(),effectiveModels:[],logFile:"logs/a1.jsonl"})});
 const parent=SessionManager.create(root,root);parent.appendMessage({role:"user",content:[{type:"text",text:"checkpoint"}],timestamp:Date.now()}); const view=ensureView(store,{cwd:root,sessionManager:parent} as unknown as ExtensionContext,"task","task-1");
 const events=new Map<string,any>(); let before="",during="",after="";
 const ctx={cwd:root,mode:"tui",hasUI:true,isProjectTrusted:()=>true,sessionManager:SessionManager.open(view.file),modelRegistry:{},ui:{notify:()=>{},setStatus:()=>{},setWidget:()=>{},custom:async(factory:any)=>{const c=factory({terminal:{rows:30},requestRender:()=>{}},{},{matches:()=>false},()=>{});try { before=c.render(120).slice(0,4).join("\n");worker.appendMessage({role:"user",content:[{type:"text",text:"worker"}],timestamp:Date.now()});during=c.render(120).slice(0,4).join("\n");store.update(s=>{s.tasks[0].status="needs_review";s.tasks[0].attempts[0].endedAt=new Date().toISOString();s.tasks[0].attempts[0].outcome="success";s.tasks[0].attempts[0].effectiveModels=["provider/returned"]});after=c.render(120).slice(0,4).join("\n"); } finally { c.dispose(); }}}} as unknown as ExtensionCommandContext;
 extension({registerCommand:()=>{},registerTool:()=>{},on:(n:string,f:any)=>events.set(n,f),sendMessage:()=>{},sendUserMessage:()=>{}} as unknown as ExtensionAPI);await events.get("session_start")({reason:"resume"},ctx);await new Promise(r=>setTimeout(r,50));await events.get("session_shutdown")({reason:"quit"},ctx);
 assert.match(before,/task-1/);assert.ok(before.includes(root));assert.match(before,/running/);assert.match(before,/파일 준비 중/);assert.match(during,/실행 중/);assert.match(after,/needs_review/);assert.match(after,/provider\/returned/);assert.match(after,/기록 있음/);assert.ok(before.includes(store.snapshot().id));await team.shutdown();
});

test("navigator is a bounded overlay with first/last selection and cancellation", { timeout: 3000 }, async t=>{
 const roots=[0,1].map(()=>realpathSync(mkdtempSync(join(tmpdir(),"sessions-nav-long-")))); const {processRegistry}=await import("../src/core/process-registry.ts"); const registry=processRegistry();
 const teams=roots.map(root=>{const store=ProjectStore.open(root),team=new TeamController(store,{runner:async()=>{throw Error("unexpected")},validateProfile:async()=>{}});for(let i=0;i<5;i++)team.add("developer","same "+"long goal ".repeat(30));registry.owners.set(root,{controller:team,registry:{} as never});return team});
 t.after(async()=>{for(const team of teams){registry.owners.delete(team.store.root);await team.shutdown()}for(const root of roots)rmSync(root,{recursive:true,force:true})});
 let command:any, options:any, first:string[]=[],last:string[]=[], cancel:any; const confirmed:number[]=[]; const events=new Map<string,any>();
 const terminal=new Proxy({rows:30,columns:120,kittyProtocolActive:false}, {get:(obj,key)=>key in obj ? Reflect.get(obj,key) : ()=>{}}) as unknown as Terminal; const tui=new TuiMainScreen(terminal); t.after(()=>tui.stop()); tui.addChild({render:()=>Array.from({length:30},(_,i)=>`status widget ${i}`),invalidate:()=>{}}); tui.start();
 const ctx={cwd:roots[0],mode:"tui",hasUI:true,isProjectTrusted:()=>true,modelRegistry:{},ui:{notify:()=>{},setStatus:()=>{},setWidget:()=>{},custom:async(factory:any,opts:any)=>{options=opts;const keys={matches:(d:string,k:string)=>d===k}; const c=factory(tui,{},keys,(v:any)=>{cancel=v; if(v!==undefined) confirmed.push(v)}); const overlay=tui.showOverlay(c,opts.overlayOptions); tui.renderNow(true); first=tui.captureRenderState().previousLines.slice(-30).map(stripTerminalSequences);c.handleInput("tui.select.confirm");for(let i=0;i<11;i++)c.handleInput("tui.select.down");tui.renderNow(true);last=tui.captureRenderState().previousLines.slice(-30).map(stripTerminalSequences);c.handleInput("tui.select.confirm");c.handleInput("tui.select.cancel");overlay.hide();c.dispose?.();return cancel}}} as unknown as ExtensionCommandContext;
 extension({registerCommand:(_:string,d:any)=>command=d.handler,registerTool:()=>{},on:(n:string,f:any)=>events.set(n,f),sendMessage:()=>{}} as unknown as ExtensionAPI);await events.get("session_start")({reason:"startup"},ctx);await command("sessions",ctx);
 assert.equal(options.overlay,true);assert.ok(first.length<=30);assert.ok(last.length<=30);assert.deepEqual(confirmed,[0,11]);assert.match(first.join("\n"),/↑\/↓.*Enter.*Esc/);assert.match(last.join("\n"),/task-5/);assert.match(last.join("\n"),/queued/);assert.ok(last.join("\n").includes(roots[1]));assert.equal(teams[0].snapshot().navigation,undefined);assert.equal(teams[1].snapshot().navigation,undefined);await events.get("session_shutdown")({reason:"resume"},ctx);
});
