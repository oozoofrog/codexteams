import { normalizeRequest, requestDigest } from './handoff.mjs';
import { isAbsolute, normalize, extname, join, sep } from 'node:path';
import { createHash } from 'node:crypto';

export function reviewScope(request, writer, checkIds) {
  return { requestText: request.text, amendments: (request.amendments ?? []).filter(a => a.status === 'applied').map(a => ({ requestId: a.requestId, instruction: a.instruction })), writer: { id: writer.id, title: writer.title, description: writer.description, acceptance: writer.acceptance }, checks: checkIds.map(id => { const check = writer.checks.find(c => c.id === id); if (!check) throw new Error('검토 검증 근거가 없습니다.'); return { id: check.id, command: check.command, status: check.status, exitCode: check.exitCode, output: check.output.slice(-4000), outputTruncated: check.output.length > 4000 }; }) };
}
export function reviewScopeDigest(scope) { return createHash('sha256').update(JSON.stringify(scope)).digest('hex'); }

const statuses = new Set(['queued', 'running', 'needs_review', 'completed', 'failed', 'interrupted', 'cancelled']);
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const validPid = value => value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
function validateProfile(p) {
  if (!p || typeof p !== 'object') throw new Error('모델 프로필이 필요합니다.');
  for (const key of ['provider', 'model']) if (typeof p[key] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(p[key])) throw new Error(`잘못된 ${key}: provider/model을 명시하세요.`);
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(p.effort)) throw new Error('지원 추론 단계: low, medium, high, xhigh, max. ultra는 물리 추론 단계가 아닙니다.');
}
export function validateUsage(usage) {
  if (!usage || !['known', 'partial', 'unknown'].includes(usage.completeness) || !Number.isSafeInteger(usage.responses) || usage.responses < 0) throw new Error('손상된 사용량 state입니다.');
  for (const name of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'totalTokens', 'costUsd']) { const value = usage[name]; if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('손상된 사용량 state입니다.'); }
}
export function validateAttempt(attempt, seen) {
  if (!attempt || !validId(attempt.id) || seen.has(attempt.id) || !validId(attempt.sessionId) || !validDate(attempt.startedAt) || !validPid(attempt.workerPid) || typeof attempt.text !== 'string' || !Array.isArray(attempt.effectiveModels) || attempt.effectiveModels.some(m => typeof m !== 'string') || attempt.logFile !== `logs/${attempt.id}.jsonl`) throw new Error('손상된 실행 시도 state입니다.');
  if (attempt.endedAt !== undefined && (!validDate(attempt.endedAt) || !['success', 'failed', 'aborted'].includes(attempt.outcome))) throw new Error('실행 종료 state가 일치하지 않습니다.');
  if (attempt.outcome !== undefined && !attempt.endedAt) throw new Error('실행 종료 시각이 없는 state입니다.');
  if (attempt.error !== undefined && typeof attempt.error !== 'string') throw new Error('손상된 실행 오류 state입니다.');
  if (attempt.recoveryPending !== undefined && typeof attempt.recoveryPending !== 'boolean') throw new Error('손상된 복구 state입니다.');
  validateProfile(attempt.profile); validateUsage(attempt.usage); seen.add(attempt.id);
}
export function validateCheck(check, attempts, seen) {
  if (!check || !validId(check.id) || seen.has(check.id) || typeof check.command !== 'string' || !check.command.trim() || !attempts.some(a => a.id === check.attemptId) || !validDate(check.startedAt) || !validPid(check.workerPid) || typeof check.output !== 'string' || !['running', 'passed', 'failed', 'interrupted'].includes(check.status)) throw new Error('손상된 검증 state입니다.');
  if (check.source !== undefined && !['user', 'team_coordinator'].includes(check.source)) throw new Error('잘못된 검증 출처입니다.');
  if (check.exitCode !== null && !Number.isInteger(check.exitCode)) throw new Error('잘못된 검증 종료 코드입니다.');
  if (check.status === 'running' ? check.endedAt !== undefined || check.exitCode !== null : !validDate(check.endedAt)) throw new Error('검증 종료 state가 일치하지 않습니다.');
  if (check.status === 'passed' && check.exitCode !== 0) throw new Error('통과 검증의 종료 코드가 0이 아닙니다.');
  if (check.status === 'failed' && check.exitCode === 0) throw new Error('실패 검증의 종료 코드가 0입니다.');
  seen.add(check.id);
}
export function validateObservation(observation, attempts) {
  if (!observation || !validDate(observation.at) || !attempts.some(a => a?.id === observation.attemptId) || !['before', 'after'].includes(observation.phase) || !['available', 'unavailable', 'truncated'].includes(observation.status) || typeof observation.gitStatus !== 'string' || Buffer.byteLength(observation.gitStatus) > 32768 || typeof observation.diffSummary !== 'string' || Buffer.byteLength(observation.diffSummary) > 32768 || (observation.error !== undefined && (typeof observation.error !== 'string' || Buffer.byteLength(observation.error) > 4096))) throw new Error('손상된 handoff 관찰 state입니다.');
}
function validateTeamMode(mode, state, attemptIds) {
  const fail = () => { throw new Error('손상된 팀 모드 state입니다.'); };
  const exact = (obj, allowed) => obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).every(k => allowed.includes(k));
  const bounded = (s, limit) => typeof s === 'string' && !!s.trim() && Buffer.byteLength(s) <= limit;
  const natural = n => Number.isSafeInteger(n) && n >= 0;
  if (!exact(mode, ['version', 'enabled', 'generation', 'requests', 'coordinatorAttempts', 'events', 'reviewEvidence']) || mode.version !== 1 || typeof mode.enabled !== 'boolean' || !natural(mode.generation) || !['requests', 'coordinatorAttempts', 'events', 'reviewEvidence'].every(k => Array.isArray(mode[k]) && mode[k].length <= 10000)) fail();
  const requests = new Map();
  for (const r of mode.requests) {
    if (!exact(r, ['id', 'text', 'origin', 'sessionId', 'receivedAt', 'revision', 'status', 'taskIds', 'answer', 'reason', 'checks', 'checkpoint', 'streamingIntent', 'amendments', 'artifactDigest', 'fixInstruction']) || !validId(r.id) || requests.has(r.id) || !bounded(r.text, 16384) || !['interactive', 'rpc'].includes(r.origin) || !validId(r.sessionId) || !validDate(r.receivedAt) || !natural(r.revision) || r.revision < 1 || !['received', 'classifying', 'queued', 'running', 'paused', 'blocked', 'answered', 'awaiting_user_acceptance', 'cancelled', 'failed'].includes(r.status) || !Array.isArray(r.taskIds) || r.taskIds.length > 32 || new Set(r.taskIds).size !== r.taskIds.length || r.taskIds.some(id => !state.tasks.some(t => t.id === id)) || (r.answer !== undefined && !bounded(r.answer, 16384)) || (r.reason !== undefined && !bounded(r.reason, 16384))) fail();
    if (r.streamingIntent !== undefined && !['steer', 'followUp'].includes(r.streamingIntent)) fail();
    if ((r.checks !== undefined && (!Array.isArray(r.checks) || r.checks.length > 16 || r.checks.some(c => !bounded(c, 16384)) || new Set(r.checks).size !== r.checks.length)) || (r.checkpoint !== undefined && !['implementation', 'checks', 'review', 'fix', 'revalidate'].includes(r.checkpoint))) fail();
    if ((r.artifactDigest !== undefined && !/^[a-f0-9]{64}$/.test(r.artifactDigest)) || (r.fixInstruction !== undefined && !bounded(r.fixInstruction, 16384))) fail();
    if (r.amendments !== undefined && (!Array.isArray(r.amendments) || r.amendments.length > 256 || r.amendments.some(a => !exact(a, ['requestId', 'instruction', 'timing', 'status']) || !validId(a.requestId) || !bounded(a.instruction, 16384) || !['after_current', 'interrupt_then_resume'].includes(a.timing) || !['pending', 'applied'].includes(a.status)))) fail();
    requests.set(r.id, r);
  }
  for (const r of mode.requests) if (r.amendments?.some(a => !requests.has(a.requestId) || a.requestId === r.id)) fail();
  for (const a of mode.coordinatorAttempts) {
    if (!exact(a, ['id', 'sessionId', 'profile', 'startedAt', 'endedAt', 'outcome', 'effectiveModels', 'text', 'error', 'usage', 'logFile', 'workerPid', 'recoveryPending', 'requestId', 'generation', 'requestRevision']) || !requests.has(a.requestId) || !natural(a.generation) || a.generation > mode.generation || !natural(a.requestRevision) || a.requestRevision < 1 || a.requestRevision > requests.get(a.requestId).revision) fail();
    validateAttempt(a, attemptIds);
  }
  const eventIds = new Set();
  for (const e of mode.events) {
    if (!exact(e, ['id', 'requestId', 'kind', 'at']) || !validId(e.id) || eventIds.has(e.id) || !requests.has(e.requestId) || !['received', 'applied', 'uncertain'].includes(e.kind) || !validDate(e.at)) fail();
    eventIds.add(e.id);
  }
  const reviewIds = new Set();
  for (const e of mode.reviewEvidence) {
    const req = requests.get(e?.requestId), impl = state.tasks.find(t => t.id === e?.implementationTaskId), reviewer = state.tasks.find(t => t.id === e?.reviewerTaskId);
    if (!exact(e, ['id', 'requestId', 'implementationTaskId', 'implementationAttemptId', 'reviewerTaskId', 'reviewerAttemptId', 'artifactDigest', 'verdict', 'checkIds', 'requestRevision', 'scope', 'scopeDigest']) || !validId(e.id) || reviewIds.has(e.id) || !req || !req.taskIds.includes(impl?.id) || !req.taskIds.includes(reviewer?.id) || impl?.role === 'reviewer' || reviewer?.role !== 'reviewer' || !impl?.attempts.some(a => a.id === e.implementationAttemptId) || !reviewer?.attempts.some(a => a.id === e.reviewerAttemptId) || !/^[a-f0-9]{64}$/.test(e.artifactDigest) || !['pass', 'changes_required', 'blocked'].includes(e.verdict) || !Array.isArray(e.checkIds) || new Set(e.checkIds).size !== e.checkIds.length || e.checkIds.some(id => !impl.checks.some(c => c.id === id && c.attemptId === e.implementationAttemptId))) fail();
    if (e.scope !== undefined || e.scopeDigest !== undefined || e.requestRevision !== undefined) {
      const scope = e.scope, actual = reviewScope(req, impl, e.checkIds);
      if (!natural(e.requestRevision) || e.requestRevision < 1 || e.requestRevision > req.revision || !exact(scope, ['requestText', 'amendments', 'writer', 'checks']) || scope.requestText !== req.text || !exact(scope.writer, ['id', 'title', 'description', 'acceptance']) || JSON.stringify(scope.writer) !== JSON.stringify(actual.writer) || !Array.isArray(scope.amendments) || scope.amendments.length > 256 || scope.amendments.some(a => !exact(a, ['requestId', 'instruction']) || !(req.amendments ?? []).some(x => x.requestId === a.requestId && x.instruction === a.instruction && x.status === 'applied')) || new Set(scope.amendments.map(a => a.requestId)).size !== scope.amendments.length || JSON.stringify(scope.checks) !== JSON.stringify(actual.checks) || !/^[a-f0-9]{64}$/.test(e.scopeDigest) || reviewScopeDigest(scope) !== e.scopeDigest || (e.requestRevision === req.revision && reviewScopeDigest(actual) !== e.scopeDigest)) fail();
    }
    if (e.verdict === 'pass' && (impl.attempts.find(a => a.id === e.implementationAttemptId)?.outcome !== 'success' || reviewer.attempts.find(a => a.id === e.reviewerAttemptId)?.outcome !== 'success' || e.checkIds.some(id => impl.checks.find(c => c.id === id)?.status !== 'passed'))) fail();
    reviewIds.add(e.id);
  }
}

export function validateState(state, root) {
  if (!state || state.schemaVersion !== 1 || state.root !== root || !validId(state.id) || !Number.isSafeInteger(state.revision) || state.revision < 0 || typeof state.goal !== 'string' || !validDate(state.createdAt) || !validDate(state.updatedAt) || !Array.isArray(state.tasks) || !Array.isArray(state.planningAttempts) || !state.profiles || (state.recoveryRequired !== undefined && typeof state.recoveryRequired !== 'boolean')) throw new Error('지원하지 않거나 손상된 프로젝트 state입니다.');
  for (const role of ['planner', 'developer', 'designer', 'reviewer']) validateProfile(state.profiles[role]);
  const ids = new Set(), handoffIds = new Set(), attemptIds = new Set(), checkIds = new Set();
  for (const attempt of state.planningAttempts) validateAttempt(attempt, attemptIds);
  for (const task of state.tasks) {
    if (!task || typeof task.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(task.id) || ids.has(task.id) || !statuses.has(task.status) || !['developer', 'designer', 'reviewer'].includes(task.role) || typeof task.title !== 'string' || !task.title.trim() || typeof task.description !== 'string' || !task.description.trim() || !validDate(task.createdAt) || !validDate(task.updatedAt) || !Array.isArray(task.acceptance) || !task.acceptance.length || task.acceptance.some(a => typeof a !== 'string' || !a.trim()) || !Array.isArray(task.dependsOn) || task.dependsOn.some(d => typeof d !== 'string') || new Set(task.dependsOn).size !== task.dependsOn.length || !Array.isArray(task.attempts) || !Array.isArray(task.checks)) throw new Error('손상된 작업 state입니다.');
    if (task.handoff !== undefined) {
      const h = task.handoff; if (!h || typeof h !== 'object') throw new Error('손상된 handoff state입니다.');
      const request = normalizeRequest(h.request, root);
      if (handoffIds.has(request.requestId) || requestDigest(request) !== h.digest || !validDate(h.submittedAt) || task.title !== request.task.title || task.description !== request.task.description || task.role !== request.task.role || JSON.stringify(task.acceptance) !== JSON.stringify(request.task.acceptance) || task.dependsOn.length !== 0 || !Array.isArray(h.errors) || h.errors.length > 64 || h.errors.some(e => typeof e !== 'string' || Buffer.byteLength(e) > 4096) || !Array.isArray(h.observations) || h.observations.length > 256) throw new Error('손상된 handoff state입니다.');
      for (const observation of h.observations) validateObservation(observation, task.attempts);
      handoffIds.add(request.requestId);
    }
    for (const attempt of task.attempts) validateAttempt(attempt, attemptIds);
    for (const check of task.checks) validateCheck(check, task.attempts, checkIds);
    const latest = task.attempts.at(-1);
    if (['needs_review', 'completed'].includes(task.status) && (!latest || latest.outcome !== 'success' || !latest.endedAt)) throw new Error('검토·완료 상태에 성공한 실행 기록이 없습니다.');
    if (task.status === 'completed' && (!validDate(task.acceptedAt) || task.acceptanceSource !== 'user' || task.acceptedAttemptId !== latest.id || !Array.isArray(task.acceptedCheckIds) || task.acceptedCheckIds.some(id => !task.checks.some(c => c.id === id && c.attemptId === latest.id)))) throw new Error('작업 수락 증거 state가 일치하지 않습니다.');
    ids.add(task.id);
  }
  if (state.teamMode !== undefined) validateTeamMode(state.teamMode, state, attemptIds);
  if (state.navigation !== undefined) {
    const nav = state.navigation;
    const workerDir = join(root, '.codexteams', 'sessions') + sep;
    const validPath = p => typeof p === 'string' && isAbsolute(p) && normalize(p) === p && extname(p) === '.jsonl' && !p.includes('\0') && !p.startsWith(workerDir);
    if (!nav || !nav.root || !validId(nav.root.id) || !validPath(nav.root.file) || !Array.isArray(nav.views)) throw new Error('손상된 탐색 state입니다.');
    const sessions = new Set([nav.root.id]), files = new Set([nav.root.file]), targets = new Set();
    for (const view of nav.views) {
      const target = view?.kind === 'task' ? state.tasks.find(t => t.id === view.targetId) : view?.kind === 'planning' ? state.planningAttempts.find(a => a.id === view.targetId) : undefined;
      const worker = view?.kind === 'task' ? target?.attempts?.some(a => a.sessionId === view.workerSessionId) : target?.sessionId === view?.workerSessionId;
      const key = `${view?.kind}:${view?.targetId}`;
      if (!target || !validId(view.sessionId) || !validPath(view.file) || view.parentSession !== nav.root.file || sessions.has(view.sessionId) || files.has(view.file) || targets.has(key) || (view.workerSessionId !== undefined && (!validId(view.workerSessionId) || !worker))) throw new Error('손상된 조회 세션 state입니다.');
      sessions.add(view.sessionId); files.add(view.file); targets.add(key);
    }
  }
  for (const task of state.tasks) if (task.dependsOn.some(id => !ids.has(id))) throw new Error('state 의존 작업이 없습니다.');
  const byId = new Map(state.tasks.map(task => [task.id, task])), complete = new Set(), active = new Set();
  function visit(id) { if (active.has(id)) throw new Error('state 작업 의존성에 cycle이 있습니다.'); if (complete.has(id)) return; active.add(id); for (const dependency of byId.get(id).dependsOn) visit(dependency); active.delete(id); complete.add(id); }
  for (const id of ids) visit(id);
}
