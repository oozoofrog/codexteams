import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

test("installed Pi SDK restores native view on resume and startup and Esc routes home", {timeout:60000}, async()=>{
 const env:NodeJS.ProcessEnv={}; for(const key of ["PATH","HOME","TMPDIR","LANG","LC_ALL"])if(process.env[key]!==undefined)env[key]=process.env[key];
 const result=await promisify(execFile)(process.execPath,[resolve("tests/fixtures/session-view-sdk.ts")],{env,cwd:resolve("."),timeout:45000,killSignal:"SIGKILL",maxBuffer:1024*1024});
 assert.match(result.stdout,/"ok":true/); assert.match(result.stdout,/"agentStarts":0/);
});

test("installed Pi SDK reload fences coordinators across two replaced roots", {timeout:60000}, async()=>{
 const env:NodeJS.ProcessEnv={}; for(const key of ["PATH","HOME","TMPDIR","LANG","LC_ALL"])if(process.env[key]!==undefined)env[key]=process.env[key];
 const result=await promisify(execFile)(process.execPath,[resolve("tests/fixtures/team-mode-reload-sdk.ts"),"--no-extensions","-e",resolve("src/index.ts")],{env,cwd:resolve("."),timeout:45000,killSignal:"SIGKILL",maxBuffer:1024*1024});
 assert.match(result.stdout,/"ok":true/); assert.match(result.stdout,/"childDispatches":0/);
});

test("installed Pi SDK reload cleans pending check and owners across two roots", {timeout:60000}, async()=>{
 const env:NodeJS.ProcessEnv={}; for(const key of ["PATH","HOME","TMPDIR","LANG","LC_ALL"])if(process.env[key]!==undefined)env[key]=process.env[key];
 const result=await promisify(execFile)(process.execPath,[resolve("tests/fixtures/session-reload-sdk.ts"),"--no-extensions","-e",resolve("src/index.ts")],{env,cwd:resolve("."),timeout:45000,killSignal:"SIGKILL",maxBuffer:1024*1024});
 assert.match(result.stdout,/"ok":true/);
});
