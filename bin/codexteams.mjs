#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants, accessSync, readFileSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { readRequest, requestDigest, readResult, validRequestId, validateSubmissionResult } from '../src/core/handoff.mjs';

const HELP = `Usage: codexteams [--pi <executable>] [--] ["goal"]

Open Pi in the current project. With a goal, plan and start eligible work.
Without a goal, display the current project status.
Goals must be command-line arguments; nonempty redirected stdin is rejected.
Redirected stdin or stdout selects Pi JSONL output. A full terminal uses Pi TUI.

  --handoff <path>   Submit an absolute request file (JSON result on stdout)
  --handoff-result <id>  Read a persisted result without starting Pi
  --pi <executable>  Select Pi (otherwise CODEXTEAMS_PI, then pi on PATH)
  --                Treat the next argument as a literal goal
  -h, --help        Show help without starting Pi
  -v, --version     Show the codexteams version without starting Pi

Requires Pi >=1.4.0 <2. This session loads only this codexteams extension.
`;
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const VERSION_TIMEOUT_MS = 5000;
const MAX_PROBE_BYTES = 16384;
let submissionId = null;

function parse(args) {
  let selected, goal, boundary = false, action, handoff, lookup;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!boundary && goal === undefined && arg === '--') { boundary = true; continue; }
    if (!boundary && goal === undefined && (arg === '--handoff' || arg === '--handoff-result')) {
      if (handoff !== undefined || lookup !== undefined || !args[i + 1]) throw new Error('Handoff options require exactly one argument.');
      if (arg === '--handoff') handoff = args[++i]; else lookup = args[++i];
      continue;
    }
    if (!boundary && goal === undefined && arg === '--pi') {
      if (selected !== undefined || !args[i + 1] || args[i + 1].startsWith('-')) throw new Error('--pi requires one executable argument.');
      selected = args[++i];
      continue;
    }
    if (!boundary && goal === undefined && ['-h', '--help', '-v', '--version'].includes(arg)) {
      if (args.length !== 1) throw new Error('Help and version options must be used alone.');
      action = arg === '-h' || arg === '--help' ? 'help' : 'version';
      continue;
    }
    if (goal !== undefined || (!boundary && arg.startsWith('-'))) throw new Error(`Unsupported argument or option: ${arg.slice(0, 100)}`);
    goal = arg;
  }
  if ((handoff !== undefined || lookup !== undefined) && (goal !== undefined || boundary || action)) throw new Error('Handoff options cannot be combined with a goal.');
  if (lookup !== undefined && (!validRequestId(lookup) || selected !== undefined)) throw new Error('Invalid result ID or incompatible --pi.');
  if (boundary && goal === undefined) throw new Error('A goal is required after --.');
  if (goal !== undefined && (!goal.trim() || Buffer.byteLength(goal) > 16384)) throw new Error('The goal must contain 1..16384 UTF-8 bytes and cannot be blank.');
  return { selected, goal, action, handoff, lookup };
}

async function requireEmptyRedirectedInput() {
  if (process.stdin.isTTY) return;
  await new Promise((resolveInput, reject) => {
    const cleanup = () => {
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onError);
    };
    const onData = chunk => {
      if (!chunk.length) return;
      cleanup();
      process.stdin.destroy();
      reject(new Error('Nonempty redirected stdin is not supported. Pass the goal as one command-line argument.'));
    };
    const onEnd = () => { cleanup(); resolveInput(); };
    const onError = error => { cleanup(); reject(new Error(`Cannot read stdin: ${error.message}`)); };
    process.stdin.on('data', onData);
    process.stdin.once('end', onEnd);
    process.stdin.once('error', onError);
    process.stdin.resume();
  });
}

function executable(selection) {
  if (!selection || !selection.trim()) throw new Error('Pi executable selection cannot be empty.');
  const candidates = isAbsolute(selection) || selection.includes('/') || selection.includes('\\')
    ? [resolve(selection)]
    : (process.env.PATH ?? '').split(delimiter).map(directory => resolve(directory || '.', selection));
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* Try only PATH entries for this exact executable name. */ }
  }
  throw new Error(`Cannot find an executable Pi at ${selection}. Install Pi >=1.4.0 <2 or select it with --pi.`);
}

function terminate(signal) {
  // Reproduce the child's signal result for shells and process supervisors.
  try { process.kill(process.pid, signal); }
  catch { process.exitCode = 1; }
}

function run(executablePath, args, { probe = false, capture = false } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executablePath, args, {
      cwd: process.cwd(), env: { ...process.env, CODEXTEAMS_PI: executablePath },
      stdio: probe ? ['ignore', 'pipe', 'pipe'] : capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', shell: false,
    });
    let stdout = '', bytes = 0, failure, interrupted;
    const decoder = capture ? new TextDecoder('utf-8', { fatal: true }) : null;
    let timer;
    const handlers = SIGNALS.map(signal => {
      const handler = () => { interrupted = signal; child.kill(signal); };
      process.on(signal, handler);
      return [signal, handler];
    });
    const cleanup = () => {
      clearTimeout(timer);
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
    if (capture) {
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) { failure ??= new Error('Pi output exceeded limit.'); child.kill('SIGKILL'); child.stdout.destroy(); }
        else {
          try { stdout += decoder.decode(chunk, { stream: true }); }
          catch { failure ??= new Error('Pi output is not valid UTF-8.'); child.kill('SIGKILL'); child.stdout.destroy(); }
        }
      });
      child.stdout.once('end', () => { try { stdout += decoder.decode(); } catch { failure ??= new Error('Pi output is not valid UTF-8.'); } });
    }
    if (probe) {
      const stop = message => {
        failure ??= new Error(message);
        child.kill('SIGKILL');
        child.stdout.destroy();
        child.stderr.destroy();
      };
      timer = setTimeout(() => stop('Pi version probe timed out.'), VERSION_TIMEOUT_MS);
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_PROBE_BYTES) stop('Pi version probe exceeded its output limit.');
        else stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_PROBE_BYTES) stop('Pi version probe exceeded its output limit.');
      });
    }
    child.once('error', error => { cleanup(); reject(new Error(`Cannot start Pi executable: ${error.message}`)); });
    child.once('close', (code, signal) => {
      cleanup();
      if (interrupted && probe) resolveResult({ code, signal: interrupted, stdout });
      else if (failure) reject(failure);
      else resolveResult({ code, signal, stdout });
    });
  });
}

async function main() {
  const { selected, goal, action, handoff, lookup } = parse(process.argv.slice(2));
  if (action === 'help') { process.stdout.write(HELP); return; }
  if (action === 'version') {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(pkg.version);
    return;
  }
  if (process.env.CODEXTEAMS_WORKER) throw new Error('codexteams cannot start recursively from a worker.');
  await requireEmptyRedirectedInput();
  if (lookup !== undefined) { console.log(JSON.stringify(readResult(process.cwd(), lookup))); return; }
  let request;
  if (handoff !== undefined) {
    try { request = readRequest(handoff, process.cwd()); submissionId = request.requestId; }
    catch (error) { console.log(JSON.stringify({ schemaVersion: 1, kind: 'codexteams.handoff.result', requestId: null, task: null, status: 'rejected', error: error.message, limitations: ['Invalid request.'] })); process.exitCode = 2; return; }
  }
  const pi = executable(selected ?? process.env.CODEXTEAMS_PI ?? 'pi');
  const probe = await run(pi, ['--version'], { probe: true });
  if (probe.signal) { terminate(probe.signal); return; }
  const version = probe.stdout.trim();
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (probe.code !== 0 || !match || Number(match[1]) !== 1 || Number(match[2]) < 4) {
    throw new Error('Pi version must be >=1.4.0 <2 (stable); selected executable failed the version check.');
  }
  const extension = fileURLToPath(new URL('../src/index.ts', import.meta.url));
  const command = request ? `/teams handoff ${JSON.stringify(handoff)} ${requestDigest(request)}` : goal === undefined ? (process.stdin.isTTY && process.stdout.isTTY ? '/teams home' : '/teams status') : `/teams launch ${goal}`;
  const outputArgs = request || !process.stdin.isTTY || !process.stdout.isTTY ? ['--mode', 'json'] : [];
  const result = await run(pi, [...outputArgs, ...(request ? ['-p'] : []), '--no-extensions', '-e', extension, '--', command], { capture: Boolean(request) });
  if (result.signal) { terminate(result.signal); return; }
  if (!request) { process.exitCode = result.code ?? 1; return; }
  try {
    const events = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    const messages = events.filter(event => event.type === 'message_end' && event.message?.customType === 'codexteams.handoff.result');
    if (messages.length !== 1) throw new Error('Expected exactly one handoff result.');
    const value = JSON.parse(messages[0].message.content);
    validateSubmissionResult(value, request);
    if (result.code !== 0) throw new Error(`Pi exited with code ${result.code}.`);
    console.log(JSON.stringify(value));
    process.exitCode = value.status === 'rejected' ? 2 : ['needs_review', 'completed'].includes(value.status) ? 0 : 1;
  } catch (error) {
    console.error(`codexteams: ${error.message}`);
    console.log(JSON.stringify({ schemaVersion: 1, kind: 'codexteams.handoff.result', requestId: request.requestId, task: null, status: 'protocol_error', error: error.message, limitations: ['No validated result received.'] }));
    process.exitCode = 3;
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`codexteams: ${message}`);
  if (submissionId !== null) {
    console.log(JSON.stringify({ schemaVersion: 1, kind: 'codexteams.handoff.result', requestId: submissionId, task: null, status: 'protocol_error', error: message, limitations: ['No validated result received.'] }));
    process.exitCode = 3;
  } else process.exitCode = 1;
});
