import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const modulePath = '../src/core/handoff.mjs';
function fixture(root: string) { return { schemaVersion: 1, requestId: 'r-1', projectRoot: root, source: { kind: 'codex', checkpoint: 'stopped', stopped: true }, goal: 'goal', task: { title: 'title', description: 'description', role: 'developer', acceptance: ['yes'] }, context: { summary: '', completed: [], constraints: [], files: [], evidence: [] } }; }
test('handoff request validates all boundaries and does not follow unsafe files', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-boundary-'))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = await import(modulePath); const valid = fixture(root);
  for (const invalid of [ { ...valid, requestId: '_invalid' }, { ...valid, requestId: 'a'.repeat(65) }, { ...valid, projectRoot: '/' }, { ...valid, source: { kind: 'codex', stopped: false } }, { ...valid, task: { ...valid.task, acceptance: [] } }, { ...valid, task: { ...valid.task, role: 'planner' } }, { ...valid, context: { ...valid.context, files: [4] } }, { ...valid, goal: 'x'.repeat(16385) } ]) assert.throws(() => p.normalizeRequest(invalid, root));
  const file = join(root, 'request.json'); writeFileSync(file, JSON.stringify(valid));
  assert.equal(p.readRequest(file, root).requestId, 'r-1');
  const link = join(root, 'link'); symlinkSync(file, link); assert.throws(() => p.readRequest(link, root));
  const fifo = join(root, 'fifo'); execFileSync('mkfifo', [fifo]); assert.throws(() => p.readRequest(fifo, root));
  writeFileSync(file, 'x'.repeat(65537)); assert.throws(() => p.readRequest(file, root));
  writeFileSync(file, Buffer.from([0xff])); assert.throws(() => p.readRequest(file, root));
});
