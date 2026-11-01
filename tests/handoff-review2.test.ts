import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { TeamController } from '../src/core/controller.ts';
import { ProjectStore } from '../src/core/store.ts';
import { resolvePiInvocation } from '../src/runtime/pi-runner.ts';
import { normalizeRequest, readResult } from '../src/core/handoff.mjs';
import type { WorkerResult } from '../src/core/types.ts';

function request(root: string) { return { schemaVersion: 1, requestId: 'r2', projectRoot: root, source: { kind: 'codex', stopped: true, checkpoint: 'stopped' }, goal: 'goal', task: { title: 'task', description: 'do work', role: 'developer', acceptance: ['done'] }, context: { summary: '', completed: [], constraints: [], files: [], evidence: [] } }; }
function rootFor(t: { after: (f: () => void | Promise<void>) => void }) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'review2-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }

test('absent directory or state file returns not_found without creating state', t => {
  const root = rootFor(t), directory = join(root, '.codexteams');
  assert.equal(readResult(root, 'r2').status, 'not_found');
  assert.equal(existsSync(directory), false);
  mkdirSync(directory);
  assert.equal(readResult(root, 'r2').status, 'not_found');
  assert.equal(existsSync(join(directory, 'state.json')), false);
});

test('checkpoint is required', t => { const root = rootFor(t), r = request(root); assert.throws(() => normalizeRequest({ ...r, source: { kind: 'codex', stopped: true } }, root)); });

test('pending runner returns a running duplicate without executing twice', async t => {
  const root = rootFor(t), store = ProjectStore.open(root); let release!: (result: WorkerResult) => void; let started!: () => void; const ready = new Promise<void>(r => { started = r; }); let calls = 0;
  const team = new TeamController(store, { validateProfile: async () => {}, runner: r => new Promise(resolve => { calls++; release = () => resolve({ outcome: 'success', text: 'ok', exitCode: 0, usage: { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, totalTokens: null, costUsd: null, responses: 0, completeness: 'unknown' }, effectiveModels: [], sessionId: r.sessionId }); started(); }) });
  t.after(() => team.shutdown());
  const first = team.handoff(request(root)); await ready;
  try { const duplicate = await team.handoff(request(root)); assert.equal(duplicate.status, 'running'); await assert.rejects(team.handoff({ ...request(root), goal: 'changed' }), /different digest/); assert.equal(calls, 1); }
  finally { release({} as WorkerResult); await first; }
});

test('CLI digest binding rejects deterministic payload replacement before store creation', async t => {
  const root = rootFor(t), requestPath = join(root, 'request.json'), wrapper = join(root, 'pi-wrapper');
  writeFileSync(requestPath, JSON.stringify(request(root)));
  const pi = resolvePiInvocation();
  writeFileSync(wrapper, `#!${process.execPath}\nimport { readFileSync, writeFileSync } from 'node:fs'; import { spawnSync } from 'node:child_process';\nif(process.argv.includes('--version')) { const r=JSON.parse(readFileSync(process.env.PACKET,'utf8')); r.goal='replaced'; writeFileSync(process.env.PACKET,JSON.stringify(r)); console.log('1.4.0'); } else { const r=spawnSync(${JSON.stringify(pi.command)}, [...${JSON.stringify(pi.args)}, ...process.argv.slice(2)], {stdio:'inherit',env:process.env}); process.exit(r.status ?? 1); }\n`, { mode: 0o755 });
  const env = { ...process.env, CODEXTEAMS_WORKER: '', PI_CODING_AGENT_DIR: join(root, 'agent'), PACKET: requestPath };
  const pending = promisify(execFile)(process.execPath, [fileURLToPath(new URL('../bin/codexteams.mjs', import.meta.url)), '--pi', wrapper, '--handoff', requestPath], { cwd: root, env, timeout: 30000 }); pending.child.stdin?.end();
  await assert.rejects(pending, (error: any) => error.code === 2 && /changed after CLI validation/.test(JSON.parse(error.stdout).error));
  assert.throws(() => readFileSync(join(root, '.codexteams', 'state.json')));
});

test('reserved crash-gap state survives reopen and only explicit resume executes', async t => {
  const root = rootFor(t), r = request(root);
  const controllerPath = new URL('../src/core/controller.ts', import.meta.url).href;
  const storePath = new URL('../src/core/store.ts', import.meta.url).href;
  const source = `import { TeamController } from ${JSON.stringify(controllerPath)}; import { ProjectStore } from ${JSON.stringify(storePath)}; const team = new TeamController(ProjectStore.open(${JSON.stringify(root)}), { validateProfile: async () => process.exit(0), runner: async () => { throw Error('unexpected'); } }); await team.handoff(${JSON.stringify(r)});`;
  execFileSync(process.execPath, ['--input-type=module', '-e', source], { timeout: 10000 });
  let calls = 0; const reopened = new TeamController(ProjectStore.open(root), { validateProfile: async () => {}, runner: async req => { calls++; return { outcome: 'success', text: 'done', exitCode: 0, usage: { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, totalTokens: null, costUsd: null, responses: 0, completeness: 'unknown' }, effectiveModels: [], sessionId: req.sessionId }; } });
  t.after(() => reopened.shutdown());
  const id = reopened.snapshot().tasks[0].id;
  assert.deepEqual(reopened.snapshot().tasks[0].handoff?.errors, []);
  assert.equal((await reopened.handoff(r)).status, 'queued'); await reopened.run(); assert.equal(calls, 0);
  await reopened.resume(id); assert.equal(calls, 1); assert.equal(reopened.snapshot().tasks[0].status, 'needs_review');
});

test('stored Git before and after evidence and check link reflect actual attempt', async t => {
  const root = rootFor(t); const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'tracked.txt'), 'base\n'); git('add', 'tracked.txt'); git('commit', '-qm', 'fixture');
  writeFileSync(join(root, 'tracked.txt'), 'preexisting\n');
  const team = new TeamController(ProjectStore.open(root), { validateProfile: async () => {}, runner: async req => { writeFileSync(join(root, 'tracked.txt'), 'worker\n'); return { outcome: 'success', text: 'reported work', exitCode: 0, usage: { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, totalTokens: null, costUsd: null, responses: 0, completeness: 'unknown' }, effectiveModels: [], sessionId: req.sessionId }; } });
  t.after(() => team.shutdown()); await team.handoff(request(root)); const task = team.snapshot().tasks[0];
  await team.check(task.id, 'printf check-fixture'); const saved = readResult(root, 'r2') as any;
  assert.deepEqual(saved.observations.map((o: any) => o.phase), ['before', 'after']);
  assert.ok(saved.observations.every((o: any) => o.status === 'available' && o.attemptId === saved.currentAttempt.id && o.gitStatus.includes('tracked.txt') && o.diffSummary.includes('tracked.txt')));
  assert.equal(saved.checks.length, 1); assert.equal(saved.checks[0].attemptId, saved.currentAttempt.id); assert.equal(saved.checks[0].status, 'passed'); assert.match(saved.checks[0].output, /check-fixture/);
});

test('CLI rejects inconsistent successful result evidence with protocol exit 3', async t => {
  const root = rootFor(t), store = ProjectStore.open(root), r = request(root);
  const team = new TeamController(store, { validateProfile: async () => {}, runner: async req => ({ outcome: 'success', text: 'ok', exitCode: 0, usage: { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, totalTokens: null, costUsd: null, responses: 0, completeness: 'unknown' }, effectiveModels: [], sessionId: req.sessionId }) });
  const result = await team.handoff(r); await team.shutdown();
  const path = join(root, 'request.json'), pi = join(root, 'pi'); writeFileSync(path, JSON.stringify(r));
  writeFileSync(pi, `#!${process.execPath}\nif(process.argv.includes('--version'))console.log('1.4.0');else console.log(JSON.stringify({type:'message_end',message:{customType:'codexteams.handoff.result',content:process.env.FAKE_RESULT}}));\n`, { mode: 0o755 });
  const mutations = [
    (v: any) => { v.attempts = []; v.currentAttempt = null; v.observations = []; },
    (v: any) => { v.attempts[0].usage.input = -1; v.currentAttempt = v.attempts[0]; },
    (v: any) => { v.attempts[0].endedAt = 'invalid'; v.currentAttempt = v.attempts[0]; },
    (v: any) => { v.attempts[0].outcome = 'failed'; v.currentAttempt = v.attempts[0]; },
    (v: any) => { v.currentAttempt = { ...v.currentAttempt, text: 'different' }; },
    (v: any) => { v.checks = [{ id: 'check1', attemptId: v.attempts[0].id, command: 'true', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), status: 'passed', exitCode: 1, output: '' }]; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(result); mutate(value);
    const env = { ...process.env, CODEXTEAMS_WORKER: '', FAKE_RESULT: JSON.stringify(value) };
    const pending = promisify(execFile)(process.execPath, [fileURLToPath(new URL('../bin/codexteams.mjs', import.meta.url)), '--pi', pi, '--handoff', path], { cwd: root, env }); pending.child.stdin?.end();
    await assert.rejects(pending, (error: any) => error.code === 3 && JSON.parse(error.stdout).status === 'protocol_error');
  }
});

test('standalone lookup rejects the same corrupt task evidence as ProjectStore', async t => {
  const root = rootFor(t), store = ProjectStore.open(root); const team = new TeamController(store, { validateProfile: async () => { throw new Error('fixture'); }, runner: async () => { throw new Error('unexpected'); } });
  await team.handoff(request(root)); await team.shutdown();
  const path = join(root, '.codexteams', 'state.json'), original = JSON.parse(readFileSync(path, 'utf8'));
  const successful = (s: any) => { const t = s.tasks[0]; t.attempts = [{ id: 'a1', sessionId: 's1', profile: s.profiles.developer, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), outcome: 'success', effectiveModels: [], text: 'done', usage: { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, totalTokens: null, costUsd: null, responses: 0, completeness: 'unknown' }, logFile: 'logs/a1.jsonl' }]; t.status = 'needs_review'; };
  for (const mutate of [ (s: any) => { s.tasks[0].attempts = [null]; }, (s: any) => { s.tasks[0].status = 'bogus'; }, (s: any) => { successful(s); s.tasks[0].status = 'completed'; s.tasks[0].acceptedAt = new Date().toISOString(); s.tasks[0].acceptanceSource = 'user'; s.tasks[0].acceptedAttemptId = 'wrong'; s.tasks[0].acceptedCheckIds = []; }, (s: any) => { successful(s); s.tasks[0].checks = [{ id: 'x', attemptId: 'missing', command: 'true', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), status: 'passed', exitCode: 0, output: '' }]; }, (s: any) => { successful(s); s.tasks[0].handoff.observations = [{ at: new Date().toISOString(), attemptId: 'a1', phase: 'before', status: 'available', gitStatus: 42, diffSummary: '' }]; } ]) {
    const corrupt = structuredClone(original); mutate(corrupt); writeFileSync(path, JSON.stringify(corrupt));
    assert.throws(() => ProjectStore.read(root)); assert.throws(() => readResult(root, 'r2'));
    assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('../bin/codexteams.mjs', import.meta.url)), '--handoff-result', 'r2'], { cwd: root, env: { ...process.env, CODEXTEAMS_WORKER: '' }, stdio: 'pipe' }));
  }
  const valid = structuredClone(original); successful(valid); writeFileSync(path, JSON.stringify(valid));
  assert.equal(ProjectStore.read(root)?.tasks[0].status, 'needs_review');
  assert.equal(readResult(root, 'r2').status, 'needs_review');
  valid.tasks[0].handoff.request.projectRoot = join(root, 'nonexistent-project');
  writeFileSync(path, JSON.stringify(valid));
  assert.throws(() => ProjectStore.read(root), { code: 'ENOENT' });
  assert.throws(() => readResult(root, 'r2'), { code: 'ENOENT' });
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL('../bin/codexteams.mjs', import.meta.url)), '--handoff-result', 'r2'], { cwd: root, env: { ...process.env, CODEXTEAMS_WORKER: '' }, stdio: 'pipe' }));
});
