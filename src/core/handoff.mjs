import { createHash } from 'node:crypto';
import { constants, lstatSync, openSync, closeSync, fstatSync, readSync, realpathSync, readFileSync } from 'node:fs';
import { isAbsolute, join, parse, resolve } from 'node:path';
import { validateState, validateAttempt, validateCheck, validateObservation } from './state-validation.mjs';
import { isDeepStrictEqual } from 'node:util';

const MAX_FILE = 65536;
function object(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) throw new Error('Invalid or unknown request fields.');
  return value;
}
function text(value, max, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || Buffer.byteLength(value) > max) throw new Error('Invalid or oversized request text.');
  return value;
}
export function validRequestId(id) { return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id); }
export function normalizeRequest(value, root) {
  const r = object(value, ['schemaVersion', 'requestId', 'projectRoot', 'source', 'goal', 'task', 'context']);
  if (r.schemaVersion !== 1 || !validRequestId(r.requestId)) throw new Error('Invalid request version or ID.');
  if (typeof r.projectRoot !== 'string' || !isAbsolute(r.projectRoot) || realpathSync(r.projectRoot) !== r.projectRoot || r.projectRoot !== realpathSync(root)) throw new Error('Request projectRoot must be canonical and match cwd.');
  const s = object(r.source, ['kind', 'stopped', 'checkpoint'], ['sessionId']);
  if (s.kind !== 'codex' || s.stopped !== true) throw new Error('Source must declare codex stopped.');
  const source = { kind: 'codex', ...(s.sessionId === undefined ? {} : { sessionId: text(s.sessionId, 2048) }), checkpoint: text(s.checkpoint, 2048), stopped: true };
  const task = object(r.task, ['title', 'description', 'role', 'acceptance']);
  if (typeof task.title !== 'string' || !task.title.trim() || [...task.title].length > 160 || !['developer', 'designer', 'reviewer'].includes(task.role)) throw new Error('Invalid task title or role.');
  if (!Array.isArray(task.acceptance) || task.acceptance.length < 1 || task.acceptance.length > 16) throw new Error('Invalid task acceptance.');
  const context = object(r.context, ['summary', 'completed', 'constraints', 'files', 'evidence']);
  const array = key => { const a = context[key]; if (!Array.isArray(a) || a.length > 64) throw new Error('Invalid context array.'); return a.map(x => text(x, 2048)); };
  return { schemaVersion: 1, requestId: r.requestId, projectRoot: r.projectRoot, source, goal: text(r.goal, 16384), task: { title: task.title, description: text(task.description, 16384), role: task.role, acceptance: task.acceptance.map(x => text(x, 2048)) }, context: { summary: text(context.summary, 16384, true), completed: array('completed'), constraints: array('constraints'), files: array('files'), evidence: array('evidence') } };
}
export function requestDigest(request) { return createHash('sha256').update(JSON.stringify(request)).digest('hex'); }
export function readRequest(path, root) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) throw new Error('Request path must be absolute and normalized.');
  let current = parse(path).root;
  const components = [];
  for (const part of path.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part); const entry = lstatSync(current);
    if (entry.isSymbolicLink()) throw new Error('Symlink in request path.');
    components.push({ path: current, dev: entry.dev, ino: entry.ino });
  }
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const stat = fstatSync(fd); if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Request must be a regular file of at most 64 KiB.');
    for (const component of components) { const entry = lstatSync(component.path); if (entry.isSymbolicLink() || entry.dev !== component.dev || entry.ino !== component.ino) throw new Error('Request path changed while opening.'); }
    const last = components.at(-1); if (!last || stat.dev !== last.dev || stat.ino !== last.ino) throw new Error('Request file changed while opening.');
    const bytes = Buffer.alloc(MAX_FILE + 1); let length = 0, count;
    while (length < bytes.length && (count = readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += count;
    if (length > MAX_FILE) throw new Error('Request exceeds 64 KiB.');
    return normalizeRequest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))), root);
  } finally { closeSync(fd); }
}
export function handoffResult(state, id, root) {
  if (!validRequestId(id)) throw new Error('Invalid request ID.');
  const task = state?.tasks?.find(t => t.handoff?.request?.requestId === id);
  if (!task) return { schemaVersion: 1, kind: 'codexteams.handoff.result', requestId: id, status: 'not_found', project: state ? { id: state.id, root: state.root, revision: state.revision } : { id: null, root, revision: null }, task: null, recoveryRequired: Boolean(state?.recoveryRequired), limitations: ['No matching persisted handoff.'] };
  const latest = task.attempts.at(-1) ?? null;
  return { schemaVersion: 1, kind: 'codexteams.handoff.result', requestId: id, digest: task.handoff.digest, status: task.status, project: { id: state.id, root: state.root, revision: state.revision }, task: { id: task.id, title: task.title, role: task.role, status: task.status }, attempts: task.attempts, currentAttempt: latest, checks: task.checks, observations: task.handoff.observations, errors: task.handoff.errors, recoveryRequired: Boolean(state.recoveryRequired), limitations: ['Worker verification is self-reported; checks are controller records.', 'Workspace observations include pre-existing changes and do not attribute authorship.', ...(task.status === 'queued' ? [`Reserved only; use /teams resume ${task.id} to execute explicitly.`] : [])] };
}
export function validateSubmissionResult(value, request) {
  const fail = () => { throw new Error('Malformed or mismatched handoff result.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || value.kind !== 'codexteams.handoff.result' || value.requestId !== request.requestId || !Array.isArray(value.limitations) || value.limitations.some(x => typeof x !== 'string')) fail();
  if (value.status === 'rejected') { if (value.task !== null || typeof value.error !== 'string') fail(); return; }
  if (!['queued', 'running', 'needs_review', 'completed', 'failed', 'interrupted', 'cancelled'].includes(value.status) || value.digest !== requestDigest(request) || !value.project || typeof value.project.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.project.id) || value.project.root !== request.projectRoot || !Number.isSafeInteger(value.project.revision) || value.project.revision < 0 || !value.task || typeof value.task.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(value.task.id) || value.task.status !== value.status || value.task.title !== request.task.title || value.task.role !== request.task.role || !Array.isArray(value.attempts) || !Array.isArray(value.checks) || !Array.isArray(value.observations) || value.observations.length > 256 || !Array.isArray(value.errors) || value.errors.length > 64 || value.errors.some(e => typeof e !== 'string' || Buffer.byteLength(e) > 4096) || typeof value.recoveryRequired !== 'boolean') fail();
  const attempts = new Set(), checks = new Set();
  for (const attempt of value.attempts) {
    validateAttempt(attempt, attempts);
    if (attempt.endedAt !== undefined && Date.parse(attempt.endedAt) < Date.parse(attempt.startedAt)) fail();
  }
  for (const check of value.checks) {
    validateCheck(check, value.attempts, checks);
    if (check.endedAt !== undefined && Date.parse(check.endedAt) < Date.parse(check.startedAt)) fail();
  }
  for (const observation of value.observations) validateObservation(observation, value.attempts);
  const latest = value.attempts.at(-1) ?? null;
  if (!isDeepStrictEqual(value.currentAttempt, latest)) fail();
  if (['needs_review', 'completed'].includes(value.status) && (!latest || latest.outcome !== 'success' || !latest.endedAt)) fail();
}
// Read-only lookup for the standalone launcher; never opens a store or invokes Pi.
export function readResult(root, id) {
  const canonical = realpathSync(root), directory = join(canonical, '.codexteams'), file = join(directory, 'state.json');
  let source;
  try {
    if (lstatSync(directory).isSymbolicLink() || lstatSync(file).isSymbolicLink()) throw new Error('Symlink state path.');
    source = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return handoffResult(null, id, canonical);
  }
  const state = JSON.parse(source);
  validateState(state, canonical);
  return handoffResult(state, id, canonical);
}
