import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { ProjectStore } from "../../src/core/store.ts";
import { TeamController } from "../../src/core/controller.ts";
import { ensureView } from "../../src/core/navigation.ts";
const temp=realpathSync(mkdtempSync(join(tmpdir(),"sessions-sdk-view-"))),root=join(temp,"project"),agent=join(temp,"agent"),dir=join(temp,"sessions");for(const p of [root,agent,dir])mkdirSync(p);
const store=ProjectStore.open(root),team=new TeamController(store,{validateProfile:async()=>{},runner:async()=>{throw Error("no inference")}});team.add("developer","view fixture");
const parent=SessionManager.create(root,dir);parent.appendMessage({role:"user",content:[{type:"text",text:"view checkpoint"}],timestamp:Date.now()});
const view=ensureView(store,{cwd:root,sessionManager:parent} as never,"task","task-1");await team.shutdown();
const stateFile=join(root,".codexteams","state.json"), initialState=readFileSync(stateFile);
const ext=resolve("src/index.ts");let mounted=0,disposed=0,component:any,done:((value:unknown)=>void)|undefined,events=0,errors:string[]=[];
const ui={notify:(s:string)=>{errors.push(s)},setStatus:()=>{},setWidget:()=>{},custom:(factory:any,opts:any)=>new Promise(resolveCustom=>{assert.equal(opts.overlay,true);mounted++;done=(value)=>{component.dispose?.();disposed++;resolveCustom(value)};component=factory({terminal:{rows:30},requestRender:()=>{}},{},{matches:(_:string,key:string)=>key==="tui.select.cancel"},done);const lines=component.render(120);assert.ok(lines.length<=18);assert.match(lines.at(-1),/줄/);})};
const createRuntime=async ({cwd,sessionManager,sessionStartEvent}:any)=>{const services=await createAgentSessionServices({cwd,agentDir:agent,settingsManager:SettingsManager.inMemory({}, {projectTrusted:true}),resourceLoaderOptions:{noExtensions:true,additionalExtensionPaths:[ext],noSkills:true,noPromptTemplates:true,noThemes:true}});return {...await createAgentSessionFromServices({services,sessionManager,sessionStartEvent}),services,diagnostics:services.diagnostics}};
async function until(f:()=>boolean){for(let i=0;i<250;i++){if(f())return;await new Promise(r=>setTimeout(r,20))}throw Error(`timed out mounted=${mounted} errors=${errors.join("|")}`)}
async function run(startView:boolean, replaceWhileOpen=false, openCommand=false){
 const expected=mounted+1;
 const runtime=await createAgentSessionRuntime(createRuntime,{cwd:root,agentDir:agent,sessionManager:startView?SessionManager.open(view.file):SessionManager.open(parent.getSessionFile()!)});
 const bind=async()=>{runtime.session.subscribe(e=>{if(e.type==="agent_start")events++});await runtime.session.bindExtensions({mode:"tui",uiContext:ui as never,commandContextActions:{waitForIdle:()=>runtime.session.waitForIdle(),newSession:o=>runtime.newSession(o),fork:(id,o)=>runtime.fork(id,o),navigateTree:async()=>({cancelled:true}),switchSession:(p,o)=>runtime.switchSession(p,o),reload:()=>runtime.session.reload()}})};
 runtime.setRebindSession(bind);await bind();
 if(!startView) { if(openCommand) await runtime.session.prompt("/teams open task-1"); else await runtime.switchSession(view.file); }
 await until(()=>mounted>=expected);
 if (replaceWhileOpen) await runtime.switchSession(parent.getSessionFile()!);
 else component.handleInput("escape");
 await until(()=>runtime.session.sessionFile===parent.getSessionFile());
 assert.equal(events,0);await runtime.dispose();assert.deepEqual(readFileSync(stateFile),initialState);
}
try {await run(false);await run(true);await run(false,true);await run(false,false,true);assert.equal(mounted,4);assert.equal(disposed,4);console.log(JSON.stringify({ok:true,mounted,disposed,agentStarts:events}));}
finally{rmSync(temp,{recursive:true,force:true})}
