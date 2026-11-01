import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile), launcher = fileURLToPath(new URL('../bin/codexteams.mjs', import.meta.url));
test('CLI rejects exit-zero Pi with missing, duplicate, mismatched or malformed result', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-cli-'))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const request = { schemaVersion: 1, requestId: 'case1', projectRoot: root, source: { kind: 'codex', checkpoint: 'stopped', stopped: true }, goal: 'goal', task: { title: 'task', description: 'desc', role: 'developer', acceptance: ['done'] }, context: { summary: '', completed: [], constraints: [], files: [], evidence: [] } };
  const path = join(root, 'request.json'); writeFileSync(path, JSON.stringify(request)); const pi = join(root, 'pi');
  writeFileSync(pi, `#!${process.execPath}\nif(process.argv.includes('--version'))console.log('1.4.0');else{const v=process.env.RESULT;const m={type:'message_end',message:{customType:'codexteams.handoff.result',content:v}};if(v!=='missing')console.log(JSON.stringify(m));if(process.env.DUPLICATE)console.log(JSON.stringify(m));}\n`, { mode: 0o755 });
  const base = { schemaVersion: 1, kind: 'codexteams.handoff.result', requestId: 'case1', status: 'needs_review' };
  const malformedNested = { ...base, digest: createHash('sha256').update(JSON.stringify(request)).digest('hex'), project: { id: 'p', root, revision: 1 }, task: { id: 't', title: 'task', role: 'developer', status: 'needs_review' }, attempts: [null], currentAttempt: null, checks: [], observations: [], errors: [], recoveryRequired: false, limitations: [] };
  for (const [value, duplicate] of [['missing', false], [JSON.stringify(base), true], [JSON.stringify({ ...base, requestId: 'other' }), false], [JSON.stringify(base), false], [JSON.stringify(malformedNested), false], [JSON.stringify({ ...malformedNested, attempts: [] }), false]]) {
    const env = { ...process.env, CODEXTEAMS_WORKER: '', RESULT: value as string, ...(duplicate ? { DUPLICATE: '1' } : {}) };
    const pending = exec(process.execPath, [launcher, '--pi', pi, '--handoff', path], { cwd: root, env }); pending.child.stdin?.end();
    try { await pending; assert.fail('invalid Pi output accepted'); } catch (error) { assert.equal((error as { code: number }).code, 3); }
  }
});
