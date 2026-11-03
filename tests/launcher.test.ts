import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const launcher = join(root, 'bin/codexteams.mjs');
const fixtureSource = await readFile(new URL('./fixtures/launcher-pi.mjs', import.meta.url), 'utf8');

async function setup(t: TestContext) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'codexteams-launcher-case-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const pi = join(cwd, 'pi');
  await writeFile(pi, `#!${process.execPath}\n${fixtureSource}`, { mode: 0o755 });
  const capture = join(cwd, 'capture.jsonl');
  const env: NodeJS.ProcessEnv = { ...process.env, CODEXTEAMS_PI: pi, LAUNCHER_CAPTURE: capture };
  delete env.CODEXTEAMS_WORKER;
  delete env.LAUNCHER_FIXTURE_MODE;
  delete env.LAUNCHER_FIXTURE_VERSION;
  delete env.LAUNCHER_FIXTURE_EXIT;
  const records = async (): Promise<any[]> => {
    try { return (await readFile(capture, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  };
  return { cwd, pi, capture, env, records };
}

function invoke(args: string[], cwd: string, env: NodeJS.ProcessEnv, input = '') {
  const child = spawn(process.execPath, [launcher, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(input);
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolveResult, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveResult({ code, signal, stdout, stderr }));
  });
}

test('launcher sends one literal launch command with own extension and caller cwd', async t => {
  const f = await setup(t);
  const goal = '  한글 "quoted"\n$(touch INJECTED); `echo unsafe` @file --pi other  ';
  const result = await invoke([goal], f.cwd, f.env);
  assert.equal(result.code, 0, result.stderr);
  const records = await f.records();
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].args, ['--version']);
  assert.deepEqual(records[1].args, ['--mode', 'json', '--no-extensions', '-e', join(root, 'src/index.ts'), '--', `/teams launch ${goal}`]);
  assert.equal(records[1].cwd, f.cwd);
  assert.equal(records[1].selected, f.pi);
  assert.match(result.stdout, /fixture stdout/);
  assert.match(result.stderr, /fixture stderr/);
  await assert.rejects((await import('node:fs/promises')).access(join(f.cwd, 'INJECTED')), { code: 'ENOENT' });
});

test('no goal issues read-only status and does not create project state', async t => {
  const f = await setup(t);
  const result = await invoke([], f.cwd, f.env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await f.records())[1].args.at(-1), '/teams status');
  await assert.rejects(readFile(join(f.cwd, '.codexteams/state.json')), { code: 'ENOENT' });
});

test('help and version do not invoke Pi even with invalid Pi selection', async t => {
  const f = await setup(t);
  for (const args of [['--help'], ['-h'], ['--version'], ['-v']]) {
    const result = await invoke(args, f.cwd, { ...f.env, CODEXTEAMS_PI: '/missing/pi' });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, args[0].includes('version') || args[0] === '-v' ? /0\.8\.0/ : /Usage:.*codexteams/s);
  }
  assert.deepEqual(await f.records(), []);
});

test('invalid, empty, oversize goals and unsupported arguments fail before Pi probe', async t => {
  const f = await setup(t);
  for (const args of [[''], [' \n '], ['가'.repeat(5462)], ['--unknown'], ['one', 'two'], ['--pi'], ['--pi', ''], ['--help', 'goal'], ['goal', '--version']]) {
    const result = await invoke(args, f.cwd, f.env);
    assert.notEqual(result.code, 0, JSON.stringify(args));
    assert.match(result.stderr, /goal|argument|option|executable|Usage/i);
  }
  assert.deepEqual(await f.records(), []);
});

test('option boundary passes leading dashes literally and exact byte limit is accepted', async t => {
  const f = await setup(t);
  const result = await invoke(['--', '--version'], f.cwd, f.env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await f.records())[1].args.at(-1), '/teams launch --version');
  const boundary = await invoke(['a'.repeat(16384)], f.cwd, f.env);
  assert.equal(boundary.code, 0, boundary.stderr);
});

test('Pi selection precedence is explicit, environment, then PATH, and remains absolute', async t => {
  const f = await setup(t);
  const explicit = await invoke(['--pi', './pi', 'goal'], f.cwd, { ...f.env, CODEXTEAMS_PI: '/missing/env-pi' });
  assert.equal(explicit.code, 0, explicit.stderr);
  assert.equal((await f.records())[1].selected, f.pi);
  const envChoice = await invoke(['goal'], f.cwd, { ...f.env, PATH: '' });
  assert.equal(envChoice.code, 0, envChoice.stderr);
  const pathEnv: NodeJS.ProcessEnv = { ...f.env, PATH: `${f.cwd}${delimiter}${process.env.PATH ?? ''}` };
  delete pathEnv.CODEXTEAMS_PI;
  const pathChoice = await invoke(['goal'], f.cwd, pathEnv);
  assert.equal(pathChoice.code, 0, pathChoice.stderr);
  assert.equal((await f.records()).at(-1).selected, f.pi);
});

test('missing and non-executable selected Pi fail without falling back to PATH', async t => {
  const f = await setup(t);
  const inert = join(f.cwd, 'inert');
  await writeFile(inert, 'inert', { mode: 0o644 });
  for (const selected of ['/missing/pi', inert]) {
    const result = await invoke(['goal'], f.cwd, { ...f.env, CODEXTEAMS_PI: selected, PATH: f.cwd });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Pi|executable/i);
  }
  assert.deepEqual(await f.records(), []);
});

test('incompatible, malformed and failed version probes cannot launch work', async t => {
  const f = await setup(t);
  for (const version of ['1.3.99', '2.0.0', '1.4.0-beta.1', 'garbage', '1.4.0\n2.0.0']) {
    const result = await invoke(['goal'], f.cwd, { ...f.env, LAUNCHER_FIXTURE_VERSION: version });
    assert.notEqual(result.code, 0, version);
    assert.match(result.stderr, /version|1\.4\.0/i);
  }
  const failed = await invoke(['goal'], f.cwd, { ...f.env, LAUNCHER_FIXTURE_MODE: 'fail-version' });
  assert.notEqual(failed.code, 0);
  assert.match(failed.stderr, /version/i);
  assert.ok((await f.records()).every(record => record.args[0] === '--version'));
});

test('worker recursion is refused before any Pi invocation', async t => {
  const f = await setup(t);
  const result = await invoke(['goal'], f.cwd, { ...f.env, CODEXTEAMS_WORKER: '1' });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /worker/i);
  assert.deepEqual(await f.records(), []);
});

test('Pi exit status, stdout and stderr survive launcher', async t => {
  const f = await setup(t);
  const result = await invoke(['goal'], f.cwd, { ...f.env, LAUNCHER_FIXTURE_EXIT: '23' });
  assert.equal(result.code, 23);
  assert.match(result.stdout, /fixture stdout/);
  assert.match(result.stderr, /fixture stderr/);
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  test(`launcher forwards ${signal} to Pi and waits for its exit`, { timeout: 10000 }, async t => {
    const f = await setup(t);
    const child = spawn(process.execPath, [launcher, 'goal'], { cwd: f.cwd, env: { ...f.env, LAUNCHER_FIXTURE_MODE: 'wait-signal' }, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { child.kill('SIGKILL'); });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveClose => child.once('close', (code, signal) => resolveClose({ code, signal })));
    await new Promise<void>((resolveReady, reject) => {
      child.stdout.on('data', chunk => { if (String(chunk).includes('fixture ready')) resolveReady(); });
      child.once('close', code => reject(new Error(`Pi never became ready: ${code}: ${stderr}`)));
    });
    child.kill(signal);
    assert.deepEqual(await closed, { code: 37, signal: null });
    assert.ok((await f.records()).some(record => record.received === signal));
  });
}

test('Pi signal termination is propagated as a signal result', async t => {
  const f = await setup(t);
  const result = await invoke([], f.cwd, { ...f.env, LAUNCHER_FIXTURE_MODE: 'self-signal' });
  assert.equal(result.signal, 'SIGTERM');
});

test('selected Pi executable is used for worker resolution without changing default resolution', async t => {
  const f = await setup(t);
  const module = new URL('../src/runtime/pi-runner.ts', import.meta.url).href;
  const script = `import { resolvePiInvocation } from ${JSON.stringify(module)}; console.log(JSON.stringify(resolvePiInvocation()));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: f.cwd, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  assert.equal(await new Promise(resolveCode => child.once('close', resolveCode)), 0);
  assert.deepEqual(JSON.parse(stdout), { command: f.pi, args: [] });
});

test('hung version probe fails within its bound without launching a session', { timeout: 10000 }, async t => {
  const f = await setup(t);
  const result = await invoke(['goal'], f.cwd, { ...f.env, LAUNCHER_FIXTURE_MODE: 'hang-version' });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /version.*timed out/i);
  assert.deepEqual((await f.records()).map(record => record.args), [['--version']]);
});

test('excessive version output is rejected before launching a session', async t => {
  const f = await setup(t);
  const result = await invoke(['goal'], f.cwd, { ...f.env, LAUNCHER_FIXTURE_VERSION: '1'.repeat(20000) });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /version.*output limit/i);
  assert.deepEqual((await f.records()).map(record => record.args), [['--version']]);
});


test('nonempty redirected stdin is rejected before Pi probe for status and goal', async t => {
  const f = await setup(t);
  for (const args of [[], ['goal']]) {
    const result = await invoke(args, f.cwd, f.env, 'piped input must never become a model prompt\n');
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /stdin|standard input/i);
  }
  assert.deepEqual(await f.records(), []);
});

test('help, version and worker recursion do not wait for redirected stdin EOF', { timeout: 5000 }, async t => {
  const f = await setup(t);
  for (const [args, worker, expectedCode] of [[['--help'], '', 0], [['--version'], '', 0], [['goal'], '1', 1]] as const) {
    const child = spawn(process.execPath, [launcher, ...args], {
      cwd: f.cwd, env: { ...f.env, CODEXTEAMS_WORKER: worker }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    t.after(() => { child.kill('SIGKILL'); });
    child.stdout.resume();
    child.stderr.resume();
    assert.equal(await new Promise(resolveClose => child.once('close', resolveClose)), expectedCode);
  }
  assert.deepEqual(await f.records(), []);
});

test('redirected stdin rejects on its first chunk without waiting for EOF', { timeout: 5000 }, async t => {
  const f = await setup(t);
  const child = spawn(process.execPath, [launcher, 'goal'], { cwd: f.cwd, env: f.env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.kill('SIGKILL'); });
  child.stdout.resume();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  child.stdin.write('\n');
  assert.equal(await new Promise(resolveClose => child.once('close', resolveClose)), 1);
  assert.match(stderr, /stdin|standard input/i);
  assert.deepEqual(await f.records(), []);
});


test('redirected streams request JSON output from Pi for non-UI extension messages', async t => {
  const f = await setup(t);
  const result = await invoke([], f.cwd, f.env);
  assert.equal(result.code, 0, result.stderr);
  const records = await f.records();
  assert.deepEqual(records[0].args, ['--version']);
  assert.equal(records[1].stdinTTY, false);
  assert.equal(records[1].stdoutTTY, false);
  assert.deepEqual(records[1].args.slice(0, 2), ['--mode', 'json']);
  const help = await invoke(['--help'], f.cwd, f.env);
  assert.match(help.stdout, /JSONL/);
});
