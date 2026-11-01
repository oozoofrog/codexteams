import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { TeamController } from '../src/core/controller.ts';
import { ProjectStore } from '../src/core/store.ts';
import { readResult } from '../src/core/handoff.mjs';
import { resumeCandidates } from '../src/ui/format.ts';
import type { WorkerRunner } from '../src/core/types.ts';

function request(root: string) { return { schemaVersion: 1, requestId: 'r1', projectRoot: root, source: { kind: 'codex', checkpoint: 'stopped', stopped: true }, goal: 'handoff goal', task: { title: 'work', description: 'do it', role: 'developer', acceptance: ['done'] }, context: { summary: 'packet', completed: [], constraints: [], files: [], evidence: [] } }; }
function setup(t: { after: (f: () => void | Promise<void>) => void }, validateProfile: () => Promise<void> = async () => {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-controller-'))); const store = ProjectStore.open(root); const prompts: string[] = [];
  const runner: WorkerRunner = async r => { prompts.push(r.prompt); return { outcome: 'success', text: 'done', exitCode: 0, usage: { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, totalTokens: null, costUsd: null, responses: 0, completeness: 'unknown' }, effectiveModels: [], sessionId: r.sessionId }; };
  const team = new TeamController(store, { runner, validateProfile });
  t.after(async () => { await team.shutdown(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, team, prompts };
}

test('duplicate submissions never execute regardless of persisted status; conflict rejects', async t => {
  const { root, store, team, prompts } = setup(t); team.add('developer', 'unrelated');
  const r = request(root); await team.handoff(r); const id = team.snapshot().tasks[1].id;
  assert.equal(prompts.length, 1); assert.match(prompts[0], /handoff goal/); assert.match(prompts[0], /packet/);
  assert.throws(() => store.update(s => { s.tasks[1].handoff!.digest = 'tampered'; }));
  assert.throws(() => store.update(s => { s.tasks[1].title = 'tampered'; }));
  for (const status of ['queued', 'running', 'failed', 'interrupted', 'cancelled', 'needs_review'] as const) {
    store.update(s => { s.tasks[1].status = status; });
    await team.handoff(r); assert.equal(prompts.length, 1); assert.equal(team.snapshot().tasks[1].attempts.length, 1);
  }
  team.accept(id); await team.handoff(r); assert.equal(prompts.length, 1);
  await assert.rejects(team.handoff({ ...r, goal: 'different' }), /different digest/);
  assert.equal(team.snapshot().tasks[0].status, 'queued');
});

test('profile failure remains reserved and requires explicit ID resume', async t => {
  let allowed = false; const { root, team, prompts } = setup(t, async () => { if (!allowed) throw new Error('profile unavailable'); });
  const r = request(root); await team.handoff(r); const task = team.snapshot().tasks[0];
  assert.equal(task.status, 'queued'); assert.match(task.handoff!.errors[0], /profile unavailable/);
  allowed = true; await team.handoff(r); await team.run(); assert.equal(prompts.length, 0);
  assert.equal(resumeCandidates(team.snapshot()).some(candidate => candidate.id === task.id), false);
  await assert.rejects(team.run(task.id)); await team.resume(task.id); assert.equal(prompts.length, 1);
  assert.equal(team.snapshot().tasks[0].handoff!.observations.length, 2);
});

test('cancellation interrupts a handoff and shutdown rejects future dispatch', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-cancel-'))), store = ProjectStore.open(root);
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const runner: WorkerRunner = r => new Promise(resolve => { started(); r.signal!.addEventListener('abort', () => resolve({ outcome: 'aborted', text: '', error: 'cancelled', exitCode: null, usage: { input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, totalTokens: null, costUsd: null, responses: 0, completeness: 'unknown' }, effectiveModels: [], sessionId: r.sessionId }), { once: true }); });
  const team = new TeamController(store, { runner, validateProfile: async () => {} });
  t.after(async () => { await team.shutdown(); rmSync(root, { recursive: true, force: true }); });
  const execution = team.handoff(request(root)); await ready; await team.cancel();
  assert.equal((await execution).status, 'interrupted'); await team.shutdown();
  await assert.rejects(team.handoff(request(root)), /종료/);
});

test('lost lock prevents reservation and execution', async t => {
  const { root, team, prompts } = setup(t); const lock = join(root, '.codexteams', 'lock.json');
  const contents = JSON.parse(readFileSync(lock, 'utf8')); contents.nonce = 'other-owner'; writeFileSync(lock, JSON.stringify(contents));
  await assert.rejects(team.handoff(request(root)), /소유자/); assert.equal(prompts.length, 0);
});

test('recovery gate prevents duplicate execution while read-only state remains available', async t => {
  const { root, store, team, prompts } = setup(t); const r = request(root); await team.handoff(r);
  store.update(s => { s.recoveryRequired = true; });
  await assert.rejects(team.handoff(r), /복구/); assert.equal(prompts.length, 1);
  assert.equal(ProjectStore.read(root)?.tasks[0].handoff?.request.requestId, 'r1');
  assert.equal(readResult(root, 'r1').status, 'needs_review');
  assert.throws(() => ProjectStore.open(root), /잠금|사용/);
});
