import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { ProjectStore } from "../../src/core/store.ts";
import { TeamController } from "../../src/core/controller.ts";
import { emptyUsage } from "../../src/core/usage.ts";

const temp=realpathSync(mkdtempSync(join(tmpdir(),"sessions-sdk-reload-"))), a=join(temp,"a"),b=join(temp,"b"), agent=join(temp,"agent"), sessions=join(temp,"sessions");
for(const path of [a,b,agent,sessions])mkdirSync(path);
const ext=resolve("src/index.ts");
for(const root of [a,b]){
 const store=ProjectStore.open(root);const team=new TeamController(store,{validateProfile:async()=>{},runner:async req=>({outcome:"success",text:"fixture",exitCode:0,usage:emptyUsage(),effectiveModels:[],sessionId:req.sessionId})});
 const task=team.add("developer","reload fixture");await team.run(task.id);await team.shutdown();
}
const parent=(root:string)=>{const m=SessionManager.create(root,sessions);m.appendMessage({role:"user",content:[{type:"text",text:"SDK reload checkpoint"}],timestamp:Date.now()});return m};
const manager=parent(a), other=parent(b).getSessionFile()!;
const createRuntime=async ({cwd,sessionManager,sessionStartEvent}:any)=>{
 const services=await createAgentSessionServices({cwd,agentDir:agent,settingsManager:SettingsManager.inMemory({}, {projectTrusted:true}),resourceLoaderOptions:{noExtensions:true,additionalExtensionPaths:[ext],noSkills:true,noPromptTemplates:true,noThemes:true}});
 return {...await createAgentSessionFromServices({services,sessionManager,sessionStartEvent}),services,diagnostics:services.diagnostics};
};
const runtime=await createAgentSessionRuntime(createRuntime,{cwd:a,agentDir:agent,sessionManager:manager});
const ui={notify:()=>{},setStatus:()=>{},setWidget:()=>{}};
const bind=async()=>{await runtime.session.bindExtensions({mode:"rpc",uiContext:ui as never})};runtime.setRebindSession(bind);await bind();
const state=(root:string)=>JSON.parse(readFileSync(join(root,".codexteams","state.json"),"utf8"));
const until=async (f:()=>boolean)=>{for(let i=0;i<200;i++){if(f())return;await new Promise(r=>setTimeout(r,25))}throw Error("timed out")};
try {
 // Connect both teams before either command starts a long-running check.
 await runtime.session.prompt("/teams add developer second");
 await runtime.switchSession(other);await runtime.session.prompt("/teams add developer second");
 // SDK host uses the same explicit extension path and disabled-discovery arguments as the launcher.
 await runtime.switchSession(manager.getSessionFile()!);
 await runtime.session.prompt("/teams check task-1 while [ ! -f release ]; do sleep 0.05; done");
 await until(()=>state(a).tasks[0].checks[0]?.workerPid>0);
 const check=state(a).tasks[0].checks[0];
 assert.equal((await runtime.switchSession(other)).cancelled,false);
 assert.equal(state(a).tasks[0].checks[0].workerPid,check.workerPid);
 assert.ok(existsSync(join(a,".codexteams","lock.json")));assert.ok(existsSync(join(b,".codexteams","lock.json")));
 await runtime.session.reload();
 assert.equal(state(a).tasks[0].checks[0].status,"interrupted");
 assert.equal(existsSync(join(a,".codexteams","lock.json")),false);assert.equal(existsSync(join(b,".codexteams","lock.json")),false);
 console.log(JSON.stringify({ok:true,check:check.id,pid:check.workerPid,roots:2,shutdown:"reload"}));
} finally {await runtime.dispose();rmSync(temp,{recursive:true,force:true});}
